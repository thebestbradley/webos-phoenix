// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// How people ask for each command, in other words than the obvious ones:
// a model choosing a command (assistant.js pickCommand) sees up to three
// on the command's line, so "kill the wifi" or "light me up" lead it to
// the right one. lib/commands.js puts them on BUILT_IN as `examples`.
// None of them is a phrasing of the evaluation sets word for word
// (test/eval-phrasings.cjs, test/model-eval.json).

"use strict";

module.exports = {
    call: ["give Sam a buzz", "get Mom on the line", "phone the office"],
    text: ["drop Sam a line saying I'm here", "let Mary know I'll be late", "ping Alex that the door is open"],
    readMessages: ["anything new from Sam", "read out my texts", "did Priya message me"],
    email: ["fire off an email to Alex about Friday", "mail Priya the agenda", "send Sam an email saying thanks"],
    searchEmail: ["dig up the email about the lease", "any mail from the bank", "look for the invoice email"],
    event: ["pencil in a dentist visit next tuesday at 3", "block out friday morning for the offsite", "I'm meeting Sam for lunch tomorrow at noon, put it in"],
    agenda: ["what am I up to tomorrow", "how busy is my friday", "what have I got on this week"],
    timer: ["count down three minutes for the eggs", "give me ten minutes on the clock", "time 25 minutes"],
    timerStatus: ["how long till the timer goes off", "is the timer still going", "time left on the pasta"],
    timerCancel: ["drop the timer", "never mind the timer", "stop counting down"],
    stopwatch: ["start timing me", "clock how long this takes", "stop the stopwatch"],
    alarm: ["set up a wake up call at 6", "I have to be awake by 5:45", "get me out of bed at 7"],
    alarmList: ["when's my alarm going off", "which alarms are on", "is my alarm set"],
    alarmManage: ["switch off tomorrow's alarm", "no alarm tomorrow", "scrap the 6:30 alarm"],
    reminder: ["don't let me forget the bins tonight", "buzz me about the rent friday", "nudge me to stretch in an hour"],
    task: ["stick batteries on the shopping list", "I need to buy bread, add it to my list", "put renew passport on my to-do"],
    note: ["jot this down: gate code 4471", "make a note that the plumber comes thursday", "write down parking level 3"],
    findNotes: ["dig up my note about the cabin", "where did I write the wifi password", "look through my memos for recipes"],
    contactAdd: ["save Jo's number 555 0111", "make a contact for Robin Lee", "add a new person called Kim"],
    contactInfo: ["what's Sam's cell", "how do I reach Priya by email", "where does Alex live"],
    toggle: ["cut the wifi for a while", "light me up, it's dark", "get bluetooth up and running"],
    media: ["skip this one", "hold the music", "what's this song"],
    volume: ["that's far too loud", "crank it up", "I can barely hear it"],
    brightness: ["the display's too bright, bring it down", "I can't see the screen, brighter", "dim it a bit"],
    screenshot: ["grab what's on the screen", "snap the screen", "capture this"],
    lock: ["lock it up", "screen off", "lock my phone"],
    battery: ["how much juice is left", "am I running out of battery", "is it charging"],
    settings: ["take me to the wifi settings", "where do I change the ringtone", "show sound settings"],
    open: ["boot up the camera", "pull up the calculator", "jump into Maps"],
    navigate: ["get me to the airport", "how do I get home from here", "walk me to the station"],
    distance: ["how far away is Denver", "how many miles to Chicago", "distance to the coast"],
    photos: ["pull up the pictures I took yesterday", "show me last week's photos", "my screenshots"],
    play: ["spin some tunes", "put on some Daft Punk", "I want to hear jazz"],
    weather: ["how's the weekend shaping up weather-wise", "do I need an umbrella", "is it chilly outside"],
    convert: ["cups in a litre", "50 euros in dollars", "what's 5 feet in cm"],
    worldTime: ["what time is it over in London", "is it night in Sydney", "time in Tokyo right now"],
    calculate: ["18 percent of 64", "split 84 three ways", "12 times 7"],
    time: ["what's the time", "got the time", "what time have we got"],
    search: ["look up how big Canada is", "google pizza dough", "find out who won the game"],
    callBack: ["ring them back", "call whoever that was back", "return that call"],
    callLog: ["did anyone call", "who rang earlier", "when did Mom last call"],
    voicemail: ["any voicemails", "play my messages", "listen to voicemail"],
    replyMessage: ["write back on my way", "answer Sam yes", "respond sounds good"],
    eventMove: ["bump the meeting with Sam to friday", "bump my dentist appointment to 4", "make lunch an hour later"],
    eventCancel: ["scratch my dentist appointment", "call off lunch with Sam", "I can't make the meeting, delete it"],
    freeTime: ["have I got time for coffee on friday", "am I busy at 3 tomorrow", "when's my next free hour"],
    noteAppend: ["stick the gate code on my cabin note", "add eggs to my groceries memo", "tack this onto the wifi note"],
    taskList: ["what's left to do", "read me my shopping list", "what's on my plate today"],
    taskDone: ["tick eggs off", "I bought the milk", "done with buy stamps"],
    nearby: ["any good pizza around here", "where can I get coffee", "closest pharmacy"],
    website: ["go to wikipedia.org", "open the site example.com", "take me to example.com"],
    storage: ["how full is my phone", "space left", "am I running out of storage"],
    appStore: ["get me the Doom app", "download a weather app", "find a game in the store"],
    help: ["how do I switch apps", "show me how to take a screenshot", "how does this work"],
    findFiles: ["where's my budget spreadsheet", "dig up the file called lease", "find the pdf called invoice"],
    readEmail: ["what was in Alex's latest email", "read out the newest mail", "what's in my latest email"],
    emailReply: ["answer that email saying thanks", "write back to Alex saying sounds good", "reply to the last mail"],
    travelTime: ["how long to drive to work", "how far is the airport in time", "how long is the walk to the station"],
    detail: ["what time's my meeting with Sam", "where is it", "who's invited"],
    edit: ["rename it to Coffee with Sam", "add Alex to it", "update Sam's email to sam@new.example.com"]
};
