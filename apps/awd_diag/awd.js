'use strict';

const { replyTo } = require('./kit/diag');

const VIP = 0x39;
const IDENT = [0xf1, 0x50];
const STATUS = [0xdb, 0x44];
const DEACTIVATE = [0xdb, 0x2f, 0x00];
const OPTIONS = {
    maxRetries: 0,
    callTimeoutMs: 3500,
    pendingTimeoutMs: 5000,
    hardTimeoutMs: 8000,
};

async function request(diag, target, service, data) {
    if (!diag.available) throw new Error('HU diagnostic service unavailable');
    return diag.physical(target, service, data, 4000, replyTo(service, data), OPTIONS);
}

async function identity(diag, target) {
    const reply = await request(diag, target, 0x22, IDENT);
    if (!reply || reply[0] !== 0x62 || reply.length < 6) return null;
    return Buffer.from(reply.slice(3, 6)).toString('hex');
}

async function readFlag(diag) {
    const reply = await request(diag, VIP, 0x22, STATUS);
    if (reply && reply[0] === 0x62 && reply.length === 4) {
        if (reply[3] === 0) return false;
        if (reply[3] === 1) return true;
    }
    throw new Error('VIP AWD status unavailable');
}

async function readStatus(diag) {
    if (await identity(diag, 0x29) !== '0f2500') {
        throw new Error('Expected IB_G05 identity at 0x29');
    }
    const vip = await identity(diag, VIP);
    if (vip !== '0f2520' && vip !== '0f2530') {
        throw new Error('Expected VIP_G05 identity at 0x39');
    }
    return readFlag(diag);
}

async function deactivate(diag, readMotion, isConfirmed) {
    const before = await readStatus(diag);
    const motion = await readMotion();
    if (motion.speed !== 0 || motion.rpm !== 0) {
        throw new Error('Live zero speed and zero RPM are required');
    }
    if (!isConfirmed()) throw new Error('PAD confirmation expired');

    let ack;
    try {
        ack = await request(diag, VIP, 0x2e, DEACTIVATE);
    } catch (_) {
        // A timeout can occur after delivery. Read the flag without replaying the write.
    }
    try {
        const active = await readFlag(diag);
        if (!active && ack && ack.length === 3 && ack[0] === 0x6e) {
            return before ? 'confirmed' : 'accepted-while-inactive';
        }
        if (!active) return 'inactive-unconfirmed';
        if (ack && ack.length === 3 && ack[0] === 0x7f && ack[2] === 0x33) return 'denied';
        return 'active-unconfirmed';
    } catch (_) {
        return 'unknown';
    }
}

module.exports = { readStatus, deactivate };
