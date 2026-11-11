'use strict';
const fs = require('fs');
const net = require('net');
const path = require('path');
const childProcess = require('child_process');
const crypto = require('crypto');

const MAX_READ = 64 * 1024;
const MAX_WRITE = 256 * 1024;
const MAX_OUTPUT = 32 * 1024;
const COMMAND_TIMEOUT = 120000;

const string = { type: 'string' };
const TOOLS = [
    {
        name: 'run_command',
        description: 'Run one shell command on the head unit. Every command is shown to the owner, who approves or ' +
            'denies it on screen; some commands are blocked outright. It runs in the workspace as the app user, or ' +
            'from / as root when as_root is true. Use as_root only when the task cannot be done otherwise. ' +
            'Output is limited to 32 KB and the command is stopped after 2 minutes.',
        schema: {
            type: 'object',
            properties: {
                command: string,
                as_root: { type: 'boolean' },
                reason: { type: 'string', description: 'One short sentence the owner reads before approving.' }
            },
            required: ['command', 'as_root', 'reason'], additionalProperties: false
        }
    },
    {
        name: 'read_file',
        description: 'Read a text file from the workspace (path relative to the workspace). No approval needed.',
        schema: { type: 'object', properties: { path: string }, required: ['path'], additionalProperties: false }
    },
    {
        name: 'write_file',
        description: 'Create or replace a text file in the workspace (path relative to the workspace). No approval needed.',
        schema: { type: 'object', properties: { path: string, content: string }, required: ['path', 'content'], additionalProperties: false }
    }
];

// The client validates tool input itself; returns a problem string or null.
function validate(name, input) {
    const tool = TOOLS.filter(t => t.name === name)[0];
    if (!tool) return 'Unknown tool: ' + String(name).slice(0, 40);
    if (!input || typeof input !== 'object' || Array.isArray(input)) return 'Tool input must be an object';
    const properties = tool.schema.properties;
    const keys = Object.keys(input);
    for (let i = 0; i < keys.length; i++) if (!properties[keys[i]]) return 'Unexpected field: ' + keys[i].slice(0, 40);
    for (let i = 0; i < tool.schema.required.length; i++) {
        const field = tool.schema.required[i];
        if (typeof input[field] !== properties[field].type) return 'Field ' + field + ' must be a ' + properties[field].type;
    }
    return null;
}

function clip(text, limit) {
    if (text.length <= limit) return text;
    const half = Math.floor(limit / 2);
    return text.slice(0, half) + '\n[... ' + (text.length - 2 * half) + ' characters left out ...]\n' + text.slice(-half);
}

class Tools {
    constructor(workspace, options) {
        options = options || {};
        this.workspace = path.resolve(workspace);
        this.rootSocket = options.rootSocket || null;
        this.rootToken = options.rootToken || null;
        this.rootKeyFile = options.rootKeyFile || null;
        this.sshPath = options.sshPath || null;
        this.spawn = options.spawn || childProcess.spawn;
        this.connect = options.connect || net.connect;
        this.kill = options.kill || process.kill.bind(process);
        this.timeoutMs = options.timeoutMs || COMMAND_TIMEOUT;
    }
    // Two ways to root. The helper is preferred when provisioned: it re-checks
    // each command on the root side and keeps an audit log. Otherwise the
    // bundled root key is used over SSH to this head unit itself.
    helperAvailable() { return !!(this.rootSocket && this.rootToken && fs.existsSync(this.rootSocket)); }
    sshAvailable() { return !!(this.rootKeyFile && this.sshPath && fs.existsSync(this.rootKeyFile) && fs.existsSync(this.sshPath)); }
    rootAvailable() { return this.helperAvailable() || this.sshAvailable(); }
    rootMethod() { return this.helperAvailable() ? 'helper' : this.sshAvailable() ? 'ssh' : null; }

    // Reject symlink components, including dangling links that existsSync misses.
    resolve(relative) {
        if (typeof relative !== 'string' || !relative || relative.indexOf('\0') >= 0) throw new Error('Invalid path');
        const target = path.resolve(this.workspace, relative);
        const inside = (root, p) => p === root || p.indexOf(root + path.sep) === 0;
        if (!inside(this.workspace, target) || target === this.workspace) throw new Error('Path is outside the workspace');
        let existing = target;
        while (existing !== this.workspace) {
            try {
                if (fs.lstatSync(existing).isSymbolicLink()) throw new Error('Symlinks are not allowed in workspace paths');
            } catch (e) { if (e.code !== 'ENOENT') throw e; }
            existing = path.dirname(existing);
        }
        return target;
    }
    readFile(relative) {
        const target = this.resolve(relative);
        const stat = fs.statSync(target);
        if (!stat.isFile()) throw new Error('Not a file');
        if (stat.size <= MAX_READ) return fs.readFileSync(target, 'utf8');
        const buffer = Buffer.alloc(MAX_READ);
        const fd = fs.openSync(target, 'r');
        try { fs.readSync(fd, buffer, 0, MAX_READ, 0); } finally { fs.closeSync(fd); }
        return buffer.toString('utf8') + '\n[File is ' + stat.size + ' bytes; only the first ' + MAX_READ + ' are shown]';
    }
    writeFile(relative, content) {
        if (Buffer.byteLength(content, 'utf8') > MAX_WRITE) throw new Error('File content is larger than ' + MAX_WRITE + ' bytes');
        const target = this.resolve(relative);
        const missing = [];
        let dir = path.dirname(target);
        while (!fs.existsSync(dir)) { missing.unshift(dir); dir = path.dirname(dir); }
        missing.forEach(d => fs.mkdirSync(d, 448));
        // Atomic replacement also avoids overwriting the other end of a hard link.
        const temporary = path.join(path.dirname(target), '.ai-' + crypto.randomBytes(16).toString('hex'));
        fs.writeFileSync(temporary, content, { mode: 420, flag: 'wx' });
        try { fs.renameSync(temporary, target); }
        finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
        return Buffer.byteLength(content, 'utf8');
    }

    // Both runners return { promise -> { code, output }, abort() }.
    run(command, asRoot) {
        if (!asRoot) return this.runLocal(command);
        return this.helperAvailable() ? this.runRoot(command) : this.runSsh(command);
    }
    runLocal(command) { return this.exec('/bin/sh', ['-c', command]); }
    // Root through the head unit's own SSH server on loopback, with the bundled key.
    runSsh(command) {
        return this.exec(this.sshPath, [
            '-i', this.rootKeyFile, '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes',
            '-o', 'StrictHostKeyChecking=no', '-o', 'UserKnownHostsFile=/dev/null',
            '-o', 'LogLevel=ERROR', '-o', 'ConnectTimeout=5', '-p', '22', 'root@127.0.0.1', '--', command
        ]);
    }
    exec(file, args) {
        let child, timer, finish, settled = false;
        const kill = () => {
            if (!child || settled) return;
            try { this.kill(-child.pid, 'SIGKILL'); }
            catch (e) { try { child.kill('SIGKILL'); } catch (ignored) {} }
        };
        const promise = new Promise((resolve, reject) => {
            const env = { PATH: process.env.PATH || '/usr/bin:/bin', HOME: this.workspace, LANG: 'C' };
            child = this.spawn(file, args, { cwd: this.workspace, env: env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
            let output = '';
            const collect = chunk => { output += chunk.toString('utf8').slice(0, Math.max(0, 4 * MAX_OUTPUT - output.length)); };
            child.stdout.on('data', collect);
            child.stderr.on('data', collect);
            finish = (error, result) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                if (error) reject(error); else resolve(result);
            };
            timer = setTimeout(() => { kill(); finish(null, { code: 'timeout', output: clip(output, MAX_OUTPUT) }); }, this.timeoutMs);
            child.on('error', e => finish(new Error('Command could not start: ' + e.message)));
            child.on('close', (code, signal) => finish(null, { code: signal || code, output: clip(output, MAX_OUTPUT) }));
        });
        return { promise, abort() { kill(); if (finish) finish(new Error('Stopped')); } };
    }
    // One JSON line to the root helper, one JSON line back. Closing the socket stops the command.
    runRoot(command) {
        let socket, timer, finish, settled = false;
        const promise = new Promise((resolve, reject) => {
            finish = (error, result) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                if (error) reject(error); else resolve(result);
            };
            let reply = '';
            socket = this.connect(this.rootSocket);
            socket.setEncoding('utf8');
            socket.on('connect', () => socket.write(JSON.stringify({ token: this.rootToken, command: command, timeoutMs: COMMAND_TIMEOUT }) + '\n'));
            socket.on('data', chunk => {
                if (settled) return;
                if (reply.length + chunk.length > 8 * MAX_OUTPUT) {
                    finish(new Error('Root helper reply is too large')); socket.destroy(); return;
                }
                reply += chunk;
            });
            socket.on('error', e => finish(new Error('Root helper is not reachable: ' + e.message)));
            socket.on('close', () => {
                let message;
                try { message = JSON.parse(reply); } catch (e) { finish(new Error('Root helper gave no answer')); return; }
                if (!message.ok) finish(new Error('Root helper refused: ' + String(message.error).slice(0, 200)));
                else finish(null, { code: message.code, output: clip(String(message.output || ''), MAX_OUTPUT) });
            });
            timer = setTimeout(() => { finish(new Error('Root helper timed out')); socket.destroy(); }, this.timeoutMs + 1000);
        });
        return { promise, abort() { if (!settled) { finish(new Error('Stopped')); if (socket) socket.destroy(); } } };
    }
}

module.exports = { Tools, TOOLS, validate, clip };
