'use strict';
// Link to the Camera Cluster feed tool: the service that decodes the camera
// stream and hands the picture to Cluster renderer. Newline-delimited JSON over
// a Unix socket. The app sends one thing, whether the picture is shown on the
// cluster, and reads the tool's status. Opening the socket starts the service.
const net = require('net');
const EventEmitter = require('events');

const SOCKET = '/dev/shm/camera-cluster-feed/ctl.sock';
const RETRY_MS = [500, 1000, 2000, 5000];
const MAX_LINE = 16384;

class Feed extends EventEmitter {
    constructor(options) {
        super();
        const o = options || {};
        this.path = o.path || SOCKET;
        this.connect = o.connect || ((path) => net.connect(path));
        this.setTimer = o.setTimer || setTimeout;
        this.clearTimer = o.clearTimer || clearTimeout;
        this.socket = null;
        this.up = false;
        this.wanted = false;      // keep a connection
        this.shown = false;       // the picture on the cluster
        this.attempt = 0;
        this.timer = null;
        this.buffer = '';
        this.info = { link: 'not started', state: '', reason: '', cluster: false };
    }

    status() { return this.info; }

    _update(change) {
        let changed = false;
        Object.keys(change).forEach((key) => { if (this.info[key] !== change[key]) changed = true; });
        if (!changed) return;
        this.info = Object.assign({}, this.info, change);
        this.emit('change', this.info);
    }

    // Start the link (and with it the service) and keep it until stop().
    start() {
        if (this.wanted) return;
        this.wanted = true;
        this._open();
    }

    stop() {
        this.wanted = false;
        this.shown = false;
        if (this.timer) { this.clearTimer(this.timer); this.timer = null; }
        if (this.socket) {
            // The service keeps running without the app: take the picture off first.
            if (this.up) this._send({ cmd: 'cluster', on: '0' });
            this.socket.end();
            this.socket = null;
        }
        this.up = false;
        this._update({ link: 'not started', state: '', reason: '', cluster: false });
    }

    show(on) {
        on = !!on;
        if (on === this.shown) return;
        this.shown = on;
        if (this.up) this._send({ cmd: 'cluster', on: on ? '1' : '0' });
    }

    _send(message) {
        try { this.socket.write(JSON.stringify(message) + '\n'); } catch (e) { /* the close event follows */ }
    }

    _open() {
        if (!this.wanted || this.socket) return;
        let socket;
        try { socket = this.connect(this.path); } catch (e) { this._retry(e); return; }
        this.socket = socket;
        this.buffer = '';
        this._update({ link: 'connecting' });
        socket.on('connect', () => {
            if (this.socket !== socket) return;
            this.up = true;
            this.attempt = 0;
            this._update({ link: 'connected' });
            // The service outlives the app; say what is wanted now, whatever it had before.
            this._send({ cmd: 'cluster', on: this.shown ? '1' : '0' });
        });
        socket.on('data', (chunk) => { if (this.socket === socket) this._data(chunk); });
        socket.on('error', (e) => { if (this.socket === socket) this.lastError = e; });
        socket.on('close', () => {
            if (this.socket !== socket) return;
            this.socket = null;
            this.up = false;
            this._retry(this.lastError);
            this.lastError = null;
        });
    }

    _retry(error) {
        if (!this.wanted) return;
        const code = error && error.code;
        this._update({
            link: code === 'ENOENT' ? 'feed tool not installed' : code === 'EACCES' ? 'no access to the feed tool' : 'feed tool not answering',
            state: '', reason: '', cluster: false
        });
        const wait = RETRY_MS[Math.min(this.attempt, RETRY_MS.length - 1)];
        this.attempt++;
        if (this.timer) this.clearTimer(this.timer);
        this.timer = this.setTimer(() => { this.timer = null; this._open(); }, wait);
    }

    _data(chunk) {
        this.buffer += chunk.toString('utf8');
        if (this.buffer.length > MAX_LINE && this.buffer.indexOf('\n') < 0) { this.buffer = ''; return; }
        let end;
        while ((end = this.buffer.indexOf('\n')) >= 0) {
            const line = this.buffer.slice(0, end);
            this.buffer = this.buffer.slice(end + 1);
            let message = null;
            try { message = JSON.parse(line); } catch (e) { message = null; }
            if (!message || typeof message !== 'object') continue;
            if (message.ev === 'status') {
                this._update({
                    state: String(message.state || '').slice(0, 40),
                    reason: String(message.reason || '').slice(0, 120),
                    cluster: message.cluster === 1 || message.cluster === '1'
                });
            } else if (message.ev === 'busy') {
                this._update({ link: 'feed tool is in use by another app' });
            }
        }
    }
}

module.exports = { Feed, SOCKET };
