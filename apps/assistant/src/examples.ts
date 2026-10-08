// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// What to ask, for an empty conversation: one of each kind of command
// (docs/AI-AND-MCP.md, the commands), shown a few at a time, a different
// few every few seconds. The shell's view has the same list
// (AssistantOverlay.qml examples); each is a request the grammar takes as
// it stands (service/grammar.test.ts checks both).

export const EXAMPLES = [
    "Add a meeting with Sam tomorrow at 3", "What's on my calendar this week?",
    "Remind me to call Mom at 6", "Set an alarm for 7am weekdays",
    "Set a timer for 10 minutes", "New note: buy flowers",
    "Add milk to my shopping list", "Email Priya saying see you soon",
    "Play some music by Miles Davis", "Turn on the flashlight",
    "Convert 10 miles to km", "What's the weather tomorrow?",
    "Text Sam I'm running late", "Set brightness to 50%",
    "What time is it in Tokyo?", "Navigate to the nearest coffee shop",
    "Show my photos from yesterday", "What's 15% of 80?",
];

/** n examples from the i-th on, round the list. */
export function examplesFrom(i: number, n: number): string[] {
    return Array.from({ length: n }, (_, k) => EXAMPLES[(i + k) % EXAMPLES.length]);
}
