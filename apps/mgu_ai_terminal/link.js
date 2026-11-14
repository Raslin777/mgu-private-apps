'use strict';
// Phone link: a small web page served by the head unit itself, reached by
// scanning a QR code while the phone is on the car's Wi-Fi. It is used to
// enter the API key once and to type requests instead of the iDrive keyboard.
// No outside server is involved. Commands are still approved on the car
// screen only; the phone can ask, read output and stop.
//
// The page is plain HTTP on the car's own network. A pairing code shown on
// the head-unit screen is required before the page can do anything.
const http = require('http');
const os = require('os');
const crypto = require('crypto');

const PORT = 8377;
const MAX_BODY = 16 * 1024;
const MAX_TRIES = 5;
const LOCK_MS = 30000;
const HOTSPOT = '172.16.222.';

function sameText(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    const digest = v => crypto.createHash('sha256').update(v).digest();
    return crypto.timingSafeEqual(digest(a), digest(b));
}
function addresses() {
    const found = [];
    const all = os.networkInterfaces();
    Object.keys(all).forEach(name => (all[name] || []).forEach(entry => {
        if (entry.family === 'IPv4' && !entry.internal) found.push(entry.address);
    }));
    // The car's hotspot address first: that is the network a phone joins.
    return found.sort((a, b) => (a.indexOf(HOTSPOT) === 0 ? 0 : 1) - (b.indexOf(HOTSPOT) === 0 ? 0 : 1));
}

class PhoneLink {
    // options.handlers: { state(), setup(fields), ask(text), stop(), reset() }; setup and ask may throw.
    constructor(options) {
        this.handlers = options.handlers;
        this.now = options.now || Date.now;
        this.addresses = options.addresses || addresses;
        this.createServer = options.createServer || http.createServer;
        this.port = options.port === undefined ? PORT : options.port;
        this.onChange = options.onChange || (() => {});
        this.server = null;
        this.token = null;
        this.tries = 0;
        this.lockedUntil = 0;
        this.newCode();
    }
    newCode() { this.code = String(100000 + crypto.randomBytes(4).readUInt32BE(0) % 900000); }
    get running() { return !!this.server; }
    get paired() { return !!this.token; }
    // What the head-unit screen shows. The code is in the address fragment, so
    // scanning pairs without typing; a fragment is never sent in the page request.
    info() {
        const list = this.addresses();
        const url = host => 'http://' + host + ':' + this.port + '/';
        return {
            running: this.running, paired: this.paired, code: this.code,
            url: list.length ? url(list[0]) + '#' + this.code : null,
            shown: list.length ? url(list[0]) : null,
            others: list.slice(1, 3).map(url)
        };
    }
    start() {
        if (this.server) return Promise.resolve();
        return new Promise((resolve, reject) => {
            const listen = port => {
                const server = this.createServer((req, res) => this.handle(req, res));
                server.once('error', error => {
                    if (error.code === 'EADDRINUSE' && port !== 0) listen(0);
                    else reject(new Error('Phone link could not start: ' + (error.code || error.message)));
                });
                server.listen(port, '0.0.0.0', () => {
                    this.server = server;
                    this.port = server.address().port;
                    this.onChange();
                    resolve();
                });
            };
            listen(this.port);
        });
    }
    stop() {
        if (this.server) this.server.close();
        this.server = null;
        this.token = null;
        this.tries = 0;
        this.newCode();
        this.onChange();
    }

    send(res, status, body, type) {
        const data = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body), 'utf8');
        res.writeHead(status, {
            'content-type': type || 'application/json; charset=utf-8', 'content-length': data.length,
            'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY',
            'referrer-policy': 'no-referrer',
            'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'"
        });
        res.end(data);
    }
    // Only requests addressed to this head unit by IP are served, which stops
    // a web site from reaching the page through a name it controls.
    hostAllowed(header) {
        if (typeof header !== 'string') return false;
        return this.addresses().concat(['127.0.0.1']).some(a => header === a + ':' + this.port || (this.port === 80 && header === a));
    }
    handle(req, res) {
        const path = String(req.url || '').split('?')[0];
        if (!this.hostAllowed(req.headers.host)) { this.send(res, 403, { error: 'Open the address shown on the car screen' }); return; }
        if (req.method === 'GET' && path === '/') { this.send(res, 200, PAGE, 'text/html; charset=utf-8'); return; }
        if (req.method === 'GET' && path === '/api/state') {
            if (!this.authorised(req)) { this.send(res, 401, { error: 'Not paired' }); return; }
            this.send(res, 200, this.handlers.state());
            return;
        }
        if (req.method !== 'POST' || path.indexOf('/api/') !== 0) { this.send(res, 404, { error: 'Not found' }); return; }
        if (String(req.headers['content-type'] || '').split(';')[0].trim() !== 'application/json') {
            this.send(res, 415, { error: 'JSON only' });
            return;
        }
        let size = 0, done = false;
        const chunks = [];
        req.on('data', chunk => {
            if (done) return;
            size += chunk.length;
            if (size > MAX_BODY) { done = true; this.send(res, 413, { error: 'Too large' }); req.destroy(); return; }
            chunks.push(chunk);
        });
        req.on('error', () => { done = true; });
        req.on('end', () => {
            if (done) return;
            let body;
            try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (e) { body = null; }
            if (!body || typeof body !== 'object' || Array.isArray(body)) { this.send(res, 400, { error: 'Bad request' }); return; }
            this.post(path, req, res, body);
        });
    }
    authorised(req) { return this.token !== null && sameText(req.headers['x-link-token'], this.token); }
    post(path, req, res, body) {
        if (path === '/api/pair') { this.pair(res, body); return; }
        if (!this.authorised(req)) { this.send(res, 401, { error: 'Not paired' }); return; }
        try {
            if (path === '/api/setup') this.handlers.setup(body);
            else if (path === '/api/ask') this.handlers.ask(body.text);
            else if (path === '/api/stop') this.handlers.stop();
            else if (path === '/api/new') this.handlers.reset();
            else { this.send(res, 404, { error: 'Not found' }); return; }
            this.send(res, 200, { ok: true });
        } catch (e) { this.send(res, 400, { error: String(e.message).slice(0, 200) }); }
    }
    // One phone at a time. Five wrong codes lock pairing briefly and change the code.
    pair(res, body) {
        if (this.now() < this.lockedUntil) { this.send(res, 429, { error: 'Too many tries. Wait, then use the new code on the car screen.' }); return; }
        if (!sameText(String(body.code || ''), this.code)) {
            if (++this.tries >= MAX_TRIES) { this.tries = 0; this.lockedUntil = this.now() + LOCK_MS; this.newCode(); this.onChange(); }
            this.send(res, 403, { error: 'Wrong code' });
            return;
        }
        this.tries = 0;
        this.token = crypto.randomBytes(32).toString('hex');
        this.newCode();
        this.onChange();
        this.send(res, 200, { token: this.token });
    }
}

const PAGE = [
    '<!doctype html><html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1"><title>AI Terminal</title><style>',
    'body{margin:0;font:16px system-ui,sans-serif;background:#0b1018;color:#d1dbea}',
    'main{max-width:640px;margin:0 auto;padding:16px}h1{font-size:20px;color:#eef5ff;margin:0 0 4px}',
    '#status{color:#6ddbd1;margin:0 0 12px;min-height:20px}',
    'label{display:block;margin:12px 0 4px;color:#9aacc4}',
    'input,select,textarea,button{font:inherit;width:100%;box-sizing:border-box;padding:10px;border-radius:8px;border:1px solid #28384d;background:#141c28;color:#eef5ff}',
    'input[type=checkbox]{width:auto;margin-right:8px}',
    'button{background:#1f6f69;border:0;margin-top:12px;font-weight:600}button.alt{background:#28384d}button.stop{background:#8a2f27}',
    '#out{white-space:pre-wrap;word-break:break-word;background:#141c28;border-radius:8px;padding:10px;min-height:160px;max-height:50vh;overflow:auto;font:13px ui-monospace,monospace}',
    '#review{display:none;border:2px solid #ff6b5e;border-radius:8px;padding:10px;margin:12px 0;color:#ffd7d2}',
    '.row{display:flex;gap:8px}.row button{flex:1}.hide{display:none}.err{color:#ff6b5e;min-height:20px}small{color:#7e91aa}',
    '</style></head><body><main><h1>AI Terminal</h1><p id="status"></p>',
    '<section id="pair"><label for="code">Code shown on the car screen</label>',
    '<input id="code" inputmode="numeric" autocomplete="off" maxlength="6"><button id="pairBtn">Link this phone</button></section>',
    '<section id="setup" class="hide"><label for="provider">Provider</label>',
    '<select id="provider"><option value="anthropic">Claude (Anthropic)</option><option value="openai">OpenAI</option></select>',
    '<label for="akey">Anthropic API key</label><input id="akey" type="password" autocomplete="off" placeholder="leave empty to keep the saved key">',
    '<label for="okey">OpenAI API key</label><input id="okey" type="password" autocomplete="off" placeholder="leave empty to keep the saved key">',
    '<label for="omodel">OpenAI model id</label><input id="omodel" autocomplete="off" placeholder="leave empty to keep the saved model">',
    '<label><input id="root" type="checkbox">Allow root commands (each one approved on the car screen)</label>',
    '<button id="saveBtn">Save</button><button id="cancelBtn" class="alt hide">Back</button>',
    '<p><small>Keys are sent to the head unit over the car\'s Wi-Fi and stored there. They are never shown again.</small></p></section>',
    '<section id="chat" class="hide"><div id="out"></div>',
    '<div id="review"><b id="reviewTitle"></b><div id="reviewWhy"></div><pre id="reviewCmd" style="white-space:pre-wrap;word-break:break-word"></pre>',
    '<small>Approve or deny on the car screen.</small></div>',
    '<label for="text">Ask</label><textarea id="text" rows="3" maxlength="4000"></textarea>',
    '<div class="row"><button id="askBtn">Send</button><button id="stopBtn" class="stop">Stop</button></div>',
    '<div class="row"><button id="newBtn" class="alt">New conversation</button><button id="setBtn" class="alt">Settings</button></div></section>',
    '<p id="err" class="err"></p></main><script>',
    '(function(){var token=null,configured=false,view="pair",timer=null;',
    'try{token=sessionStorage.getItem("t")}catch(e){}',
    'function $(i){return document.getElementById(i)}',
    'function show(v){view=v;["pair","setup","chat"].forEach(function(n){$(n).className=n===v?"":"hide"})}',
    'function err(m){$("err").textContent=m||""}',
    'function call(method,path,body,done){var x=new XMLHttpRequest();x.open(method,path);',
    'if(token)x.setRequestHeader("x-link-token",token);if(body)x.setRequestHeader("content-type","application/json");',
    'x.onload=function(){var r={};try{r=JSON.parse(x.responseText)}catch(e){}done(x.status,r)};',
    'x.onerror=function(){done(0,{error:"Head unit not reachable"})};x.send(body?JSON.stringify(body):null)}',
    'function unpair(){token=null;try{sessionStorage.removeItem("t")}catch(e){}clearInterval(timer);show("pair");$("status").textContent=""}',
    'function poll(){call("GET","/api/state",null,function(s,r){if(s===401){unpair();return}if(s!==200)return;',
    'configured=r.configured;$("status").textContent=r.status||"";',
    'if(!configured&&view==="chat")show("setup");if(view==="pair")show(configured?"chat":"setup");',
    'var o=$("out"),bottom=o.scrollTop+o.clientHeight>=o.scrollHeight-8;o.textContent=(r.lines||[]).join("\\n");if(bottom)o.scrollTop=o.scrollHeight;',
    'var a=r.approval;$("review").style.display=a?"block":"none";',
    'if(a){$("reviewTitle").textContent=(a.root?"RUNS AS ROOT ":"Command waiting ")+(a.flags||[]).join(" / ");$("reviewWhy").textContent="Why: "+(a.reason||"");$("reviewCmd").textContent=a.command}',
    '$("askBtn").disabled=!!r.busy;$("cancelBtn").className=configured?"alt":"alt hide"})}',
    'function begin(){poll();clearInterval(timer);timer=setInterval(poll,1500)}',
    'function pair(code){err();call("POST","/api/pair",{code:code},function(s,r){if(s!==200){err(r.error||"Could not link");return}',
    'token=r.token;try{sessionStorage.setItem("t",token)}catch(e){}begin()})}',
    'function post(path,body){err();call("POST",path,body||{},function(s,r){if(s===401){unpair();return}if(s!==200)err(r.error||"Failed");poll()})}',
    '$("pairBtn").onclick=function(){pair($("code").value.trim())};',
    '$("saveBtn").onclick=function(){var b={provider:$("provider").value,allowRoot:$("root").checked};',
    'if($("akey").value)b.anthropicKey=$("akey").value.trim();if($("okey").value)b.openaiKey=$("okey").value.trim();if($("omodel").value)b.openaiModel=$("omodel").value.trim();',
    'err();call("POST","/api/setup",b,function(s,r){if(s===401){unpair();return}if(s!==200){err(r.error||"Not saved");return}',
    '$("akey").value="";$("okey").value="";show("chat");poll()})};',
    '$("cancelBtn").onclick=function(){show("chat")};$("setBtn").onclick=function(){show("setup")};',
    '$("askBtn").onclick=function(){var t=$("text").value.trim();if(!t)return;$("text").value="";post("/api/ask",{text:t})};',
    '$("stopBtn").onclick=function(){post("/api/stop")};$("newBtn").onclick=function(){post("/api/new")};',
    'var h=location.hash.replace("#","");if(h){try{history.replaceState(null,"",location.pathname)}catch(e){}}',
    'if(token)begin();else if(/^[0-9]{6}$/.test(h))pair(h);',
    '})();</script></body></html>'
].join('\n');

module.exports = { PhoneLink, addresses, PAGE, PORT };
