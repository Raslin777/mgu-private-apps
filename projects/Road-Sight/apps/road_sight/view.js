'use strict';
const { flatten } = require('./flatten');
const W = 1600, ROWS = 19, DETAIL_ROWS = 20, COLS = 2;
const C = { bg: '#090e15', panel: '#121e2c', text: '#edf4ff', dim: '#a6b5c8', faint: '#6f8097', live: '#7fd9c1', warn: '#ffb62a', bad: '#ff7a6b' };
function age(ms) {
    if (ms === null || ms === undefined) return '--';
    if (ms < 1000) return ms + ' ms';
    if (ms < 60000) return Math.round(ms / 100) / 10 + ' s';
    return Math.round(ms / 6000) / 10 + ' min';
}
function rate(v) { return v >= 10 ? Math.round(v) + '/s' : v > 0 ? Math.round(v * 10) / 10 + '/s' : '--'; }
const EVIDENCE = { A: 'expected', B: 'likely', C: 'unknown' };
function status(svc) {
    if (svc.total > 0) return ['receiving', C.live];
    if (svc.state === 'refused') return ['refused', C.bad];
    if (svc.available === false) return ['not offered', C.faint];
    if (svc.available === true) return ['offered, silent', C.warn];
    return [svc.state, C.dim];
}
// The list of pages: overview pages first, then one entry per service.
function pages(snapshot, liveOnly) {
    const shown = liveOnly ? snapshot.filter(s => s.total > 0) : snapshot;
    const list = [];
    const overview = Math.max(1, Math.ceil(snapshot.length / ROWS));
    for (let i = 0; i < overview; i++) list.push({ kind: 'overview', index: i, of: overview });
    shown.forEach(s => list.push({ kind: 'service', iface: s.iface }));
    return list;
}
function detailRows(svc) {
    const rows = [];
    svc.members.forEach(m => {
        rows.push({ head: true, text: m.name + (m.kind === 'field' ? ' (field)' : ''),
            right: m.error ? 'error: ' + m.error : m.count ? 'x' + m.count + '   ' + rate(m.rate) + '   ' + age(m.age) + ' ago' : 'nothing received',
            live: m.count > 0, bad: !!m.error });
        if (m.count) flatten(m.value).forEach(pair => rows.push({ head: false, text: pair[0], right: pair[1] }));
    });
    return rows;
}
function drawOverview(cv, snapshot, page) {
    const live = snapshot.filter(s => s.total > 0).length;
    cv.text('ROAD SIGHT', 44, 40, 28, C.text, { font: 'bold' });
    cv.text(live + ' of ' + snapshot.length + ' services sending data   |   overview ' + (page.index + 1) + '/' + page.of, 320, 40, 22, live ? C.live : C.dim);
    const x = [44, 130, 560, 760, 900, 1040, 1180, 1330];
    ['GROUP', 'SERVICE', 'STATUS', 'EVENTS', 'COUNT', 'RATE', 'LAST', 'EXPECTED?'].forEach((h, i) => cv.text(h, x[i], 76, 16, C.faint));
    snapshot.slice(page.index * ROWS, (page.index + 1) * ROWS).forEach((svc, row) => {
        const y = 100 + row * 21, st = status(svc);
        cv.text(svc.group, x[0], y, 17, C.dim);
        cv.text(svc.name.slice(0, 40), x[1], y, 17, svc.total ? C.text : C.dim);
        cv.text(st[0], x[2], y, 17, st[1]);
        cv.text(svc.seen + '/' + svc.members.length, x[3], y, 17, svc.seen ? C.text : C.faint);
        cv.text(String(svc.total), x[4], y, 17, svc.total ? C.text : C.faint);
        cv.text(rate(svc.rate), x[5], y, 17, C.dim);
        cv.text(age(svc.age), x[6], y, 17, C.dim);
        cv.text(EVIDENCE[svc.evidence] || '', x[7], y, 17, svc.evidence === 'A' ? C.live : svc.evidence === 'B' ? C.text : C.faint);
    });
    cv.text('Read-only. Next: one page per service with every value it sent.', 44, 508, 17, C.faint);
}
function drawService(cv, svc, scroll) {
    const st = status(svc), rows = detailRows(svc);
    cv.text(svc.name.slice(0, 44), 44, 40, 28, C.text, { font: 'bold' });
    cv.text(svc.group + '   |   service 0x' + svc.id.toString(16).toUpperCase() + '   |   ' + st[0], 760, 40, 21, st[1]);
    cv.text(svc.iface.slice(0, 110), 44, 68, 15, C.faint);
    const per = DETAIL_ROWS * COLS, pagesOf = Math.max(1, Math.ceil(rows.length / per));
    const at = ((scroll % pagesOf) + pagesOf) % pagesOf;
    rows.slice(at * per, (at + 1) * per).forEach((row, i) => {
        const col = Math.floor(i / DETAIL_ROWS), y = 96 + (i % DETAIL_ROWS) * 20, x0 = 44 + col * 778;
        if (row.head) {
            cv.text(row.text.slice(0, 44), x0, y, 17, row.bad ? C.bad : row.live ? C.live : C.dim, { font: 'bold' });
            cv.text(row.right.slice(0, 36), x0 + 440, y, 15, row.bad ? C.bad : C.dim);
        } else {
            cv.text(row.text.slice(-52), x0 + 14, y, 15, C.dim);
            cv.text(String(row.right).slice(0, 26), x0 + 500, y, 15, C.text);
        }
    });
    cv.text(rows.length + ' lines' + (pagesOf > 1 ? '   |   part ' + (at + 1) + '/' + pagesOf + ' ("More lines")' : '') +
        (svc.error ? '   |   ' + svc.error : ''), 44, 508, 17, C.faint);
}
function draw(cv, model) {
    cv.clear(C.bg);
    const list = pages(model.snapshot, model.liveOnly);
    const index = Math.min(Math.max(model.page, 0), list.length - 1), page = list[index];
    if (page.kind === 'overview') drawOverview(cv, model.snapshot, page);
    else {
        const svc = model.snapshot.filter(s => s.iface === page.iface)[0];
        if (svc) drawService(cv, svc, model.scroll);
    }
    cv.text((index + 1) + '/' + list.length + (model.liveOnly ? '   live only' : ''), 1420, 508, 17, C.faint);
    return { index: index, count: list.length };
}
module.exports = { draw, pages, detailRows, age, rate, status, W };
