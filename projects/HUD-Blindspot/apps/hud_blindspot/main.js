'use strict';
const mgu = require('./kit/mgu');
const { ClusterRender } = require('./cluster_render_client');
const { WarningState } = require('./warnings');
const { WarningSource } = require('./source');
const { Overlay } = require('./overlay');
const { draw } = require('./view');
mgu.run({
    async background(ctx) {
        const warning = new WarningState();
        const overlay = new Overlay(() => new ClusterRender('hud_blindspot'), ctx.log);
        let stopped = false;
        const values = () => ({ enabled: ctx.settings.get('enabled'), size: ctx.settings.get('size'),
            opacity: ctx.settings.get('opacity'), height: ctx.settings.get('height') });
        const tick = () => {
            if (stopped) return;
            try { overlay.update(warning.snapshot(), values(), Date.now()); }
            catch (e) { overlay.close(); ctx.log.warn('HUD overlay: ' + String(e.message || e)); }
        };
        const source = new WarningSource(ctx.signals, warning, ctx.log, tick);
        ctx.settings.onChange(tick);
        const timer = setInterval(tick, 100);
        const stop = () => { if (stopped) return; stopped = true; clearInterval(timer); overlay.close(); source.stop(); };
        ctx.app.on('shutdown', stop); process.once('exit', stop);
        await source.start(); tick();
        return { model: () => Object.assign(values(), { warning: warning.snapshot(), overlay: { link: overlay.link, target: overlay.target } }), stop: stop };
    },
    async start(ctx) {
        const background = ctx.background;
        if (!background) { ctx.log.warn('HUD Blindspot background failed to initialize'); return; }
        ctx.ui.onClick('BTN_ENABLE', () => ctx.settings.set('enabled', true));
        ctx.ui.onClick('BTN_DISABLE', () => ctx.settings.set('enabled', false));
        const cycle = (key, values) => () => ctx.settings.set(key, values[(values.indexOf(ctx.settings.get(key)) + 1) % values.length]);
        ctx.ui.onClick('BTN_SIZE', cycle('size', ['small', 'medium', 'large']));
        ctx.ui.onClick('BTN_OPACITY', cycle('opacity', ['45', '65', '85']));
        ctx.ui.onClick('BTN_HEIGHT', cycle('height', ['40', '50', '60']));
        ctx.loop('MAIN', 2, () => {
            const cv = ctx.canvas(1600, 520); draw(cv, background.model());
            return ctx.ui.image('MAIN_GFX', cv);
        });
    }
});
