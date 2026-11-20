'use strict';
const { icon, layout } = require('./artwork');
class Overlay {
    constructor(factory, log) {
        this.factory = factory; this.log = log; this.client = null;
        this.layers = {}; this.sent = {}; this.geometry = ''; this.link = 'Off'; this.target = ''; this.blocked = false;
        this.frames = { left: [icon('left', false), icon('left', true)], right: [icon('right', false), icon('right', true)] };
    }
    connect() {
        if (this.client) return;
        const cr = this.factory(); this.client = cr;
        this.link = 'Connecting to Cluster renderer';
        cr.on('ready', () => { this.link = 'Connected'; this.target = ''; });
        cr.on('disconnected', () => {
            // Remove replayable layers immediately. Reconnect must receive a new
            // controller tick and current signal validity before it can draw.
            this.clear(); this.link = 'Connecting to Cluster renderer';
        });
        cr.on('error', error => { this.link = 'Cluster renderer unavailable'; this.log.warn(String(error.message || error)); });
        cr.on('target', (name, state, holder, reason, guideDisabled, disabled) => {
            if (name !== 'hud') return;
            this.target = disabled ? 'HUD disabled by renderer guard' : state + (reason ? ': ' + reason : '');
            if (disabled) { this.blocked = true; this.clear(); }
        });
        cr.on('refused', (op, ref, reason) => {
            this.target = 'HUD request refused: ' + reason;
            this.blocked = true; this.clear(); this.log.warn(this.target);
        });
        cr.connect();
    }
    clear() {
        if (this.client) Object.keys(this.layers).forEach(side => this.client.drop(this.layers[side]));
        this.layers = {}; this.sent = {}; this.geometry = '';
    }
    close() {
        this.clear();
        if (this.client) { this.client.removeAllListeners(); this.client.close(); }
        this.client = null; this.blocked = false; this.target = ''; this.link = 'Off';
    }
    update(snapshot, settings, now) {
        if (settings.enabled !== true) { this.close(); return; }
        this.connect();
        const cr = this.client;
        if (!cr.ready || this.blocked) return;
        const geometry = layout(cr.targets, settings);
        if (!geometry) { this.clear(); this.target = 'HUD target not supported'; return; }
        if (!snapshot.valid || !snapshot.active || !(snapshot.left || snapshot.right)) { this.clear(); return; }
        const key = JSON.stringify(geometry);
        if (key !== this.geometry) { this.clear(); this.geometry = key; }
        for (const side of ['left', 'right']) {
            const severity = snapshot[side];
            if (!severity) {
                if (this.layers[side]) cr.drop(this.layers[side]);
                delete this.layers[side]; delete this.sent[side]; continue;
            }
            if (!this.layers[side]) {
                const ref = cr.image({ target: 'hud', klass: 'overlay', z: 0,
                    x: geometry[side], y: geometry.y, w: geometry.size, h: geometry.size,
                    iw: 64, ih: 64, fps: 4, opacity: geometry.opacity,
                    visible: false, exclusive: false, prewarm: false, contend: false, guide_hold: false });
                if (!ref) { this.blocked = true; this.target = 'HUD layer refused'; this.clear(); return; }
                this.layers[side] = ref;
                cr.pixels(ref, null, this.frames[side][severity >= 2 ? 1 : 0]);
            }
            const visible = severity === 1 || Math.floor(now / 250) % 2 === 0;
            const stamp = severity + ':' + visible;
            if (this.sent[side] !== stamp) {
                cr.pixels(this.layers[side], null, this.frames[side][severity >= 2 ? 1 : 0]);
                cr.set(this.layers[side], { visible: visible }); this.sent[side] = stamp;
            }
        }
    }
}
module.exports = { Overlay };
