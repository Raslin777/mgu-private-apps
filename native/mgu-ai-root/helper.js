'use strict';
// Root helper for AI Terminal. Runs as root from systemd (socket activated).
// Protocol: one JSON line in  { token, command, timeoutMs }
//           one JSON line out { ok, code, output } or { ok: false, error }
// The app asks the owner to approve each command before it reaches this
// process. The helper still checks the token, re-applies the deny rules, runs
// one command at a time and records every command it runs.
const fs = require('fs');
const net = require('net');
const path = require('path');
const crypto = require('crypto');
const childProcess = require('child_process');
const safety = require('./safety');

const STATE = process.env.MGU_AI_ROOT_DIR || '/var/opt/mgu-ai-root';
const TOKEN = path.join(STATE, 'token');
const AUDIT = path.join(STATE, 'audit.log');
const SOCKET = process.env.MGU_AI_ROOT_SOCKET || '/run/mgu-ai-root/root.sock';
const MAX_REQUEST = 16 * 1024;
const MAX_OUTPUT = 64 * 1024;
const MAX_TIMEOUT = 300000;

let busy = false;

function audit(text) {
    try {
        if (fs.existsSync(AUDIT) && fs.statSync(AUDIT).size > 1024 * 1024) fs.renameSync(AUDIT, AUDIT + '.1');
        fs.appendFileSync(AUDIT, new Date().toISOString() + ' ' + text.replace(/\s+/g, ' ') + '\n', { mode: 384 });
    } catch (e) { /* an unwritable log must not stop the helper */ }
}
function authorised(candidate) {
    let stored;
    try {
        const stat = fs.statSync(TOKEN);
        if (stat.uid !== 0 || (stat.mode & 63)) return false;
        stored = fs.readFileSync(TOKEN, 'utf8').trim();
    } catch (e) { return false; }
    if (stored.length < 32 || typeof candidate !== 'string') return false;
    const digest = value => crypto.createHash('sha256').update(value).digest();
    return crypto.timingSafeEqual(digest(stored), digest(candidate));
}

function handle(socket) {
    let buffer = '', child = null, answered = false, received = false;
    const answer = message => {
        if (answered) return;
        answered = true;
        socket.end(JSON.stringify(message) + '\n');
    };
    socket.setEncoding('utf8');
    socket.setTimeout(MAX_TIMEOUT + 10000, () => socket.destroy());
    socket.on('error', () => {});
    socket.on('close', () => {
        // The app closes the socket when the owner presses Stop.
        if (child) { try { process.kill(-child.pid, 'SIGKILL'); } catch (e) { child.kill('SIGKILL'); } }
    });
    socket.on('data', chunk => {
        if (answered || received) return;
        buffer += chunk;
        if (buffer.length > MAX_REQUEST) { answer({ ok: false, error: 'request too large' }); return; }
        const end = buffer.indexOf('\n');
        if (end < 0) return;
        received = true;
        let request;
        try { request = JSON.parse(buffer.slice(0, end)); } catch (e) { answer({ ok: false, error: 'bad request' }); return; }
        if (!request || !authorised(request.token)) {
            audit('REFUSED unauthorised request');
            setTimeout(() => answer({ ok: false, error: 'unauthorised' }), 1000);
            return;
        }
        const verdict = safety.checkCommand(request.command, { root: true, protectedPaths: [TOKEN] });
        if (verdict.action === 'deny') {
            audit('BLOCKED (' + verdict.reason + ') ' + String(request.command));
            answer({ ok: false, error: 'blocked because ' + verdict.reason });
            return;
        }
        if (busy) { answer({ ok: false, error: 'another root command is running' }); return; }
        busy = true;
        audit('RUN ' + request.command);
        const limit = Math.min(Number(request.timeoutMs) > 0 ? Number(request.timeoutMs) : 120000, MAX_TIMEOUT);
        let output = '', timedOut = false, finished = false;
        child = childProcess.spawn('/bin/sh', ['-c', request.command], {
            cwd: '/', detached: true, stdio: ['ignore', 'pipe', 'pipe'],
            env: { PATH: '/usr/sbin:/usr/bin:/sbin:/bin', HOME: '/root', LANG: 'C' }
        });
        const collect = data => { if (output.length < MAX_OUTPUT) output += data.toString('utf8'); };
        child.stdout.on('data', collect);
        child.stderr.on('data', collect);
        const timer = setTimeout(() => {
            timedOut = true;
            try { process.kill(-child.pid, 'SIGKILL'); } catch (e) { child.kill('SIGKILL'); }
        }, limit);
        const finish = (code, signal) => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            busy = false;
            const result = timedOut ? 'timeout' : (signal || code);
            audit('EXIT ' + result);
            child = null;
            answer({ ok: true, code: result, output: output.slice(0, MAX_OUTPUT) });
        };
        child.on('error', e => { output += 'could not start: ' + e.message; finish(127, null); });
        child.on('close', finish);
    });
}

function listen() {
    const server = net.createServer(handle);
    server.on('error', e => { console.error('mgu-ai-root: ' + e.message); process.exit(1); });
    if (Number(process.env.LISTEN_FDS) >= 1) {
        // systemd socket activation: the listening socket is file descriptor 3,
        // already owned root:tm_oap_app with mode 0660.
        server.listen({ fd: 3 });
        return;
    }
    // Started without the socket unit: create the same socket ourselves.
    const dir = path.dirname(SOCKET);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, 493);
    try { fs.unlinkSync(SOCKET); } catch (e) { /* not there */ }
    server.listen(SOCKET, () => {
        fs.chmodSync(SOCKET, 432);
        try {
            const row = fs.readFileSync('/etc/group', 'utf8').split('\n').filter(l => l.indexOf('tm_oap_app:') === 0)[0];
            if (row) fs.chownSync(SOCKET, 0, Number(row.split(':')[2]));
        } catch (e) { console.error('mgu-ai-root: socket group not set: ' + e.message); }
    });
}

if (require.main === module) listen();
module.exports = { handle, authorised };
