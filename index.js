if (process.platform != 'linux'){
    console.error("This program can only be run under linux!");
    process.exit();
}
import * as tmi from "tmi.js";
import * as chi from "child_process";
import { default as robot } from "@jitsi/robotjs";
import { createRequire } from "node:module";
import * as fs from "node:fs";
const nativeModule = createRequire(import.meta.url)("./nodephin.node"); // custom bs
let setInputs = nativeModule.setInputs;

const MODE = {
    DISABLED: 0,
    FROZEN: 1,
    ANARCHY: 2,
    DEMOCRACY: 3,
    OPS: 4,
    MODS: 5
}

const MODETEXT = [
    "Disabled",
    "Paused",
    "Anarchy",
    "Democracy",
    "Restricted",
    "ModsOnly"
]

const DEFAULT_WAIT = 1;
const DEFAULT_BUTTON = 0.4;
const DEFAULT_MOVE = 1;
const DEFAULT_LOOK = 0.5;
const CONST_VERT_LOOK = 5;
const MAX_INPUTS = 99;
const MAX_INPUT_TIME = 10;
const MAX_WAIT = 120;
const SNEAK_MOD = 0.33;

const FLUSHPERM_INTERVAL = 30000;
const TRYUNBLOCK_INTERVAL = 1000;

const actionModifiers = {
    NANO: 0.1,
	MICRO: 0.25,
    SLIGHT: 0.5,
    LITTLE: 0.5,
	LIGHT: 0.5,
	DOUBLE: 2,
    SUPER: 4, 
	GIGA: 6
};

const ITOP = {
    NOP: 0,
    WAIT: 1,
    HALT: 2,
    IWAIT: 3,
    BUTTON: 4,
    MOVE: 5,
    LOOK: 6,
    SETSNEAK: 7,
    OTHER: 8,
    ROBOT: 9
}

const DIRECTIONS = {
    UP: [0,1],
    FORWARD: [0,1],
    STRAIGHT: [0,1],
    DOWN: [0,-1],
    BACK: [0,-1],
    BACKWARD: [0,-1],
    BACKWARDS: [0,-1],
    LEFT: [-1,0],
    RIGHT: [1,0]
}

const BUTTONS = ['A','B','X','Y','L','R','Z'];


let globalCooldown = 0;
let cdDone = true;

function doCooldownDone(){
    cdDone = true;
}

let inputUnuseTimeouts = {
    "A": 0,
    "B": 0,
    "X": 0,
    "Y": 0,
    "L": 0,
    "R": 0,
    "Z": 0,
    "START": 0,
    "MOVE": 0,
    "LOOK": 0
}

let stickStates = {
    "MX": 0x80,
    "MY": 0x80,
    "LX": 0x80,
    "LY": 0x80
}

let requestedMode = MODE.DEMOCRACY;
let actualMode = requestedMode;
let actualModeLock = false;

let sneaking = 0;

let inputThreads = []
const usernameRegex = RegExp("^(#)?[a-zA-Z0-9][\\w]{2,24}$");

const DEVS = ["aaronrules5"]

const settingsObj = JSON.parse(fs.readFileSync("./settings.json", "UTF-8"));
const CHANNELNAME = settingsObj["channel-name"];

const loginObj = JSON.parse(fs.readFileSync("./login.json", "UTF-8"));
const BOTNAME = loginObj["bot-name"];
const TOKEN = loginObj["access-token"];
const ANON = (!BOTNAME || !TOKEN);

let permStr = fs.readFileSync("./perm.json", "UTF-8");
let permObj = {};

try {
    permObj = JSON.parse(permStr);
}
catch {
    console.warn("Unable to parse perm.json! Resetting to defaults!");
    permObj = {};
    permObj["ops"] = {};
    permObj["blocks"] = {};
    permObj["help"] = "Hai";
}

function finalSetInputs(){
    setInputs(0x37ECC0,Buffer.from([
        (inputUnuseTimeouts["A"] ? 0x01 : 0x00) | (inputUnuseTimeouts["B"] ? 0x02 : 0x00) | (inputUnuseTimeouts["X"] ? 0x04 : 0x00) | (inputUnuseTimeouts["Y"] ? 0x08 : 0x00) | (inputUnuseTimeouts["START"] ? 0x10 : 0x00),
        (inputUnuseTimeouts["Z"] ? 0x10 : 0x00) | (inputUnuseTimeouts["R"] ? 0x20 : 0x00) | (inputUnuseTimeouts["L"] ? 0x40 : 0x00) | 0x80,
        inputUnuseTimeouts["MOVE"] ? Math.ceil(((stickStates.MX * (sneaking ? SNEAK_MOD : 1))+1)/2*255) : 0x80,
        inputUnuseTimeouts["MOVE"] ? Math.ceil(((stickStates.MY * (sneaking ? SNEAK_MOD : 1))+1)/2*255) : 0x80,
        inputUnuseTimeouts["LOOK"] ? 255 - Math.ceil(((stickStates.LX+1)/2*255)) : 0x80,
        inputUnuseTimeouts["LOOK"] ? 255 - Math.ceil((stickStates.LY+1)/2*255) : 0x80,
        0x00,
        0x00
    ]));
}

function doInputUse(key,time){
    clearTimeout(inputUnuseTimeouts[key]);
    inputUnuseTimeouts[key] = setTimeout(doInputUnuse.bind(null,key),time);
    finalSetInputs();
}

function doInputUnuse(key){
    clearTimeout(inputUnuseTimeouts[key]);
    inputUnuseTimeouts[key] = 0;
    finalSetInputs();
}

async function sleep(ms){
    return new Promise((res)=>{
        setTimeout(res,ms);
    })
}

function ciEqual(str1,str2){
    return str1.toUpperCase()==str2.toUpperCase();
}

function ciIncludes(arr,str){
    let i = 0;
    const arrLen = arr.length;
    while (i < arrLen){
        if (ciEqual(arr[i],str))
            return true;
        i++;
    }
    return false;
}

function tpSay(client, msg){
    console.log(msg);
    if (ANON || !client)
        return;
    let msgBuf = msg;
    while (msgBuf.length > 0) {
        client.say(CHANNELNAME, msgBuf.slice(0, 400));
        msgBuf = msgBuf.slice(400);
    }
}

function tryUnblock(){
    permObj["blocks"] = permObj["blocks"].filter((x) => {
        return Date.now() < x.expires || x.expires == -1;
    });
}

function flushPerm(){
    if (inputThreads.length != 0){
        setTimeout(flushPerm,1000); // Reschedule File IO
        return;
    }
    fs.writeFileSync(
        "./perm.json",
        JSON.stringify(permObj, null, 4),
        "UTF-8"
    );
    setTimeout(flushPerm, FLUSHPERM_INTERVAL);
}

function setMode(client, whom, modeValue){
    requestedMode = modeValue;
    if (actualModeLock){
        tpSay(client, `@${whom} Heads up! You tried to set the mode to ${MODETEXT[modeValue]} at a weird time! It may not work correctly!`);
        return true;
    }
    actualMode = requestedMode;
    tpSay(client, `@${whom} The mode has successfully been set to ${MODETEXT[modeValue]}!`);
    return true;
}

async function resetDolphin(){
    actualMode = MODE.DISABLED;
    actualModeLock = true;
    clearAllThreads();
    chi.spawnSync("pkill",["-sigterm","dolphin-emu"]);
    await sleep(1000);
    chi.spawn("dolphin-emu",["-e",settingsObj["dol"]],{detached: true});
    await sleep(1000);
    if (requestedMode < MODE.ANARCHY)
        actualMode = MODE.DEMOCRACY;
    else
        actualMode = requestedMode;
    actualModeLock = false;
}

function wakeThread(thread){
    thread.sleeping = 0;
    execInputThreads();
}

function clearAllThreads(){
    for (let j = 0; j < inputThreads.length; j++){
        let delThread = inputThreads[j];
        if (true){
            if (delThread.inputs.length != 0){
                delThread.inputs = [];
            }
        }
    }
    for (let key in inputUnuseTimeouts){
        doInputUnuse(key);
    }
}

function execInputThreads(){
    for (let i = 0; i < inputThreads.length; i++){
        const curThread = inputThreads[i];
        while (curThread.sleeping == 0 && curThread.inputs.length != 0){
            let curInput = curThread.inputs[0];
            switch (curInput.op){
                case ITOP.IWAIT:
                case ITOP.WAIT:
                    curThread.sleeping = setTimeout(wakeThread.bind(null,curThread),curInput.time*1000);
                    break;
                case ITOP.HALT:
                    for (let j = 0; j < inputThreads.length; j++){
                        let delThread = inputThreads[j];
                        if (delThread != curThread){
                            if (delThread.inputs.length != 0){
                                delThread.inputs = [];
                            }
                        }
                    }
                    for (let key in inputUnuseTimeouts){
                        doInputUnuse(key);
                    }
                    break;
                case ITOP.BUTTON:
                    if (inputUnuseTimeouts[curInput.button] != 0){
                        curThread.inputs.splice(0,0,{"op":ITOP.IWAIT,"time":0.05});
                        curThread.inputs.splice(0,0,{"op":ITOP.NOP,"time":0});
                        doInputUnuse(curInput.button);
                        break;
                    }
                    doInputUse(curInput.button,curInput.time*1000);
                    break;
                case ITOP.MOVE:
                    if (inputUnuseTimeouts.MOVE != 0){
                        doInputUnuse("MOVE");
                        curThread.inputs.splice(0,0,{"op":ITOP.IWAIT,"time":0.05});
                        curThread.inputs.splice(0,0,{"op":ITOP.NOP,"time":0});
                        break;
                    }
                    stickStates.MX = curInput.stickX;
                    stickStates.MY = curInput.stickY;
                    doInputUse("MOVE",curInput.time*1000);
                    break;
                case ITOP.LOOK:
                    if (inputUnuseTimeouts.LOOK != 0){
                        doInputUnuse("LOOK");
                        curThread.inputs.splice(0,0,{"op":ITOP.IWAIT,"time":0.05});
                        curThread.inputs.splice(0,0,{"op":ITOP.NOP,"time":0});
                        break;
                    }
                    stickStates.LX = curInput.stickX;
                    stickStates.LY = curInput.stickY;
                    doInputUse("LOOK",curInput.time*1000);
                    break;
                case ITOP.SETSNEAK:
                    sneaking = curInput.sneak;
                    finalSetInputs();
                    break;
                case ITOP.OTHER:
                case ITOP.NOP:
                    break;
                case ITOP.ROBOT:
                    robot.keyTap(curInput.d);
                    curThread.sleeping = setTimeout(wakeThread.bind(null,curThread),1000);
                    break;
                default:
                    break;
            }
            curThread.inputs.splice(0,1); // prepare for the next input
        }
    }
    // Actually remove empty threads
    for (let i = inputThreads.length-1; i >= 0; i--){
        const curThread = inputThreads[i];
        if (curThread.inputs.length == 0){
            if (curThread.sleeping != 0){
                clearTimeout(curThread.sleeping);
            }
            inputThreads.splice(i,1);
        }
    }
}

function main(){
    console.clear();
    const client = new tmi.Client({
        channels: [settingsObj["channel-name"]],
        ...(!ANON && {identity: {username: BOTNAME, password: `oauth:${TOKEN}`}})
    });

    if (ANON){
        console.warn("[Anonymous Mode] - No chat messages will be sent from the bot");
    }

    setTimeout(flushPerm, FLUSHPERM_INTERVAL);
    setInterval(tryUnblock, TRYUNBLOCK_INTERVAL);

    client.connect();
    client.on('connected', () => {
        // tpSay(client, "I am ready!");
    });

    client.on('message', async (channel, tags, message, self) => {
        const isBroadcaster = ciEqual(CHANNELNAME,tags.username);
        const isMod = tags.mod;
        const isOp = ciIncludes(permObj["ops"],tags.username);
        const isDev = ciIncludes(DEVS,tags.username);
        if (!tags.username || ciEqual(tags.username, BOTNAME))
            return;

        let iSplit = message.split(",");
        let itBuilder = {"user": tags, "sleeping": 0, "inputs": []}
        let bTroll = 0;
        let bNoPermStart = 0;
        let bNoPermLoad = 0;
        let bLoadBadTime = 0;
        let bGenericLoadFail = 0;
        let bNotDev = 0;

        if (cdDone == false){
            return;
        }
        cdDone = false;
        setTimeout(doCooldownDone, globalCooldown);

        let mSplit = message.toUpperCase().replaceAll(/[^ -~]/g,"").trim().split(" ");

        let badPermsMsg=()=>{
            tpSay(client,`@${tags.username} You don't have permission to do that!`);
        }

        let modeMsg=(modeValue)=>{
            // tpSay(client,`@${tags.username} Setting the mode to ${MODETEXT[modeValue]}!`);
        }

        let opWall=()=>{
            if (!isBroadcaster && !isMod && !isOp){
                badPermsMsg();
                return false;
            }
            return true;
        }

        let modWall=()=>{
            if (!isBroadcaster && !isMod){
                badPermsMsg();
                return false;
            }
            return true;
        }

        let devWall=()=>{
            if (!isBroadcaster && !isDev){
                if (isMod){
                    tpSay(client, `@${tags.username} Sorry! This save slot is reserved for debugging purposes!`);
                    return false;
                }
                badPermsMsg();
                return false;
            }
            return true;
        }

        let checkModeBeforeSave=()=>{
            if (actualMode == MODE.DISABLED || actualMode == MODE.FROZEN){
                tpSay(client, `@${tags.username} You can't do that in the current mode! (${MODETEXT[actualMode]})`);
                return false;
            }
            return true;
        }

        let resumeGame=async (modeValue)=>{
            modeMsg(modeValue);
            if (actualMode == MODE.DISABLED){
                //await resetDolphin();
            }
            if (actualMode == MODE.FROZEN){
                robot.keyTap("f10");
            }
            setMode(client, tags.username, modeValue);
        }

        let listSubCommands = async ()=>{
            switch (mSplit[2]){
                case "OP":
                case "OPS":
                case "OPERATORS":
                    tpSay(client,`@${tags.username} Operators: ${permObj.ops.join(", ")}`);
                    break;
                case "BLOCKED":
                case "BLOCKS":
                case "BLOCK":
                    let blockMsgs = permObj.blocks.map((x)=>`${x.user} is blocked for${x.expires==-1?"ever":" "+Math.round((x.expires-Date.now())/1000) + " seconds"}`);
                    tpSay(client,`@${tags.username} Blocked users: ${blockMsgs.join(", ")}`)
                    break;
            }
        }

        let modeSubCommands = async ()=>{
            switch(mSplit[2]){
                case "STREAM":
                case "STREAMING":
                case "DISABLE":
                case "DISABLED":
                    // clear any inputs in buffer
                    modeMsg(MODE.DISABLED);
                    setMode(client, tags.username, MODE.DISABLED);
                    clearAllThreads();
                    //chi.spawnSync("pkill",["-sigkill","dolphin-emu"]);
                    return;
                case "FREEZE":
                case "FROZEN":
                case "PAUSE":
                    if (actualMode == MODE.FROZEN){
                        tpSay(client,`@${tags.username} It's already set to that mode!`);
                        return;
                    }
                    modeMsg(MODE.FROZEN);
                    clearAllThreads();
                    if (setMode(client, tags.username, MODE.FROZEN)){
                        robot.keyTap("f10");
                    };
                    return;
                case "ANARCHY":
                    resumeGame(MODE.ANARCHY);
                    return;
                case "DEMOCRACY":
                    resumeGame(MODE.DEMOCRACY);
                    return;
                case "OPS":
                case "RESTRICTED":
                    resumeGame(MODE.OPS);
                    return;
                case "MODS":
                case "MODSONLY":
                    resumeGame(MODE.MODS);
                    return;
                default:
                    tpSay(client,`@${tags.username} The current mode is set to ${MODETEXT[actualMode]}!`);
                    return;
            }
        }
        /*
        switch(mSplit[0]){
            case "PAUSE":
            case "START":
                if (!opWall() || !checkModeBeforeSave())
                    return;
                doInputUse("START",100);
                return;
        }
        */
        if (mSplit[0] == "TP"){
            switch(mSplit[1]){
                case "HELP":
                    tpSay(client,`@${tags.username} ${permObj["help"]}`);
                    return;
                case "SETHELP":
                    if (!modWall())
                        return;
                    if (!mSplit[2] || mSplit[2] == ""){
                        tpSay(client,`@${tags.username} No message?`);
                        return;
                    }
                    permObj["help"] = message.trim().split(" ").slice(2).join(" ");
                    tpSay(client,`@${tags.username} Set message!`);
                    return;
                case "ANTISOFTLOCK":
                case "SOFTLOCK":
                case "DIE":
                    if (!opWall() || !checkModeBeforeSave())
                        return;
                    setInputs(0x3C1C0B,Buffer.from([0x00,0x00]));
                    return;
                    /*
                case "PAUSE":
                case "START":
                    if (!opWall() || !checkModeBeforeSave())
                        return;
                    doInputUse("START",100);
                    return;
                    */
                case "SAVE":
                    if (mSplit[2]){
                        switch (mSplit[2]){
                            case "1":
                                robot.keyTap("f1");
                                return;
                            case "2":
                                robot.keyTap("f3");
                                return;
                            case "3":
                                robot.keyTap("f5");
                                return;
                            default:
                                tpSay(client,`@${tags.username} Try again, please!`);
                                return;
                        }
                    } // no break / return here on purpose
                case "SAVE1":
                    if (!opWall() || !checkModeBeforeSave())
                        return;
                    robot.keyTap("f1");
                    return;
                    /*
                case "LOAD":
                    if (!opWall() || !checkModeBeforeSave())
                        return;
                    if (mSplit[2]){
                        switch (mSplit[2]){
                            case "1":
                                robot.keyTap("f2");
                                return;
                            case "2":
                                robot.keyTap("f4");
                                return;
                            case "3":
                                robot.keyTap("f6");
                                return;
                            default:
                                tpSay(client,`@${tags.username} Try again, please!`);
                                return;
                        }
                    } // no break / return here on purpose
                case "LOAD1":
                    if (!opWall() || !checkModeBeforeSave())
                        return;
                    robot.keyTap("f2");
                    return;
                    */
                case "SAVE2":
                    if (!opWall() || !checkModeBeforeSave())
                        return;
                    robot.keyTap("f3");
                    return;
                    /*
                case "LOAD2":
                    if (!opWall() || !checkModeBeforeSave())
                        return;
                    robot.keyTap("f4");
                    return;
                    */
                case "SAVE3":
                    if (!opWall() || !checkModeBeforeSave())
                        return;
                    robot.keyTap("f5");
                    return;
                    /*
                case "LOAD3":
                    if (!opWall() || !checkModeBeforeSave())
                        return;
                    robot.keyTap("f6");
                    return;
                    */
                case "SAVEDEV":
                    if (!devWall() || !checkModeBeforeSave())
                        return;
                    robot.keyTap("f7");
                    return;
                    /*
                case "LOADDEV":
                    if (!devWall() || !checkModeBeforeSave())
                        return;
                    robot.keyTap("f8");
                    return;
                    */
                case "DUMPTICKABLE":
                    if (!opWall())
                        return;
                    tpSay(client, `@${tags.username} suck my movie`);
                    return;
                case "MODE":
                    if (!modWall())
                        return;
                    modeSubCommands();
                    return;
                case "OP":
                    if (!modWall())
                        return;
                    const userToOp = mSplit[2];
                    if (!userToOp || !userToOp.match(usernameRegex) || ciIncludes(permObj["ops"],userToOp)){
                        tpSay(client,`@${tags.username} Failed to op the user ${userToOp}!`);
                        return;
                    }
                    permObj["ops"].push(userToOp);
                    tpSay(client,`@${tags.username} Opped ${userToOp}!`);
                    return;
                case "UNOP":
                case "DEOP":
                    if (!modWall())
                        return;
                    const userToDeop = mSplit[2];
                    const deopIndex = permObj["ops"].indexOf(userToDeop);
                    if (!userToDeop || !userToDeop.match(usernameRegex) || deopIndex == -1){
                        tpSay(client,`@${tags.username} Failed to deop the user ${userToDeop}!`);
                        return;
                    }
                    permObj["ops"].splice(deopIndex,1);
                    tpSay(client,`@${tags.username} Deopped ${userToDeop}!`);
                    return;
                case "BLOCK":
                    if (!opWall())
                        return;
                    let blockLength = parseInt(mSplit[3], 10);
                    blockLength = Number.isFinite(blockLength) ? blockLength : -1; // If no number or an invalid one is given, assume *forever*
                    const userToBlock = mSplit[2];
                    var usersBlocked = permObj["blocks"].map(x => x.user);
                    if (!userToBlock || !userToBlock.match(usernameRegex) || usersBlocked.indexOf(userToBlock)!=-1){
                        tpSay(client,`@${tags.username} Failed to block ${userToBlock}'s input!`);
                        return;
                    }
                    permObj["blocks"].push({user: userToBlock, expires: blockLength != -1 ? Date.now() + blockLength * 1000 : -1});
                    tpSay(client,`@${tags.username} Blocking ${userToBlock}'s input for${blockLength == -1 ? "ever" : " " + blockLength + " seconds"}!`);
                    return;
                case "UNBLOCK":
                    if (!opWall())
                        return;
                    const userToUnblock = mSplit[2];
                    var usersBlocked = permObj["blocks"].map(x => x.user);
                    const unblockIndex = usersBlocked.indexOf(userToUnblock);
                    if (!userToUnblock || !userToUnblock.match(usernameRegex) || unblockIndex == -1){
                        tpSay(client,`@${tags.username} Failed to unblock ${userToUnblock}'s input!`);
                        return;
                    }
                    permObj["blocks"].splice(unblockIndex,1);
                    tpSay(client,`@${tags.username} Unblocked ${userToUnblock}'s input!`);
                    return;
                case "COOLDOWN":
                    if (!modWall())
                        return;
                    let cooldownValue = mSplit[2];
                    try {
                        cooldownValue = parseFloat(cooldownValue);
                        if (!Number.isFinite(cooldownValue) || cooldownValue >= 3153600000 || cooldownValue < 0)
                            throw Error();
                    }
                    catch {
                        tpSay(client,`@${tags.username} Current cooldown is ${globalCooldown} seconds`);
                        return;
                    }
                    globalCooldown = cooldownValue;
                    tpSay(client, `@${tags.username} Cooldown is now set to ${cooldownValue} seconds`);
                    return;
                case "LIST":
                    if (!opWall())
                        return;
                    listSubCommands();
                    return;
                case "RESET":
                    if (!modWall())
                        return;
                    tpSay(client,`@${tags.username} Resetting Dolphin Emulator!`);
                    await resetDolphin();
                    return;
            }
        }
        switch (actualMode){
            case MODE.DISABLED:
            case MODE.FROZEN:
                return;
            case MODE.OPS:
                if (!isBroadcaster && !isMod && !isOp)
                    return;
            case MODE.MODS:
                if (!isBroadcaster && !isMod)
                    return;
            case MODE.DEMOCRACY:
                if (!isBroadcaster && ciIncludes(permObj["blocks"].map(x=>x.user),tags.username))
                    return; // Input blocked
            case MODE.ANARCHY:
                break;
        }

        for (let i = 0; i < iSplit.length; i++){
            const curInput = iSplit[i];
            mSplit = curInput.toUpperCase().replaceAll(/[^ -~]/g,"").trim().split(" ");
            let timeCoeff = 1;
            let bDouble = 0;
            let timeCalc = parseFloat(mSplit[mSplit.length-1]);
            let bLastIsTime = Number.isFinite(timeCalc);
            timeCalc = bLastIsTime ? timeCalc : 0;

            if (mSplit[0] == "WAIT"){
                timeCalc = parseFloat(mSplit[1]);
                timeCalc = Number.isFinite(timeCalc) ? timeCalc : DEFAULT_WAIT;
                itBuilder.inputs.push({"op": ITOP.WAIT, "time": timeCalc});
                continue;
            }
            if (mSplit[0] == "HALT"){
                itBuilder.inputs.push({"op": ITOP.HALT});
                continue;
            }
            if (Object.keys(actionModifiers).includes(mSplit[0])){
                if (mSplit[0] == "DOUBLE")
                    bDouble = 1;
                timeCoeff = actionModifiers[mSplit[0]];
                mSplit.splice(0, 1);
            }

            if (BUTTONS.includes(mSplit[0])){
                timeCalc = bLastIsTime ? timeCalc : DEFAULT_BUTTON;
                if (bDouble){
                    itBuilder.inputs.push({"op": ITOP.BUTTON, "button": mSplit[0], "time": timeCalc * timeCoeff});
                    itBuilder.inputs.push({"op": ITOP.IWAIT, "time": 0.25});
                }
                itBuilder.inputs.push({"op": ITOP.BUTTON, "button": mSplit[0], "time": timeCalc * timeCoeff});
                continue;
            }

            if (mSplit[0] == "LOOK" || mSplit[0] == "TURN"){
                timeCalc = bLastIsTime ? timeCalc : DEFAULT_LOOK;
                let horzTally = 0;
                let vertTally = 0;
                for (let j = 1; j < mSplit.length-(bLastIsTime?1:0); j++){
                    if (Object.keys(DIRECTIONS).includes(mSplit[j])){
                        let dirInc = DIRECTIONS[mSplit[j]];
                        horzTally+=dirInc[0];
                        vertTally+=dirInc[1];
                    }
                }
                const finalDirection = Math.atan2(vertTally,horzTally);
                let stickX = Math.cos(finalDirection);
                let stickY = Math.sin(finalDirection);
                stickX = vertTally == 0 ? stickX : 0; // One at a time! 0.22 -> 0.4
                const vertMin = 0.22;
                const vertMax = 0.4;
                stickY = stickY * timeCalc * timeCoeff;
                stickY = Math.min(stickY,1);
                stickY = Math.max(stickY,-1);
                stickY = stickY * (vertMax - vertMin) + (Math.sign(stickY) * (vertMax-(vertMax - vertMin)));
                if (vertTally == 0 && horzTally == 0)
                    continue;
                itBuilder.inputs.push({"op": ITOP.LOOK, "stickX": stickX, "stickY": stickY, "time": vertTally ? CONST_VERT_LOOK : timeCalc * timeCoeff});
                continue;
            }

            function dirCalc(startAt, mult){
                if (Object.keys(DIRECTIONS).includes(mSplit[startAt])){
                    timeCalc = bLastIsTime ? timeCalc : DEFAULT_MOVE * mult;
                    let horzTally = 0;
                    let vertTally = 0;
                    for (let j = startAt; j < mSplit.length-(bLastIsTime?1:0); j++){
                        if (Object.keys(DIRECTIONS).includes(mSplit[j])){
                            let dirInc = DIRECTIONS[mSplit[j]];
                            horzTally+=dirInc[0];
                            vertTally+=dirInc[1];
                        }
                    }
                    const finalDirection = Math.atan2(vertTally,horzTally);
                    const stickX = Math.cos(finalDirection);
                    const stickY = Math.sin(finalDirection);
                    if (vertTally == 0 && horzTally == 0)
                        return;
                    itBuilder.inputs.push({"op": ITOP.MOVE, "stickX": stickX, "stickY": stickY, "time": timeCalc * timeCoeff});
                }
            }
            let loadWall=()=>{
                if (!isBroadcaster && !isMod && !isOp){
                    itBuilder.inputs.push({"op": ITOP.NOP});
                    bNoPermLoad = 1;
                    return false;
                }
                if (actualMode == MODE.DISABLED || actualMode == MODE.FROZEN){
                    itBuilder.inputs.push({"op": ITOP.NOP});
                    bLoadBadTime = 1;
                    return false;
                }
                return true;
            }

            let hackySubTP=()=>{
                switch (mSplit[1]){
                    case "LOAD":
                        if (mSplit[2]){
                            switch (mSplit[2]){
                                case "1":
                                    if (!loadWall)
                                        return;
                                    itBuilder.inputs.push({"op": ITOP.ROBOT, "d": "f2"});
                                    return;
                                case "2":
                                    if (!loadWall)
                                        return;
                                    itBuilder.inputs.push({"op": ITOP.ROBOT, "d": "f4"});
                                    return;
                                case "3":
                                    if (!loadWall)
                                        return;
                                    itBuilder.inputs.push({"op": ITOP.ROBOT, "d": "f6"});
                                    return;
                                default:
                                    itBuilder.inputs.push({"op": ITOP.NOP});
                                    bGenericLoadFail = 1;
                                    return;
                            }
                        } // no break / return here on purpose
                    case "LOAD1":
                        if (!loadWall)
                            return;
                        itBuilder.inputs.push({"op": ITOP.ROBOT, "d": "f2"});
                        return;
                    case "LOAD2":
                        if (!loadWall)
                            return;
                        itBuilder.inputs.push({"op": ITOP.ROBOT, "d": "f4"});
                        return;
                    case "LOAD3":
                        if (!loadWall)
                            return;
                        itBuilder.inputs.push({"op": ITOP.ROBOT, "d": "f6"});
                        return;
                    case "LOADDEV":
                        if (!loadWall)
                            return;
                        if (!isDev){
                            itBuilder.inputs.push({"op": ITOP.NOP});
                            bNotDev = 1;
                            return;
                        }
                        itBuilder.inputs.push({"op": ITOP.ROBOT, "d": "f8"});
                        return;
                }
            }

            switch (mSplit[0]){
                case "TP":
                    hackySubTP();
                    continue;
                case "START":
                case "PAUSE":
                    if (!isBroadcaster && !isMod && !isOp){
                        itBuilder.inputs.push({"op": ITOP.NOP});
                        bNoPermStart = 1;
                        continue;
                    }
                    itBuilder.inputs.push({"op": ITOP.BUTTON, "button": "START", "time": DEFAULT_BUTTON});
                    continue;
                case "CRUISEBOOST":
                case "CB":
                    dirCalc(1,1);
                    itBuilder.inputs.push({"op": ITOP.BUTTON, "button": "L", "time": DEFAULT_BUTTON});
                    itBuilder.inputs.push({"op": ITOP.BUTTON, "button": "X", "time": DEFAULT_BUTTON});
                    continue;
                case "BOWL":
                    dirCalc(1,1);
                    itBuilder.inputs.push({"op": ITOP.BUTTON, "button": "X", "time": DEFAULT_BUTTON});
                    continue;
                case "SNEAK":
                    itBuilder.inputs.push({"op": ITOP.SETSNEAK, "sneak": 1});
                    continue;
                case "UNSNEAK":
                    itBuilder.inputs.push({"op": ITOP.SETSNEAK, "sneak": 0});
                    continue;
                case "SHOOT":
                    itBuilder.inputs.push({"op": ITOP.BUTTON, "button": "L", "time": DEFAULT_BUTTON});
                    continue;
                case "ATTACK":
                case "SPIN":
                    itBuilder.inputs.push({"op": ITOP.BUTTON, "button": "B", "time": DEFAULT_BUTTON});
                    continue;
                case "BASH":
                    itBuilder.inputs.push({"op": ITOP.BUTTON, "button": "Y", "time": DEFAULT_BUTTON});
                    continue;
                case "SLAM":
                    itBuilder.inputs.push({"op": ITOP.BUTTON, "button": "A", "time": DEFAULT_BUTTON});
                    itBuilder.inputs.push({"op": ITOP.IWAIT, "time": 0.25});
                    itBuilder.inputs.push({"op": ITOP.BUTTON, "button": "X", "time": DEFAULT_BUTTON});
                    continue;
                case "GLIDE":
                    dirCalc(1,2);
                    timeCalc = bLastIsTime ? timeCalc : DEFAULT_BUTTON;
                    itBuilder.inputs.push({"op": ITOP.BUTTON, "button": "A", "time": DEFAULT_BUTTON});
                    itBuilder.inputs.push({"op": ITOP.IWAIT, "time": 0.25});
                    itBuilder.inputs.push({"op": ITOP.BUTTON, "button": "A", "time": DEFAULT_BUTTON});
                    itBuilder.inputs.push({"op": ITOP.IWAIT, "time": 0.25});
                    timeCalc = bLastIsTime ? timeCalc : 2;
                    itBuilder.inputs.push({"op": ITOP.BUTTON, "button": "A", "time": timeCalc * timeCoeff});
                    continue;
                case "DJ":
                    dirCalc(1,1);
                    timeCalc = bLastIsTime ? timeCalc : DEFAULT_BUTTON;
                    itBuilder.inputs.push({"op": ITOP.BUTTON, "button": "A", "time": DEFAULT_BUTTON});
                    itBuilder.inputs.push({"op": ITOP.IWAIT, "time": 0.25});
                    itBuilder.inputs.push({"op": ITOP.BUTTON, "button": "A", "time": DEFAULT_BUTTON});
                    continue;
                case "SHIT":
                case "DIAPER":
                case "DIAPEY":
                    bTroll = 1;
                case "JUMP":
                    dirCalc(1,1);
                    timeCalc = bLastIsTime ? timeCalc : DEFAULT_BUTTON;
                    itBuilder.inputs.push({"op": ITOP.BUTTON, "button": "A", "time": DEFAULT_BUTTON});
                    if (bDouble){
                        itBuilder.inputs.push({"op": ITOP.IWAIT, "time": 0.25});
                        itBuilder.inputs.push({"op": ITOP.BUTTON, "button": "A", "time": DEFAULT_BUTTON});
                    }
                    continue;
            }
            dirCalc(0,1);
        }
        // --- out of loop
        if (iSplit.length > MAX_INPUTS) {
            tpSay(client, `@${tags.username} That's >${MAX_INPUTS} inputs in one message! Too many!`);
            return;
        }
        let finalWaits = 0;
        for (let i = 0; i < itBuilder.inputs.length; i++){
            let inputTime = itBuilder.inputs[i].time;
            inputTime = Math.max(inputTime,0);
            if (itBuilder.inputs[i].op==ITOP.WAIT){
                finalWaits+=inputTime;
                itBuilder.inputs[i].time = inputTime;
                continue;
            }
            inputTime = Math.min(inputTime,MAX_INPUT_TIME);
            itBuilder.inputs[i].time = inputTime;
        }
        if (finalWaits > MAX_WAIT){
            tpSay(client, `@${tags.username} You wait for >${MAX_WAIT} seconds in total! Too many!`);
            return;
        }
        if (bTroll)
            tpSay(client,"Trolling");
        if (bNoPermStart)
            tpSay(client,`@${tags.username} Your message had start/pause! You don't have permission! That input will be skipped!`);
        if (bGenericLoadFail)
            tpSay(client, `@${tags.username} Unable to load! That input will be skipped! Please, try again!`);
        if (bNoPermLoad)
            tpSay(client,`@${tags.username} Your message tried to load! You don't have permission! That input will be skipped!`);
        if (bNotDev)
            tpSay(client,`@${tags.username} Your message tried to load the dev state! You don't have permission! That input will be skipped!`);
        if (bLoadBadTime)
            tpSay(client, `@${tags.username} You tried to load at a bad time! That input will be skipped!`);
        inputThreads.splice(0, 0, itBuilder);
        execInputThreads();
    });
}

main();