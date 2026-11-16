'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('node:events');
const { AddressTests, SOURCES, draw } = require('../apps/external_lights/address-tests');
const { quiet } = require('./sim.cjs');
function fixture() {
    const diag=Object.assign(new EventEmitter(),{p:{},available:true});
    const state={block:null,stationary:null,time:0,calls:[],nrc:null};
    const checks=new AddressTests(diag,quiet,()=>state.block,()=>state.stationary,
        {now:()=>state.time,wait:async ms=>{state.time+=ms;}});
    diag.physical=async (ecu,sid,data,timeout,accept,opts)=>{
        state.calls.push({ecu,sid,data:data.slice(),source:opts.testSource});
        if(state.onCall) await state.onCall(sid,data,checks);
        const reply=state.nrc && sid===0x2e && data[5]!==0 ? [0x7f,sid,state.nrc] :
            sid===0x22 ? [0x62].concat(data,[1]) : sid===0x10 ? [0x50,data[0]] : [0x6e,0xd5,0x42];
        diag.lastExchange={source:opts.testSource,request:[sid].concat(data).map(b=>b.toString(16).padStart(2,'0')).join(' '),rawTasu:['00 00 00 00 00 00 40 00 00 '+reply.map(b=>b.toString(16).padStart(2,'0')).join(' ')]};
        return reply;
    };
    return {diag,state,checks};
}

test('Read tests every allowed source using only D542 read; retains positive RX and raw bytes',async()=>{
    for(const source of SOURCES){
        const f=fixture();assert.equal(await f.checks.run('read',source),true);
        assert.deepEqual(f.state.calls,[{ecu:0x40,sid:0x22,data:[0xd5,0x42],source}]);
        assert.equal(f.checks.history[0].rx,'62 D5 42 01');
        assert.equal(f.checks.history[0].raw.length,1);
        assert.match(f.checks.status,/write permission is not confirmed/);
    }
});
test('Write runs preflight/session, one 500 ms indicator activation, off and default cleanup on the selected source',async()=>{
    const f=fixture();assert.equal(await f.checks.run('write',0xf4),true);
    assert.deepEqual(f.state.calls.map(c=>[c.sid].concat(c.data)),[
        [0x22,0xf1,0x50],[0x22,0xd5,0x42],[0x10,3],
        [0x2e,0xd5,0x42,0,6,0,50],[0x2e,0xd5,0x42,0,6,0,0],[0x10,1]]);
    assert.ok(f.state.calls.every(c=>c.source===0xf4));
    assert.ok(f.checks.history.every(c=>c.rx!=='Waiting' && c.raw.length===1));
    assert.match(f.checks.status,/check the left indicator physically/);
    assert.equal(f.checks.busy,false);assert.equal(f.checks.session.attempted,false);
});
test('moving, missing/stale telemetry, unconfirmed Park and active shows block writes before any request',async()=>{
    for(const reason of ['moving','Park unconfirmed','speed stale','speed unavailable']){
        const f=fixture();f.state.stationary=reason;
        assert.equal(await f.checks.run('write',0xf5),false);assert.equal(f.state.calls.length,0);
        assert.match(f.checks.status,/blocked/);
    }
    const f=fixture();f.state.block='Show is playing';
    assert.equal(await f.checks.run('read',0xf1),false);
    assert.equal(await f.checks.run('write',0xf1),false);assert.equal(f.state.calls.length,0);
});
test('movement during preflight prevents activation and still closes an attempted session',async()=>{
    const f=fixture();f.state.onCall=async(sid)=>{if(sid===0x10) f.state.stationary='moving';};
    assert.equal(await f.checks.run('write',0xf4),false);
    assert.ok(!f.state.calls.some(c=>c.sid===0x2e));
    assert.deepEqual(f.state.calls.slice(-1).map(c=>[c.sid].concat(c.data)),[[0x10,1]]);
});
test('movement or Stop after activation triggers lamp-off and default-session cleanup',async()=>{
    for(const stop of [false,true]){
        const f=fixture();f.state.onCall=async(sid,data,checks)=>{
            if(sid===0x2e && data[5]===50){if(stop) checks.stop();else f.state.stationary='moving';}
        };
        assert.equal(await f.checks.run('write',0xf4),false);
        assert.deepEqual(f.state.calls.slice(-2).map(c=>[c.sid].concat(c.data)),[[0x2e,0xd5,0x42,0,6,0,0],[0x10,1]]);
    }
});
test('NRC22 is retained, not retried under another address; cleanup returns remain visible',async()=>{
    const f=fixture();f.state.nrc=0x22;
    assert.equal(await f.checks.run('write',0xf5),false);
    assert.match(f.checks.status,/NRC 22/);
    assert.equal(f.state.calls.filter(c=>c.sid===0x2e && c.data[5]===50).length,1);
    assert.ok(f.state.calls.every(c=>c.source===0xf5));
    assert.equal(f.checks.history[3].rx,'7F 2E 22');assert.equal(f.checks.history[5].rx,'50 01');
});
test('invalid inputs are blocked and read tests do not require a parked vehicle',async()=>{
    const f=fixture();f.state.stationary='moving';
    assert.equal(await f.checks.run('write',0xf3),false);assert.equal(await f.checks.run('flash',0xf4),false);
    assert.equal(f.state.calls.length,0);assert.equal(await f.checks.run('read',0xf4),true);
});
test('all raw replies can be reviewed; long messages remain inside the canvas',async()=>{
    const f=fixture();await f.checks.run('write',0xf4);
    f.checks.status='long '.repeat(100);
    for(const offset of [0,13,999]){
        f.checks.offset=offset;const texts=[];
        draw({clear(){},text(s,x,y){texts.push({s,x,y});}},{bg:'#000',text:'#fff',dim:'#888',warn:'#fa0'},f.checks,0xf4);
        assert.ok(texts.every(t=>t.y<520));
        assert.ok(texts.some(t=>/RX:/.test(t.s)) || offset===999);
    }
});
