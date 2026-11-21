'use strict';
function draw(cv, model) {
    cv.clear('#090e15');
    cv.text('HUD BLINDSPOT', 44, 44, 30, '#edf4ff', { font: 'bold' });
    cv.text(model.enabled ? 'Enabled' : 'Disabled', 1260, 44, 27, model.enabled ? '#7fd9c1' : '#97a6ba');
    cv.text('Size: ' + model.size + '     Opacity: ' + model.opacity + '%     Height: ' + model.height + '%', 44, 91, 25, '#a6b5c8');
    cv.roundRect(44, 118, 1510, 200, 16, '#121e2c');
    const s = model.warning;
    const label = side => !s.valid ? 'Unavailable' : !s.active ? 'Standby' : s[side] >= 2 ?
        (s.source === 'UDS D347' ? 'Blinking warning' : 'Urgent warning') : s[side] ? 'Warning' : 'No warning';
    cv.text('LEFT', 84, 166, 22, '#a6b5c8');
    cv.text(label('left'), 84, 215, 34, s.valid && s.left ? '#ffb62a' : '#edf4ff');
    cv.text('RIGHT', 1180, 166, 22, '#a6b5c8');
    cv.text(label('right'), 1180, 215, 34, s.valid && s.right ? '#ffb62a' : '#edf4ff');
    cv.text(model.overlay.link, 520, 171, 24, '#edf4ff');
    cv.text((model.overlay.target || 'Only warning icons are added').slice(0, 60), 420, 219, 20, '#a6b5c8');
    cv.text(s.reason || (s.active ? 'Live warning signal' : 'Blind-spot system on standby'), 84, 292, 23, '#a6b5c8');
    const diagnostic = model.diagnostic || {}, trace = diagnostic.trace;
    let source = 'Source: ' + (s.source || 'SOME/IP') + ' | age: ' + (s.age == null ? '--' : s.age + ' ms');
    if (s.fallbackReason) source += ' | Fallback: ' + s.fallbackReason;
    cv.text(source.slice(0, 130), 44, 350, 21, '#a6b5c8');
    const primary = model.someip || {}, sample = primary.sample || {};
    const raw = primary.mirror || (s.source === 'SOME/IP' ? s.mirror : null);
    const value = v => v == null ? '--' : String(v).slice(0, 12);
    cv.text(('SOME/IP: ' + (primary.available ? 'Provider available' : 'Provider unavailable') +
        ' | Q ' + value(sample.qualifier) + ' L ' + value(sample.left) + ' R ' + value(sample.right) +
        ' | age ' + (primary.age == null ? '--' : primary.age + ' ms') +
        ' | mirror raw L ' + value(raw && raw.left) + ' R ' + value(raw && raw.right)).slice(0, 140), 44, 379, 20, '#edf4ff');
    const assisted = model.assisted || {}, viewSample = assisted.sample || {};
    cv.text('Assisted View: ' + (assisted.available ? 'Provider available' : 'Provider unavailable') +
        ' | Q ' + value(viewSample.qualifier) + ' L ' + value(viewSample.left) + ' R ' + value(viewSample.right) +
        ' | age ' + (assisted.age == null ? '--' : assisted.age + ' ms'), 44, 403, 18, '#a6b5c8');
    if (trace) {
        cv.text(('Last D347 TX: ' + trace.tx + ' | ' + (trace.origin || 'Waiting') + ' RX: ' + (trace.rx || 'No UDS reply')).slice(0, 130), 44, 430, 19, '#edf4ff');
        const line = 'TASU RX: ' + (trace.rawTasu || 'No raw reply');
        for (let at = 0; at < line.length; at += 115) cv.text(line.slice(at, at + 115), 44, 451 + Math.floor(at / 115) * 20, 18, '#a6b5c8');
    } else {
        cv.text('Mirror event (raw): L ' + (raw && raw.left != null ? String(raw.left).slice(0, 12) : '--') +
            '  R ' + (raw && raw.right != null ? String(raw.right).slice(0, 12) : '--'), 44, 430, 19, '#a6b5c8');
        cv.text((diagnostic.reason || 'Waiting for signal').slice(0, 130), 44, 455, 20, '#a6b5c8');
    }
    cv.text('Supplemental display. Keep using the factory mirror warnings.', 44, 501, 18, '#97a6ba');
}
module.exports = { draw };
