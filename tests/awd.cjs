'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const stage = process.argv[2];
const { Diag } = require(path.join(stage, 'kit', 'diag'));
const { readStatus, deactivate } = require(path.join(stage, 'awd'));
const stopped = async () => ({ speed: 0, rpm: 0 });
const confirmed = () => true;

async function fixture(options = {}) {
    const sent = [];
    let onResponse;
    let active = options.active !== false;
    const emit = (target, bytes) => {
        const header = Buffer.alloc(9);
        header[6] = target;
        onResponse({ errorCode: 'NO_ERROR', udsResponse: Buffer.concat([header, Buffer.from(bytes, 'hex')]) });
    };
    const signals = {
        proxy: async () => ({}),
        on: async (_, name, handler) => {
            assert.equal(name, 'sendTasuResponse');
            onResponse = handler;
        },
        onAvailable: async (_, handler) => handler(true),
        call: async (_, name, request) => {
            assert.equal(name, 'sendTasuRequest');
            assert.equal(request.sourceAddress, 0xf2);
            const target = request.targetAddress;
            const hex = Buffer.concat([Buffer.from([request.serviceID]), request.udsData]).toString('hex');
            sent.push([target, hex]);
            if (target === 0x29 && hex === '22f150') {
                emit(target, '7f2278');
                emit(target, options.wrongIb ? '62f1500f2100' : '62f1500f2500');
            } else if (target === 0x39 && hex === '22f150') {
                emit(target, options.wrongVip ? '62f150000000' : '62f1500f2520');
            } else if (target === 0x39 && hex === '22db44') {
                if (options.unreadable || (options.badReadback && sent.some(([, sid]) => sid === '2edb2f00'))) {
                    emit(target, '7f2231');
                } else {
                    emit(target, active ? '62db4401' : '62db4400');
                }
            } else {
                assert.deepEqual([target, hex], [0x39, '2edb2f00']);
                if (options.busy) return 'APP_REQUEST_TEMPORARILY_NOT_ACCEPTED';
                if (options.denied) emit(target, '7f2e33');
                else {
                    active = false;
                    if (options.lostAck) throw new Error('TASU call timed out after delivery');
                    emit(0x29, '6edb2f');
                    emit(target, '6edb2f');
                }
            }
            return 'NO_ERROR';
        },
    };
    const log = { info() {}, warn() {} };
    return { diag: await new Diag(signals, log).init(), sent };
}

const writes = (sent) => sent.filter(([, request]) => request.startsWith('2e'));

async function main() {
    const status = await fixture();
    assert.equal(await readStatus(status.diag), true);
    assert.deepEqual(writes(status.sent), []);
    for (const invalid of [{ wrongIb: true }, { wrongVip: true }, { unreadable: true }]) {
        const { diag, sent } = await fixture(invalid);
        await assert.rejects(deactivate(diag, stopped, confirmed), /identity|status unavailable/);
        assert.deepEqual(writes(sent), []);
    }
    for (const motion of [{ speed: 1, rpm: 0 }, { speed: 0, rpm: 1 }, { speed: 0, rpm: undefined }]) {
        const { diag, sent } = await fixture();
        await assert.rejects(deactivate(diag, async () => motion, confirmed), /zero speed and zero RPM/);
        assert.deepEqual(writes(sent), []);
    }
    const expired = await fixture();
    await assert.rejects(deactivate(expired.diag, stopped, () => false), /confirmation expired/);
    assert.deepEqual(writes(expired.sent), []);

    for (const [options, result] of [
        [{}, 'confirmed'],
        [{ active: false }, 'accepted-while-inactive'],
        [{ denied: true }, 'denied'],
        [{ busy: true }, 'active-unconfirmed'],
        [{ lostAck: true }, 'inactive-unconfirmed'],
        [{ badReadback: true }, 'unknown'],
    ]) {
        const { diag, sent } = await fixture(options);
        assert.equal(await deactivate(diag, stopped, confirmed), result);
        assert.deepEqual(writes(sent), [[0x39, '2edb2f00']]);
        assert.deepEqual(sent[sent.length - 1], [0x39, '22db44']);
    }
    console.log('AWD route, safety gates, one-shot write, and readback checks passed');
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
