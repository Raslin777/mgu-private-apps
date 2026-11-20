'use strict';
function draw(cv, model) {
    cv.clear('#090e15');
    cv.text('HUD BLINDSPOT', 44, 44, 30, '#edf4ff', { font: 'bold' });
    cv.text(model.enabled ? 'Enabled' : 'Disabled', 1260, 44, 27, model.enabled ? '#7fd9c1' : '#97a6ba');
    cv.text('Small warnings at the left and right edges of your HUD', 44, 91, 25, '#a6b5c8');
    cv.roundRect(44, 118, 1510, 224, 16, '#121e2c');
    const s = model.warning;
    const label = side => !s.valid ? 'Unavailable' : !s.active ? 'Standby' : s[side] >= 2 ? 'Urgent warning' : s[side] ? 'Warning' : 'No warning';
    cv.text('LEFT', 84, 166, 22, '#a6b5c8');
    cv.text(label('left'), 84, 215, 34, s.valid && s.left ? '#ffb62a' : '#edf4ff');
    cv.text('RIGHT', 1180, 166, 22, '#a6b5c8');
    cv.text(label('right'), 1180, 215, 34, s.valid && s.right ? '#ffb62a' : '#edf4ff');
    cv.text(model.overlay.link, 520, 171, 24, '#edf4ff');
    cv.text((model.overlay.target || 'Only warning icons are added').slice(0, 60), 420, 219, 20, '#a6b5c8');
    cv.text(s.reason || (s.active ? 'Live warning signal' : 'Blind-spot system on standby'), 84, 292, 23, '#a6b5c8');
    cv.text('Size: ' + model.size + '     Opacity: ' + model.opacity + '%     Height: ' + model.height + '%', 44, 386, 24, '#edf4ff');
    const raw = s.mirror;
    cv.text('Mirror event (raw): L ' + (raw && raw.left != null ? String(raw.left).slice(0, 12) : '--') +
        '  R ' + (raw && raw.right != null ? String(raw.right).slice(0, 12) : '--') +
        '     Warning age: ' + (s.age == null ? '--' : s.age + ' ms'), 44, 434, 21, '#a6b5c8');
    cv.text('Supplemental display. Keep using the factory mirror warnings.', 44, 486, 21, '#97a6ba');
}
module.exports = { draw };
