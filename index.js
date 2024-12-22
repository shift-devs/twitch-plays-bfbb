import { promises } from "fs";
import * as tmi from "tmi.js";
import * as chi from "child_process";
import { default as robot } from "@jitsi/robotjs";
import { createRequire } from "node:module";
const nativeModule = createRequire(import.meta.url)("./nodephin.node"); // custom bs
let setInputs = nativeModule.setInputs;

// Very fast tick interval, but we only call setInputs on input changes. So... probably fine.
const CTICK_INTERVAL = 10;
const CTICK_MAX = 6000;
const FLUSHPERM_INTERVAL = 30000;

const MODE = {
    DISABLED: 0,
    FROZEN: 1,
    ANARCHY: 2,
    DEMOCRACY: 3,
    OPS: 4,
    MODS: 5
}

const MODETEXT = [
    "Streaming",
    "Paused",
    "Anarchy",
    "Democracy",
    "Restricted",
    "ModsOnly"
]

const usernameRegex = RegExp("^(#)?[a-zA-Z0-9][\\w]{2,24}$");

const DEVSAVERS = ["aaronrules5", "darkrta", "the_ivo_robotnic"]

const settingsObj = JSON.parse(await promises.readFile("./settings.json", "UTF-8"));
const CHANNELNAME = settingsObj["channel-name"];

const loginObj = JSON.parse(await promises.readFile("./login.json", "UTF-8"));
const BOTNAME = loginObj["bot-name"];
const TOKEN = loginObj["access-token"];
const ANON = (!BOTNAME || !TOKEN);

const DIRECTIONS = {
	FORWARD: "UP",
	UP: "UP",
	BACK: "DOWN",
	DOWN: "DOWN",
	LEFT: "LEFT",
	RIGHT: "RIGHT",
};

const KEYS = ["A","B","X","Y","Z","L","R"]

const SIMPLEACTIONS = {
    "BASH": "Y",
//    "SLAM": "X",
    "BOWL": "X",
    "ATTACK": "B"
}

// const simpleActions = ["HOLD", "JUMP", "LOOK", "TURN", "PRESS", "MOVE", "SNEAK", "UNSNEAK", "HALT"];

const actionsModifiers = {
	MICRO: 100,
	LIGHT: 500,
	DOUBLE: 1000,
	GIGA: 5000,
    HOLD: 6000
};

let permStr = await promises.readFile("./perm.json", "UTF-8")
let permObj = {};

try {
    permObj = JSON.parse(permStr);
}
catch {
    console.warn("Unable to parse perm.json! Resetting to defaults!");
    permObj = {};
    permObj["ops"] = {};
    permObj["blocks"] = {};
}

let requestedMode = MODE.DEMOCRACY;
let actualMode = requestedMode;
let actualModeLock = false;

let prevInputStates = {}

let tickableInputs = {
    "A": 0,
    "B": 0,
    "X": 0,
    "Y": 0,
    "START": 0,
    "L": 0,
    "R": 0,
    "Z": 0,
    "UP": 0,
    "DOWN": 0,
    "LEFT": 0,
    "RIGHT": 0,
    "CUP": 0,
    "CLEFT": 0,
    "CDOWN": 0,
    "CRIGHT": 0,
}

let sneaking = false;

let globalCooldown = 0;
let cdDone = true;

function doCooldownDone(){
    cdDone = true;
}

function clearTicks(){
    for (let key in tickableInputs) {
        tickableInputs[key] = 0;
    }
}

function doTick(){
    let needsUpdate = false;
    for (let key in tickableInputs) {
        let value = tickableInputs[key];
        if (value != 0 && value != -1){
            value -= CTICK_INTERVAL;
            value = Math.max(0, value);
            value = Math.min(CTICK_MAX, value);
            tickableInputs[key] = value;
        }
        if (prevInputStates[key] != (value ? 1 : 0)){
            needsUpdate = true;
        }
        prevInputStates[key] = tickableInputs[key] ? 1 : 0;
    }
    if (needsUpdate)
        finalSetInputs()
}

function finalSetInputs(){
    setInputs(0x37ECC0,Buffer.from([
        (tickableInputs["A"] ? 0x01 : 0x00) | (tickableInputs["B"] ? 0x02 : 0x00) | (tickableInputs["X"] ? 0x04 : 0x00) | (tickableInputs["Y"] ? 0x08 : 0x00) | (tickableInputs["START"] ? 0x10 : 0x00),
        (tickableInputs["Z"] ? 0x10 : 0x00) | (tickableInputs["R"] ? 0x20 : 0x00) | (tickableInputs["L"] ? 0x40 : 0x00) | 0x80,
        tickableInputs["LEFT"] ? (sneaking ? 0x5A : 0x00) : (tickableInputs["RIGHT"] ? (sneaking ? 0xFF - 0x5A : 0xFF) : 0x80),
        tickableInputs["DOWN"] ? (sneaking ? 0x5A : 0x00) : (tickableInputs["UP"] ? (sneaking ? 0xFF - 0x5A : 0xFF) : 0x80),
        tickableInputs["CLEFT"] ? 0x00 : (tickableInputs["CRIGHT"] ? 0xFF : 0x80),
        tickableInputs["CDOWN"] ? 0x00 : (tickableInputs["CUP"] ? 0xFF : 0x80),
        0x00,
        0x00
    ]));
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

async function flushPerm(){
    await promises.writeFile(
        "./perm.json",
        JSON.stringify(permObj, null, 4),
        "UTF-8"
    );
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
    clearTicks();
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

async function press(key) {
	if (key)
        tickableInputs[key] += 50;
}

async function hold(key, time = 6000) {
	if (key in DIRECTIONS){
        key = DIRECTIONS[key];
        move(key, null, time);
        return;
    }
    tickableInputs[key] += time;
}

async function move(dir1, dir2, time = 1000) {
    let finalDir1 = DIRECTIONS[dir1];
    let finalDir2 = DIRECTIONS[dir2];
    if ((finalDir1 == "UP" && finalDir2 == "DOWN") || (finalDir1 == "DOWN" && finalDir2 == "UP") || (finalDir1 == "LEFT" && finalDir2 == "RIGHT") || (finalDir1 == "RIGHT" && finalDir2 == "LEFT"))
        return;
    tickableInputs[DIRECTIONS[dir1]] += time;
    tickableInputs[DIRECTIONS[dir2]] += time;
    if ((tickableInputs.UP > 0 && tickableInputs.DOWN > 0) || (tickableInputs.LEFT > 0 && tickableInputs.RIGHT > 0)){
        tickableInputs.UP = 0;
        tickableInputs.DOWN = 0;
        tickableInputs.LEFT = 0;
        tickableInputs.RIGHT = 0;
        tickableInputs[DIRECTIONS[dir1]] += time;
        tickableInputs[DIRECTIONS[dir2]] += time;
    }
}

async function jump(dir1, dir2, time = 800) {
    if (dir1 || dir2){
        move(dir1, dir2, time);
    }
    tickableInputs.A += 250;
}

async function glide(dir1, dir2, time = 2000){
    if (dir1 || dir2){
        move(dir1, dir2, time + 800);
    }
    tickableInputs.A += 250;
    await sleep(250);
    tickableInputs.A = 0;
    await sleep(50);
    tickableInputs.A += 400;
    await sleep(400);
    tickableInputs.A = 0;
    await sleep(50);
    tickableInputs.A += time + 800;
}

async function slam(){
    tickableInputs.A += 250;
    await sleep(250);
    tickableInputs.A = 0;
    await sleep(50);
    tickableInputs.A += 250;
    await sleep(100);
    tickableInputs.X += 50;
}

async function doublejump(dir1, dir2, time = 800) {
    if (dir1 || dir2){
        move(dir1, dir2, time);
    }
    tickableInputs.A += 250;
    await sleep(250);
    tickableInputs.A = 0;
    await sleep(50);
    tickableInputs.A += 250;
}

async function look(dir, time = 500) {
	switch (dir) {
		case "LEFT":
			tickableInputs.CRIGHT += time;
			return;
		case "RIGHT":
            tickableInputs.CLEFT += time;
			return;
        case "UP":
            tickableInputs.CDOWN += time;
            return;
        case "DOWN":
            tickableInputs.CUP += time;
            return;
	}
}
async function main(){
    console.clear();

    if (process.platform != 'linux'){
        console.error("This program can only be run under linux!");
        return;
    }

    setInterval(tryUnblock, 1000);
    setInterval(flushPerm, FLUSHPERM_INTERVAL);
    setInterval(doTick, CTICK_INTERVAL);

    const client = new tmi.Client({
        channels: [settingsObj["channel-name"]],
        ...(!ANON && {identity: {username: BOTNAME, password: `oauth:${TOKEN}`}})
    });

    if (ANON){
        console.warn("[Anonymous Mode - No chat messages will be sent from the bot]");
    }

    client.connect();
    client.on('connected', () => {
        // tpSay(client, "I am ready!");
    })

    client.on('message', async (channel, tags, message, self) => {
        const isBroadcaster = ciEqual(CHANNELNAME,tags.username);
        const isMod = tags.mod;
        const isOp = ciIncludes(permObj["ops"],tags.username);
        const isDevSaver = ciIncludes(DEVSAVERS,tags.username);
        if (!tags.username || ciEqual(tags.username, BOTNAME))
            return;

        // robot.mouseClick();

        let mSplit = message.toUpperCase().split(" ");

        let badPermsMsg=()=>{
            tpSay(client,`@${tags.username} You don't have permission to do that!`);
        }

        let modeMsg=(modeValue)=>{
            tpSay(client,`@${tags.username} Setting the mode to ${MODETEXT[modeValue]}!`);
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
            if (!isBroadcaster && !isDevSaver){
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
                await resetDolphin();
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
                    let blockMsgs = permObj.blocks.map((x)=>`${x.user} is blocked for${x.expires==-1?"ever":" "+Math.round(x.expires-Date.now()) + " seconds"}`);
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
                    clearTicks();
                    chi.spawnSync("pkill",["-sigkill","dolphin-emu"]);
                    return;
                case "FREEZE":
                case "FROZEN":
                case "PAUSE":
                    if (actualMode == MODE.FROZEN){
                        tpSay(client,`@${tags.username} It's already set to that mode!`);
                        return;
                    }
                    modeMsg(MODE.FROZEN);
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
                    resumeGame(MODE.MODS)
                default:
                    tpSay(client,`@${tags.username} The current mode is set to ${MODETEXT[actualMode]}!`);
                    return;
            }
        }

        switch(mSplit[0]){
            case "START":
                if (!opWall() || !checkModeBeforeSave())
                    return;
                tickableInputs.START += 100;
                return;
        }

        if (mSplit[0] == "TP"){
            switch(mSplit[1]){
                case "ANTISOFTLOCK":
                    if (!opWall() || !checkModeBeforeSave())
                        return;
                    setInputs(0x3C1C0B,Buffer.from([0x00,0x00]));
                    return;
                case "START":
                    if (!opWall() || !checkModeBeforeSave())
                        return;
                    tickableInputs.START += 100;
                    return;
                case "SAVE":
                    if (!opWall() || !checkModeBeforeSave())
                        return;
                    robot.keyTap("f1");
                    return;
                case "LOAD":
                    if (!opWall() || !checkModeBeforeSave())
                        return;
                    robot.keyTap("f2");
                    return;
                case "SAVE2":
                    if (!opWall() || !checkModeBeforeSave())
                        return;
                    robot.keyTap("f3");
                    return;
                case "LOAD2":
                    if (!opWall() || !checkModeBeforeSave())
                        return;
                    robot.keyTap("f4");
                    return;
                case "SAVE3":
                    if (!opWall() || !checkModeBeforeSave())
                        return;
                    robot.keyTap("f5");
                    return;
                case "LOAD3":
                    if (!opWall() || !checkModeBeforeSave())
                        return;
                    robot.keyTap("f6");
                    return;
                case "SAVEDEV":
                    if (!devWall() || !checkModeBeforeSave())
                        return;
                    robot.keyTap("f7");
                    return;
                case "LOADDEV":
                    if (!devWall() || !checkModeBeforeSave())
                        return;
                    robot.keyTap("f8");
                    return;
                case "DUMPTICKABLE":
                    if (!opWall())
                        return;
                    tpSay(client, `@${tags.username} ${JSON.stringify(tickableInputs)}`);
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
                    if (!modWall())
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
                    if (!modWall())
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
                    if (!modWall())
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

        if (cdDone == false)
            return;

        setTimeout(doCooldownDone,globalCooldown*1000);
        cdDone = false;

        if (mSplit[0] in DIRECTIONS) {
            move(mSplit[0], mSplit[1] in DIRECTIONS ? mSplit[1] : null);
            return;
        }

        if (KEYS.includes(mSplit[0])){
            press(mSplit[0]);
            return;
        }

        if (Object.keys(SIMPLEACTIONS).includes(mSplit[0])){
            press(SIMPLEACTIONS[mSplit[0]]);
            return;
        }

        switch (mSplit[0]) {
            case "HALT":
                clearTicks();
                return;
            case "MOVE":
                if (mSplit[1] in DIRECTIONS)
                    move(mSplit[1], mSplit[2] in DIRECTIONS ? mSplit[2] : null);
                return;
            case "PRESS":
                if (KEYS.includes(mSplit[0]))
                    press(mSplit[0]);
                return;
            case "TURN":
            case "LOOK":
                if (mSplit[1] in DIRECTIONS) look(mSplit[1]);
                return;
            case "HOLD":
                break
                if (KEYS.includes(mSplit[1]) || mSplit[1] in DIRECTIONS)
                    hold(mSplit[1]);
                //return;
            case "SHIT":
                tpSay(client,"Trolling");
            case "SLAM":
                slam();
                return;
            case "GLIDE":
                if (mSplit[1] in DIRECTIONS)
                    glide(mSplit[1], mSplit[2] in DIRECTIONS ? mSplit[2] : null);
                return;
            case "JUMP":
                if (mSplit[1] in DIRECTIONS)
                    jump(mSplit[1], mSplit[2] in DIRECTIONS ? mSplit[2] : null);
                else jump();
                return;
            case "SNEAK":
                sneaking = true;
                return;
            case "UNSNEAK":
                sneaking = false;
                return;
        }

        if (mSplit[0] in actionsModifiers) {
            var dir1, dir2, time;
            time = actionsModifiers[mSplit[0]];
            dir1 = mSplit[2] in DIRECTIONS ? mSplit[2] : null;
            dir2 = mSplit[3] in DIRECTIONS ? mSplit[3] : null;
            if (KEYS.includes(mSplit[1])) {
                if (mSplit[0] == "DOUBLE"){
                    tickableInputs[mSplit[1]] += 250;
                    await sleep(250);
                    tickableInputs[mSplit[1]] = 0;
                    await sleep(50);
                    tickableInputs[mSplit[1]] += 250;
                    return;
                }
                if (mSplit[0] == "HOLD"){
                    hold(mSplit[1]);
                    return;
                }
                press(mSplit[1]);
                return;
            }
            if (mSplit[1] in DIRECTIONS) {
                move(mSplit[1], mSplit[2], time);
                return;
            }
            switch (mSplit[1]) {
                case "TURN":
                case "LOOK":
                    if (mSplit[2] in DIRECTIONS) {
                        switch (mSplit[0]){
                            case "LIGHT":
                                look(mSplit[2], 200);
                                return;
                            case "GIGA":
                                look(mSplit[2], 1000);
                                return;
                            case "MICRO":
                                look(mSplit[2], 100);
                                return;
                            case "DOUBLE":
                                look(mSplit[2], 800);
                                return;
                        }
                    }
                    return;
                case "SHIT":
                    tpSay(client,"Trolling");
                case "JUMP":
                    if (mSplit[0] == "DOUBLE")
                        doublejump(dir1,dir2,time);
                    else
                        jump(dir1, dir2, time);
                    return;
                case "GLIDE":
                    glide(dir1, dir2, time);
                    return;
                case "SLAM":
                    slam();
                    return;
                case "MOVE":
                    move(dir1, dir2, time);
                    return;
                case "HOLD":
                    break
                    if (KEYS.includes(mSplit[2]) || mSplit[2] in DIRECTIONS){}
                        hold(mSplit[2]);
                    //return;
            }
        }
    });
}

main();