'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Vehicle=require('../apps/external_lights/vehicle');
const {AddressTests}=require('../apps/external_lights/address-tests');
const {quiet}=require('./sim.cjs');
function fixture(){
    const handlers={},watches=[],logs=[];let time=0;
    const vehicle=Vehicle.watch({signals:{async watch(iface,instance,fields,log,opts){
        watches.push({iface,instance,fields,opts});Object.assign(handlers,fields);return{};
    }}},{info:line=>logs.push(line),warn:line=>logs.push(line)},()=>time);
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
