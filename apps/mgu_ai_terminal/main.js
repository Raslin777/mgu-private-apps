'use strict';
const fs = require('fs');
const path = require('path');
const mgu = require('./kit/mgu');
const api = require('./api');
const config = require('./config');
const Agent = require('./agent').Agent;
const Tools = require('./tools').Tools;
const draw = require('./view').draw;
const spell = require('./speller').spell;
const PhoneLink = require('./link').PhoneLink;

const LEASE = '/run/mgu-uplink/lease.json';
const ROOT_SOCKET = '/run/mgu-ai-root/root.sock';

const SSH_PATHS = ['/usr/bin/ssh', '/bin/ssh', '/usr/sbin/ssh', '/usr/local/bin/ssh'];

function mkdir(dir) { if (!fs.existsSync(dir)) fs.mkdirSync(dir, 448); }

// The bundled root key is copied to the data directory with mode 0600 (an SSH
// client refuses a key other users can read). Returns null when no key is
// bundled or this head unit has no SSH client.
function rootSsh(dataDir) {
    const pem = require('./rootkey');
    if (typeof pem !== 'string' || pem.indexOf('PRIVATE KEY') < 0) return null;
    const sshPath = SSH_PATHS.filter(p => fs.existsSync(p))[0];
    if (!sshPath) return null;
    const keyFile = path.join(dataDir, 'root_key');
    let current = null;
    try { current = fs.readFileSync(keyFile, 'utf8'); } catch (e) { current = null; }
    if (current !== pem) {
        try { fs.unlinkSync(keyFile); } catch (e) { /* not there */ }
        fs.writeFileSync(keyFile, pem, { mode: 384 });
    }
    fs.chmodSync(keyFile, 384);
    // Each line of the key counts as a secret, so it is removed from any output.
    return { sshPath: sshPath, keyFile: keyFile, secrets: pem.split('\n').map(l => l.trim()).filter(l => l.length >= 16 && l.indexOf('-----') < 0) };
}

mgu.run({
    async start(ctx) {
        let agent = null, offset = 0, entering = false;
        const idle = { status: 'Starting', lines: [], approvals: [] };
        const workspace = path.join(ctx.dataDir, 'workspace');
        mkdir(workspace);
        const buttons = () => {
            const review = agent && agent.approvals.length;
            ctx.ui.text('BTN_ASK', review ? 'Approve' : 'Ask');
            ctx.ui.text('BTN_SETUP', review ? 'Deny' : 'Reload');
        };
        // Phone link: the pairing screen shows while the link is on and no phone is paired.
        const state = () => {
            const s = agent || idle;
            const a = s.approvals[0];
            return {
                configured: !!agent, provider: agent ? agent.provider.label : null, status: s.status, busy: !!s.busy,
                lines: s.lines.slice(-80),
                approval: a ? { command: a.command, root: a.root, reason: a.reason, flags: a.flags } : null
            };
        };
        const link = new PhoneLink({
            handlers: {
                state: state,
                setup(fields) {
                    if (agent && agent.busy) throw new Error('Stop the current request first');
                    config.update(ctx.dataDir, fields);
                    if (!setup()) throw new Error(idle.lines[0] || 'Settings were not accepted');
                },
                // Requests typed on the phone go through the same checks as the car keyboard.
                ask(text) {
                    if (!agent) throw new Error('Add an API key first');
                    if (agent.busy) throw new Error('Wait for this request, or choose Stop');
                    offset = 0;
                    agent.ask(text).catch(e => { agent.status = e.message; });
                },
                stop() { if (agent) agent.stop(); },
                reset() { if (agent) agent.newConversation(); offset = 0; }
            }
        });
        const startLink = () => link.start().catch(e => { (agent || idle).status = e.message; });
        const pairing = () => (link.running && !link.paired ? link.info() : null);
        // Reads config.json again. With no settings yet, the phone link opens by itself.
        function setup() {
            let settings;
            try { settings = config.load(ctx.dataDir); }
            catch (e) {
                agent = null;
                idle.status = 'Not set up';
                idle.lines = [e.message];
                buttons();
                startLink();
                return null;
            }
            const caFile = path.join(ctx.dataDir, 'ca.pem');
            const network = { leasePath: LEASE, ca: fs.existsSync(caFile) ? fs.readFileSync(caFile) : undefined };
            let ssh = null;
            try { if (settings.allowRoot) ssh = rootSsh(ctx.dataDir); } catch (e) { ssh = null; }
            const options = {
                config: settings,
                secrets: config.secrets(settings).concat(ssh ? ssh.secrets : []),
                protectedPaths: [config.file(ctx.dataDir), caFile, path.join(ctx.dataDir, 'root_key')],
                call: request => api.call(request, network),
                tools: new Tools(workspace, {
                    rootSocket: ROOT_SOCKET, rootToken: settings.allowRoot ? settings.rootToken : null,
                    rootKeyFile: ssh ? ssh.keyFile : null, sshPath: ssh ? ssh.sshPath : null
                })
            };
            if (agent) {
                agent.tools = options.tools; agent.call = options.call; agent.protectedPaths = options.protectedPaths;
                agent.setConfig(settings, options.secrets);
            }
            else {
                agent = new Agent(options);
                agent.on('change', buttons);
                agent.on('approval', () => { offset = 0; });
            }
            buttons();
            return agent;
        }
        function action(fn) {
            return async () => {
                try { await fn(); } catch (e) { (agent || idle).status = e.message; buttons(); }
            };
        }
        ctx.ui.onClick('BTN_ASK', action(async () => {
            if (agent && agent.approvals.length) { agent.decide(agent.approvals[0].id, true); offset = 0; return; }
            if (entering) return;
            const a = agent || setup();
            if (!a) return;
            if (a.busy) throw new Error('Wait for this request, or choose Stop');
            entering = true;
            let text;
            try { text = await spell(ctx.app, 'Ask AI Terminal'); } finally { entering = false; }
            await ctx.ui.open('MAIN');
            // A command may have started waiting while the keyboard was open: never treat typed text as its approval.
            if (text && text.trim() && !a.busy) { offset = 0; await a.ask(text); }
        }));
        ctx.ui.onClick('BTN_SETUP', action(async () => {
            if (agent && agent.approvals.length) { agent.decide(agent.approvals[0].id, false); offset = 0; return; }
            if (agent && agent.busy) throw new Error('Stop the current request first');
            setup();
        }));
        ctx.ui.onClick('BTN_STOP', action(async () => { if (agent) agent.stop(); }));
        ctx.ui.onClick('BTN_MORE', action(() => ctx.ui.open('OPTIONS')));
        ctx.ui.onClick('OPT_BACK', action(() => ctx.ui.open('MAIN')));
        ctx.ui.onClick('OPT_OLDER', action(async () => { offset += 10; await ctx.ui.open('MAIN'); }));
        ctx.ui.onClick('OPT_NEWER', action(async () => { offset = Math.max(0, offset - 10); await ctx.ui.open('MAIN'); }));
        ctx.ui.onClick('OPT_NEW', action(async () => { if (agent) agent.newConversation(); offset = 0; await ctx.ui.open('MAIN'); }));
        ctx.ui.onClick('OPT_PROVIDER', action(async () => {
            await ctx.ui.open('MAIN');
            if (!agent) { setup(); return; }
            if (agent.busy) throw new Error('Stop the current request first');
            config.setProvider(ctx.dataDir, config.other(agent.config.provider));
            setup();
            agent.lines = [];
        }));
        ctx.ui.onClick('OPT_PHONE', action(async () => {
            await ctx.ui.open('MAIN');
            // On: show the pairing code. Already on: turn it off and forget the paired phone.
            if (link.running) { link.stop(); (agent || idle).status = 'Phone link off'; }
            else await link.start();
        }));
        if (ctx.onScroll) ctx.onScroll(dy => { offset = Math.max(0, offset + (dy < 0 ? 3 : -3)); return true; });
        let visibilityTimer;
        ctx.ui.onVisible(() => {
            clearTimeout(visibilityTimer);
            visibilityTimer = setTimeout(() => {
                // Leaving the app stops work; the native keyboard is part of the app.
                if (agent && agent.busy && !entering && !ctx.ui.isVisible('MAIN') && !ctx.ui.isVisible('OPTIONS')) agent.stop();
            }, 250);
        });
        process.once('exit', () => { if (agent) agent.stop(); link.stop(); });
        setup();
        ctx.loop('MAIN', 4, () => {
            const cv = ctx.canvas(1600, 520);
            const shown = agent || idle;
            shown.configured = !!agent;
            draw(cv, shown, offset, pairing());
            return ctx.ui.image('MAIN_GFX', cv);
        });
    }
});
