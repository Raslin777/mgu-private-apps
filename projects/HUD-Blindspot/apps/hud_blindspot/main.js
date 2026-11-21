'use strict';
const mgu = require('./kit/mgu');
const { ClusterRender } = require('./cluster_render_client');
const { WarningState, selectSomeip, VIEW_IFACE, VIEW_EVENT } = require('./warnings');
const { WarningSource } = require('./source');
const { Overlay } = require('./overlay');
const { draw } = require('./view');
const Position = require('./position');
const { MirrorReader, selectSource } = require('./uds');
mgu.run({
    async background(ctx) {
        const warning = new WarningState(), assisted = new WarningState();
        const overlay = new Overlay(() => new ClusterRender('hud_blindspot'), ctx.log);
        let stopped = false, reader;
        const values = () => ({ enabled: ctx.settings.get('enabled'), size: ctx.settings.get('size'),
            opacity: ctx.settings.get('opacity'), height: ctx.settings.get('height'),
            positions: ctx.settings.get('positions'), positionTarget: ctx.settings.get('positionTarget'),
            source: ctx.settings.get('source') || 'auto' });
        const someip = () => selectSomeip(warning.snapshot(), assisted.snapshot());
        const selected = () => selectSource(reader.snapshot(), someip(), values().source);
        const tick = () => {
            if (stopped) return;
            try {
                const settings = values();
                const primary = someip();
                reader.tick(settings.enabled === true && (settings.source === 'uds' ||
                    settings.source === 'auto' && !primary.authoritative && !primary.valid));
                overlay.update(selected(), settings, Date.now());
            }
            catch (e) { overlay.close(); ctx.log.warn('HUD overlay: ' + String(e.message || e)); }
        };
        const source = new WarningSource(ctx.signals, warning, ctx.log, tick);
        const viewSource = new WarningSource(ctx.signals, assisted, ctx.log, tick,
            { iface: VIEW_IFACE, event: VIEW_EVENT, mirror: false, update: raw => assisted.updateView(raw) });
        reader = new MirrorReader(ctx.signals, ctx.log, tick);
        ctx.settings.onChange(tick);
        const timer = setInterval(tick, 100);
        const stop = () => { if (stopped) return; stopped = true; clearInterval(timer); overlay.close(); source.stop(); viewSource.stop(); reader.stop(); };
        ctx.app.on('shutdown', stop); process.once('exit', stop);
        await Promise.all([source.start(), viewSource.start(), reader.start()]); tick();
        return { model: () => Object.assign(values(), { warning: selected(), someip: warning.snapshot(),
                assisted: assisted.snapshot(),
                diagnostic: { reason: reader.reason, trace: reader.trace },
                overlay: { link: overlay.link, target: overlay.target } }),
            hudTargets: () => overlay.client && overlay.client.targets || 'hud:800x480', stop: stop };
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
        const positionLabel = () => {
            const target = Position.selected(ctx.settings.get('positionTarget'));
            return ctx.ui.text('POS_TARGET', 'Move: ' + (target === 'both' ? 'Both' : target === 'left' ? 'Left' : 'Right') +
                ' | ' + Position.summary(background.model(), background.hudTargets()));
        };
        ctx.ui.onClick('BTN_POSITION', async () => { await positionLabel(); return ctx.ui.open('POSITION'); });
        ctx.ui.onClick('POS_TARGET', async () => {
            cycle('positionTarget', Position.TARGETS)(); return positionLabel();
        });
        const move = (dx, dy, reset) => async () => {
            const positions = Position.change(background.model(), ctx.settings.get('positionTarget'), dx, dy, reset, background.hudTargets());
            if (positions) ctx.settings.set('positions', positions);
            return positionLabel();
        };
        ctx.ui.onClick('POS_LEFT', move(-1, 0, false));
        ctx.ui.onClick('POS_RIGHT', move(1, 0, false));
        ctx.ui.onClick('POS_UP', move(0, -1, false));
        ctx.ui.onClick('POS_DOWN', move(0, 1, false));
        ctx.ui.onClick('POS_RESET', move(0, 0, true));
        ctx.ui.onClick('POS_BACK', () => ctx.ui.open('MAIN'));
        ctx.loop('MAIN', 2, () => {
            const cv = ctx.canvas(1600, 520); draw(cv, background.model());
            return ctx.ui.image('MAIN_GFX', cv);
        });
    }
});
