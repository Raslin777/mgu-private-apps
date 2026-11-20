'use strict';
const { layout } = require('./artwork');
const TARGETS = ['both', 'left', 'right'];
function selected(value) { return TARGETS.indexOf(value) >= 0 ? value : 'both'; }
function change(settings, target, dx, dy, reset, targets) {
    const current = layout(targets || 'hud:800x480', settings);
    if (!current) return null;
    const offsets = current.offsets;
    for (const side of selected(target) === 'both' ? ['left', 'right'] : [selected(target)]) {
        offsets[side] = reset ? { x: 0, y: 0 } : { x: offsets[side].x + dx * 2, y: offsets[side].y + dy * 2 };
    }
    // Save only the realizable offsets. Repeated presses at an edge cannot
    // accumulate hidden movement that must be undone before an icon moves back.
    return layout(targets || 'hud:800x480', Object.assign({}, settings, { positions: offsets })).offsets;
}
function summary(settings, targets) {
    const geometry = layout(targets || 'hud:800x480', settings);
    if (!geometry) return 'HUD unavailable';
    return ['left', 'right'].map(side => {
        const point = geometry.offsets[side];
        return (side === 'left' ? 'L' : 'R') + ' ' + Math.round(point.x) + ',' + Math.round(point.y) + '%';
    }).join(' | ');
}
module.exports = { change, selected, summary, TARGETS };
