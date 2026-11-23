'use strict';
// Turns whatever the SOME/IP binding hands over (objects, arrays, buffers,
// numbers, enum names) into "path = value" rows. No schema is needed: the
// binding already delivers named members.
const MAX_ROWS = 400, MAX_DEPTH = 8, ARRAY_HEAD = 4;
function isBytes(v) {
    return Buffer.isBuffer(v) || (v && typeof v === 'object' && typeof v.length === 'number' && v.BYTES_PER_ELEMENT === 1);
}
function scalar(v) {
    if (v === null || v === undefined) return '--';
    if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 10000) / 10000);
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    if (typeof v === 'string') return v.length > 60 ? v.slice(0, 57) + '...' : v;
    return String(v).slice(0, 60);
}
function hex(bytes, limit) {
    let out = '';
    for (let i = 0; i < bytes.length && i < limit; i++) out += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
    return out + (bytes.length > limit ? '... (' + bytes.length + ' bytes)' : '');
}
// True for a value that only says "nothing here" (all members at their fill value).
function blank(v) {
    return v === null || v === undefined || v === '' || v === 0 || v === false;
}
function flatten(value) {
    const rows = [];
    function walk(v, path, depth) {
        if (rows.length >= MAX_ROWS) return;
        if (isBytes(v)) { rows.push([path || 'value', hex(v, 24)]); return; }
        if (Array.isArray(v)) {
            // Lists from the car are fixed-size blocks: say how many entries hold something, show the first few.
            const filled = v.filter(x => !(x && typeof x === 'object' ? Object.keys(x).every(k => blank(x[k])) : blank(x))).length;
            rows.push([path || 'value', 'list of ' + v.length + (filled !== v.length ? ', ' + filled + ' filled' : '')]);
            if (depth >= MAX_DEPTH) return;
            for (let i = 0; i < v.length && i < ARRAY_HEAD; i++) walk(v[i], (path || 'value') + '[' + i + ']', depth + 1);
            return;
        }
        if (v && typeof v === 'object') {
            if (depth >= MAX_DEPTH) { rows.push([path || 'value', '{...}']); return; }
            const keys = Object.keys(v);
            if (!keys.length) { rows.push([path || 'value', '{}']); return; }
            for (let i = 0; i < keys.length; i++) walk(v[keys[i]], path ? path + '.' + keys[i] : keys[i], depth + 1);
            return;
        }
        rows.push([path || 'value', scalar(v)]);
    }
    walk(value, '', 0);
    return rows;
}
// One compact line for the log.
function oneLine(value, limit) {
    let text;
    try {
        // A Buffer reaches a replacer already turned into { type, data }, so look at the original member.
        text = JSON.stringify(value, function (k, v) { const raw = this[k]; return isBytes(raw) ? 'hex:' + hex(raw, 64) : v; });
    } catch (e) { text = String(value); }
    if (text === undefined) text = String(value);
    return text.length > limit ? text.slice(0, limit) + '...' : text;
}
module.exports = { flatten, oneLine, hex };
