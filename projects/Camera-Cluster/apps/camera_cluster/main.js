'use strict';
const mgu = require('./kit/mgu');
const cameras = require('./camera');
const icam = require('./icam');
const Feed = require('./feed').Feed;
const draw = require('./view').draw;

mgu.run({
    async start(ctx) {
        const log = (text) => ctx.log.info(text);
        const feed = new Feed();
        const camera = new cameras.Camera({ io: icam.create(ctx.signals, log), log: log });

        // The picture goes on the cluster only while the camera unit confirms the
        // view that was asked for. A parking view or a refusal takes it off again,
        // so the cluster never shows a picture the driver did not choose.
        const sync = () => feed.show(camera.want !== cameras.VIEWS.off && camera.state === 'on');
        camera.on('change', sync);

        function select(view) {
            return async () => {
                try {
                    if (view === cameras.VIEWS.off) {
                        feed.show(false);
                        await camera.select(view);
                        return;
                    }
                    // The feed first: it must be listening when the camera unit starts its stream.
                    feed.start();
                    await camera.select(view);
                } catch (e) { ctx.log.warn('select: ' + ((e && e.message) || e)); }
            };
        }
        ctx.ui.onClick('BTN_FRONT', select(cameras.VIEWS.front));
        ctx.ui.onClick('BTN_REAR', select(cameras.VIEWS.rear));
        ctx.ui.onClick('BTN_OFF', select(cameras.VIEWS.off));

        // The platform stopping the app: picture off and cameras back, in the 200 ms it allows.
        ctx.app.on('shutdown', () => { feed.stop(); camera.select(cameras.VIEWS.off); });
        process.once('exit', () => feed.stop());

        ctx.loop('MAIN', 2, () => {
            const cv = ctx.canvas(1600, 520);
            draw(cv, { camera: camera.status(), feed: feed.status() });
            return ctx.ui.image('MAIN_GFX', cv);
        });
    }
});
