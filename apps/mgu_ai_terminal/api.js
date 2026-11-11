'use strict';
const https = require('https');
const dns = require('dns');
const fs = require('fs');

// Direct HTTPS to the model provider. The head unit's Node 8 cannot run the
// vendors' SDKs, so requests are built by hand. This client allows only these hosts.
const HOSTS = { anthropic: 'api.anthropic.com', openai: 'api.openai.com' };
const MAX_REPLY = 8 * 1024 * 1024;

// mgu-uplink routes per UID but does not replace the HU resolver, so provider
// names are resolved with the DNS servers from the uplink lease.
function leaseLookup(leasePath) {
    if (!leasePath || !fs.existsSync(leasePath)) return null;
    return function (hostname, options, callback) {
        if (typeof options === 'function') { callback = options; options = {}; }
        let servers;
        try {
            servers = JSON.parse(fs.readFileSync(leasePath, 'utf8')).dns;
            if (!Array.isArray(servers) || !servers.length) throw new Error('none');
        } catch (e) { callback(new Error('No uplink DNS')); return; }
        const resolver = new dns.Resolver();
        try { resolver.setServers(servers); } catch (e) { callback(new Error('Bad uplink DNS')); return; }
        resolver.resolve4(hostname, (error, addresses) => {
            if (error || !addresses || !addresses.length) { callback(error || new Error('No address for ' + hostname)); return; }
            if (options && options.all) callback(null, addresses.map(a => ({ address: a, family: 4 })));
            else callback(null, addresses[0], 4);
        });
    };
}

function post(request, options, callback) {
    let finished = false, deadline;
    const done = (error, result) => { if (!finished) { finished = true; clearTimeout(deadline); callback(error, result); } };
    if (request.host !== HOSTS.anthropic && request.host !== HOSTS.openai) {
        done(new Error('Destination is not an allowed provider'));
        return { destroy() {} };
    }
    const data = Buffer.from(JSON.stringify(request.body), 'utf8');
    const settings = {
        host: request.host, port: 443, method: 'POST', path: request.path,
        headers: Object.assign({ 'content-type': 'application/json', 'accept': 'application/json', 'content-length': data.length }, request.headers)
    };
    if (options.ca) settings.ca = options.ca;
    const lookup = leaseLookup(options.leasePath);
    if (lookup) settings.lookup = lookup;
    const req = (options.request || https.request)(settings, res => {
        const chunks = [];
        let size = 0;
        res.on('data', chunk => {
            size += chunk.length;
            if (size > MAX_REPLY) { req.destroy(fatal('Provider reply is too large')); return; }
            chunks.push(chunk);
        });
        res.on('error', error => done(error));
        res.on('aborted', () => { const error = new Error('Provider reply was interrupted'); error.retryable = true; done(error); });
        res.on('end', () => {
            let body = null;
            try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (e) { body = null; }
            if (res.statusCode === 200 && !body) { done(new Error('Provider sent an unreadable reply')); return; }
            done(null, { status: res.statusCode, body: body || {} });
        });
    });
    const fatal = message => { const error = new Error(message); error.retryable = false; return error; };
    req.setTimeout(options.timeoutMs || 300000, () => req.destroy(fatal('Provider timed out')));
    // Socket timeouts do not cover stalled DNS resolution or connection setup.
    deadline = setTimeout(() => {
        const error = fatal('Provider timed out');
        done(error);
        req.destroy(error);
    }, options.timeoutMs || 300000);
    req.on('error', error => { if (error.retryable === undefined) error.retryable = true; done(error); });
    req.on('close', () => { if (!finished) done(fatal('Provider connection closed without a reply')); });
    req.end(data);
    return { destroy() { done(fatal('Stopped')); req.destroy(); } };
}

// Returns { promise, abort }. Retries rate limits, server errors and network
// failures twice; nothing else is retried.
function call(request, options) {
    options = options || {};
    let aborted = false, active = null, timer = null, fail;
    const pause = options.backoffMs === undefined ? 1500 : options.backoffMs;
    const promise = new Promise((resolve, reject) => {
        fail = reject;
        let attempt = 0;
        const run = () => {
            active = post(request, options, (error, result) => {
                active = null;
                if (aborted) return;
                const retry = error ? error.retryable : (result.status === 429 || result.status >= 500);
                if (retry && attempt < 2) { attempt++; timer = setTimeout(run, attempt * pause); return; }
                if (error) reject(error); else resolve(result);
            });
        };
        run();
    });
    return {
        promise,
        abort() {
            if (aborted) return;
            aborted = true;
            clearTimeout(timer);
            if (active) active.destroy();
            fail(new Error('Stopped'));
        }
    };
}

function failure(label, status, body) {
    const detail = body && body.error && typeof body.error.message === 'string' ? body.error.message : '';
    if (status === 401 || status === 403) return new Error(label + ' rejected the API key');
    if (status === 429) return new Error(label + ' rate limit reached; wait and try again');
    if (status >= 500) return new Error(label + ' is unavailable (' + status + ')');
    return new Error(label + ' error ' + status + (detail ? ': ' + detail.slice(0, 200) : ''));
}

// Each provider keeps history in its own wire format; the agent only sees
// { entry, text, calls: [{ id, name, input, invalid }], stop }.
const anthropic = {
    name: 'anthropic', label: 'Claude',
    build(config, system, tools, history) {
        return {
            host: HOSTS.anthropic, path: '/v1/messages',
            headers: {
                'x-api-key': config.anthropicKey,
                'anthropic-version': '2026-10-21',
                // If a safety classifier declines, the API retries on its recommended fallback model.
                'anthropic-beta': 'server-side-fallback-2026-07-01'
            },
            body: {
                model: config.anthropicModel, max_tokens: 16000, system: system,
                fallbacks: 'default', cache_control: { type: 'ephemeral' },
                tools: tools.map(t => ({ name: t.name, description: t.description, input_schema: t.schema, strict: true })),
                messages: history
            }
        };
    },
    user(text) { return { role: 'user', content: text }; },
    parse(status, body) {
        if (status !== 200) throw failure('Claude', status, body);
        const content = Array.isArray(body.content) ? body.content : [];
        const stops = { end_turn: 'end', tool_use: 'tools', max_tokens: 'max', refusal: 'refusal', model_context_window_exceeded: 'context' };
        return {
            // The whole content array goes back unchanged: it carries thinking blocks the API expects.
            entry: { role: 'assistant', content: content },
            text: content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim(),
            calls: content.filter(b => b.type === 'tool_use').map(b => ({ id: b.id, name: b.name, input: b.input })),
            stop: stops[body.stop_reason] || 'end'
        };
    },
    results(list) {
        return [{ role: 'user', content: list.map(r => {
            const block = { type: 'tool_result', tool_use_id: r.id, content: r.content };
            if (r.error) block.is_error = true;
            return block;
        }) }];
    }
};

const openai = {
    name: 'openai', label: 'OpenAI',
    build(config, system, tools, history) {
        return {
            host: HOSTS.openai, path: '/v1/chat/completions',
            headers: { authorization: 'Bearer ' + config.openaiKey },
            body: {
                model: config.openaiModel,
                messages: [{ role: 'system', content: system }].concat(history),
                tools: tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.schema } }))
            }
        };
    },
    user(text) { return { role: 'user', content: text }; },
    parse(status, body) {
        if (status !== 200) throw failure('OpenAI', status, body);
        const choice = Array.isArray(body.choices) && body.choices[0];
        if (!choice || !choice.message) throw new Error('OpenAI sent an unreadable reply');
        const message = choice.message;
        const raw = Array.isArray(message.tool_calls) ? message.tool_calls.filter(c => c.type === 'function' && c.function) : [];
        const calls = raw.map(c => {
            let input = null, invalid = false;
            try { input = JSON.parse(c.function.arguments); } catch (e) { invalid = true; }
            return { id: c.id, name: c.function.name, input: input, invalid: invalid };
        });
        const entry = { role: 'assistant', content: typeof message.content === 'string' ? message.content : null };
        if (raw.length) entry.tool_calls = raw;
        let stop = 'end';
        if (message.refusal || choice.finish_reason === 'content_filter') stop = 'refusal';
        else if (choice.finish_reason === 'length') stop = 'max';
        else if (calls.length) stop = 'tools';
        return { entry: entry, text: (entry.content || '').trim(), calls: calls, stop: stop };
    },
    results(list) { return list.map(r => ({ role: 'tool', tool_call_id: r.id, content: r.content })); }
};

module.exports = { call, post, leaseLookup, providers: { anthropic, openai }, HOSTS };
