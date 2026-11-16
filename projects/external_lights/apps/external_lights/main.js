'use strict';
/**
 * External Lights - light shows on the car's exterior lamps, and each lamp on its own for a test.
 *
 * Buttons: Start (the show picked), Stop, Next show, Next lamp, Flash lamp (the lamp picked, one second).
 * Movement and missing telemetry show warnings. Diagnostic preflight/session checks still gate commands.
 * Only the initial BDC lamp subset is selectable; no brake/headlight-controller takeover.
 */
const mgu = require('./kit/mgu');
const { Transport } = require('./transport');
const Address = require('./address-tests');
const Vehicle = require('./vehicle');
const Session = require('./session').Session;
const { LAMPS } = require('./lamps');
const Shows = require('./shows');
const { Player } = require('./player');
const { draw } = require('./view');

mgu.run({
    async start(ctx) {
        const { ui, settings, log } = ctx;
        const diag = await new Transport(ctx.signals, log).init();
        diag.quiet = true; diag.busyLog = false;
        const vehicle = Vehicle.watch(ctx, log);
        // Movement is warning-only by the owner's request. Link/session failures still stop commands.
        const session = new Session(diag, log, { allowed: () => null });
        const glare = () => settings.get('glare') === true;
        const player = new Player({ diag, log, session, allowed: () => session.reason(), maxMs: () => (Number(settings.get('minutes')) || 3) * 60000 });
        const tests = new Address.AddressTests(diag,log,() =>
            player.state !== 'idle' || player.closing || player.prepared || session.attempted || diag.activeRequest ?
                'Stop lighting and wait for cleanup first' : !diag.p || !diag.available ? 'Diagnostic link unavailable' : null,
            () => vehicle.reason());
        const testSource = () => {
            const value = parseInt(settings.get('testSource') || 'F4',16);
            return Address.SOURCES.indexOf(value) >= 0 ? value : 0xf4;
        };

        let showKey = Shows.keys().indexOf(settings.get('show')) >= 0 ? settings.get('show') : Shows.keys()[0], lampAt = 0;
        const lamps = () => LAMPS.filter((l) => !l.experimental && (glare() || !l.glare) && player.refused.indexOf(l.key) < 0);
        const picked = () => { const l = lamps(); return l.length ? l[lampAt % l.length] : null; };
        const current = () => Shows.show(showKey, { glare: glare() });
        const guard = (name, fn) => () => { try { return fn(); } catch (e) { log.warn(name + ': ' + (e && e.message || e)); } };
        const lightAction = fn => () => { if (tests.busy) { tests.status = 'Wait for the address test to finish'; return; } return fn(); };
        // The pinned renderer owns the first canvas only. Both pages must use
        // MAIN_GFX and one loop; opening another RHMI canvas breaks GPU routing.
        let page = 'lights', buttonKey = null, redraw = null;
        const lightingBusy = () => player.state !== 'idle' || player.closing || player.prepared || session.attempted;
        const updateButtons = () => {
            const stop = tests.busy ? 'Stop test' : lightingBusy() ? 'Stop show' : 'Later';
            const key = page + (page === 'tests' ? ':' + stop : '');
            if (key === buttonKey) return;
            buttonKey = key;
            const labels = page === 'tests' ? ['Read test',stop,'Next address','Earlier','Write test','Back'] :
                ['Start','Stop','Next show','Next lamp','Flash lamp','Address tests'];
            if (typeof ui.text === 'function') Promise.all(['BTN_START','BTN_STOP','BTN_SHOW','BTN_LAMP','BTN_FLASH','BTN_TESTS']
                .map((id,i) => ui.text(id,labels[i]))).catch(e => log.warn('button labels: ' + e));
        };
        const testAction = kind => { const result = tests.run(kind,testSource()); updateButtons(); return result; };

        ui.onClick('BTN_START', guard('start', () => page === 'tests' ? testAction('read') : lightAction(() => player.play(current()))()));
        ui.onClick('BTN_STOP', guard('stop', () => {
            if (page === 'tests' && !tests.busy && !lightingBusy()) tests.scroll(-13);
            else { tests.stop(); player.stop('Stopped'); }
            updateButtons();
        }));
        ui.onClick('BTN_SHOW', guard('show', () => {
            if (page === 'tests') {
                if (!tests.busy) settings.set('testSource',Address.SOURCES[(Address.SOURCES.indexOf(testSource())+1)%Address.SOURCES.length].toString(16).toUpperCase());
                return;
            }
            showKey = Shows.next(showKey); settings.set('show', showKey);
            if (!tests.busy && player.state === 'playing' && !player.show.once) player.play(current());
        }));
        ui.onClick('BTN_LAMP', guard('lamp', () => {
            if (page === 'tests') { tests.scroll(13); return; }
            const count = lamps().length; lampAt = count ? (lampAt + 1) % count : 0;
        }));
        ui.onClick('BTN_FLASH', guard('flash', () => page === 'tests' ? testAction('write') :
            lightAction(() => { const selected = picked(); if (selected) player.flash(selected.key, 1000); })()));
        ui.onClick('BTN_TESTS', () => {
            page = page === 'lights' ? 'tests' : 'lights'; updateButtons();
            if (redraw && redraw.kick) redraw.kick();
        });

        // Shutdown cleanup is best effort within the platform's short grace period.
        if (ctx.app && ctx.app.on) ctx.app.on('shutdown', () => { tests.stop(); player.stop('App closed'); vehicle.close(); });

        redraw = ctx.loop('MAIN', 4, () => {
            updateButtons();
            const cv = ctx.canvas(1600, 520);
            if (page === 'tests') {
                Address.draw(cv,ctx.theme(),tests,tests.busy ? tests.source : testSource(),vehicle.summary ? vehicle.summary() : null);
                return ui.image('MAIN_GFX',cv);
            }
            draw(cv, ctx.theme(), {
                lit: LAMPS.filter((l) => player.isLit(l.key)).map((l) => l.key),
                show: current().name, state: player.state, reason: player.reason, lamp: picked() ? picked().name : 'No available lamps',
                warning: vehicle.warning ? vehicle.warning() : vehicle.reason(), speed: vehicle.speed(), rtt: player.rtt, writes: player.writes, skipped: player.skipped,
                failure: session.lastFailure, cleanupFailure: session.cleanupFailure,
                exchange: session.audit && session.audit.length ? session.audit[session.audit.length-1] : null,
                refused: player.refused.map((k) => LAMPS.find((l) => l.key === k).name), link: !!diag.p,
            });
            return ui.image('MAIN_GFX', cv);
        });
    },
});
