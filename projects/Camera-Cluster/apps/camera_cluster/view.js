'use strict';
// The app's one screen: what is selected and what each part of the chain says.
const NAMES = ['Off', 'Front camera', 'Rear camera'];

// What the driver should expect on the cluster, from the two parts' states.
function summary(model) {
    const camera = model.camera, feed = model.feed;
    if (!camera.want) return { text: 'Off. The cluster shows its own map.', colour: '#9aacc4' };
    if (feed.link !== 'connected') return { text: 'Not showing: ' + feed.link + '.', colour: '#ff6b5e' };
    if (camera.state === 'refused') return { text: 'Not showing: the camera unit did not give the view.', colour: '#ff6b5e' };
    if (camera.state === 'paused') return { text: 'Waiting: a parking view has the cameras.', colour: '#f2c14e' };
    if (camera.state !== 'on') return { text: 'Asking the camera unit...', colour: '#f2c14e' };
    if (feed.state === 'showing') return { text: NAMES[camera.want] + ' is on the cluster.', colour: '#6ddbd1' };
    return { text: 'Camera view is on; waiting for the picture on the cluster.', colour: '#f2c14e' };
}

function draw(cv, model) {
    const camera = model.camera, feed = model.feed;
    cv.clear('#0b1018');
    cv.text('CAMERA CLUSTER', 36, 43, 30, '#eef5ff', { font: 'bold' });
    cv.text(NAMES[camera.want] || 'Off', 1570, 43, 24, '#6ddbd1', { align: 'right' });
    cv.fillRect(30, 64, 1540, 2, '#28384d');

    const top = summary(model);
    cv.text(top.text, 40, 130, 34, top.colour, { font: 'bold' });

    const rows = [
        ['Camera unit', camera.text],
        ['Feed tool', feed.link + (feed.state ? ' - ' + feed.state : '')],
        ['Cluster', feed.reason || (feed.cluster ? 'picture allowed on the cluster' : 'picture off')],
        ['Camera picture', camera.stream || 'size not reported yet']
    ];
    rows.forEach((row, i) => {
        cv.text(row[0], 40, 200 + i * 42, 24, '#7e91aa');
        cv.text(String(row[1]).slice(0, 96), 260, 200 + i * 42, 24, '#d1dbea');
    });

    cv.text('Front / Rear put that camera in the cluster\'s centre map area. Off gives the map back.', 40, 400, 22, '#9aacc4');
    cv.text('The picture is not a driving aid: it is delayed and can freeze. Check before you rely on it.', 40, 434, 22, '#9aacc4');
    cv.text('Prototype: built offline, not yet run on a car.', 1570, 505, 18, '#7e91aa', { align: 'right' });
    return top;
}

module.exports = { draw, summary, NAMES };
