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

function draw(cv, state, offset) {
    cv.clear('#0b1018');
    cv.text('AI TERMINAL', 36, 43, 30, '#eef5ff', { font: 'bold' });
    cv.text(state.status || 'Starting', 1570, 43, 22, '#6ddbd1', { align: 'right' });
    cv.fillRect(30, 64, 1540, 2, '#28384d');
    if (state.approvals.length) return drawApproval(cv, state.approvals[0], offset);
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
