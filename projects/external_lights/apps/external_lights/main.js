'use strict';
/**
 * External Lights - light shows on the car's exterior lamps, and each lamp on its own for a test.
 *
 * Buttons: Start (the show picked), Stop, Next show, Next lamp, Flash lamp (the lamp picked, one second).
 * Movement and missing telemetry show warnings. Diagnostic preflight/session checks still gate commands.
 * Only the initial BDC lamp subset is selectable; no brake/headlight-controller takeover.
 */
const mgu = require('./kit/mgu');
const { Diag } = require('./kit/diag');
const Vehicle = require('./vehicle');
const Session = require('./session').Session;
const { LAMPS } = require('./lamps');
const Shows = require('./shows');
const { Player } = require('./player');
const { draw } = require('./view');

mgu.run({
    async start(ctx) {
        const { ui, settings, log } = ctx;
        const diag = await new Diag(ctx.signals, log).init();
        diag.quiet = true; diag.busyLog = false;
        const vehicle = Vehicle.watch(ctx, log);
        // Movement is warning-only by the owner's request. Link/session failures still stop commands.
        const session = new Session(diag, log, { allowed: () => null });
        const glare = () => settings.get('glare') === true;
        const player = new Player({ diag, log, session, allowed: () => session.reason(), maxMs: () => (Number(settings.get('minutes')) || 3) * 60000 });

        let showKey = Shows.keys().indexOf(settings.get('show')) >= 0 ? settings.get('show') : Shows.keys()[0], lampAt = 0;
        const lamps = () => LAMPS.filter((l) => !l.experimental && (glare() || !l.glare) && player.refused.indexOf(l.key) < 0);
        const picked = () => { const l = lamps(); return l.length ? l[lampAt % l.length] : null; };
        const current = () => Shows.show(showKey, { glare: glare() });
        const guard = (name, fn) => () => { try { fn(); } catch (e) { log.warn(name + ': ' + (e && e.message || e)); } };

        ui.onClick('BTN_START', guard('start', () => player.play(current())));
        ui.onClick('BTN_STOP', guard('stop', () => player.stop('Stopped')));
        ui.onClick('BTN_SHOW', guard('show', () => {
            showKey = Shows.next(showKey); settings.set('show', showKey);
            if (player.state === 'playing' && !player.show.once) player.play(current());
        }));
        ui.onClick('BTN_LAMP', guard('lamp', () => { const count = lamps().length; lampAt = count ? (lampAt + 1) % count : 0; }));
        ui.onClick('BTN_FLASH', guard('flash', () => { const selected = picked(); if (selected) player.flash(selected.key, 1000); }));

        // Shutdown cleanup is best effort within the platform's short grace period.
        if (ctx.app && ctx.app.on) ctx.app.on('shutdown', () => { player.stop('App closed'); vehicle.close(); });

        ctx.loop('MAIN', 4, () => {
            const cv = ctx.canvas(1600, 520);
            draw(cv, ctx.theme(), {
                lit: LAMPS.filter((l) => player.isLit(l.key)).map((l) => l.key),
                show: current().name, state: player.state, reason: player.reason, lamp: picked() ? picked().name : 'No available lamps',
                warning: vehicle.reason(), speed: vehicle.speed(), rtt: player.rtt, writes: player.writes, skipped: player.skipped,
                failure: session.lastFailure, cleanupFailure: session.cleanupFailure,
                refused: player.refused.map((k) => LAMPS.find((l) => l.key === k).name), link: !!diag.p,
            });
            return ui.image('MAIN_GFX', cv);
        });
    },
});
