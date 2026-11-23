'use strict';
// Draws the app's pages with SIMULATED values, using the app kit's own canvas.
// The numbers are invented to show the layout; they are not from a car.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const { Canvas } = require(path.join(root, '.cache', 'idrive-kit', 'kit', 'runtime', 'canvas'));
const services = require('../apps/road_sight/services');
const { Collector } = require('../apps/road_sight/collector');
const { draw, pages } = require('../apps/road_sight/view');
const SAMPLES = {
    'LaneBoundariesLegacy2|laneMarkingList': { cRCLaneMarkingList: 142, aliveLaneMarkingList: 7, cHLLaneMarkingList: 3, nanoseconds: 31250,
        eventDataQualifier: 1, secondsLaneMarking: 4821, extendedQualifierLaneMarking: 0, laneRoutingLaneMarking: 1,
        synchronizationStatusLaneMarking: 1, integrityLaneBoundaries: 2, dummy1: 0 },
    'LaneBoundariesLegacy2|laneMarkingEgoLeftHandGeometry': { cRCLaneMarkingEgoLeftHandGeometry: 88, aliveLaneMarkingEgoLeftHandGeometry: 7,
        cHLLaneMarkingEgoLeftHandGometry: 3, rangeLaneMarkingEgoLeftHand: 46, coefficient0LaneMarkingEgoLeftHand: 588,
        coefficient1LaneMarkingEgoLeftHand: 511, coefficient2LaneMarkingEgoLeftHand: 514, coefficient3LaneMarkingEgoLeftHand: 2047 },
    'LaneBoundariesLegacy2|laneMarkingEgoLeftHandProperty': { cRCLaneMarkingEgoLeftHandProperty: 201, aliveLaneMarkingEgoLeftHandProperty: 7,
        cHLLaneMarkingEgoLeftHandProperty: 3, iDLaneMarkingEgoLeftHand: 4, subsistenceProbabilityLaneMarkingEgoLeftHand: 14,
        statusMeasurmentLaneMarkingEgoLeftHand: 1, dummy1: 0, typeLaneMarkingEgoLeftHand: 2, colorLaneMarkingEgoLeftHand: 1,
        branchLaneMarkingEgoLeftHand: 0, dummy2: 0, distanceBranchLaneMarkingEgoLeftHand: 63, qualityLaneWidtLaneMarkingNextLeftHand: 3,
        laneWidthLaneMarkingNextLeftHand: 175 },
    'LaneBoundariesLegacy2|laneMarkingEgoRightHandGeometry': { cRCLaneMarkingEgoRightHandGeometry: 19, aliveLaneMarkingEgoRightHandGeometry: 7,
        cHLLaneMarkingEgoRightHandGometry: 3, rangeLaneMarkingEgoRightHand: 44, coefficient0LaneMarkingEgoRightHand: 436,
        coefficient1LaneMarkingEgoRightHand: 510, coefficient2LaneMarkingEgoRightHand: 514, coefficient3LaneMarkingEgoRightHand: 2047 },
    'LaneBoundariesLegacy2|laneMarkingExtensionLeftRight': { widthLaneBoundaryEgoRight: 15, widthLaneBoundaryEgoLeft: 12,
        ratioLaneBoundaryEgoRight: 255, ratioLaneBoundaryEgoLeft: 40 },
    'SignRecognitionFrontCameraLegacy|RecognitionTrafficSignCamera': { trafficSignID: 3, trafficSignType: 1, trafficSignAddOnType1: 63,
        trafficSignAddOnType2: 63, qualityRecognitionTrafficSign: 3, trafficSignValue: 13, speedLimitUnitOfMeasurement: 1,
        trafficSignPositionX: 84, trafficSignPositionY: 131, trafficSignPositionZ: 9, trafficSignStatus: 1 },
    'TrafficLightRecognitionFrontCameraLegacy|RecognitionTrafficLightCamera': { trafficLightID: 2, trafficLightPositionX: 120,
        trafficLightPositionY: 128, trafficLightPositionZ: 22, trafficLightStatus: 1, trafficLightArrow: 0, trafficLightIndicateDirection: 0,
        trafficLightColor: 3, qualityRecognitionTrafficLight: 2 },
    'GapVehicleAhead|GapVehicleDrivingAhead': { gapVehicleDrivingAhead: 412, statusGapVehicleDrivingAhead: 1 },
    'ParkDistanceInformation|FrontDistanceNotificationPDC2': { distanceFrontLeft: 255, distanceFrontMiddleLeft: 255, distanceFrontMiddleRight: 255, distanceFrontRight: 255 },
    'LateralCollisionAvoidance|lateralCollisionAvoidanceQualifiers': { qualifierLaneChangeWarning: 9,
        statusLaneChangeWarning: { statusLaneChangeWarningLeft: 'NO_WARNING', statusLaneChangeWarningRight: 'WARNING' } }
};
const RATES = { LaneBoundariesLegacy2: 200, SignRecognitionFrontCameraLegacy: 1000, TrafficLightRecognitionFrontCameraLegacy: 500,
    GapVehicleAhead: 100, ParkDistanceInformation: 250, LateralCollisionAvoidance: 2000 };
async function main() {
    let now = 0;
    const handlers = {}, quiet = { info() {}, warn() {} };
    const offered = ['LaneBoundariesLegacy', 'SemanticLaneDescription', 'TrafficSignRecognition'];
    const signals = { async proxy(iface) { return { iface: iface }; },
        async onAvailable(p, fn) { const n = p.iface.split('.').pop(); fn(!!RATES[n] || offered.indexOf(n) >= 0); },
        async on(p, name, fn) { handlers[p.iface.split('.').pop() + '|' + name] = fn; } };
    const collector = new Collector(signals, services, quiet, { now: () => now, logFirst: () => false });
    await collector.start();
    // twelve simulated minutes of driving
    for (now = 0; now <= 720000; now += 50) Object.keys(SAMPLES).forEach(key => {
        const period = RATES[key.split('|')[0]];
        if (now % period === 0 && handlers[key]) handlers[key](SAMPLES[key]);
    });
    now = 720080;
    const snap = collector.snapshot();
    const dir = path.join(root, 'preview'); fs.mkdirSync(dir, { recursive: true });
    const list = pages(snap, false);
    const shot = (name, page, scroll) => {
        const cv = new Canvas(1600, 520);
        draw(cv, { snapshot: snap, liveOnly: false, page: page, scroll: scroll || 0 });
        fs.writeFileSync(path.join(dir, name + '.png'), cv.png());
    };
    shot('overview-1', 0); shot('overview-2', 1);
    const find = name => list.findIndex(p => p.kind === 'service' && p.iface.split('.').pop() === name);
    shot('lanes', find('LaneBoundariesLegacy2')); shot('lanes-part2', find('LaneBoundariesLegacy2'), 1);
    shot('signs', find('SignRecognitionFrontCameraLegacy'));
    console.log('Simulated previews (invented values): ' + dir);
}
main().catch(e => { console.error(e); process.exitCode = 1; });
