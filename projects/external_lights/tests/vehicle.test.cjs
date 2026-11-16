'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Vehicle=require('../apps/external_lights/vehicle');
const {AddressTests}=require('../apps/external_lights/address-tests');
const {quiet}=require('./sim.cjs');
// The Park logic is kept and tested with the check switched on; the app ships with it off (see the last tests).
function fixture(parkCheck){
    const handlers={},watches=[],logs=[];let time=0;
    const opts=parkCheck===false?undefined:{parkCheck:true,speedCheck:true};
    const vehicle=Vehicle.watch({signals:{async watch(iface,instance,fields,log,opts){
        watches.push({iface,instance,fields,opts});Object.assign(handlers,fields);return{};
    }}},{info:line=>logs.push(line),warn:line=>logs.push(line)},()=>time,opts);
    return{vehicle,handlers,watches,logs,time(t){time=t;},now:()=>time};
}
test('DataPowerTrain2 supplies Park when the older gearbox event never arrives',()=>{
    for(const raw of ['P',3]){
        const f=fixture();f.handlers.statusCarSpeed2({speedVehicleCentreOfGravity:0});
        assert.match(f.vehicle.reason(),/Park signal unavailable/);
        f.handlers.DataPowerTrain2({statusGearSelectionDrive:raw});
        assert.equal(f.vehicle.reason(),null);
        assert.match(f.vehicle.summary(),/gearbox=not received/);
        assert.match(f.vehicle.summary(),new RegExp('powertrain='+raw+' \\(0 ms\\)'));
        const watch=f.watches.find(w=>w.iface==='de.bmw.infrastructure.VehicleInformation');
        assert.deepEqual(Object.keys(watch.fields),['statusGearboxDrive','DataPowerTrain2']);
    }
});
test('the two selector enums are kept distinct; N, NP, unknown and engaged gears do not confirm Park',()=>{
    for(const raw of [1,2,4,0,15,'N','R','NP','N_OR_P','_1','_9','INVALID',undefined]){
        const f=fixture();f.handlers.statusCarSpeed2({speedVehicleCentreOfGravity:0});
        f.handlers.DataPowerTrain2({statusGearSelectionDrive:raw});assert.ok(f.vehicle.reason(),String(raw));
    }
    const f=fixture();f.handlers.statusCarSpeed2({speedVehicleCentreOfGravity:0});
    f.handlers.statusGearboxDrive({statusActualStageDrive:1});assert.equal(f.vehicle.reason(),null);
    f.handlers.statusGearboxDrive({statusActualStageDrive:3});assert.match(f.vehicle.reason(),/selector reports N/);
});
test('stale selector data and conflicting fresh selections remain blocked',()=>{
    const f=fixture();f.handlers.statusCarSpeed2({speedVehicleCentreOfGravity:0});
    f.handlers.DataPowerTrain2({statusGearSelectionDrive:3});assert.equal(f.vehicle.reason(),null);
    f.time(1600);f.handlers.statusCarSpeed2({speedVehicleCentreOfGravity:0});assert.match(f.vehicle.reason(),/Park data is stale/);
    f.handlers.DataPowerTrain2({statusGearSelectionDrive:3});assert.equal(f.vehicle.reason(),null);
    f.handlers.statusGearboxDrive({statusActualStageDrive:'D'});assert.match(f.vehicle.reason(),/conflicting/);
    f.handlers.statusGearboxDrive({statusActualStageDrive:'P'});assert.equal(f.vehicle.reason(),null);
});
test('missing, invalid and nonzero speed block even with a fresh explicit Park signal',()=>{
    const f=fixture();f.handlers.DataPowerTrain2({statusGearSelectionDrive:3});assert.match(f.vehicle.reason(),/speed/);
    for(const raw of [65535,undefined,-1,64]){
        f.handlers.statusCarSpeed2({speedVehicleCentreOfGravity:raw});assert.ok(f.vehicle.reason());
    }
    f.handlers.statusCarSpeed2({speedVehicleCentreOfGravity:0});assert.equal(f.vehicle.reason(),null);
    f.time(400);assert.match(f.vehicle.summary(),/powertrain=3 \(400 ms\)/);
    assert.match(f.vehicle.summary(),/raw=0/);
});
test('Park fallback permits the guarded test, while fresh Neutral sends no diagnostic requests',async()=>{
    const f=fixture();const calls=[];
    const diag={p:{},available:true,async physical(ecu,sid,data){calls.push([sid].concat(data));
        return sid===0x22?[0x62].concat(data,[1]):sid===0x10?[0x50,data[0]]:[0x6e,0xd5,0x42];}};
    const checks=new AddressTests(diag,quiet,()=>null,()=>f.vehicle.reason(),{now:f.now,wait:async ms=>f.time(f.now()+ms)});
    f.handlers.statusCarSpeed2({speedVehicleCentreOfGravity:0});f.handlers.DataPowerTrain2({statusGearSelectionDrive:3});
    assert.equal(await checks.run('write',0xf4),true);assert.equal(calls.length,6);
    f.handlers.statusCarSpeed2({speedVehicleCentreOfGravity:0});f.handlers.DataPowerTrain2({statusGearSelectionDrive:1});
    assert.equal(await checks.run('write',0xf4),false);assert.equal(calls.length,6);
});
test('as shipped the Park and speed checks are off: nothing blocks, the page warning still reports speed',()=>{
    assert.equal(Vehicle.PARK_CHECK,false);assert.equal(Vehicle.SPEED_CHECK,false);
    const f=fixture(false);
    assert.equal(f.vehicle.reason(),null,'no signal at all');
    assert.match(f.vehicle.warning(),/speed unavailable/);
    f.handlers.statusCarSpeed2({speedVehicleCentreOfGravity:0});
    assert.equal(f.vehicle.reason(),null);assert.equal(f.vehicle.warning(),null);
    for(const raw of [1,2,4,7,'N','INVALID',undefined]){
        f.handlers.DataPowerTrain2({statusGearSelectionDrive:raw});
        assert.equal(f.vehicle.reason(),null,String(raw));assert.equal(f.vehicle.warning(),null,String(raw));
    }
    f.handlers.statusGearboxDrive({statusActualStageDrive:'D'});assert.equal(f.vehicle.reason(),null);
    assert.match(f.vehicle.summary(),/gearbox=D \(0 ms\); powertrain=/,'the raw inputs are still shown');
    for(const raw of [64,640,65535,undefined,-1]){
        f.handlers.statusCarSpeed2({speedVehicleCentreOfGravity:raw});
        assert.equal(f.vehicle.reason(),null,String(raw));assert.ok(f.vehicle.warning(),String(raw));
    }
    assert.match(f.vehicle.summary(),/raw=-1/);
    f.time(1600);assert.equal(f.vehicle.reason(),null);assert.match(f.vehicle.warning(),/stale/);
});
test('with only the speed check on, speed decides and the selector does not',()=>{
    const handlers={};
    const v=Vehicle.watch({signals:{async watch(i,n,fields){Object.assign(handlers,fields);return{};}}},quiet,()=>0,{speedCheck:true});
    assert.match(v.reason(),/speed/);
    handlers.statusCarSpeed2({speedVehicleCentreOfGravity:0});handlers.DataPowerTrain2({statusGearSelectionDrive:1});
    assert.equal(v.reason(),null);
    handlers.statusCarSpeed2({speedVehicleCentreOfGravity:64});assert.match(v.reason(),/moving/);
});
test('as shipped the write test runs with no speed signal, in Neutral, and at speed; Stop still ends it',async()=>{
    const f=fixture(false);const calls=[];let checks=null,stopAt=null;
    const diag={p:{},available:true,async physical(ecu,sid,data){calls.push([sid].concat(data));
        if(stopAt!==null&&calls.length===stopAt) checks.stop();
        return sid===0x22?[0x62].concat(data,[1]):sid===0x10?[0x50,data[0]]:[0x6e,0xd5,0x42];}};
    checks=new AddressTests(diag,quiet,()=>null,()=>f.vehicle.reason(),{now:f.now,wait:async ms=>f.time(f.now()+ms)});
    assert.equal(await checks.run('write',0xf4),true,'no speed or selector signal');
    const each=calls.length;assert.ok(each>0);
    assert.deepEqual(calls.filter(c=>c[0]===0x2e),[[0x2e,0xd5,0x42,0,6,0,50],[0x2e,0xd5,0x42,0,6,0,0]]);
    f.handlers.statusCarSpeed2({speedVehicleCentreOfGravity:640});f.handlers.DataPowerTrain2({statusGearSelectionDrive:1});
    assert.equal(await checks.run('write',0xf4),true,'moving, Neutral');assert.equal(calls.length,2*each);
    stopAt=calls.length+1+calls.findIndex(c=>c[0]===0x2e&&c[6]===50); // Stop as the lamp is switched on
    assert.equal(await checks.run('write',0xf4),false,'stopped by the user');
    assert.match(checks.status,/stopped/);
    assert.deepEqual(calls[calls.length-1],[0x10,1],'the default session is restored after Stop');
    assert.deepEqual(calls[calls.length-2],[0x2e,0xd5,0x42,0,6,0,0],'and the lamp is switched off first');
});
