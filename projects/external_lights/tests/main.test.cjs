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

test('address navigation uses one persistent canvas and routes its footer controls without opening an RHMI state',async()=>{
    let implementation,checks,starts=0,flashes=0,drawn;
    const handlers={},calls=[],loops=[],images=[],labels={},values={testSource:'F4'};
    const modules={
        './kit/mgu':{run(value){implementation=value;}},
        './transport':{Transport:class{async init(){this.p={};this.available=true;return this;}}},
        './address-tests':{SOURCES:[0xf2,0xf1,0xf4,0xf5],AddressTests:class{
            constructor(){checks=this;this.busy=false;this.scrolls=[];}
            run(mode,source){calls.push({mode,source});} stop(){this.busy=false;} scroll(n){this.scrolls.push(n);}
        },draw(){drawn='tests';}},
        './vehicle':{watch(){return{reason:()=>null,speed:()=>0,close(){}};}},
        './session':{Session:class{reason(){return null;}}},
        './lamps':L,'./shows':require('../apps/external_lights/shows'),
        './player':{Player:class{constructor(){this.refused=[];this.state='idle';}isLit(){return false;}play(){starts++;}flash(){flashes++;}stop(){}}},
        './view':{draw(){drawn='lights';}}
    };
    vm.runInNewContext(fs.readFileSync(require.resolve('../apps/external_lights/main'),'utf8'),{require:name=>modules[name]});
    await implementation.start({ui:{onClick(name,fn){handlers[name]=fn;},
        open(){throw new Error('Navigation must not open another RHMI canvas');},
        text(name,text){labels[name]=text;},image(name){images.push(name);}},
        settings:{get(key){return values[key];},set(key,value){values[key]=value;}},
        log:{warn(message){throw new Error(message);}},loop(name,fps,fn){loops.push({name,fn});},canvas(){return{};},theme(){return{};}});
    assert.equal(loops.length,1);assert.equal(loops[0].name,'MAIN');
    const frame=()=>loops[0].fn();frame();assert.equal(drawn,'lights');
    for(let visit=0;visit<5;visit++){
        handlers.BTN_TESTS();
        for(let tick=0;tick<30;tick++){frame();assert.equal(drawn,'tests');}
        assert.equal(labels.BTN_START,'Read test');assert.equal(labels.BTN_FLASH,'Write test');
        assert.equal(labels.BTN_TESTS,'Back');
        handlers.BTN_TESTS();frame();assert.equal(drawn,'lights');
        assert.equal(labels.BTN_START,'Start');assert.equal(labels.BTN_FLASH,'Flash lamp');
    }
    handlers.BTN_TESTS();handlers.BTN_START();handlers.BTN_FLASH();handlers.BTN_SHOW();handlers.BTN_START();
    assert.deepEqual(calls,[{mode:'read',source:0xf4},{mode:'write',source:0xf4},{mode:'read',source:0xf5}]);
    handlers.BTN_LAMP();handlers.BTN_STOP();assert.deepEqual(checks.scrolls,[13,-13]);
    checks.busy=true;frame();assert.equal(labels.BTN_STOP,'Stop test');
    handlers.BTN_STOP();frame();assert.equal(labels.BTN_STOP,'Later');
    checks.busy=true;handlers.BTN_TESTS();handlers.BTN_START();handlers.BTN_FLASH();
    assert.equal(starts,0);assert.equal(flashes,0);
    checks.busy=false;handlers.BTN_START();assert.equal(starts,1);
    assert.ok(images.length>150 && images.every(name=>name==='MAIN_GFX'));
});

test('the pinned renderer owns only the first canvas, so the packaged app declares one',()=>{
    const path=require('node:path');
    const {Display}=require('../.cache/idrive-kit/kit/runtime/display');
    const display=Object.create(Display.prototype);
    display.screen={name:'MAIN'};display.gpu={ready:true};display.place={};display.blocked=false;display._shown=()=>true;
    assert.equal(display.active('MAIN'),true);assert.equal(display.active('DIAGNOSTICS'),false);
    const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'../apps/external_lights/app.json'),'utf8'));
    assert.deepEqual(manifest.screens.filter(s=>s.kind==='canvas').map(s=>s.name),['MAIN']);
});
