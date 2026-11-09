'use strict';

const mgu = require('./kit/mgu');
const { Diag } = require('./kit/diag');
const { readStatus, deactivate } = require('./awd');

const RESTORE = 'Cycle ignition and read status';
const CONFIRM_MS = 20000;
const RESULTS = {
    'accepted-while-inactive': ['Request accepted. AWD was already inactive.', RESTORE],
    confirmed: ['AWD deactivation confirmed', RESTORE],
    'inactive-unconfirmed': ['AWD inactive, write unconfirmed', RESTORE],
    denied: ['VIP denied the request (0x33)', 'AWD active. Verify PAD mode.'],
    'active-unconfirmed': ['AWD still reports active', 'Deactivation unconfirmed'],
    unknown: ['AWD state unknown', RESTORE],
};

mgu.run({
    async start({ ui, signals, log }) {
        const diag = await new Diag(signals, log).init();
        let busy = false;
        let armedUntil = 0;
        let disarmTimer;
        let confirmation = 0;
        let motionProxies;
        let verifyRestoration = false;
        const foreground = () => ui.isVisible('MAIN') && ui.hasFocus('MAIN');
        const report = (status, detail) => {
            ui.text('STATUS', status);
            ui.text('DETAIL', detail);
        };

        function disarm() {
            clearTimeout(disarmTimer);
            armedUntil = 0;
            ui.text('TEST', 'Arm PAD test');
        }

        function cancel() {
            confirmation++;
            disarm();
        }

        ui.onVisible((state, on) => { if (state === 'MAIN' && !on) cancel(); });
        ui.onFocus((state, on) => { if (state === 'MAIN' && !on) cancel(); });

        async function readMotion() {
            if (!motionProxies) {
                motionProxies = await Promise.all([
                    signals.proxy('de.bmw.infotainment.vehicle.Vehicle2', '1'),
                    signals.proxy('de.bmw.infotainment.vehicle.CDS', '1'),
                ]);
            }
            const [speedProxy, engineProxy] = motionProxies;
            if (!speedProxy.isAvailable() || !engineProxy.isAvailable()) {
                throw new Error('Vehicle speed or engine RPM unavailable');
            }
            const [speed, engine] = await Promise.all([
                speedProxy.getValue('statusCarSpeed2', 2200),
                engineProxy.getValue('statusEngineSpeed2', 2200),
            ]);
            return { speed: speed && speed.speedVehicleCentreOfGravity,
                rpm: engine && engine.actualValueRPMEngineCrankshaft };
        }

        async function run(action) {
            busy = true;
            ui.enabled('READ', false);
            ui.enabled('TEST', false);
            try {
                await action();
            } catch (error) {
                report(error.message, 'No AWD write sent');
            } finally {
                busy = false;
                ui.enabled('READ', true);
                ui.enabled('TEST', !verifyRestoration);
            }
        }

        ui.onClick('READ', async () => {
            if (busy || !foreground()) return;
            cancel();
            report('Reading AWD status', 'Checking IB_G05 and VIP_G05');
            await run(async () => {
                const active = await readStatus(diag);
                if (active) verifyRestoration = false;
                report(active ? 'AWD active' : 'AWD inactive',
                    active ? 'VIP_G05 status verified' : RESTORE);
            });
        });

        ui.onClick('TEST', async () => {
            if (busy || verifyRestoration || !foreground()) return;
            if (Date.now() >= armedUntil) {
                disarm();
                armedUntil = Date.now() + CONFIRM_MS;
                disarmTimer = setTimeout(disarm, CONFIRM_MS);
                report('Park, engine off, PAD mode', 'Confirm only when all three apply');
                ui.text('TEST', 'Confirm PAD test');
                return;
            }
            const until = armedUntil;
            const expected = ++confirmation;
            disarm();
            report('Checking AWD and vehicle state', 'Keep the car stationary in PAD');
            await run(async () => {
                const result = await deactivate(diag, readMotion,
                    () => foreground() && confirmation === expected && Date.now() < until);
                verifyRestoration = result !== 'denied';
                report(...RESULTS[result]);
            });
        });
    },
});
