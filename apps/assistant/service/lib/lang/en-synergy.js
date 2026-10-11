// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Assistant's English for what is connected through Synergy
// (lib/synergy.js, lib/commands-synergy.js): the words for accounts and
// services, the rules that hear them, and what is said back.
//
// An account is heard by the names it has on the device (ctx.accounts,
// lib/synergy.js vocabulary: its template's name, its providers' short
// names, its alias, its user name), so a connector installed later is
// heard as soon as it is signed in, and by the services people name
// (SERVICES: "Gmail" is the Google account, "Mastodon" the Fediverse; the
// ones Phoenix cannot reach say why).
//
// Rules (lib/lang/en.js puts them before its own):
//   post          "post to Bluesky: ...", "toot ...", "share this on LinkedIn"
//   joinMeeting   "join my next meeting", "join the Zoom call", "join the design review"
//   inviteReply   "accept the invite from Alex", "decline it", "maybe to the offsite"
//   emailMark     "archive it", "mark the email from Priya as unread", "flag it", "mark all as read"
//   emailDelete   "delete the email from Alex" (read back)
//   saveToDrive   "save it to Google Drive", "upload the budget file to Dropbox" (read back)
//   eventCalendar "add it to my Google calendar", "move the dentist to my work calendar"
//   accounts      "what accounts do I have"
//   shareLocation "share my location with Sam on Slack", "send my ETA to Sam",
//                 "let Priya know when I'll be at the airport" (read back)
//   and the commands that read or write an account's data, with the account
//   said ("what's on my work calendar", "any new emails in my work account",
//   "read my unread Slack messages", "find the budget file on Dropbox",
//   "what's on my Microsoft To Do", "add milk to Todoist"): the account's
//   words taken out, the rest read by the other rules, the account added to
//   what they found (scoped).
//
// Made by lib/lang/en.js: require("./en-synergy")(h), h: the helpers it shares.

"use strict";

// The services people name. account: the words the account itself goes by
// (its template's name), when they differ; none: why Phoenix cannot reach it.
var SERVICES = [
    { name: "Slack", words: ["slack"], caps: ["MESSAGING", "CONTACTS"] },
    { name: "Bluesky", words: ["bluesky", "blue sky", "bsky"], caps: ["MESSAGING", "CONTACTS", "SOCIAL"], post: true },
    { name: "the Fediverse", account: "fediverse", words: ["fediverse", "the fediverse", "mastodon", "pixelfed"], caps: ["MESSAGING", "CONTACTS", "SOCIAL"], post: true },
    { name: "LinkedIn", words: ["linkedin", "linked in"], caps: ["CONTACTS"], post: true },
    { name: "Jabber", words: ["jabber", "xmpp"], caps: ["MESSAGING", "CONTACTS"] },
    { name: "Matrix", words: ["matrix"], caps: ["MESSAGING", "CONTACTS"] },
    { name: "Delta Chat", words: ["delta chat", "deltachat"], caps: ["MESSAGING", "CONTACTS"] },
    { name: "Telegram", words: ["telegram"], caps: ["MESSAGING", "CONTACTS"] },
    { name: "Google", words: ["google", "gmail", "google mail", "google calendar", "google tasks", "google contacts"], caps: ["CALENDAR", "TASKS", "CONTACTS", "MAIL"] },
    { name: "Microsoft", words: ["microsoft", "outlook", "hotmail", "office 365", "microsoft 365", "exchange", "microsoft to do", "ms to do", "to do", "outlook calendar"],
      caps: ["CALENDAR", "TASKS", "CONTACTS", "MAIL"] },
    { name: "Todoist", words: ["todoist"], caps: ["TASKS"] },
    { name: "Zoom", words: ["zoom"], caps: ["CALENDAR"] },
    { name: "iCloud", words: ["icloud"], caps: ["CALENDAR", "CONTACTS", "MAIL"] },
    { name: "Dropbox", words: ["dropbox", "drop box"], caps: ["DOCUMENTS"] },
    { name: "Google Drive", words: ["google drive", "gdrive"], caps: ["DOCUMENTS"] },
    { name: "OneDrive", words: ["onedrive", "one drive"], caps: ["DOCUMENTS"] },
    { name: "Box", words: ["box"], caps: ["DOCUMENTS"] },
    { name: "Nextcloud", words: ["nextcloud", "next cloud"], caps: ["DOCUMENTS"] },
    { name: "ownCloud", words: ["owncloud", "own cloud"], caps: ["DOCUMENTS"] },
    { name: "WebDAV", words: ["webdav"], caps: ["DOCUMENTS"] },
    { name: "S3 Storage", words: ["s3"], caps: ["DOCUMENTS"] },
    // Out of reach (docs/SYNERGY-CONNECTORS.md 7: "WhatsApp (no client API) and Signal ... stay out";
    // "Not likely": Facebook, Instagram, Threads; section 7: iCloud Drive).
    { name: "Signal", words: ["signal"], caps: ["MESSAGING"], none: "Signal has no way in for other apps" },
    { name: "WhatsApp", words: ["whatsapp", "whats app"], caps: ["MESSAGING"], none: "WhatsApp has no way in for other apps" },
    { name: "iCloud Drive", words: ["icloud drive"], caps: ["DOCUMENTS"], none: "Apple keeps iCloud Drive to its own devices" },
    { name: "X (Twitter)", words: ["twitter", "x"], caps: ["SOCIAL"], post: true, none: "Phoenix has no account for it" },
    { name: "Facebook", words: ["facebook"], caps: ["SOCIAL"], post: true, none: "Facebook doesn't let other apps post for you" },
    { name: "Instagram", words: ["instagram"], caps: ["SOCIAL"], post: true, none: "Instagram lets other apps post only for business accounts" },
    { name: "Threads", words: ["threads"], caps: ["SOCIAL"], post: true, none: "Phoenix has no account for it; the Fediverse account reaches Threads profiles that share to the fediverse" }
];
function serviceOf(said) {
    var s = String(said || "").toLowerCase().replace(/^(?:my|the)\s+/, "").replace(/\s+(?:account|app)$/, "").trim();
    for (var i = 0; i < SERVICES.length; ++i) if (SERVICES[i].words.indexOf(s) >= 0 || SERVICES[i].name.toLowerCase() === s) return SERVICES[i];
    return null;
}
// The words an account itself goes by, for a service's other name ("gmail" -> "google").
function canon(said) {
    var svc = serviceOf(said);
    return svc ? (svc.account || svc.name).toLowerCase() : String(said || "").toLowerCase();
}
function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

module.exports = function (h) {
    var quote = h.quote, list = h.list, plural = h.plural, cap = h.cap, cased = h.cased;

    // The words for the accounts that can do `caps` (or any): the services'
    // and the device's own accounts' (ctx.accounts), longest first, as a
    // regexp alternation.
    // A word naming what a service does ("google calendar", "gmail"): the
    // phrase is that service only for that ("add lunch to my google
    // calendar" is no task for the Google account).
    var WORD_CAP = [[/\bcalendars?\b/, "CALENDAR"], [/\b(?:g?mail|inbox|outlook)\b/, "MAIL"], [/\bcontacts\b/, "CONTACTS"], [/\bdrive\b/, "DOCUMENTS"],
                    [/\b(?:tasks|to do)\b/, "TASKS"], [/\bmeet\b/, "CALENDAR"]];
    function wordsFor(ctx, caps, opts) {
        var out = [];
        function add(w) {
            w = String(w || "").toLowerCase().trim();
            if (caps && WORD_CAP.some(function (x) { return x[0].test(w) && caps.indexOf(x[1]) < 0; })) return;
            if (w && w.length > 1 && out.indexOf(w) < 0) out.push(w);
        }
        SERVICES.forEach(function (s) {
            if (opts && opts.post && !s.post) return;
            if (caps && !s.caps.some(function (c) { return caps.indexOf(c) >= 0; })) return;
            s.words.forEach(add);
        });
        ((ctx && ctx.accounts) || []).forEach(function (a) {
            if (caps && !(a.caps || []).some(function (c) { return caps.indexOf(c) >= 0; })) return;
            (a.phrases || []).forEach(add);
        });
        out.sort(function (a, b) { return b.length - a.length; });
        return out.map(escapeRe).join("|") || "(?!x)x";
    }

    // ---- Chat networks for "text" (lib/lang/en.js chatNetwork) ----------------------------------
    // The IM networks a message may go by: the services' and the device's IM accounts'.
    function chatWords(ctx) { return wordsFor(ctx, ["MESSAGING"]); }

    // ---- Rules ----------------------------------------------------------------------------------

    function accounts(t) {
        if (/^(?:what|which) accounts? (?:do i have|have i got|are (?:connected|set up|signed in|on (?:my|this) (?:phone|device|tablet)))(?: (?:set up|connected))?$/.test(t)
            || /^(?:list|show(?: me)?|what are) (?:all )?my accounts$/.test(t)
            || /^what(?:'s| is) (?:connected|set up)(?: (?:to|in|through) synergy)?$/.test(t)
            || /^what(?:'s| is) in (?:my )?synergy$/.test(t))
            return { capability: "" };
        return null;
    }

    // "post to bluesky: shipping today", "toot hello", "share this on linkedin", "post hello world to mastodon"
    function post(t, ctx) {
        var svc = wordsFor(ctx, null, null);
        var m = new RegExp("^(?:post|publish|share|toot|skeet|put)(?: (this|it|that))? (?:on|to|onto|in) (?:my )?(" + svc + ")(?: (?:account|feed|timeline|profile))?" +
                           "(?:\\s*[:,-]\\s*|\\s+(?:saying|that says|that|with the words?)\\s+|\\s+)?(.*)$").exec(t);
        if (m && !/^(?:a |an )?(?:message|dm|direct message|text)\b/.test(m[3])) {
            var words = m[3].trim();
            return { service: m[2], text: words ? cased(words, ctx) : "", it: !!m[1] && !words };
        }
        m = new RegExp("^(?:post|publish|share|toot|skeet) (.+?) (?:on|to|onto) (?:my )?(" + svc + ")(?: (?:account|feed|timeline))?$").exec(t);
        if (m && !/^(?:a |an )?(?:message|dm|text)\b/.test(m[1])) {
            if (/^(?:this|it|that|this link|that link|this article)$/.test(m[1])) return { service: m[2], text: "", it: true };
            return { service: m[2], text: cased(m[1].replace(/^(?:a post |the words? )(?:saying )?/, ""), ctx), it: false };
        }
        if ((m = /^(toot|skeet|tweet)(?: this)?\s*[:,-]?\s+(.+)$/.exec(t))) return { service: { toot: "mastodon", skeet: "bluesky", tweet: "twitter" }[m[1]], text: cased(m[2], ctx), it: false };
        if ((m = /^(?:post|publish)(?: (?:a|an|my))?(?: (?:status|update|post))?\s*[:,]\s*(.+)$/.exec(t))) return { service: "", text: cased(m[1], ctx), it: false };
        return null;
    }

    // "join my next meeting", "join the zoom call", "join the design review"
    var MEETING_SVC = "(zoom|teams|microsoft teams|google meet|meet|webex|jitsi)";
    function joinMeeting(t) {
        var m = new RegExp("^(?:join|jump on|hop on|get on|dial into|dial in to|connect me to|open|start|take me to)(?: (?:my|the|our|this))?(?: (next|current|upcoming|first))?(?: " + MEETING_SVC +
                           ")? (?:meeting|call|video call|conference call|conference|video chat|standup|stand-up)(?: (?:now|link))?$").exec(t);
        if (m) return { query: m[2] && !/^(?:standup|stand-up)$/.test(m[2]) ? "" : /stand-?up/.test(t) ? "stand-up" : "", service: m[2] || "" };
        m = new RegExp("^(?:join|dial into|hop on)(?: (?:my|the|our))? (.+?)(?: (?:meeting|call))?(?: (?:on|in|over) " + MEETING_SVC + ")?(?: now)?$").exec(t);
        if (m && !/\b(?:wi-?fi|network|hotspot|vpn|game|club|group|waitlist|wait list|queue|team|beta)\b/.test(m[1]))
            return { query: m[1].replace(/^(?:\d{1,2}(?::\d{2})? ?(?:am|pm)?|next) /, function (x) { return /next/.test(x) ? "" : x; }).trim(), service: m[2] || "" };
        return null;
    }

    // "accept the invite from alex", "decline it", "tentatively accept the design review", "rsvp yes to lunch"
    function inviteReply(t) {
        var m = /^(accept|decline|reject|refuse|turn down|tentatively accept|accept tentatively|say (?:yes|no|maybe) to|rsvp(?: with)? (?:yes|no|maybe)(?: to| for)?|(?:say )?maybe to)(?: (it|that|this|the|my|our|that|this))?(?: (?:meeting |calendar |event )?(?:invite|invitation|invitations|meeting request|request))?(?: (?:(to|for|from|about) )?(?:the |my )?(.+?))?$/.exec(t);
        if (!m) return null;
        var verb = m[1], response = /tentative|maybe/.test(verb) ? "tentative" : /accept|yes/.test(verb) ? "accepted" : "declined";
        var rest = (m[4] || "").trim();
        // "accept it", "decline the invitation": the one the conversation is about (or the only one waiting).
        if (/^(?:it|that|this)$/.test(m[2] || "") && !rest) return { response: response, query: "", from: "", it: true };
        // "decline the call", "accept the terms": not invitations.
        if (/^(?:call|phone call|terms|cookies|request|friend request|connection|update|changes?)$/.test(rest)) return null;
        if (m[3] === "from") return { response: response, query: "", from: rest, it: false };
        return { response: response, query: rest, from: "", it: !rest };
    }

    // The email meant: "it", "the email from alex", "my latest email", "the email about the invoice".
    var EMAIL_REF = "(it|this|that|this one|that one|(?:this|that|the|my) (?:last |latest |newest |most recent )?(?:e-?mail|mail)(?: (?:from (.+?)|about (.+?)))?)";
    function emailRef(m, i) {
        var said = m[i] || "it";
        return { it: /^(?:it|this|that|this one|that one|this e-?mail|that e-?mail)$/.test(said), from: m[i + 1] || "", query: m[i + 2] || "",
                 latest: /\b(?:last|latest|newest|most recent)\b/.test(said) };
    }
    function emailMark(t) {
        var m = new RegExp("^mark (?:" + EMAIL_REF + "|(all)(?: of)?(?: (?:my|the))?(?: (?:unread|new))?(?: (?:e-?mails?|mail|messages))?(?: from (.+?))?) (?:as )?(read|unread|seen|new|not read|important|starred|flagged)$").exec(t);
        if (m) {
            var how = { seen: "read", new: "unread", "not read": "unread", important: "flag", starred: "flag", flagged: "flag" }[m[6]] || m[6];
            if (m[4]) return { action: how, all: true, from: m[5] || "", it: false, query: "" };
            return Object.assign({ action: how, all: false }, emailRef(m, 1));
        }
        m = new RegExp("^(archive|flag|unflag|un-flag|star|unstar|un-star|remove the flag from|take the flag off)(?: " + EMAIL_REF + ")?$").exec(t);
        if (m) {
            var act = /^(?:unflag|un-flag|unstar|un-star|remove|take)/.test(m[1]) ? "unflag" : /^(?:flag|star)$/.test(m[1]) ? "flag" : "archive";
            // "archive" with nothing more, or "it": the email the conversation is about.
            return Object.assign({ action: act, all: false }, emailRef(m, 2));
        }
        return null;
    }
    function emailDelete(t) {
        var m = new RegExp("^(?:delete|trash|bin|remove|get rid of) " + EMAIL_REF + "$").exec(t);
        if (!m || /^(?:it|this|that|this one|that one)$/.test(m[1])) return null;
        return emailRef(m, 1);
    }

    // "save it to google drive", "upload the budget file to dropbox"
    function saveToDrive(t, ctx) {
        var drive = wordsFor(ctx, ["DOCUMENTS"]);
        var m = new RegExp("^(?:save|upload|copy|put|back up|backup|store|send)(?: (it|that|this|this file|that file|the file|(?:the |my )?(.+?)))? (?:to|on|onto|in|into|up to) (?:my )?(" + drive + ")(?: account)?$").exec(t);
        if (!m) return null;
        var file = (m[2] || "").replace(/ (?:file|document|doc|pdf|spreadsheet|presentation)s?$/, "").trim();
        return { file: file, it: !file, drive: m[3] };
    }

    // "find the trip itinerary on google drive", "where's the budget in my dropbox"
    function findOnDrive(t, ctx) {
        var drive = wordsFor(ctx, ["DOCUMENTS"]);
        var m = new RegExp("^(?:find|look for|search for|locate|where(?:'s| is| are)|open|show me) (?:the |my |a )?(.+?) (?:on|in|from) (?:my )?(" + drive + ")(?: account)?$").exec(t);
        if (!m || /^(?:files?|documents?|stuff|things)$/.test(m[1])) return null;
        var q = m[1].replace(/^(?:files?|documents?|docs?|pdfs?) (?:called|named|about) /, "").replace(/ (?:file|document|doc|pdf|spreadsheet|presentation)s?$/, "").trim();
        return q ? { query: q, kind: /\bpdf\b/.test(m[1]) && !/\bpdf\b/.test(q) ? "pdf" : "", drive: m[2] } : null;
    }

    // "add it to my google calendar", "move the dentist appointment to my work calendar"
    function eventCalendar(t, ctx) {
        var m = /^(?:add|put|move|copy|save|switch)( it| that| this| this event| that event| (?:my |the )?(.+?))? (?:to|on|onto|into|over to) (?:my |the )?((?:[a-z0-9@.&'-]+ ){1,3})calendar$/.exec(t);
        if (!m) return null;
        var what = (m[2] || "").trim(), cal = m[3].trim();
        if (/^(?:whole|entire|full|own|main|new)$/.test(cal)) return null;
        // "add lunch friday at noon to my google calendar": a new event (rule "event", scoped).
        if (what && (h.extract(what, (ctx && ctx.now) || Date.now()).day !== undefined || /\d|\b(?:today|tomorrow|tonight|noon|morning|afternoon|evening|every|at)\b/.test(what))) return null;
        if (what && !/^(?:move|copy|switch)\b/.test(t)) return null;
        return { query: what, it: !what, calendar: cal };
    }

    // "what's on my todoist", "what's on my microsoft to do": an account's tasks.
    function accountTasks(t, ctx) {
        var acc = wordsFor(ctx, ["TASKS"]);
        var m = new RegExp("^(?:what(?:'s| is| are)(?: (?:on|in))?|show(?: me)?|read(?: me)?|check|open|list)(?: everything on)? (?:my |the )?(" + acc + ")(?: (?:list|lists|tasks|to-?dos?|to-?do list|inbox))?$").exec(t);
        return m ? { list: "", account: m[1] } : null;
    }
    // "add milk to todoist", "put eggs on my microsoft to do"
    function addToAccount(t, ctx) {
        var acc = wordsFor(ctx, ["TASKS"]);
        var m = new RegExp("^((?:add|put|stick|write) .+? (?:to|on|onto|in)) (?:my |the )?(" + acc + ")(?: (?:inbox|tasks))?$").exec(t);
        if (!m) return null;
        var r = parseRest(m[1] + " my to-do list", ctx);
        if (!r || r.command !== "task") return null;
        r.args.account = m[2];
        return r.args;
    }

    // "share my location with sam", "send sam my location on slack", "tell
    // priya where i am", "send my eta to sam", "let sam know when i'll be at
    // the airport": who, by which account (as "text ... on slack"), and
    // whether it is the ETA (where to, if said).
    var WHERE_I_AM = "(?:my (?:current |exact |live |gps )?(?:location|position|whereabouts)|where i am|where i'm at|where i am right now)";
    var MY_ETA = "(?:my (?:eta|e\\.t\\.a\\.?|arrival time|estimated (?:time of )?arrival))";
    var WHEN_THERE = "when i(?:'ll| will| should) (?:be there|get there|arrive|be home|get home|be (?:at|in) (.+?)|get to (.+?)|arrive (?:at|in) (.+?))";
    function shareLocation(t, ctx) {
        var via = "(?:\\s+(?:on|over|via|through|by|using|in) (?:my |a )?(" + chatWords(ctx) + "|text|texts|sms|text message|imessage))?";
        var who = "(?!(?:me|myself|us)\\b)(.+?)", m, place = "";
        var out = function (w, v, eta, p) {
            // "my mom": the contact is "mom" (as "text my mom ...").
            return { who: cased(w.replace(/^my /, ""), ctx), via: v ? cased(v, ctx) : "", eta: !!eta, place: p ? String(p).replace(/^(?:the )?(home|work)$/, "$1") : "" };
        };
        // "share my location": to whom is asked for.
        if ((m = new RegExp("^(?:share|send) (" + WHERE_I_AM + "|" + MY_ETA + ")$").exec(t))) return { who: "", via: "", eta: new RegExp("^" + MY_ETA + "$").test(m[1]), place: "" };
        // "share my location with sam", "send my eta to sam on slack"
        if ((m = new RegExp("^(?:share|send|text|message|give|show) (" + WHERE_I_AM + "|" + MY_ETA + ")(?: (?:to|for) (.+?))? (?:with|to) " + who + via + "$").exec(t)))
            return out(m[3], m[4], new RegExp("^" + MY_ETA + "$").test(m[1]), m[2]);
        // "send sam my location", "text sam my eta to the airport"
        if ((m = new RegExp("^(?:send|text|message|give|show) " + who + " (" + WHERE_I_AM + "|" + MY_ETA + ")(?: (?:to|for) (.+?))?" + via + "$").exec(t)))
            return out(m[1], m[4], new RegExp("^" + MY_ETA + "$").test(m[2]), m[3]);
        // "tell sam where i am", "let priya know when i'll be at the airport"
        if ((m = new RegExp("^(?:tell|let) " + who + "(?: know)? (" + WHERE_I_AM + "|" + WHEN_THERE + ")" + via + "$").exec(t))) {
            var eta = /^when /.test(m[2]);
            place = m[3] || m[4] || m[5] || (/\b(?:be|get) home$/.test(m[2]) ? "home" : "");
            return out(m[1], m[6], eta, place);
        }
        return null;
    }

    // ---- The account said, taken out, the rest read by the other rules (scoped) --------------------

    // Which argument each command takes the account in.
    var ARG = { agenda: "calendar", event: "calendar", freeTime: "calendar", readMessages: "via", searchEmail: "account", readEmail: "account",
                emailMark: "account", emailDelete: "account", task: "account", taskList: "account", findFiles: "drive" };
    var CALENDAR_CMDS = ["agenda", "event", "freeTime"];
    var CAPS_OF = { readMessages: ["MESSAGING"], searchEmail: ["MAIL"], readEmail: ["MAIL"], emailMark: ["MAIL"], emailDelete: ["MAIL"],
                    task: ["TASKS"], taskList: ["TASKS"], findFiles: ["DOCUMENTS"], agenda: ["CALENDAR"], event: ["CALENDAR"], freeTime: ["CALENDAR"] };
    var NOT_A_CALENDAR = /^(?:whole|entire|full|own|next|new|the|a|my|this|that|today's|tomorrow's|this week's|next week's|weekly|daily|monthly)$/;

    // The other rules, not these (lib/lang/en.js gives them).
    function parseRest(t, ctx) {
        var rules = h.rules();
        for (var i = 0; i < rules.length; ++i) {
            if (rules[i][1].synergy) continue;
            var args = rules[i][1](t, ctx);
            if (args) return { command: rules[i][0], args: args };
        }
        return null;
    }
    var last = { t: null, ctx: null, r: null };
    function scopedParse(t, ctx) {
        if (last.t === t && last.ctx === ctx) return last.r;
        var r = scopedNow(t, ctx);
        last = { t: t, ctx: ctx, r: r };
        return r;
    }
    function scopedNow(t, ctx) {
        var tries = [], m;
        // "my work calendar", "the family calendar", "google calendar"
        if ((m = /\b(my|the|our) ((?:[a-z0-9@.&'-]+ ){1,3})calendar\b/.exec(t)) && !NOT_A_CALENDAR.test(m[2].trim()) && !/^(?:the|a|my) /.test(m[2])) {
            // The phrase gone ("am i free at 3 on my work calendar": "am i free at 3"), else just the account's words.
            var gone = new RegExp("\\s(?:on|to|in|into|onto|from|for) " + m[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?=$|\\s)").exec(t);
            if (gone) tries.push({ rest: t.slice(0, gone.index) + t.slice(gone.index + gone[0].length), said: m[2].trim(), only: CALENDAR_CMDS });
            tries.push({ rest: t.slice(0, m.index) + m[1] + " calendar" + t.slice(m.index + m[0].length), said: m[2].trim(), only: CALENDAR_CMDS });
        }
        var known = wordsFor(ctx, null);
        if ((m = new RegExp("\\b(?:on|to|in|from) (" + known + ") calendar\\b").exec(t)))
            tries.push({ rest: t.slice(0, m.index) + "on my calendar" + t.slice(m.index + m[0].length), said: m[1], only: CALENDAR_CMDS });
        // "... in my work account", "... on slack", "... in gmail"
        if ((m = /\s(?:in|on|from|for|of|using|via|through) (?:my |the |our )?((?:[a-z0-9@.&'-]+ ){0,2}[a-z0-9@.&'-]+) (account|inbox|mailbox|workspace|e-?mail account|mail account)$/.exec(t))
            && !/^(?:my|the|our|your|this|that|a|an|new|main|other|whole)$/.test(m[1]))
            tries.push({ rest: t.slice(0, m.index), said: m[1], only: /inbox|mailbox|mail/.test(m[2]) ? ["searchEmail", "readEmail", "emailMark", "emailDelete"]
                                                                  : m[2] === "workspace" ? ["readMessages"] : null });
        if ((m = new RegExp("\\s(?:in|on|from|for|using|via|through|at) (?:my |the )?(" + known + ")(?: account| inbox| app)?$").exec(t)))
            tries.push({ rest: t.slice(0, m.index), said: m[1] });
        // "my slack messages", "my gmail inbox", "my google tasks", "my dropbox files"
        if ((m = new RegExp("\\b(my |the |any |all )?(" + known + ") (e-?mails?|mail|inbox|messages|dms|direct messages|chats|texts|tasks|to-?dos?|to-?do list|list|files|documents|docs)\\b").exec(t)))
            tries.push({ rest: t.slice(0, m.index) + (m[1] || "") + m[3] + t.slice(m.index + m[0].length), said: m[2] });
        // "search my dropbox for invoice", "search dropbox for the budget"
        if ((m = new RegExp("^(search|look through|look in|check) (?:my |the )?(" + known + ") for (.+)$").exec(t)))
            tries.push({ rest: m[1] + " my files for " + m[3], said: m[2] });
        for (var i = 0; i < tries.length; ++i) {
            var x = tries[i], r = parseRest(x.rest.replace(/\s+/g, " ").trim(), ctx);
            if (!r || !ARG[r.command] || (x.only && x.only.indexOf(r.command) < 0)) continue;
            if (!x.only && CALENDAR_CMDS.indexOf(r.command) >= 0 && !knownFor(x.said, ctx, CAPS_OF[r.command])) continue;
            // A word that is no account here and no service, after "on" or "in" ("find budget in documents"): not one.
            if (!x.only && !/ (?:account|inbox|mailbox|workspace)$/.test(t) && !knownFor(x.said, ctx, CAPS_OF[r.command])) continue;
            if (r.args[ARG[r.command]]) continue;
            r.args[ARG[r.command]] = cased(x.said, ctx);
            return r;
        }
        return null;
    }
    // The words name a service or an account that can do it.
    function knownFor(said, ctx, caps) {
        var s = String(said || "").toLowerCase();
        return new RegExp("^(?:" + wordsFor(ctx, caps) + ")$").test(s);
    }
    function scoped(command) {
        var f = function (t, ctx) {
            var r = scopedParse(t, ctx);
            return r && r.command === command ? r.args : null;
        };
        f.synergy = true;
        return f;
    }
    function mark(f) { f.synergy = true; return f; }

    var RULES = [
        ["accounts", mark(accounts)],
        ["shareLocation", mark(shareLocation)],
        ["post", mark(post)],
        ["joinMeeting", mark(joinMeeting)],
        ["inviteReply", mark(inviteReply)],
        ["emailDelete", mark(emailDelete)],
        ["emailMark", mark(emailMark)],
        ["saveToDrive", mark(saveToDrive)],
        ["findFiles", mark(findOnDrive)],
        ["eventCalendar", mark(eventCalendar)],
        ["taskList", mark(accountTasks)],
        ["task", mark(addToAccount)]
    ].concat(Object.keys(ARG).map(function (c) { return [c, scoped(c)]; }));

    // Whether a model's choice of these fits the words (lib/lang/en.js grounded).
    var MENTIONS = {
        post: /\b(post|toot|skeet|share|publish|bluesky|mastodon|linkedin|fediverse)\b/,
        joinMeeting: /\b(join|meeting|call|zoom|teams|meet|webex)\b/,
        inviteReply: /\b(accept|decline|maybe|tentative\w*|rsvp|invite|invitation|yes|no)\b/,
        emailMark: /\b(archive|flag|mark|read|unread|star|unstar)\b/,
        emailDelete: /\b(delete|trash|remove|bin)\b/,
        saveToDrive: /\b(save|upload|copy|back ?up|drive|dropbox|box|nextcloud|owncloud|cloud)\b/,
        eventCalendar: /\bcalendar\b/,
        shareLocation: /\b(location|where i am|where i'm|eta|e\.t\.a|arriv\w*|when i'll|when i will|position|whereabouts)\b/
    };

    // ---- What is said ----------------------------------------------------------------------------
    function about(seconds) {
        var mins = Math.max(1, Math.round(seconds / 60));
        if (mins < 60) return "about " + plural(mins, "minute");
        var hrs = Math.floor(mins / 60), rest = Math.round((mins % 60) / 5) * 5;
        return "about " + plural(hrs, "hour") + (rest ? " " + rest + " minutes" : "");
    }
    var say = {
        // Accounts
        accountsList: function (items) {
            if (!items.length) return "You have no accounts connected yet. Add one in Accounts.";
            return "You have " + plural(items.length, "account") + ": " + items.map(function (a) { return a.label + (a.does ? " for " + a.does : ""); }).join("; ") + ".";
        },
        capabilityWords: function (caps) {
            var W = { CONTACTS: "contacts", CALENDAR: "calendar", TASKS: "tasks", MAIL: "email", MESSAGING: "messages", DOCUMENTS: "files", SOCIAL: "posts",
                      MEMOS: "memos", PHONE: "calls", FEEDS: "news", PHOTO: "photos" };
            var out = [];
            caps.forEach(function (c) { var w = W[c]; if (w && out.indexOf(w) < 0) out.push(w); });
            return list(out);
        },
        noAccountFor: function (said) {
            var svc = serviceOf(said);
            if (svc && svc.none) return "I can't reach " + svc.name + ": " + svc.none + ".";
            if (svc) return "You're not signed in to " + svc.name + ". Add the account in Accounts first.";
            return "You don't have an account called " + quote(said) + ". Add it in Accounts first.";
        },
        // An account that does other things ("my gmail" for a Google account with no email here).
        notOn: function (name, capability) {
            var what = { MAIL: "email", CALENDAR: "a calendar", TASKS: "tasks", DOCUMENTS: "files", MESSAGING: "messages" }[capability] || "that";
            return "Your " + name + " account doesn't bring " + what + " to Phoenix.";
        },
        whichAccount: function (labels) { return "Which account: " + list(labels, "or") + "?"; },
        whichNetwork: function (labels) { return "On " + list(labels, "or") + "?"; },
        cantDo: function (account, what) { return account + " can't " + what + "."; },
        // Messages
        confirmChatAs: function (who, message, net, as) { return "Send \"" + message + "\" to " + who + " on " + net + (as ? " as " + as : "") + "?"; },
        whatToSayOn: function (name, net) { return "What should I say to " + name + " on " + net + "?"; },
        noConversation: function (who, net) { return "I couldn't find a conversation called " + quote(who) + (net ? " on " + net : "") + "."; },
        imMessages: function (msgs, unread, label, now) {
            var where = label ? label + " " : "";
            if (!msgs.length) return unread ? "You have no new " + where + "messages." : "You have no " + where + "messages.";
            var first = msgs.slice(0, 3).map(function (m) { return m.from + (m.net && !label ? " on " + m.net : "") + ": " + quote(h.excerpt(m.text, 120)); });
            return (unread ? "You have " + plural(msgs.length, "new " + where + "message") + ". " : "") + first.join("; ") + (msgs.length > 3 ? "; and " + (msgs.length - 3) + " more" : "") + ".";
        },
        // Where you are, when you'll be there
        shareWithWhom: function (eta) {
            return eta ? "Who to? Say it with the name, like “send my ETA to Sam”." : "Who to? Say it with the name, like “share my location with Sam”.";
        },
        whereTo: function () { return "Where are you going? Say it with the place, like “send Sam my ETA to the airport”."; },
        noPlaceSaved: function (place) {
            return "I don't know where " + (place === "home" || place === "work" ? place : "that") + " is. Say the place, like “send Sam my ETA to the airport”.";
        },
        locationMessage: function (link) { return "I'm here: " + link; },
        locationReady: function () { return "I can see where you are now. Ask me again to send it."; },
        etaMessage: function (place, seconds, at) {
            return "On my way to " + place + ", there around " + h.timeText(at) + " (" + about(seconds) + " from here).";
        },
        // Naming the account it goes on (or a text).
        confirmShare: function (eta, who, net, place, at) {
            if (eta) return (net ? "Tell " + who + " on " + net : "Text " + who) + " that you'll be at " + place + " around " + h.timeText(at) + "?";
            return (net ? "Send your location to " + who + " on " + net : "Text your location to " + who) + "?";
        },
        // Calendars
        noCalendarCalled: function (said, names) {
            return "You don't have a calendar called " + quote(said) + (names.length ? ". Your calendars: " + list(names) : "") + ".";
        },
        calendarReadOnly: function (name) { return "Your " + name + " calendar is read only: I can't add to it."; },
        onCalendar: function (text, name) {
            if (/\byour calendar\b/.test(text)) return text.replace(/\byour calendar\b/, "your " + name + " calendar");
            return text.replace(/^(.+?) you have /, "$1 on your " + name + " calendar you have ");
        },
        movedToCalendar: function (title, name) { return "Moved " + quote(title) + " to your " + name + " calendar."; },
        alreadyOnCalendar: function (title, name) { return quote(title) + " is already on your " + name + " calendar."; },
        // Meetings
        joining: function (title, service) { return "Joining " + quote(title) + " on " + service + "."; },
        meetingLater: function (title, service, start, now) { return quote(title) + " on " + service + " is " + h.whenText(start, null, false, now) + ". Join it now?"; },
        joinNow: function () { return "Join Now"; },
        noMeetingLink: function (query) { return query ? "I couldn't find a meeting " + quote(query) + " with a link to join." : "You have no meetings with a link to join today."; },
        // Invitations
        confirmInvite: function (response, title, start, allDay, organizer, account, now) {
            var verb = { accepted: "Accept", declined: "Decline", tentative: "Say maybe to" }[response];
            return verb + " " + quote(title) + " (" + h.whenText(start, null, allDay, now) + ")" + (organizer ? " from " + organizer : "") +
                (account ? " on your " + account + " calendar" : "") + "? " + (organizer ? organizer.split(" ")[0] : "The organizer") + " will be told.";
        },
        inviteAnswered: function (response, title, account) {
            var did = { accepted: "Accepted", declined: "Declined", tentative: "Said maybe to" }[response];
            return did + " " + quote(title) + "." + (account ? " The organizer is told when your " + account + " account syncs." : "");
        },
        inviteEmail: function (response, subject) {
            return ({ accepted: "Accepted", declined: "Declined", tentative: "Said maybe to" }[response]) + " " + quote(subject) + ": the reply goes out with your email.";
        },
        noInvites: function () { return "You have no invitations to answer."; },
        notAGuest: function (title) { return quote(title) + " isn't an invitation to you: you're not one of its guests."; },
        alreadyAnswered: function (title, response) {
            return "You've already " + ({ accepted: "accepted", declined: "declined", tentative: "said maybe to" }[response]) + " " + quote(title) + ".";
        },
        // Email
        confirmEmailDelete: function (subject, from, account) {
            return "Delete " + quote(subject || "(no subject)") + (from ? " from " + from : "") + (account ? " in " + account : "") + "?";
        },
        emailDeleted: function (subject, n) { return n > 1 ? "Deleted " + n + " emails." : "Deleted " + quote(subject || "(no subject)") + "."; },
        emailMarked: function (action, subject, n) {
            var what = n > 1 ? plural(n, "email") : quote(subject || "(no subject)");
            return { read: "Marked " + what + " as read.", unread: "Marked " + what + " as unread.", flag: "Flagged " + what + ".",
                     unflag: "Took the flag off " + what + ".", archive: "Archived " + what + "." }[action];
        },
        noArchive: function (account) { return "Your " + account + " account has no Archive folder. Open Email to move it."; },
        whichEmail: function () { return "Which email? Say who it's from, like “archive the email from Alex”."; },
        nothingToMark: function (action) { return action === "read" ? "You have no unread email." : "There's no email like that."; },
        inMailbox: function (text, label) { return "In " + label + ": " + text.charAt(0).toLowerCase() + text.slice(1); },
        noMailAccountCalled: function (said, labels) {
            return "You don't have an email account called " + quote(said) + (labels.length ? ". Your email accounts: " + list(labels) : "") + ".";
        },
        // Tasks
        noListIn: function (name, account, lists) {
            return account + " has no list called " + quote(name) + (lists.length ? ". Its lists: " + list(lists) : "") + ".";
        },
        tasksIn: function (account, items) {
            if (!items.length) return "There's nothing on " + account + ".";
            var shown = items.slice(0, 8).map(quote);
            return cap(account) + ": " + list(shown) + (items.length > 8 ? ", and " + (items.length - 8) + " more" : "") + ".";
        },
        // Posting
        confirmPost: function (label, as, text, audience) {
            return "Post to " + label + (as ? " as " + as : "") + ": " + quote(text) + "?" + (audience ? " " + audience : "");
        },
        posted: function (label) { return "Posted to " + label + "."; },
        openPost: function () { return "Open Post"; },
        postTooLong: function (label, n, max) { return "That's " + n + " characters, and " + label + " takes " + max + ". Say it shorter?"; },
        whatToPost: function (label) { return "What should the post on " + label + " say?"; },
        noPostAccount: function () { return "You have no account to post to. Add Bluesky, the Fediverse or LinkedIn in Accounts."; },
        cantPostTo: function (label) { return label + " doesn't take posts from Phoenix."; },
        postFailed: function (label, why) { return "I couldn't post to " + label + (why ? ": " + why : "") + "."; },
        // Drives
        filesOn: function (text, drive) { return text.replace(/\.$/, "") + " on " + drive + "."; },
        noFilesOn: function (q, drive) { return "I couldn't find " + quote(q) + " on " + drive + "."; },
        confirmUpload: function (name, drive) { return "Upload " + quote(name) + " to " + drive + "?"; },
        uploaded: function (name, drive) { return "Uploaded " + quote(name) + " to " + drive + "."; },
        uploadFailed: function (name, drive, why) { return "I couldn't upload " + quote(name) + " to " + drive + (why ? ": " + why : "") + "."; },
        whichFile: function () { return "Which file? Find it first, like “find my file called budget”."; },
        noFileCalled: function (q) { return "I couldn't find a file called " + quote(q) + " on this device."; }
    };

    return { RULES: RULES, MENTIONS: MENTIONS, say: say, SERVICES: SERVICES, serviceOf: serviceOf, canon: canon, chatWords: chatWords, wordsFor: wordsFor };
};
module.exports.SERVICES = SERVICES;
module.exports.serviceOf = serviceOf;
module.exports.canon = canon;
