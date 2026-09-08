const ply = new Player(0)
const char = ply.getChar()

import "../mercurial[mem]/libs/vectorLibrary.mts"
import { Vector3 } from "../mercurial[mem]/libs/vectorLibrary.mts"
import { getCarForwardWithPitchVector, getCarPos, getCarRightVector, getCarSpeed } from "../mercurial[mem]/libs/carUtils.mts"
import { lerp } from "../mercurial[mem]/libs/mathUtils.mts"
import Noise from "../mercurial[mem]/libs/noise.mts"
import { easeInQuint, easeInSine, easeInOutSine, easeOutSine } from "../mercurial[mem]/libs/easingStyles.mts"
import { setCamFOV } from "../mercurial[mem]/libs/camUtils.mts"
import { CameraMode, KeyCode, VehicleSubclass, WeaponType } from "../.config/sa.enums.mts"
import { buttonDict, modSettingType, OnHgMenuButtonClickEvent, registerHgMod, SettingList } from "../mercurial[mem]/merc_interface.mts"
import { trace } from "../mercurial[mem]/libs/tracingUtils.mts"


const CTimer_ms_fTimeStep = Memory.Translate('CTimer::ms_fTimeStep');

function getFrameTime(): number {
    const timeMultiplier = Memory.ReadFloat(CTimer_ms_fTimeStep, false)
    const dtInSeconds = timeMultiplier * (1.0 / 60.0)
    return dtInSeconds 
}

let shakeTime = 0

let camActive = false
let camRollLerp = 0
let carForw = Vector3.zero()
let carRight = Vector3.zero()
let carSpeedShakeMaxThreshold = 45
let driftRightNormalized = 0
let driftRightLerp = 0
let driftRightMaxThreshold = 8
let prevForwSpeed = 0
let prevRightSpeed = 0
let CTIMERA = 0

let controlDecay = 1

const settings = new SettingList({
    Cam_Enabled: {type: modSettingType.boolean, value: true, default: true},
    Height_Offset: {type: modSettingType.number, value: 1, min: -20, max: 20, default: 1},
    Back_Offset: {type: modSettingType.number, value: 2, min: -30, max: 30, default: 2},
    Right_Offset: {type: modSettingType.number, value: -0.2, min: -20, max: 20, default: -0.2},
    Cam_Rotate_Restore_Time: {type: modSettingType.number, value: 2, min: 0.5, max: 5, default: 2},
    Cam_Rotate_Sensitivity: {type: modSettingType.number, value: 0.4, min: 0.1, max: 5, default: 0.4},
    FOV_Min: {type: modSettingType.number, value: 65, min: 10, max: 180, default: 65},
    FOV_Max: {type: modSettingType.number, value: 90, min: 10, max: 180, default: 90},

    Crash_Shake_Enabled: {type: modSettingType.boolean, value: true, default: true},

    Drift_Max_Tilt: {type: modSettingType.number, value: 0.15, default: 0.15, min: 0, max: 1},
    Drift_Side_Move: {type: modSettingType.number, value: 2, default: 2, min: 0, max: 5},
    Drift_Cam_Lower: {type: modSettingType.number, value: 1.2, min: -10, max: 10, default: 1.2},
    Test_Drift_Cam: {type: modSettingType.boolean, value: false, default: false},
    Test_Drift_LeftRight: {type: modSettingType.number, value: 0, min: -1, max: 1, default: 0},
})

settings.loadFromIni()

const buttons: buttonDict = {
    saveToIni: {niceName: "Save to INI", description: "bla bla"}
}

registerHgMod("Hg_Dynamic_Car_Camera", settings, buttons)

addEventListener<OnHgMenuButtonClickEvent>("OnHgMenuButtonClick", (ev) => {
    if (!ev.data) {return}
    if (ev.data.modName != "Hg_Dynamic_Car_Camera") {return}
    switch (ev.data.btnId) {
        case "saveToIni":
            saveSettingsToIni()
            break
    }
})

async function saveSettingsToIni() {
    if (!settings) {return}
    settings.saveToIni()
}

interface numberDict {
    [key: string]: number
}

const rollAdders: numberDict = {}
const pitchAdders: numberDict = {}

const noisy = new Noise(Math.RandomIntInRange(1, 9999))

let crashCD = false
async function crash(forwAccel: number, rightAccel: number) {
    if(crashCD == true) {return}
    const curTime = CTIMERA

    const signF = Math.sign(forwAccel)
    const signR = Math.sign(rightAccel)
    const forwN = Math.ClampFloat(forwAccel / -30, -1, 1)
    const rightN = Math.ClampFloat(rightAccel / -10, -1, 1)
    const dictName = `crashRoll_${curTime}`

    const strengthForw = lerp(0, 50, easeInSine(Math.abs(forwN)))
    const strengthRight = lerp(0, 0.3, easeInSine(Math.abs(rightN)))

    const duration = lerp(0.7, 2, Math.max(easeInQuint(Math.abs(forwN)), easeInQuint(Math.abs(rightN))) )
    doCrashShake(dictName, strengthForw * signF, strengthRight * -signR, duration)
    doCrashPerlinShake(duration)
    crashCD = true
    await asyncWait(100)
    crashCD = false
}

async function doCrashShake(name: string, strengthForw: number, strengthRight: number, duration: number) {
    tween(rollAdders, name, 0, strengthRight, 0.14, easeOutSine).then(() => {
        tween(rollAdders, name, strengthRight, 0, duration, easeInOutSine, true)
    })

    tween(pitchAdders, name, 0, strengthForw, 0.14, easeOutSine).then(() => {
        tween(pitchAdders, name, strengthForw, 0, duration, easeInOutSine, true)
    })
}

async function doCrashPerlinShake(duration: number) {
    let shakeTime = 0
    let prog = 0
    let strength = 0
    const curTime = CTIMERA
    const dictName = `crashPerlin_${curTime}`

    pitchAdders[dictName] = 0
    rollAdders[dictName] = 0
    while (prog < 1) {
        const dt = getFrameTime()
        shakeTime += dt * 5
        prog += Math.min(dt / 0.1, 1)
        strength = lerp(0, 0.5, prog)
        const nx = noisy.noise2D(shakeTime + 5230, shakeTime + 5356)
        const ny = noisy.noise2D(shakeTime + 15, shakeTime + 20)
        pitchAdders[dictName] = nx * strength * 60
        rollAdders[dictName] = ny * strength
        await asyncWait(1)
    }

    prog = 0
    while (prog < 1) {
        const dt = getFrameTime()
        shakeTime += dt * 5
        prog += Math.min(dt / (duration * 0.3), 1)
        strength = lerp(0.5, 0, easeOutSine(prog))
        const nx = noisy.noise2D(shakeTime + 5230, shakeTime + 5356)
        const ny = noisy.noise2D(shakeTime + 15, shakeTime + 20)
        pitchAdders[dictName] = nx * strength * 60
        rollAdders[dictName] = ny * strength
        await asyncWait(1)
    }

    delete pitchAdders[dictName]
    delete rollAdders[dictName]
}

async function tween(obj: numberDict, id: string, initValue: number, endValue: number, duration: number, easeFunction?: (t: number) => number, delOnEnd?: boolean) {
    const dt = getFrameTime()
    let prog = 0

    while (prog < 1) {
        prog += Math.min(dt / duration, 1)
        if (easeFunction) {
            obj[id] = lerp(initValue, endValue, easeFunction(prog))
        } else {
            obj[id] = lerp(initValue, endValue, prog)
        }
        await asyncWait(1)
    }

    if(delOnEnd) {
        delete obj[id]
    }
}

const restrictedSubClasses: Record<number, boolean> = {
    [VehicleSubclass.Plane]: true,
    [VehicleSubclass.Fplane]: true,
    [VehicleSubclass.Fheli]: true,
    [VehicleSubclass.Heli]: true,
    [VehicleSubclass.Boat]: true,
    [VehicleSubclass.Bike]: true,
    [VehicleSubclass.Bmx]: true
}

const restrictedModels: Record<number, boolean> = {
    [432]: true, // RHINO
    [407]: true, // FIRETRUCK
    [601]: true, // SWAT TRUCK
}

const exceptionModels: Record<number, boolean> = {
    [539]: true // VORTEX
}

function isRestricted(carry: Car) {
    return (restrictedSubClasses[carry.getSubclass()] || restrictedModels[carry.getModel()]) && !exceptionModels[carry.getModel()]
}


// COPIED FROM MANUAL DRIVEBY REMAKE
// driveby camera movement
//0A8C: write_memory 0x64BC9F size 4 value 0x90909090 virtual_protect 1
//0A8C: write_memory 0x64BCA3 size 4 value 0x90909090 virtual_protect 1
//0A8C: write_memory 0x64BCA7 size 1 value 0x90 virtual_protect 1
//0A8C: write_memory 0x522423 size 2 value 0x9090 virtual_protect 1
Memory.Write( 0x64BC9F, 4, 0x90909090, true )
Memory.Write( 0x64BCA3, 4, 0x90909090, true )
Memory.Write( 0x64BCA7, 1, 0x90, true )
Memory.Write( 0x522423, 2, 0x9090, true )


let doingDriveBy = false
async function doDriveBy() {
    if (doingDriveBy) {return}
    doingDriveBy = true
    Camera.RestoreJumpcut()
    setCamFOV(70)

    //TODO: Add weapon switching
    if (char.hasGotWeapon(WeaponType.M4)) {
        Memory.Write( 0x52161A, 1, 0xE9, true )
        Memory.Write( 0x52161B, 4, 0x000000B3, true )
        Memory.CallMethod(0x5E6280, Memory.GetPedPointer(char), 1, 0, WeaponType.M4)
        Task.DriveBy(char, -1 as any, -1 as any, 0, 0, 0, 900, 4, false, 100)

        while (Pad.IsKeyPressed(KeyCode.RightButton) && char.isInAnyCar() && ply.isPlaying()) {
            await asyncWait(1)
        }

        char.clearTasks()
        Memory.Write( 0x52161A, 1, 0x0F, true )
        Memory.Write( 0x52161B, 4, 0x071887BE, true )

        doingDriveBy = false
    }
}

let justExited = false
async function main() {
while (true) {
    if (ply.isPlaying() && char.isInAnyCar() && !isRestricted(char.getCarIsUsing()) && settings.getValue("Cam_Enabled") && !Pad.IsKeyPressed(KeyCode.RightButton)) {        
        justExited = true
        const dt = getFrameTime()
        CTIMERA += dt

        const minfo = Mouse.GetMovement()
        if (Math.abs(minfo.deltaX) >= 0.01 || Math.abs(minfo.deltaY) >= 0.01) {
            controlDecay = 0
        } else {
            if (controlDecay < 1) {
                controlDecay += dt / settings.getValue("Cam_Rotate_Restore_Time")
            }
        }

        if (!camActive) {camActive = true}

        let camPos = Vector3.zero()
        let camForw = Vector3.zero()

        const car = char.getCarIsUsing()
        const carDimensions = Streaming.GetModelDimensions(car.getModel())
        const xyDimension = Math.max(Math.abs(carDimensions.rightTopFrontX * 2), Math.abs(carDimensions.rightTopFrontY) * 2)
        const zDimension = Math.abs(carDimensions.rightTopFrontZ)
        const coords = getCarPos(car)

        const carVel = getCarSpeed(car)
        const carSpeed = carVel.length()
        const carForwOG = getCarForwardWithPitchVector(car)
        const carRightOG = getCarRightVector(car)

        const angleLagT = 1 - Math.exp(-2.0 * dt)

        if (controlDecay >= 1) {
            if (!car.isInAirProper()) {
                carForw = Vector3.lerp(carForw, carForwOG, angleLagT)
                carRight = Vector3.lerp(carRight, carRightOG, angleLagT)
            } else {
                carForw = Vector3.lerp(carForw, carVel.getNormalized(), angleLagT)
                carRight = Vector3.lerp(carRight, carVel.cross(new Vector3(0, 0, 1)).getNormalized(), angleLagT)
            }
        } else {
            const sens = settings.getValue("Cam_Rotate_Sensitivity")
            const pitchDelta = minfo.deltaY * dt * sens
            carForw = carForw.getRotated( new Vector3(0, 0, -1), minfo.deltaX * dt * sens )

            const newForw = carForw.getRotated(carRight, pitchDelta)

            if (newForw.z >= -0.49 && newForw.z <= 0.49) {
                carForw = newForw
            } else {
                carForw.z = Math.ClampFloat(newForw.z, -0.49, 0.49)
                carForw = carForw.getNormalized()
            }
            carRight = carForw.cross(new Vector3(0, 0, 1)).getNormalized()
        }

        const forwVel = carVel.dot(carForwOG)
        const rightVel = carVel.dot(carRightOG)

        const forwAccel = forwVel - prevForwSpeed
        prevForwSpeed = forwVel

        const rightAccel = rightVel - prevRightSpeed
        prevRightSpeed = rightVel

        if ( (Math.abs(forwAccel) >= 1.8 || rightAccel <= -1.8) && settings.getValue("Crash_Shake_Enabled") ) {
            crash(forwAccel, rightAccel)
        }

        const forwPerc = Math.min(1, forwVel / carSpeedShakeMaxThreshold)
        Camera.PersistFov(true)
        setCamFOV( lerp(settings.getValue("FOV_Min"), settings.getValue("FOV_Max"), easeInSine(forwPerc)) )
        

        const smoothSpeed = 3.0
        const t = 1 - Math.exp(-smoothSpeed * dt)

        let camRoll = 0

        if (!car.isInAirProper()) {
            driftRightNormalized = Math.ClampFloat(rightVel / driftRightMaxThreshold, -1, 1)
            camRoll += driftRightLerp * -settings.getValue("Drift_Max_Tilt")
        } else {
            driftRightNormalized = 0
        }

        driftRightLerp = lerp( driftRightLerp, driftRightNormalized, t)
        if (settings.getValue("Test_Drift_Cam")) {
            driftRightLerp = settings.getValue("Test_Drift_LeftRight")
        }

        camRollLerp = lerp( camRollLerp, camRoll, t )

        //driftRightLerp here adds 80% fake speed relative to the threshold to shake more during drifts. Since it's percentage based it works at better at all speeds for all cars and plays better with changed settings.
        const carSpeedPerc = Math.min( ( carSpeed + lerp(0, carSpeedShakeMaxThreshold * 0.8, Math.abs(driftRightLerp)) ) / carSpeedShakeMaxThreshold, 1)
        const shakeSpeed = lerp(2, 15, easeInQuint(carSpeedPerc))
        const shakeStrength = lerp(0.02, 0.1, easeInQuint(carSpeedPerc))
        shakeTime += dt * shakeSpeed

        const nx = noisy.noise2D(shakeTime, shakeTime + 5)
        const ny = noisy.noise2D(shakeTime + 10, shakeTime + 15)

        camPos = coords.sub( carForw.mul(settings.getValue("Back_Offset") + xyDimension + forwPerc * 2 - (Math.abs(driftRightLerp) * 1.5) ) )
        camPos = camPos.sub( carRight.mul(driftRightLerp * settings.getValue("Drift_Side_Move")) )
        camPos = camPos.add( carRight.mul(ny * shakeStrength) )

        //We lower the right offset when drifting so it's more centered.
        camPos = camPos.add( carRight.mul(settings.getValue("Right_Offset") * (1 - Math.abs(driftRightLerp))) )
        camPos.z += (settings.getValue("Height_Offset") + zDimension) + nx * shakeStrength - (Math.abs(driftRightLerp) * settings.getValue("Drift_Cam_Lower"))
        camForw = camPos.add(carForw.mul(200))
        camForw = camForw.add(carRight.mul(nx * (shakeStrength*10)))
        camForw.z += ny * (shakeStrength*10)

        let camRollAdd = 0
        if (Object.keys(rollAdders).length > 0) {
            for (let [_, adder] of Object.entries(rollAdders)) {
                camRollAdd += adder
            }
        }

        if (Object.keys(pitchAdders).length > 0) {
            for (let [_, adder] of Object.entries(pitchAdders)) {
                camForw.z += adder
            }
        }

        camForw.z = Math.ClampFloat(camForw.z, -90, 100)

        const upOffset = carRight.mul(Math.sin(camRollLerp + camRollAdd))


        //const rayCast = ColPoint.GetCollisionBetweenPoints( coords.x, coords.y, coords.z, camPos.x, camPos.y, camPos.z, true, true, true, true, true, true, true, true, Memory.GetVehiclePointer(car), 0 )
        const rayCast = trace.line( coords, camPos, Memory.GetVehiclePointer(car) )
        let finalRayPos = camPos.clone()
        if (rayCast) {
            const rayHitPos = rayCast.hitPos
            if (!rayHitPos.isZero()) {
                finalRayPos = new Vector3(rayHitPos.x, rayHitPos.y, rayHitPos.z).add(rayCast.normal.mul(0.05))
            }
        }

        carForw.z = Math.ClampFloat(carForw.z, -0.49, 0.49)

        Camera.SetFixedPosition(finalRayPos.x, finalRayPos.y, finalRayPos.z, upOffset.x, upOffset.y, upOffset.z)
        Camera.PointAtPoint(camForw.x, camForw.y, camForw.z, 2)
        
    } else {
        if (camActive) {
            if (justExited) {
                camActive = false
                Camera.PersistFov(false)

                justExited = false

                if (char.isInAnyCar() && ply.isPlaying() && Pad.IsKeyDown(KeyCode.RightButton)) {
                    doDriveBy()
                }

                await asyncWait(10)

                if (!ply.isPlaying()) {
                    // force death camera if we're dead
                    Memory.WriteI16(0xB6F19C + 0xC, CameraMode.PedDeadBaby, false)
                } else {
                    Camera.Restore()
                }

                // resetting this just in case
                CTIMERA = 0
            }
        }
    }
    await asyncWait(1)
}

}

main()