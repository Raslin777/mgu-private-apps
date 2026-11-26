'use strict';
const mgu = require('./kit/mgu');
const SERVICES = require('./services');
const { Collector } = require('./collector');
const { draw, pages } = require('./view');
mgu.run({
    async background(ctx) {
        const collector = new Collector(ctx.signals, SERVICES, ctx.log, { logFirst: () => ctx.settings.get('logFirst') !== false });
        let stopped = false;
        const stop = () => { if (stopped) return; stopped = true; collector.stop(); };
        ctx.app.on('shutdown', stop); process.once('exit', stop);
        // Subscriptions run in the background so the page opens at once and fills in as services answer.
        collector.start().then(() => {
            const snap = collector.snapshot();
            ctx.log.info('road-sight: ' + snap.filter(s => s.state === 'subscribed' || s.state === 'partly subscribed').length +
                ' of ' + snap.length + ' services subscribed');
        }, e => ctx.log.warn('road-sight start: ' + String(e && e.message || e)));
        return { snapshot: () => collector.snapshot(), logAll: () => collector.logAll(), stop: stop };
    },
    async start(ctx) {
        const background = ctx.background;
        if (!background) { ctx.log.warn('Road Sight background failed to initialize'); return; }
        const view = { page: 0, scroll: 0 };
        const count = () => pages(background.snapshot(), ctx.settings.get('liveOnly') === true).length;
        const go = step => () => { const n = count(); view.page = ((Math.min(view.page, n - 1) + step) % n + n) % n; view.scroll = 0; };
        ctx.ui.onClick('BTN_PREV', go(-1));
        ctx.ui.onClick('BTN_NEXT', go(1));
        ctx.ui.onClick('BTN_OVERVIEW', () => { view.page = 0; view.scroll = 0; });
        ctx.ui.onClick('BTN_LIVE', () => { ctx.settings.set('liveOnly', ctx.settings.get('liveOnly') !== true); view.page = 0; view.scroll = 0; });
        ctx.ui.onClick('BTN_MORE', () => { view.scroll++; });
        ctx.ui.onClick('BTN_LOG', () => { background.logAll(); });
        ctx.loop('MAIN', 2, () => {
            const cv = ctx.canvas(1600, 520);
            const at = draw(cv, { snapshot: background.snapshot(), liveOnly: ctx.settings.get('liveOnly') === true,
                page: view.page, scroll: view.scroll });
            view.page = at.index;
            return ctx.ui.image('MAIN_GFX', cv);
        });
    }
});
