'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const kit = require('../.cache/idrive-kit/kit/runtime/diag');
const { quiet } = require('./sim.cjs');
const source = fs.readFileSync(path.join(__dirname, '../apps/external_lights/transport.js'), 'utf8');
const moduleValue = { exports: {} };
vm.runInNewContext(source, { require: name => { assert.equal(name, './kit/diag'); return kit; },
    module: moduleValue, Promise, Buffer, setTimeout, clearTimeout });
const { Transport } = moduleValue.exports;
const accept = kit.replyTo(0x2e, [0xd5, 0x42]);
const frame = (ecu, uds) => ({ errorCode: 'NO_ERROR', udsResponse: Buffer.from([0,0,0,0,0,0,ecu,0,0].concat(uds)) });
function fixture() {
    const diag = new Transport({}, quiet);
    diag.p = {}; diag.available = true;
    diag.send = async () => 'NO_ERROR';
    return diag;
}
function idle(diag) {
    for (const event of ['frame', 'tasReject', 'tasError', 'available']) assert.equal(diag.listenerCount(event), 0, event);
    assert.equal(diag.activeRequest, null);
}
function request(diag, options) {
    return diag.physical(0x40, 0x2e, [0xd5,0x42,0,6,0,45], 100, accept,
        Object.assign({ hardTimeoutMs: 300, maxRetries: 0 }, options));
}

test('TASU header rejection is surfaced with its raw frame, not an ECU NRC or timeout', async () => {
    const diag = fixture(); const result = request(diag);
    diag._onResponse({ errorCode: 'NO_ERROR', udsResponse: Buffer.from([0,0,0x7f,0,0x22]) });
    await assert.rejects(result, error => {
        assert.equal(error.origin, 'tasu'); assert.equal(error.transportCode, 0x22);
        assert.equal(error.rawTasu, '00 00 7f 00 22'); return /TASU rejected/.test(error.message);
    });
    assert.equal(diag.lastExchange.origin, 'tasu'); idle(diag);
});
test('an inner 7F 2E 22 remains an ECU response with the entire TASU header retained', async () => {
    const diag = fixture(); const result = request(diag);
    diag._onResponse(frame(0x40,[0x7f,0x2e,0x22]));
    assert.deepEqual(await result, [0x7f,0x2e,0x22]);
    assert.equal(diag.lastExchange.origin, 'ecu');
    assert.equal(diag.lastExchange.rawTasu[0], '00 00 00 00 00 00 40 00 00 7f 2e 22'); idle(diag);
});
test('unrelated ECU/service/DID replies cannot settle the request', async () => {
    const diag = fixture(); const result = request(diag);
    diag._onResponse(frame(0x43,[0x6e,0xd5,0x42]));
    diag._onResponse(frame(0x40,[0x7f,0x22,0x22]));
    diag._onResponse(frame(0x40,[0x6e,0xda,0x5e]));
    assert.ok(diag.activeRequest);
    diag._onResponse(frame(0x40,[0x6e,0xd5,0x42]));
    assert.deepEqual(await result,[0x6e,0xd5,0x42]);
    assert.equal(diag.lastExchange.rawTasu.length,1); idle(diag);
});
test('method errors, TASU errors and disconnection remove every request listener', async () => {
    for (const kind of ['method','event','disconnect']) {
        const diag=fixture();
        if (kind==='method') diag.send=async()=>{throw new Error('method failed');};
        const result=request(diag);
        if(kind==='event') diag._onResponse({errorCode:'APP_REQUEST_NOT_ACCEPTED'});
        if(kind==='disconnect') diag.emit('available',false);
        await assert.rejects(result,error=>error.origin==='tasu'); idle(diag);
    }
});
test('a stalled send obeys the hard deadline and a late method failure is handled', async () => {
    const diag=fixture(); let rejectSend;
    diag.send=()=>new Promise((resolve,reject)=>{rejectSend=reject;});
    assert.equal(await request(diag,{hardTimeoutMs:10}),null); idle(diag);
    rejectSend(new Error('late failure'));
    await new Promise(resolve=>setImmediate(resolve)); idle(diag);
});
test('overlapping requests are rejected without disturbing the first request', async () => {
    const diag=fixture(); const first=request(diag);
    await assert.rejects(request(diag),/already active/);
    diag._onResponse(frame(0x40,[0x6e,0xd5,0x42])); await first; idle(diag);
});

test('the real kit send protocol preserves F2 and sends the original request once', async () => {
    let calls=0;
    const diag=new Transport({ async call(proxy,method,args) {
        calls++; assert.equal(method,'sendTasuRequest');
        assert.equal(args.sourceAddress,0xf2);assert.equal(args.targetAddress,0x40);
        assert.equal(args.serviceID,0x2e);assert.equal(args.udsDataLength,6);
        assert.deepEqual(Array.from(args.udsData),[0xd5,0x42,0,6,0,45]);
        setImmediate(()=>diag._onResponse(frame(0x40,[0x6e,0xd5,0x42])));
        return 'NO_ERROR';
    } },quiet);
    diag.p={};diag.available=true;
    assert.deepEqual(await request(diag),[0x6e,0xd5,0x42]);assert.equal(calls,1);idle(diag);
});

test('address tests submit the chosen source, enforce a fresh parked guard for activation and preserve normal F2',async()=>{
    const calls=[];
    const diag=new Transport({async call(proxy,method,args){
        calls.push(args);
        const reply=args.serviceID===0x22 ? [0x62,0xd5,0x42,1] : [0x6e,0xd5,0x42];
        setImmediate(()=>diag._onResponse(frame(0x40,reply)));return 'NO_ERROR';
    }},quiet);
    diag.p={};diag.available=true;
    for(const source of [0xf1,0xf2,0xf4,0xf5]){
        const result=await diag.physical(0x40,0x22,[0xd5,0x42],100,kit.replyTo(0x22,[0xd5,0x42]),
            {testSource:source,hardTimeoutMs:300});
        assert.equal(calls[calls.length-1].sourceAddress,source);assert.deepEqual(result,[0x62,0xd5,0x42,1]);
    }
    const count=calls.length;
    for(const guard of [undefined,()=> 'moving',()=> 'Park unconfirmed']){
        await assert.rejects(diag.physical(0x40,0x2e,[0xd5,0x42,0,6,0,50],100,accept,
            {testSource:0xf4,testAllowed:guard,hardTimeoutMs:300}),/fresh zero speed/);
    }
    await assert.rejects(diag.physical(0x40,0x2e,[0xd5,0x42,0,7,0,50],100,accept,
        {testSource:0xf4,testAllowed:()=>null,hardTimeoutMs:300}),/outside/);
    assert.equal(calls.length,count);
    await diag.physical(0x40,0x2e,[0xd5,0x42,0,6,0,50],100,accept,
        {testSource:0xf4,testAllowed:()=>null,hardTimeoutMs:300});
    assert.equal(calls[calls.length-1].sourceAddress,0xf4);
    await request(diag);assert.equal(calls[calls.length-1].sourceAddress,0xf2);idle(diag);
});

test('session and keepalive use the separate TASU subroutine field on every supported source', async () => {
    const calls = [];
    const diag = new Transport({ async call(proxy, method, args) {
        calls.push(args);
        assert.equal(method, 'sendTasuRequest');
        assert.equal(args.udsDataLength, 0);
        assert.deepEqual(Array.from(args.udsData), []);
        const reply = [args.serviceID + 0x40, args.subroutineID];
        setImmediate(() => diag._onResponse(frame(0x40, reply)));
        return 'NO_ERROR';
    } }, quiet);
    diag.p = {}; diag.available = true;
    for (const source of [undefined, 0xf2, 0xf1, 0xf4, 0xf5]) {
        for (const [sid, sub] of [[0x10, 3], [0x3e, 0], [0x10, 1]]) {
            const options = { maxRetries: 0, hardTimeoutMs: 300 };
            if (source !== undefined) options.testSource = source;
            const reply = await diag.physical(0x40, sid, [sub], 100, kit.replyTo(sid, [sub]), options);
            assert.deepEqual(reply, [sid + 0x40, sub]);
            const args = calls[calls.length - 1];
            assert.equal(args.sourceAddress, source === undefined ? 0xf2 : source);
            assert.equal(args.subroutineID, sub);
            assert.equal(diag.lastExchange.request, sid.toString(16) + ' ' + sub.toString(16).padStart(2, '0'));
            assert.equal(diag.lastExchange.tasuRequest.subroutineID, sub);
            assert.equal(diag.lastExchange.tasuRequest.udsDataLength, 0);
            idle(diag);
        }
    }
    assert.equal(calls.length, 15, 'one send per request, without encoding retries');
    for (const [sid, data] of [[0x10, []], [0x10, [3, 0]], [0x10, [2]], [0x3e, [1]]]) {
        await assert.rejects(diag.physical(0x40, sid, data, 100, () => true,
            { maxRetries: 0, hardTimeoutMs: 300 }), /outside/);
        idle(diag);
    }
    assert.equal(calls.length, 15);
});

test('a real Transport session refusal preserves both raw replies and never sends a lamp write', async () => {
    const { AddressTests, lines } = require('../apps/external_lights/address-tests');
    const calls = [];
    const diag = new Transport({ async call(proxy, method, args) {
        calls.push(args);
        const reply = args.serviceID === 0x22 ? [0x62].concat(Array.from(args.udsData), [1]) : [0x7f, 0x10, 0x13];
        setImmediate(() => diag._onResponse(frame(0x40, reply)));
        return 'NO_ERROR';
    } }, quiet);
    diag.p = {}; diag.available = true;
    const checks = new AddressTests(diag, quiet, () => null, () => null);
    assert.equal(await checks.run('write', 0xf4), false);
    assert.deepEqual(calls.map(c => c.serviceID), [0x22, 0x22, 0x10, 0x10]);
    assert.deepEqual(calls.slice(2).map(c => c.subroutineID), [3, 1]);
    assert.ok(calls.every(c => c.sourceAddress === 0xf4));
    assert.match(checks.status, /Extended session setup:.*NRC 13.*lamp write not sent.*cleanup failed/);
    assert.equal(checks.history[2].rx, '7F 10 13');
    assert.equal(checks.history[3].rx, '7F 10 13');
    assert.ok(checks.history.every(row => row.raw.length === 1));
    assert.ok(lines(checks).some(line => line === 'TASU API: SID 10 sub 03 dataLen 0 data (empty)'));
});
