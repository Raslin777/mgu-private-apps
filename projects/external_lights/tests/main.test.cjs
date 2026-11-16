'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const L = require('../apps/external_lights/lamps');

test('the screen and lamp buttons remain usable when all selectable lamps were refused', async () => {
    let implementation, displayed, flashes = 0;
    const handlers = {};
    class Player {
        constructor() { this.refused = L.LAMPS.map(l => l.key); this.state = 'idle'; }
        isLit() { return false; }
        flash() { flashes++; }
    }
    const modules = {
        './kit/mgu': { run(value) { implementation = value; } },
        './transport': { Transport: class { async init() { return this; } } },
        './address-tests': { SOURCES:[0xf2,0xf1,0xf4,0xf5],AddressTests:class {},draw() {} },
        './vehicle': { watch() { return { reason: () => 'The car is moving', speed: () => 20, close() {} }; } },
        './session': { Session: class { reason() { return null; } } },
        './lamps': L, './shows': require('../apps/external_lights/shows'), './player': { Player },
        './view': { draw(cv, theme, state) { displayed = state; } }
    };
    vm.runInNewContext(fs.readFileSync(require.resolve('../apps/external_lights/main'), 'utf8'), { require: name => modules[name] });
    await implementation.start({
        ui: { onClick(name, fn) { handlers[name] = fn; }, image() {} },
        settings: { get() { return false; } }, log: { warn(message) { throw new Error(message); } },
        loop(name, fps, fn) { fn(); }, canvas() { return {}; }, theme() { return {}; }
    });
    handlers.BTN_LAMP(); handlers.BTN_FLASH();
    assert.equal(flashes, 0);
    assert.equal(displayed.lamp, 'No available lamps');
});

test('Read/Write buttons use the selected tester while an active address test blocks show activation',async()=>{
    let implementation,checks,starts=0,flashes=0;
    const handlers={},calls=[],opened=[],values={testSource:'F4'};
    const modules={
        './kit/mgu':{run(value){implementation=value;}},
        './transport':{Transport:class{async init(){this.p={};this.available=true;return this;}}},
        './address-tests':{SOURCES:[0xf2,0xf1,0xf4,0xf5],AddressTests:class{
            constructor(){checks=this;this.busy=false;}
            run(mode,source){calls.push({mode,source});} stop(){} scroll(){}
        },draw(){}},
        './vehicle':{watch(){return{reason:()=>null,speed:()=>0,close(){}};}},
        './session':{Session:class{reason(){return null;}}},
        './lamps':L,'./shows':require('../apps/external_lights/shows'),
        './player':{Player:class{constructor(){this.refused=[];this.state='idle';}play(){starts++;}flash(){flashes++;}stop(){}}},
        './view':{draw(){}}
    };
    vm.runInNewContext(fs.readFileSync(require.resolve('../apps/external_lights/main'),'utf8'),{require:name=>modules[name]});
    await implementation.start({ui:{onClick(name,fn){handlers[name]=fn;},open(name){opened.push(name);}},
        settings:{get(key){return values[key];},set(key,value){values[key]=value;}},
        log:{warn(message){throw new Error(message);}},loop(){}});
    handlers.BTN_TESTS();handlers.BTN_TEST_READ();handlers.BTN_TEST_WRITE();handlers.BTN_TEST_SOURCE();handlers.BTN_TEST_READ();
    assert.deepEqual(calls,[{mode:'read',source:0xf4},{mode:'write',source:0xf4},{mode:'read',source:0xf5}]);
    checks.busy=true;handlers.BTN_START();handlers.BTN_FLASH();
    assert.equal(starts,0);assert.equal(flashes,0);
    checks.busy=false;handlers.BTN_START();assert.equal(starts,1);
    handlers.BTN_TEST_BACK();assert.deepEqual(opened,['DIAGNOSTICS','MAIN']);
});
