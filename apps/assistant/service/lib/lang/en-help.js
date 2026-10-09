// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// How to use Phoenix, in the Assistant's English: short answers to "how do
// I ...?", each from the Help app's topic it names (apps/help/topics/<topic>.md,
// which an answer offers to open) or, for the Assistant itself,
// docs/AI-AND-MCP.md. Keep each in step with its source: grammar.test.ts
// checks that every topic exists and that each answer's key words are in it.
//
//   {id, topic: Help topic id ("" for none), words: regexp on what was asked
//    (after "how do I", "what is", ...), answer, source: [words that must be in
//    the topic, as the test checks]}

"use strict";

var HOWTO = [
    { id: "back", topic: "gestures", words: /^(?:go back|get back|go to the previous (?:screen|page)|use (?:the )?back(?: gesture| button)?)$/,
      answer: "Swipe left, right to left, in the gesture area below the screen: it goes back one step, like a back button. On a tablet, apps have their own back buttons.",
      source: ["swipe left", "back"] },
    { id: "gestures", topic: "gestures", words: /^(?:(?:use )?(?:the )?gestures?(?: area)?|what (?:do|does) the gestures? (?:area )?do)$/,
      answer: "The strip below the screen is the gesture area. Swipe up from an app for card view, and again for the launcher; swipe left to go back; swipe down in card view to open the card in the middle; tap it to switch between the app and card view. On a tablet, flick up from the bottom edge instead.",
      source: ["gesture area", "swipe up", "swipe down", "flick up from the bottom edge"] },
    { id: "switch", topic: "cards", words: /^(?:switch|change|move between|go between) (?:apps|cards|applications)|^(?:multitask(?:ing)?|see (?:all )?my (?:open )?apps|(?:use |open )?card view)$/,
      answer: "Swipe up in the gesture area to see your open apps as cards, side by side. Slide them left or right and tap the one you want. On a tablet, flick up from the bottom edge of the screen.",
      source: ["card view", "slide the cards left or right"] },
    { id: "close", topic: "cards", words: /^(?:close|quit|exit|kill|shut|stop) (?:an? |the |this )?(?:apps?|cards?|applications?|programs?)(?: down)?$/,
      answer: "In card view, flick the app's card up and off the top of the screen. Swipe up in the gesture area first to see the cards.",
      source: ["flick its card up and off the top"] },
    { id: "stacks", topic: "cards", words: /^(?:(?:use |make |rearrange |reorder |move )?(?:card )?stacks?|rearrange (?:my )?cards|reorder (?:my )?cards|move a card)$/,
      answer: "Cards that belong together stack up, like an email you're writing and your inbox. Slide sideways to go through a stack. To rearrange, hold a card until it lifts and drag it; drag it to the edge of the screen to move it into the next stack.",
      source: ["stack up", "hold a card until it lifts"] },
    { id: "launcher", topic: "launcher", words: /^(?:(?:open |use |find )?(?:the )?launcher|find (?:an? |my )?apps?|see (?:all )?(?:my )?apps|open an app)$/,
      answer: "Swipe up twice in the gesture area, or tap the launcher button at the right of the dock. Its tabs are Apps, Downloads and Settings. Or just start typing an app's name.",
      source: ["swipe up twice", "launcher button", "apps, downloads and settings"] },
    { id: "rearrange", topic: "launcher", words: /^(?:rearrange|move|organi[sz]e|reorder) (?:my |the )?(?:apps|icons)|^(?:delete|remove|uninstall) (?:an? |the )?apps?$/,
      answer: "In the launcher, hold an icon until it lifts, then drag it; drop it on another tab or on the dock. To delete an app you installed, hold its icon and tap the delete badge. Built-in apps can't be deleted. Tap Done when you've finished.",
      source: ["hold an icon until it lifts", "delete badge", "built-in apps cannot be deleted"] },
    { id: "justtype", topic: "justtype", words: /^(?:(?:use )?just type|search (?:my )?(?:phone|device|tablet|everything)|(?:do a |use )?universal search)$/,
      answer: "In card view or the launcher, just start typing. Just Type finds apps, contacts, your tasks, memos, events and emails, offers quick actions like New Memo or New Task with what you typed, and searches the web.",
      source: ["start typing", "quick actions", "new memo", "search the web"] },
    { id: "notifications", topic: "notifications", words: /^(?:(?:see|read|check|open|use|clear|dismiss) (?:my |the |a )?(?:notifications?|dashboard|alerts?)|(?:the )?(?:notifications?|dashboard))$/,
      answer: "Tap the notification area to open the dashboard; each notification has its own row. Tap a row to open it in its app, or swipe it sideways to dismiss it.",
      source: ["tap the notification area", "dashboard", "swipe it sideways"] },
    { id: "systemmenu", topic: "systemmenu", words: /^(?:(?:open |use )?(?:the )?system menu|(?:get to|find|reach) (?:quick )?settings|(?:open |find )?(?:the )?quick settings)$/,
      answer: "Tap the top right of the status bar, where the battery and signal are. The system menu has the brightness slider, Wi-Fi, VPN, Bluetooth, Airplane Mode, Rotation Lock and Mute Sound. Or just ask me, like “turn on Wi-Fi”.",
      source: ["top right of the status bar", "brightness", "rotation lock"] },
    { id: "unlock", topic: "lockscreen", words: /^(?:unlock (?:my |the )?(?:phone|tablet|device|screen)|use the lock screen|unlock)$/,
      answer: "Drag the padlock up into the ring. If you've set a PIN or password, the PIN pad asks for it next.",
      source: ["drag the padlock up"] },
    { id: "passcode", topic: "passcode", words: /^(?:set|change|add|turn off|remove) (?:a |my |the )?(?:pin|passcode|password|lock code)(?: on (?:my )?(?:phone|tablet|device))?$/,
      answer: "In Settings > Screen & Lock, under Secure unlock, choose Simple PIN (at least 4 digits) or Password (at least 4 characters). To change or remove it, you need the current one.",
      source: ["settings > screen & lock", "simple pin"] },
    { id: "location", topic: "location", words: /^(?:turn (?:on|off) |use |change |manage )?(?:location(?: services)?|gps)(?: for (?:an? )?apps?)?$/,
      answer: "Settings > Location Services turns location on and off and chooses GPS or network location. Its Apps list shows every app that asked for your position; change an answer there. I can also turn it on for you: say “turn on location services”.",
      source: ["settings > location services", "apps"] },
    { id: "screenshot", topic: "", words: /^(?:take|make|capture|grab) (?:a )?screen ?shot|^(?:capture|print) (?:the )?screen$/,
      answer: "Press Home and Power together (Power and Volume Down on a device without Home), or Print Screen on a keyboard. Or just ask me: “take a screenshot”. Screenshots go to the Screen captures album in Photos.",
      source: [] },
    { id: "assistant", topic: "", words: /^(?:use (?:you|the assistant)|(?:open|talk to|ask) (?:you|the assistant)|wake you(?: up)?|start you)$/,
      answer: "Hold the launcher button in the dock, then type or tap the microphone and say what you want; or open the Assistant app. You can turn on “Hey Phoenix” in Settings > Assistant to ask hands-free. Say “help” to see what I can do.",
      source: [] }
];

module.exports = { HOWTO: HOWTO };
