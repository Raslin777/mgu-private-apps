'use strict';
const mgu = require('./kit/mgu');
const { ClusterRender } = require('./cluster_render_client');
const { WarningState, selectSomeip, VIEW_IFACE, VIEW_EVENT } = require('./warnings');
const { WarningSource } = require('./source');
const { Overlay } = require('./overlay');
const { draw } = require('./view');
const Position = require('./position');
const { MirrorReader, selectSource, useDiagnostics } = require('./uds');
const { Probe, describe, verdict } = require('./probe');
mgu.run({
    async background(ctx) {
        // The primary source is a field (held while its provider is there); the
        // Assisted View source is an event (expires).
        const warning = new WarningState(undefined, Infinity), assisted = new WarningState();
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
                reader.tick(settings.enabled === true && useDiagnostics(settings.source, someip()));
                overlay.update(selected(), settings, Date.now());
            }
            catch (e) { overlay.close(); ctx.log.warn('HUD overlay: ' + String(e.message || e)); }
        };
        const source = new WarningSource(ctx.signals, warning, ctx.log, tick);
        const viewSource = new WarningSource(ctx.signals, assisted, ctx.log, tick,
            { iface: VIEW_IFACE, event: VIEW_EVENT, mirror: false, update: raw => assisted.updateView(raw) });
        reader = new MirrorReader(ctx.signals, ctx.log, tick);
        const probe = new Probe(ctx.signals, ctx.log);
        // The lines of the check page: where each subscription stops, and what that means.
        const check = () => {
            const sources = [source.status(), viewSource.status()], checks = probe.status();
            return [describe('Blind-spot warning', sources[0]), describe('Assisted view blind-spot', sources[1])]
                .concat(checks.map(c => describe(c.label, c)))
                .concat([verdict(sources, checks, reader.snapshot())]);
        };
        ctx.settings.onChange(tick);
        const timer = setInterval(tick, 100);
        const stop = () => { if (stopped) return; stopped = true; clearInterval(timer); overlay.close(); source.stop(); viewSource.stop(); reader.stop(); probe.stop(); };
        ctx.app.on('shutdown', stop); process.once('exit', stop);
        await Promise.all([source.start(), viewSource.start(), reader.start()]); tick();
        // The reachability checks run afterwards and must never hold up the warning sources.
        probe.start().then(() => ctx.log.info('blind-spot check: ' + check().join(' || ')), () => {});
        return { model: () => Object.assign(values(), { warning: selected(), someip: warning.snapshot(),
                assisted: assisted.snapshot(),
                diagnostic: { reason: reader.reason, trace: reader.trace, stats: reader.stats, link: reader.available },
                overlay: { link: overlay.link, target: overlay.target }, check: check() }),
            check: check,
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
        const CHECK_ROWS = ['CHK_0', 'CHK_1', 'CHK_2', 'CHK_3', 'CHK_4', 'CHK_5', 'CHK_6'];
        const showCheck = () => Promise.all(background.check().map((line, i) => CHECK_ROWS[i] ? ctx.ui.text(CHECK_ROWS[i], line) : null));
        ctx.ui.onClick('BTN_CHECK', async () => { await showCheck(); return ctx.ui.open('CHECK'); });
        CHECK_ROWS.forEach(id => ctx.ui.onClick(id, showCheck));
        ctx.ui.onClick('CHK_BACK', () => ctx.ui.open('MAIN'));
        ctx.loop('MAIN', 2, () => {
            const cv = ctx.canvas(1600, 520); draw(cv, background.model());
            return ctx.ui.image('MAIN_GFX', cv);
        });
    }
});
