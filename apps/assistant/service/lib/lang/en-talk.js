// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// English: talk around the commands (docs/AI-AND-MCP.md "Evaluation"). The
// owner's tests in the simulator (10 October 2026) and the evaluation
// (apps/assistant/eval/cases.json) found the grammar answering "I can't do
// that" to "hello", "what all can you do?" and "Talk to me.", doing a
// command for "don't turn on wifi" (or nothing for it), taking
// "megweaver@icloud.com" as a new request, and knowing no earlier turn
// ("make it 8 instead", "and tomorrow?", "turn it off"). What is here:
//
//   chat(t)                  small talk and the user's complaints -> {kind}
//   negation(t)              "don't turn on wifi" -> {rest} (lib/grammar.js
//                            parses the rest, the router does nothing and says so)
//   splits / startsCommand / carry: several requests in one
//                            ("turn off wifi and set an alarm for 6",
//                            "turn off wifi and bluetooth"; lib/grammar.js)
//   normalize(t, names)      typos and transcripts, for a second try
//                            ("turn of wifi", "set an alrm", "Calli Phoenix")
//   followOn(t, last, now)   words that lean on the previous turn ("make it 8
//                            instead", "what about friday", "turn it off",
//                            "text her instead saying ..."): a request again
//   dateQuestion(t, now)     "how many days until christmas", "what day is
//                            october 20th", "what year is it"
//   didYouDo(t)              "did you add the number?": what was done, from
//                            the device (commands.js checkDone), never a guess
//
// h: the English grammar's own helpers (lib/lang/en.js).

"use strict";

module.exports = function (h) {
    var D = h.D;

    // ---- Small talk -------------------------------------------------------------------------
    var CHAT = [
        ["missed", /^(?:i (?:just |already )?(?:told|gave|said|sent)(?: (?:it|that|this))?(?: to)? you\b.*|i already (?:told|gave|said)\b.*|(?:are|were) you (?:not |even )?(?:reading|listening to|paying attention to|hearing) (?:my messages|me|what i (?:say|said|wrote))\b.*|you(?:'re| are) not (?:listening|reading|paying attention)\b.*|did(?:n't| not| you not) you (?:hear|read|get) (?:me|that|what i said)\b.*|that's not what i (?:said|asked|meant)\b.*|you got (?:it|that) wrong\b.*|that's wrong)$/],
        ["hear", /^(?:(?:hello|hi|hey)[,!]? )?(?:can|do|could) you hear me(?: now)?$|^(?:hello[,!]? )?(?:are you there|you there|are you listening|are you awake|are you on|are you working|is this (?:thing )?(?:on|working))$|^(?:testing|test)(?: testing)?(?: (?:1 2 3|one two three|123))?$|^mic check$/],
        ["greeting", /^(?:hi|hello|hey|hiya|howdy|yo|greetings|hey there|hi there|hello there|good (?:morning|afternoon|evening|day))(?: (?:phoenix|assistant|there|again|friend))?$/],
        ["howAreYou", /^(?:how are you(?: doing| today| feeling)?|how's it going|how is it going|how are things|how have you been|how(?:'s| is) your day(?: going)?|what's up|what is up|whats up|sup|wassup|what's new|how do you do|what's happening|what's going on)$/],
        ["thanks", /^(?:thanks|thank you|thanks a lot|thank you so much|thanks so much|cheers|much appreciated|thx|ty|thank you very much)(?: (?:phoenix|assistant))?$/],
        ["bye", /^(?:(?:thanks|thank you|ok|okay)[,!]? )?(?:bye|goodbye|good ?bye|bye bye|good night|night night|see you(?: later)?|see ya|talk (?:to you )?later|later|that's all|that's it|that is all|i'm done|i am done|that will be all|that'll be all|nothing else)(?: for now)?$/],
        ["who", /^(?:who are you|what are you|who am i (?:talking|speaking) (?:to|with)|what(?:'s| is) your name|do you have a name|what should i call you|are you (?:a robot|a bot|human|a person|real|an ai|ai|alive|siri|alexa|google))$/],
        ["praise", /^(?:i love you|i like you|love you|you(?:'re| are) (?:the best|awesome|great|amazing|smart|funny|cool|cute|helpful|brilliant|a star)|good (?:job|bot|work)|well done|nice(?: job| work| one)?|great job|great work|awesome|perfect|excellent|brilliant|cool|great|wonderful)$/],
        ["insult", /^(?:you(?:'re| are) (?:stupid|dumb|useless|bad|terrible|annoying|wrong|broken|slow)|shut up|you suck|i hate you)$/],
        ["joke", /^(?:tell me (?:a |another |one more )?joke|(?:say|tell me) something funny|make me laugh|(?:do you )?know any jokes|joke|tell me a funny (?:story|one)|another (?:one|joke))$/],
        ["talk", /^(?:talk to me|let's (?:talk|chat)|chat with me|i'm bored|i am bored|keep me company|what do you want to talk about|what should we talk about|say something|tell me something|tell me (?:about )?yourself|what do you like)$/],
        ["ok", /^(?:ok|okay|k|kk|alright|all right|got it|fine|sounds good|good|no thanks|no thank you|not now|not right now|forget it|forget about it|never ?mind|nevermind|oh well|hmm+|uh huh|i see|right)$/]
    ];
    function chat(t) {
        for (var i = 0; i < CHAT.length; ++i) if (CHAT[i][1].test(t)) return { kind: CHAT[i][0] };
        return null;
    }

    // ---- Don't ------------------------------------------------------------------------------
    // "don't turn on wifi", "do not call mom", "never mind, don't text sam",
    // "I said don't call him", "no don't send that", "stop, don't do that".
    var NEGATION = /^(?:(?:no|nope|wait|stop|hold on|hang on|actually|never ?mind|ok|okay|no no)[,.!]? )*(?:i said |i told you |please |but |just )?(?:don't|do not|dont|never|no need to|you don't need to|there's no need to|you don't have to) (.+)$/;
    function negation(t) {
        var need = /^i (?:don't|do not) (?:need|want) (?:the |my |an? |any )?(alarms?|timers?|reminders?|meeting|appointment|event)(?: (?:tomorrow|today|tonight|any ?more|this week))*$/.exec(t);
        if (need) return { rest: "", that: false, need: need[1] };
        var m = NEGATION.exec(t);
        if (!m) return null;
        var rest = m[1].replace(/\s*,?\s*(?:please|thanks|thank you)$/, "").trim();
        // Not a request undone: "don't let me forget" (a reminder), "don't
        // disturb me" (Do Not Disturb) are casual words for doing something.
        if (/^(?:let me forget|forget|disturb)\b/.test(rest)) return null;
        var that = /^(?:do (?:that|it|this|anything)|send (?:that|it|this)|call (?:him|her|them)|text (?:him|her|them)|bother|worry(?: about it)?|go ahead|send|call|do it)$/.test(rest);
        return { rest: rest, that: that };
    }

    // ---- Several requests in one -------------------------------------------------------------
    // Where a request may end and the next begin.
    var SPLITS = /\s*,?\s+(?:and then|and also|and|then|also|plus|after that)\s+|\s*[,;]\s+(?=\S)/g;
    // Words a request starts with (so "add eggs and bread to my list" stays one).
    var VERB = /^(?:turn|switch|set|start|stop|add|remind|text|message|send|email|call|ring|dial|phone|play|pause|resume|skip|open|launch|show|read|check|what(?:'s| is| are)?|whats|how(?:'s| is| much| many| long| far)?|when(?:'s| is)?|where(?:'s| is)?|who|tell|navigate|take|get|give|lock|mute|unmute|enable|disable|cancel|delete|remove|wake|put|create|make|schedule|book|find|search|look|go|will|is|do|am|mark|check|reply|snooze|count|dim|brighten|raise|lower|increase|decrease|airplane|flashlight|wifi|bluetooth|volume|brightness|weather|timer|alarm|new note|note|take a)\b/;
    function startsCommand(s) { return VERB.test(s); }
    // "turn off wifi and bluetooth": the second said with the first's verb.
    function carry(left, right) {
        var m = /^((?:turn|switch) (?:on|off)|enable|disable|(?:turn|switch) (?:the )?)\b/.exec(left);
        if (m && /^(?:the )?(?:wi-?fi|bluetooth|blue tooth|airplane mode|flashlight|torch|location(?: services)?|hotspot|vpn|do not disturb|rotation lock)$/.test(right))
            return m[1] + " " + right;
        if (/^(?:mute|unmute)\b/.test(left) && /^(?:the )?(?:phone|ringer|music|sound)$/.test(right)) return left.split(" ")[0] + " " + right;
        return null;
    }
    // "set two timers, one for 5 minutes and one for 10": each said whole.
    function multiples(t) {
        var m = /^(?:set|start|make)(?: me)? (?:two|2|three|3|a couple of) (timers|alarms)[,:]? (?:one )?(?:for |at )(.+?)(?:,? and (?:one |another )?(?:for |at )(.+?))(?:,? and (?:one |another )?(?:for |at )(.+?))?$/.exec(t);
        if (!m) return null;
        var noun = m[1] === "timers" ? "set a timer for " : "set an alarm for ";
        return [m[2], m[3], m[4]].filter(Boolean).map(function (x) { return noun + x; });
    }

    // ---- Typos and transcripts ---------------------------------------------------------------
    // Words the commands are made of; a word that is none of them and one
    // letter from one (two for long words) is read as it, on a second try
    // only (lib/grammar.js parse), and never a contact's name.
    var VOCAB = ("set alarm alarms remind reminder reminders timer timers stopwatch snooze weather forecast temperature calendar schedule agenda " +
        "text texts message messages email emails call calls dial redial voicemail reply contact contacts number turn switch wifi bluetooth " +
        "flashlight torch airplane mode location services rotation lock disturb hotspot volume brightness mute unmute louder quieter screen " +
        "open launch navigate directions nearest closest restaurant coffee pharmacy airport play music song songs pause resume next previous " +
        "skip note notes memo memos list lists task tasks shopping grocery groceries tomorrow today tonight morning afternoon evening minutes " +
        "minute hours hour seconds second week weekend monday tuesday wednesday thursday friday saturday sunday add delete cancel remove show " +
        "photos pictures screenshot battery storage settings camera maps clock calculator photos what what's where when how who the for and " +
        "with my me up wake search google find read send rain snow umbrella appointment meeting event events phone phoenix please about " +
        "after before every daily weekdays tell going really").split(" ");
    var VOCAB_SET = {};
    VOCAB.forEach(function (w) { VOCAB_SET[w] = true; });
    // English words are never mended into another ("talk" is not "task",
    // "time" not "timer"): the most common ones, and what people ask about.
    var WORDS = {};
    ("about above across act actually add after again against age ago agree air all almost alone along already also always am among an and " +
     "animal another answer any anyone anything appear apple area arm around art as ask at away baby back bad bag ball bank bar base be " +
     "bear beat beautiful became because become bed been before began begin behind being believe below best better between big bill bird " +
     "bit black blue board boat body book born both bottom bought box boy bread break bring brother brought brown build building built " +
     "burn bus business busy but buy by cake call came can car card care carry case cat catch cause cell center certain chair chance " +
     "change check child children city class clean clear close cold color come common company cook cool copy corner cost could count " +
     "country course cover cross cry cup cut dad dark data date daughter day dead deal dear decide deep did die different dinner direct " +
     "do doctor does dog done door down draw dream dress drink drive drop dry during each early earth east easy eat egg eggs eight " +
     "either else end enjoy enough even evening ever every exact example eye face fact fall family far farm fast father fear feel feet " +
     "few field fight fill final find fine finger finish fire first fish five floor fly follow food foot form four free friend from front " +
     "fruit full fun game garden gas gave get gift girl give glad glass go gold gone good got great green ground group grow guess guy had " +
     "hair half hall hand happen happy hard has hat have he head hear heard heart heat heavy held hello help her here high hill him his " +
     "hit hold hole home hope horse hot hotel house how hundred hurry husband idea if important in inside into iron island it job join " +
     "jump just keep kept key kid kids kill kind king kitchen knew know lady lake land language large last late laugh law lay lead learn " +
     "least leave left leg less let letter level life lift light like line lion list listen little live long look lost lot loud love low " +
     "lunch machine made mail main make man many map mark market may maybe mean meat meet men middle might mile milk mind mine minute " +
     "miss mom money month moon more most mother mountain mouth move movie much music must name near need never new news next nice " +
     "night nine no noise none noon nor north not nothing now number of off office often oh oil old on once one only open or order other " +
     "our out outside over own page paint pair paper park part party pass past pay people perhaps person pick picture piece place plan " +
     "plane plant play please point poor post power present pretty print problem pull push put question quick quiet quite race rain ran " +
     "reach read ready real reason red remember rest rich ride right ring river road rock room round run sad safe said sale same sat save " +
     "saw say school sea season seat second see seem seen sell send sense sent seven several shall she ship shoe shop short should show " +
     "side sign simple since sing sister sit six size sky sleep slow small smell smile snow so soft some son song soon sorry sound south " +
     "speak special spend spring stand star start state station stay step still stop store story street strong student study such sum " +
     "summer sun sure surprise table take talk tall taste teach team tell ten test than thank that the their them then there these they " +
     "thing think third this those though thought three through throw tie till time tire to today together told tomorrow too took top " +
     "total touch toward town toy track train travel tree trip true try turn twelve twenty two type under until up upon us use usual very " +
     "visit voice wait walk wall want war warm was wash watch water way we wear weather week weight well went were west what wheel when " +
     "where which while white who whole why wide wife will win wind window winter wish with without woman wonder wood word work world " +
     "would write wrong yard year yellow yes yet you young your").split(" ").forEach(function (w) { WORDS[w] = true; });
    // Short words left alone (and words people write as they like).
    var KEEP = /^(?:a|an|i|im|is|it|in|on|at|to|of|or|by|be|do|go|no|so|up|us|we|my|me|he|she|her|his|him|you|your|our|its|it's|i'm|am|are|was|can|did|has|had|have|all|any|one|two|six|ten|off|out|now|new|not|too|yes|ok|okay|hey|hi)$/;
    // Spellings and shorthand people type, and what transcripts write.
    var SPELLING = { txt: "text", msg: "message", msgs: "messages", wats: "what's", wat: "what", whats: "what's", u: "you", ur: "your", pls: "please",
                     plz: "please", tmrw: "tomorrow", tmr: "tomorrow", tmrrw: "tomorrow", tomoz: "tomorrow", tonite: "tonight", nite: "night",
                     calender: "calendar", alrm: "alarm", thru: "through", gonna: "going to", wanna: "want to", wether: "weather",
                     whether: "weather", rite: "right", lite: "light", b4: "before", "2moro": "tomorrow", "2day": "today", "2nite": "tonight" };
    function distance(a, b, max) {
        if (Math.abs(a.length - b.length) > max) return max + 1;
        var d = [], i, j;
        for (i = 0; i <= a.length; ++i) { d[i] = [i]; }
        for (j = 0; j <= b.length; ++j) d[0][j] = j;
        for (i = 1; i <= a.length; ++i) {
            for (j = 1; j <= b.length; ++j) {
                var cost = a[i - 1] === b[j - 1] ? 0 : 1;
                d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
                if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
            }
        }
        return d[a.length][b.length];
    }
    function closest(w) {
        if (VOCAB_SET[w] || WORDS[w] || KEEP.test(w) || w.length < 3 || /\d/.test(w) || /'/.test(w)) return null;
        var max = w.length >= 7 ? 2 : 1, best = null, bestD = max + 1, tie = false;
        VOCAB.forEach(function (v) {
            if (Math.abs(v.length - w.length) > max) return;
            var dd = distance(w, v, max);
            if (dd < bestD) { best = v; bestD = dd; tie = false; }
            else if (dd === bestD && best && v !== best) {
                // "calll": call or calls; the shorter, when one is the other with an ending.
                if (v.indexOf(best) === 0) return;
                if (best.indexOf(v) === 0) { best = v; return; }
                tie = true;
            }
        });
        return best && bestD <= max && !tie ? best : null;
    }
    // The words again, spelt as the rules know them; null when nothing changed.
    function normalize(t, names) {
        var protect = {};
        (names || []).forEach(function (n) { String(n || "").toLowerCase().split(/\s+/).forEach(function (w) { if (w) protect[w] = true; }); });
        var out = t.replace(/\bturn of\b/g, "turn off").replace(/\bswitch of\b/g, "switch off").replace(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve) ([ap]) m\b/g, "$1 $2m")
            .split(" ").map(function (w) {
                if (protect[w]) return w;
                if (SPELLING[w]) return SPELLING[w];
                return closest(w) || w;
            }).join(" ");
        return out !== t ? out : null;
    }

    // ---- What was said before ------------------------------------------------------------------
    // last: {command, args, status, name (a contact's), place, made (a thing
    // made that undo takes back)} of the previous turn's command.
    // -> {sentence} to parse again, or {command, args, replace} (replace:
    // take back what was just made first: "make it 8 instead").
    var IT = "(?:it|that|this|that one|this one|them)";
    function personOf(last) {
        if (!last) return "";
        var a = last.args || {};
        return last.name || a.name || (a.who && !/^[+\d]/.test(a.who) ? a.who : "") || (a.invitees && a.invitees[0]) || "";
    }
    function sameHalf(c, oldMs) {
        if (!c || c.meridiem || oldMs === undefined || oldMs === null) return c;
        var old = new Date(oldMs).getHours();
        if (c.hour >= 1 && c.hour <= 11) return { hour: c.hour, minute: c.minute, meridiem: old >= 12 ? "pm" : "am" };
        return c;
    }
    // A new time for something set for oldMs ("8", "8:30", "6 in the morning", "tomorrow at 9").
    function newTime(said, oldMs, now, prefer) {
        var info = h.extract((/^\d/.test(said) ? "at " : "") + said, now);
        if (info.rest.replace(/\b(?:at|on|for|by|the|instead|then|please)\b/g, "").trim()) return null;
        if (info.relative !== undefined) return info.relative;
        if (!info.clock && info.day === undefined && !info.part) return null;
        if (info.clock) info.clock = h.withPart(info.clock, info.part) || info.clock;
        if (info.clock && !info.clock.meridiem && !info.part) info.clock = sameHalf(info.clock, oldMs);
        // Only a time: the same day as before when that is still to come.
        if (info.day === undefined && oldMs) {
            var day = D.startOfDay(oldMs), c = info.clock;
            if (c) {
                var hr = c.meridiem === "pm" ? c.hour % 12 + 12 : c.meridiem === "am" ? c.hour % 12 : c.hour;
                var at = D.at(day, hr, c.minute);
                if (at > now) return at;
                return D.at(D.addDays(day, 1), hr, c.minute);
            }
        }
        var r = h.resolve(info, now, prefer || "next");
        return r.start;
    }
    var VALUE = new RegExp("^(?:(?:no|nope|actually|sorry|oops|wait|um|hmm|i mean|err?)[,.!]? )*(?:i (?:said|meant|mean)|make (?:it|that)|change (?:it|that)(?: to)?|set (?:it|that) (?:to|for)|move (?:it|that) to|it should be|should be|let's (?:say|do|make it)|(?:can you )?make it)? ?(.+?)(?: instead| then| please)?$");
    function followOn(t, last, now) {
        if (!last) return null;
        var m, cmd = last.command, a = last.args || {};
        var corrected = /^(?:no|nope|actually|sorry|oops|wait|i (?:said|meant|mean)|make (?:it|that)|change (?:it|that)|set (?:it|that)|it should be|let's make it|make that)\b/.test(t);
        // "turn it off", "now turn it back on", "switch it off", "off".
        if (cmd === "toggle" && (m = new RegExp("^(?:(?:and |now |ok |okay |then )?(?:turn|switch|put) " + IT + "(?: back)? (on|off)|(?:and |now )?(?:turn|switch) (on|off) " + IT + "|(?:back )?(on|off)(?: again)?)$").exec(t)))
            return { command: "toggle", args: { setting: a.setting, state: m[1] || m[2] || m[3] } };
        // "more", "a bit more", "again", "even louder": the same way again.
        if ((cmd === "volume" || cmd === "brightness") && /^(?:more|a (?:bit|little) more|even more|again|some more|more please|keep going|further|higher|lower|less|a bit less|a little less)$/.test(t)) {
            var dir = /^(?:lower|less|a (?:bit|little) less)$/.test(t) ? "down" : /^higher$/.test(t) ? "up" : a.action === "down" ? "down" : "up";
            return { command: cmd, args: { action: dir } };
        }
        if (cmd === "media" && /^(?:again|another one|next one|one more|skip (?:it|that|this one)(?: too)?)$/.test(t) && a.action === "next") return { command: "media", args: { action: "next" } };
        // "and tomorrow?", "what about friday", "how about in London", "and in paris?"
        if ((m = /^(?:and|what about|how about|and what about|ok and|okay and|also)\s+(.+)$/.exec(t)) && /^(?:weather|worldTime|agenda|freeTime|nearby|travelTime|distance|time)$/.test(cmd)) {
            var x = m[1].replace(/^(?:for|on)\s+/, "");
            if (cmd === "weather") {
                var dayWord = /^(today|tonight|tomorrow|this week|this weekend)$/.exec(x);
                if (dayWord) return { command: "weather", args: Object.assign({}, a, { day: dayWord[1], hour: undefined }) };
                var place = x.replace(/^(?:in|at)\s+/, "");
                if (place && !/\s(?:at|on)\s/.test(place)) return { command: "weather", args: Object.assign({}, a, { place: place }) };
            }
            if (cmd === "worldTime" || cmd === "time") return { sentence: "what time is it in " + x.replace(/^in\s+/, "") };
            if (cmd === "agenda" || cmd === "freeTime") return { sentence: "what's on my calendar " + x };
            if (cmd === "nearby") return { sentence: x.replace(/^(?:any |some )/, "") + " near me" };
            if (cmd === "travelTime") return { sentence: "how long will it take to " + (a.mode === "walk" ? "walk" : a.mode === "bike" ? "bike" : "drive") + " to " + x.replace(/^to\s+/, "") };
            if (cmd === "distance") return { sentence: "how far is " + x.replace(/^to\s+/, "") };
        }
        // "and another one at 7:30", "set another one for 3 minutes", "one more for 6".
        if ((m = /^(?:and |also |now )?(?:set |make |add |start )?(?:another|one more)(?: one)?(?: (?:alarm|timer|reminder))? ?(?:for|at|in)? (.+)$/.exec(t))) {
            if (cmd === "alarm") {
                var at2 = newTime(m[1], a.time, now, "alarm");
                return at2 ? { command: "alarm", args: { time: at2, label: "" } } : { sentence: "set an alarm for " + m[1] };
            }
            if (cmd === "timer") return { sentence: "set a timer for " + m[1] };
        }
        // A correction: "make it 8 instead", "no, 6 in the morning", "no I said 50", "I meant London".
        if (corrected && (m = VALUE.exec(t))) {
            var v = m[1].trim();
            if (cmd === "alarm" && last.made) {
                var at = newTime(v, a.time, now, "alarm");
                if (at) return { command: "alarm", args: { time: at, label: a.label || "", repeat: a.repeat }, replace: true };
            }
            if (cmd === "reminder" && last.made) {
                var due = newTime(v, a.due, now, "day");
                if (due) return { command: "reminder", args: Object.assign({}, a, { due: due }), replace: true };
            }
            if (cmd === "timer" && last.made) {
                var s = h.duration(v);
                if (s === null && /^\d+(?:\.\d+)?$/.test(v)) s = Number(v) * (a.seconds % 3600 === 0 ? 3600 : a.seconds % 60 === 0 ? 60 : 1);
                if (s) return { command: "timer", args: { seconds: s, label: a.label || "" }, replace: true };
            }
            if (cmd === "event" && last.made) {
                var st = newTime(v, a.start, now, "day");
                if (st) return { command: "event", args: Object.assign({}, a, { start: st, end: a.end && a.start ? st + (a.end - a.start) : a.end }), replace: true };
            }
            if (cmd === "weather" || cmd === "worldTime" || cmd === "distance" || cmd === "travelTime" || cmd === "navigate" || cmd === "nearby") {
                var p = v.replace(/^(?:in|at|to)\s+/, "");
                if (cmd === "weather") return { command: "weather", args: Object.assign({}, a, { place: p }) };
                if (cmd === "worldTime") return { command: "worldTime", args: { place: p } };
                if (cmd === "navigate") return { command: "navigate", args: Object.assign({}, a, { destination: p }) };
                if (cmd === "nearby") return { command: "nearby", args: { query: p } };
                return { command: cmd, args: Object.assign({}, a, { place: p }) };
            }
            if (cmd === "toggle") {
                var target = h.toggleTarget(v.replace(/^the /, ""));
                if (target) return { command: "toggle", args: { setting: target, state: a.state } };
            }
            if ((cmd === "volume" || cmd === "brightness") && /^\d+(?: ?%| percent)?$/.test(v)) return { command: cmd, args: { action: "set", level: parseInt(v, 10) } };
        }
        // "no, send it to Priya", "send that to Priya instead": the same words to someone else.
        if ((cmd === "text" || cmd === "email") && (m = /^(?:(?:no|actually|sorry|wait)[,.!]? )*(?:send|text|email|forward) (?:it|that|this|the (?:same )?(?:message|text|email))(?: to)? (.+?)(?: instead)?$/.exec(t))) {
            if (cmd === "text") return { command: "text", args: { who: m[1], message: a.message || "" }, replace: last.status === "pending" };
            return { command: "email", args: { who: m[1], subject: a.subject || "", body: a.body || "" }, replace: last.status === "pending" };
        }
        // "reply ..." after an email was read: to the email.
        if (cmd === "readEmail" && (m = /^(?:reply|respond|write back|answer)(?: to (?:it|that|him|her|them))?(?:,|:| saying| with| that)?\s*(.*)$/.exec(t)))
            return { command: "emailReply", args: { who: a.who || "", body: m[1] ? h.capital(m[1]) : "" } };
        // "him", "her", "them": the person the last request was about
        // ("and text him too", "actually text her instead saying ...").
        var who = personOf(last);
        if (who && /\b(?:him|her|them|he|she)\b/.test(t) && /^(?:(?:and|also|then|now|actually|no|ok|okay)[,]? )*(?:text|message|call|ring|phone|email|tell|send|remind me to (?:call|text))\b/.test(t)) {
            var s2 = t.replace(/^(?:(?:and|also|then|now|actually|no|ok|okay)[,]? )+/, "")
                .replace(/\b(?:him|her|them)\b/, who).replace(/\b(?:he|she)\b/, who)
                .replace(/\s+(?:too|as well|instead|also)\b/g, "").replace(/\s+about (?:it|that|this)$/, "").trim();
            return { sentence: s2, replacePending: /\binstead\b/.test(t) };
        }
        return null;
    }

    // ---- Dates ----------------------------------------------------------------------------------
    // Days people name (the next one): fixed dates, and Thanksgiving (the
    // fourth Thursday of November) and the like.
    function nthWeekday(year, month, weekday, n) {
        var d = new Date(year, month, 1), first = (weekday - d.getDay() + 7) % 7;
        return new Date(year, month, 1 + first + 7 * (n - 1)).getTime();
    }
    function lastWeekday(year, month, weekday) {
        var d = new Date(year, month + 1, 0), back = (d.getDay() - weekday + 7) % 7;
        return new Date(year, month + 1, -back).getTime();
    }
    var HOLIDAYS = [
        [/^(?:christmas(?: day)?|xmas)$/, function (y) { return new Date(y, 11, 25).getTime(); }, "Christmas"],
        [/^christmas eve$/, function (y) { return new Date(y, 11, 24).getTime(); }, "Christmas Eve"],
        [/^new year'?s eve$/, function (y) { return new Date(y, 11, 31).getTime(); }, "New Year's Eve"],
        [/^(?:new year'?s(?: day)?|the new year|new year)$/, function (y) { return new Date(y, 0, 1).getTime(); }, "New Year's Day"],
        [/^(?:halloween)$/, function (y) { return new Date(y, 9, 31).getTime(); }, "Halloween"],
        [/^(?:valentine'?s(?: day)?)$/, function (y) { return new Date(y, 1, 14).getTime(); }, "Valentine's Day"],
        [/^(?:(?:the )?4th of july|(?:the )?fourth of july|independence day)$/, function (y) { return new Date(y, 6, 4).getTime(); }, "the Fourth of July"],
        [/^(?:thanksgiving)$/, function (y) { return nthWeekday(y, 10, 4, 4); }, "Thanksgiving"],
        [/^(?:mother'?s day)$/, function (y) { return nthWeekday(y, 4, 0, 2); }, "Mother's Day"],
        [/^(?:father'?s day)$/, function (y) { return nthWeekday(y, 5, 0, 3); }, "Father's Day"],
        [/^(?:memorial day)$/, function (y) { return lastWeekday(y, 4, 1); }, "Memorial Day"],
        [/^(?:labou?r day)$/, function (y) { return nthWeekday(y, 8, 1, 1); }, "Labor Day"]
    ];
    function holiday(words, now) {
        var w = String(words || "").replace(/^(?:the )?next /, "").trim(), today = D.startOfDay(now);
        for (var i = 0; i < HOLIDAYS.length; ++i) {
            if (!HOLIDAYS[i][0].test(w)) continue;
            var y = new Date(now).getFullYear(), d = HOLIDAYS[i][1](y);
            if (d < today) d = HOLIDAYS[i][1](y + 1);
            return { day: d, name: HOLIDAYS[i][2] };
        }
        return null;
    }
    // A day said alone: "october 20th", "friday", "tomorrow", "christmas".
    function dayOf(words, now) {
        var hd = holiday(words, now);
        if (hd) return hd;
        var info = h.extract(words, now);
        if (info.rest.replace(/\b(?:on|the|of|this|year)\b/g, "").trim() || info.day === undefined) return null;
        return { day: info.day, name: "" };
    }
    // -> args of the time command: {what: "until" | "weekday" | "year" | "date", day, name}
    function dateQuestion(t, now) {
        var m;
        if (/^(?:what(?:'s| is) the year|what year is it(?: now)?|which year is it)$/.test(t)) return { what: "year" };
        if ((m = /^(?:how many|how much) (days|weeks|sleeps)(?: (?:are )?(?:left|there))? (?:until|till|til|to|before|is it (?:until|till|to)) (.+?)(?: is| comes)?$/.exec(t))
            || (m = /^how (?:long|far away|far off) (?:is it )?(?:until|till|til|to|is) ()(.+?)(?: from now| away)?$/.exec(t))) {
            var d = dayOf(m[2], now);
            if (d) return { what: "until", day: d.day, name: d.name || m[2], unit: /week/.test(m[1]) ? "weeks" : "days" };
        }
        if ((m = /^(?:what|which) day(?: of the week)? (?:is|will be|was|does) (.+?)(?: fall on| on| this year| next year)?$/.exec(t))
            || (m = /^(?:what|which) day (?:does|will) (.+?) (?:fall|land) on$/.exec(t))
            || (m = /^(?:is|does) (.+?) (?:on|fall on) a (?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/.exec(t))) {
            if (/^(?:it|today)$/.test(m[1])) return { what: "date" };
            var dd = dayOf(m[1], now);
            if (dd) return { what: "weekday", day: dd.day, name: dd.name || m[1] };
        }
        if ((m = /^what(?:'s| is| will be|'ll be) (?:the )?date (tomorrow|the day after tomorrow|yesterday|next .+|on .+|this .+|in .+)$/.exec(t))
            || (m = /^what(?:'s| is)? (tomorrow|yesterday)'?s date$/.exec(t))
            || (m = /^what date is (.+)$/.exec(t))) {
            var d3 = dayOf(m[1].replace(/^on /, ""), now);
            if (d3) return { what: "weekday", day: d3.day, name: d3.name || "" };
        }
        if (/^(?:what(?:'s| is) (?:today's|todays) date|today's date|todays date|what(?:'s| is) the date(?: today)?|what date is it(?: today)?|what's the date|the date)$/.test(t)) return { what: "date" };
        return null;
    }

    // ---- What was done --------------------------------------------------------------------------
    // "did you add the number?", "did you save it", "is it on my calendar?":
    // answered from the device (commands.js checkDone), not from memory.
    function didYouDo(t) {
        var m = /^(?:did|have|has) (?:you|it) (?:actually |really |already )?(add|save|put|set|make|create|send|turn|change|update|book|schedule|delete|remove|cancel|text|call|email|do)(?:ed)?\b(.*)$/.exec(t)
            || /^(?:is|was) (?:it|that|the (?:number|email|contact|event|alarm|reminder|memo|note)) (?:added|saved|set|made|created|sent|there|done|on (?:my|the) calendar)(.*)$/.exec(t);
        if (!m) return null;
        var said = t;
        var field = /\b(?:number|phone|mobile|cell)\b/.test(said) ? "phone" : /\b(?:e-?mail|address)\b/.test(said) ? "email" : "";
        return { field: field, words: said };
    }

    return { chat: chat, negation: negation, splits: SPLITS, startsCommand: startsCommand, carry: carry, multiples: multiples,
             normalize: normalize, followOn: followOn, dateQuestion: dateQuestion, holiday: holiday, didYouDo: didYouDo };
};
