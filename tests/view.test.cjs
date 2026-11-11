'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { wrap, draw } = require('../apps/mgu_ai_terminal/view');

function canvas() {
    const texts = [];
    return { texts, clear() {}, fillRect() {}, text(value) { texts.push(String(value)); } };
}
const approval = (command, extra) => Object.assign({ id: 1, command, root: false, reason: 'because', flags: [] }, extra || {});

test('terminal wraps and strips terminal control characters', () => {
    assert.deepEqual(wrap('abcdefgh\n\x00hello', 4), ['abcd', 'efgh', 'hell', 'o']);
});
test('the newest output is shown, and older output can be scrolled to', () => {
    const lines = [];
    for (let i = 1; i <= 30; i++) lines.push('line ' + i);
    let cv = canvas();
    draw(cv, { status: 'Ready', lines, approvals: [] }, 0);
    assert.ok(cv.texts.includes('line 30'));
    assert.equal(cv.texts.includes('line 1'), false);
    cv = canvas();
    draw(cv, { status: 'Ready', lines, approvals: [] }, 18);
    assert.ok(cv.texts.includes('line 1'));
});
test('a command waiting for approval is shown from its first line', () => {
    const long = [];
    for (let i = 1; i <= 40; i++) long.push('step-' + i);
    const cv = canvas();
    const shown = draw(cv, { status: 'Action needs approval', lines: ['old output'], approvals: [approval(long.join('\n'))] }, 0);
    assert.ok(cv.texts.includes('Why: because'));
    assert.ok(cv.texts.includes('step-1'));
    assert.equal(cv.texts.includes('step-40'), false);
    assert.equal(cv.texts.includes('old output'), false);
    assert.ok(shown.below > 0);
    assert.ok(cv.texts.some(t => /MORE LINES — scroll before approving/.test(t)));
    const end = canvas();
    assert.equal(draw(end, { status: '', lines: [], approvals: [approval(long.join('\n'))] }, 999).below, 0);
    assert.ok(end.texts.includes('step-40'));
});
test('root commands and risk flags are called out on the review screen', () => {
    const cv = canvas();
    draw(cv, { status: '', lines: [], approvals: [approval('reboot', { root: true, flags: ['RUNS AS ROOT', 'RESTARTS THE HEAD UNIT'] })] }, 0);
    assert.ok(cv.texts.includes('REVIEW — RUNS AS ROOT'));
    assert.ok(cv.texts.includes('! RUNS AS ROOT   ! RESTARTS THE HEAD UNIT'));
    assert.ok(cv.texts.includes('reboot'));
    const plain = canvas();
    draw(plain, { status: '', lines: [], approvals: [approval('ls')] }, 0);
    assert.ok(plain.texts.includes('REVIEW — runs as the app user'));
    assert.ok(plain.texts.some(t => /^Ask = Approve/.test(t)));
});
