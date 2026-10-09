// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// A request for every command the assistant has (lib/commands.js BUILT_IN),
// for the tests that run each one: permissions.test.ts (its Luna calls and
// db8 kinds against its permissions) and tools/test-assistant.cjs (each in
// the simulator, and each turned off in Settings). "" for one that only
// runs as another's button (locationAccess: "Allow").

"use strict";

module.exports = {
    call: "call Sam", text: "text Sam see you soon", readMessages: "read my last message", email: "email Sam saying hello",
    searchEmail: "do I have any new emails", event: "add a meeting with Sam tomorrow at 3", agenda: "what's on my calendar today",
    timer: "set a timer for 5 minutes", timerStatus: "how much time is left", timerCancel: "cancel my timers", stopwatch: "start a stopwatch",
    alarm: "set an alarm for 7am", alarmList: "what alarms do I have", alarmManage: "delete my 6:30 pm alarm",
    reminder: "remind me to call Mom at 6", task: "add milk to my shopping list", note: "new note: buy flowers", findNotes: "find my notes about wifi",
    contactAdd: "add Robin Lee to my contacts with number 555 0111", contactInfo: "what's Sam's number", toggle: "turn on wifi",
    media: "pause the music", volume: "turn up the volume", brightness: "set brightness to 50%", screenshot: "take a screenshot",
    lock: "lock the screen", battery: "what's my battery", settings: "open wifi settings", open: "open Maps",
    navigate: "navigate to the airport", distance: "how far is Paris", photos: "show my photos from yesterday", play: "play some music",
    weather: "what's the weather", convert: "convert 10 miles to km", worldTime: "what time is it in Tokyo", calculate: "what's 2 plus 2",
    time: "what time is it", search: "search the web for webOS", undo: "undo",
    callBack: "call back", callLog: "who called me", voicemail: "call voicemail", replyMessage: "reply ok",
    eventMove: "move my dentist appointment to 4pm", eventCancel: "cancel my dentist appointment", freeTime: "am I free tomorrow at 3",
    noteAppend: "add the code to my wifi note", taskList: "what's on my shopping list", taskDone: "check off milk",
    nearby: "coffee near me", website: "open example.com", storage: "how much storage do I have", appStore: "install doom",
    help: "how do I close an app", copyText: "", findFiles: "find my file called budget", readEmail: "read my latest email",
    emailReply: "reply to my last email saying thanks", travelTime: "how long will it take to drive to the airport", locationAccess: "",
};
