// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// English: a correction in the middle of what is said, as people do it
// aloud ("set an alarm for seven, no wait, eight"; "remind me at 3 to call
// the dentist, actually make it 4"; "text Sam, wait no, text Priya that
// I'm outside"). The sentence as meant, which lib/grammar.js parse tries
// before the words as said; the sweep of everyday phrasings (11 October
// 2026) found each read as said: an alarm nothing understood, a reminder
// "call the dentist actually make it 4", a text to "sam wait no text priya".
//
//   corrected(t, names, parses(sentence) -> bool) -> sentence | null
//
// What the correction can be, and nothing else (a message's own "no" or
// "actually" is left alone: "text Sam no worries" is a text):
//   a whole request again           "..., wait no, text Priya that I'm outside"
//   a time, number or day instead   "... for seven, no, eight"; "... at 3, actually make it 4"
//   a contact instead of the last   "call Sam, no, Priya"

"use strict";

module.exports = function (h) {
    var MARK = /(?:^|[\s,.;])(?:no wait|wait no|wait wait|no no|no sorry|sorry|oops|i mean|i meant|actually|scratch that|correction|wait|no)[,.;!]?\s+(?:(?:make|change) (?:it|that)(?: to)?\s+|(?:let's|lets) say\s+|it's\s+|its\s+)?/g;
    var NUM = "(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|ninety|half)";
    var BODY = "(?:(?:\\d{1,2}(?::\\d{2})?|" + NUM + "(?:[ -]" + NUM + ")*)(?: ?[ap]m| o'clock| (?:in the )?(?:morning|evening|afternoon))?(?: (?:minutes?|mins?|hours?|hrs?|seconds?|secs?|percent))?" +
               "|noon|midnight|(?:next )?(?:mon|tues|wednes|thurs|fri|satur|sun)day|tomorrow|today|tonight)";
    var ONE_TIME = new RegExp("^(?:(?:at|for|in|on|by) )?" + BODY + "$");
    var ANY_TIME = new RegExp("\\b(?:(?:at|for|in|on|by) )?" + BODY + "(?![\\w:])", "g");

    function last(re, s) {
        var m, found = null;
        re.lastIndex = 0;
        while ((m = re.exec(s))) {
            if (m[0]) found = m;
            else re.lastIndex++;
        }
        return found;
    }

    return function corrected(t, names, parses) {
        var m, mark = null;
        MARK.lastIndex = 0;
        while ((m = MARK.exec(t))) mark = m;
        if (!mark) return null;
        var left = t.slice(0, mark.index).replace(/[\s,.;]+$/, "").trim();
        var right = t.slice(mark.index + mark[0].length).replace(/[.!?]+$/, "").trim();
        if (!left || !right || !parses(left)) return null;
        // A whole request again.
        if (parses(right)) return right;
        // A time, number or day in place of the last one said.
        if (ONE_TIME.test(right)) {
            var said = last(ANY_TIME, left);
            if (said) {
                var word = right.replace(/^(?:at|for|in|on|by) /, "");
                // "for 6 am, no, 7": the morning kept.
                var mer = /\b([ap]m)$/.exec(said[0]);
                if (mer && /^\d{1,2}(?::\d{2})?$/.test(word)) word += " " + mer[1];
                // "a timer for 5 minutes, no, 10": the unit kept.
                var unit = / (minutes?|mins?|hours?|hrs?|seconds?|secs?)$/.exec(said[0]);
                if (unit && !/ (?:minutes?|mins?|hours?|hrs?|seconds?|secs?)$/.test(word)) word += " " + unit[1];
                // "at 6, no wait, 7": 6 was the evening (an hour from 1 to 6
                // is the afternoon), and so is 7, which alone would be the morning.
                var h0 = h.number(said[0].replace(/^(?:at|for|in|on|by) /, "")), h1 = h.number(word);
                if (!mer && !unit && h0 >= 1 && h0 <= 6 && h1 >= 7 && h1 <= 11) word += " pm";
                var lead = /^(?:at|for|in|on|by) /.exec(said[0]);
                return left.slice(0, said.index) + (lead ? lead[0] : "") + word + left.slice(said.index + said[0].length);
            }
        }
        // A contact in place of the last one named.
        var who = (names || []).map(function (n) { return String(n).toLowerCase(); })
            .filter(function (n) { return n === right || n.split(" ")[0] === right; })[0];
        if (who) {
            var hit = null;
            (names || []).forEach(function (n) {
                var low = String(n).toLowerCase(), i = left.lastIndexOf(low);
                if (i >= 0 && (!hit || i > hit.i || (i === hit.i && low.length > hit.n.length))) hit = { i: i, n: low };
            });
            if (hit) return left.slice(0, hit.i) + right + left.slice(hit.i + hit.n.length);
        }
        return null;
    };
};
