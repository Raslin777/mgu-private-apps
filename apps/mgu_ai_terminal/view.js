'use strict';

const ROWS = 12;

function wrap(text, columns) {
    const result = [];
    String(text).replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '').split('\n').forEach(line => {
        if (!line.length) result.push('');
        while (line.length) { result.push(line.slice(0, columns)); line = line.slice(columns); }
    });
    return result;
}
function fitLines(cv, text) {
    if (!cv.textWidth) return wrap(text, 100);
    const lines = [];
    wrap(text, 100).forEach(part => {
        let line = '';
        Array.from(part).forEach(character => {
            if (line && cv.textWidth(line + character, 24) > 1510) { lines.push(line); line = ''; }
            line += character;
        });
        lines.push(line);
    });
    return lines;
}

// A command waiting for approval is always shown from its first line, so the
// start of the command can never be scrolled out of view by default.
function drawApproval(cv, approval, offset) {
    const root = approval.root;
    cv.text(root ? 'REVIEW — RUNS AS ROOT' : 'REVIEW — runs as the app user', 40, 102, 26, root ? '#ff6b5e' : '#f2c14e', { font: 'bold' });
    const body = fitLines(cv, (approval.flags.length ? '! ' + approval.flags.join('   ! ') + '\n' : '') +
        'Why: ' + (approval.reason || 'no reason given') + '\n\n' + approval.command);
    const rows = ROWS - 2;
    const start = Math.min(Math.max(0, offset || 0), Math.max(0, body.length - rows));
    body.slice(start, start + rows).forEach((line, i) => {
        cv.text(line, 40, 140 + i * 31, 24, line.charAt(0) === '!' ? '#ff6b5e' : '#d1dbea');
    });
    const below = body.length - (start + rows);
    cv.text((below > 0 ? below + ' MORE LINES — scroll before approving   ' : '') + 'Ask = Approve   Reload = Deny',
        1570, 505, 18, below > 0 ? '#ff6b5e' : '#7e91aa', { align: 'right' });
    return { total: body.length, below: Math.max(0, below) };
}

// Pairing screen: a QR code for the phone page plus the same address and code as text.
let qrText = null, qr = null;
function drawLink(cv, link, configured) {
    if (!link.url) {
        cv.text('Phone link needs a network', 80, 150, 36, '#eef5ff', { font: 'bold' });
        cv.text('The head unit has no network address yet. Turn on the car\'s Wi-Fi hotspot,', 80, 215, 26, '#9aacc4');
        cv.text('then choose More > Phone link again.', 80, 252, 26, '#9aacc4');
        return { total: 0, below: 0 };
    }
    if (qrText !== link.url) { qrText = link.url; qr = require('./qrcodegen').QrCode.encodeText(qrText, require('./qrcodegen').QrCode.Ecc.MEDIUM); }
    const scale = Math.floor(360 / (qr.size + 8));
    const size = (qr.size + 8) * scale;
    cv.fillRect(80, 96, size, size, '#ffffff');
    for (let y = 0; y < qr.size; y++) for (let x = 0; x < qr.size; x++) {
        if (qr.getModule(x, y)) cv.fillRect(80 + (x + 4) * scale, 96 + (y + 4) * scale, scale, scale, '#000000');
    }
    cv.text(configured ? 'Link your phone' : 'Set up with your phone', 500, 140, 36, '#eef5ff', { font: 'bold' });
    cv.text('1. Join the car\'s Wi-Fi hotspot on your phone.', 500, 195, 25, '#9aacc4');
    cv.text('2. Scan the code, or open:', 500, 232, 25, '#9aacc4');
    cv.text(link.shown, 500, 276, 30, '#eef5ff', { font: 'bold' });
    cv.text('3. If asked, enter this code:', 500, 326, 25, '#9aacc4');
    cv.text(link.code, 500, 384, 46, '#6ddbd1', { font: 'bold' });
    if (link.others.length) cv.text('Other addresses: ' + link.others.join('   '), 500, 430, 18, '#7e91aa');
    cv.text(configured ? 'Type requests on the phone. Commands are still approved here.' : 'Then add your Claude or OpenAI API key on the phone.',
        500, 470, 22, '#d1dbea');
    return { total: 0, below: 0 };
}

// link: the phone-link details while its pairing screen should be shown, else null.
function draw(cv, state, offset, link) {
    cv.clear('#0b1018');
    cv.text('AI TERMINAL', 36, 43, 30, '#eef5ff', { font: 'bold' });
    cv.text(state.status || 'Starting', 1570, 43, 22, '#6ddbd1', { align: 'right' });
    cv.fillRect(30, 64, 1540, 2, '#28384d');
    if (state.approvals.length) return drawApproval(cv, state.approvals[0], offset);
    if (link) return drawLink(cv, link, !!state.configured);
    const text = state.lines.join('\n') || 'Your head-unit workspace\n\nAsk a question, or describe a file or command task.\n\n' +
        'Examples:\n  Create a hello-world script in my workspace.\n  List the files here and explain what they do.\n\n' +
        'Every command is shown here for you to approve or deny.';
    const lines = fitLines(cv, text);
    const end = Math.max(ROWS, lines.length - (offset || 0));
    lines.slice(Math.max(0, end - ROWS), end).forEach((line, i) => {
        const first = line.charAt(0);
        cv.text(line, 40, 102 + i * 31, 24, first === '>' ? '#6ddbd1' : first === '#' ? '#ff6b5e' : '#d1dbea');
    });
    cv.text(Math.min(lines.length, end) + '/' + lines.length + ' lines', 1570, 505, 18, '#7e91aa', { align: 'right' });
    return { total: lines.length, below: 0 };
}
module.exports = { draw, wrap };
