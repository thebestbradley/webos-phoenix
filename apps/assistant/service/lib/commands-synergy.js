// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Assistant on what is connected through Synergy (lib/synergy.js
// finds the accounts and what they can do; docs/AI-AND-MCP.md "The
// Assistant and Synergy"). Every command works on every account of the
// kind, found when asked, so a connector installed later works without a
// change here:
//
//   text          on any messaging account ("text Sam on Slack", "message
//                 the #design channel on Slack: ..."): the account's
//                 message kind (dbkinds.immessage) in the outbox, from its
//                 user name, as Messaging sends (@phoenix/luna messaging.ts
//                 sendIm); with no account named, as Messaging would: the
//                 network of the person's latest conversation, else a text,
//                 else their one network; with several, asked which
//   readMessages  texts and every account's messages (com.palm.immessage:1),
//                 or one account's ("read my unread Slack messages")
//   agenda, freeTime, event   one calendar or one account's ("my work
//                 calendar", "add it to my Google calendar"); a new event in
//                 the account's own event kind
//   eventCalendar an event moved to another calendar
//   joinMeeting   the meeting's address in the event (Zoom, Teams, Meet,
//                 Webex, Jitsi), opened
//   inviteReply   accept, decline, maybe: the user's attendee entry on the
//                 event (its connector tells the organizer), or an email
//                 invitation's meetingInfo.response as the Email app sets it
//                 (com.palm.app.email MessageDisplay.js:461-500)
//   task, taskList   one account's lists ("add milk to my Todoist shopping
//                 list", "what's on my Microsoft To Do")
//   searchEmail, readEmail   one email account's mail ("in my work account")
//   emailMark     archive (moved to the account's Archive folder as Email
//                 moves mail: destFolderId and hidden, facades/Email.js:235-241),
//                 read, unread, flag, unflag (Email.js setEmailFlags; the
//                 transport sends the change on)
//   emailDelete   read back, then deleted as Email deletes (Email.js:244-262,
//                 MessagePane.js:284)
//   post          to an account's share target (appinfo.json
//                 shareTargets[].connector) through its service's share
//                 method, read back naming the account
//   findFiles, saveToDrive   a drive's files (/media/drives/<accountId>)
//                 through the file manager; an upload read back
//   accounts      which accounts are connected, and what each does
//
// Made by lib/commands.js with the helpers it shares: require("./commands-synergy")(h).

"use strict";

var S = require("./synergy");

var MESSAGING_APP = "org.webosphoenix.messaging";
var CALENDAR_APP = "com.palm.app.calendar";
var TASKS_APP = "org.webosphoenix.tasks";
var EMAIL_APP = "com.palm.app.email";
var FILES_APP = "org.webosphoenix.files";
var ACCOUNTS_APP = "com.palm.app.accounts";
var DB = "luna://com.palm.db/";
var FILES = "luna://org.webosphoenix.filemanager/";
var PUT_MESSAGE = "luna://org.webosports.service.messaging/putMessage";

var STR = { type: "string" }, BOOL = { type: "boolean" };
var COMMANDS = [
    { id: "post", title: "Posting (Bluesky, the Fediverse, LinkedIn, ...)", risk: "send",
      description: "Post to a social account the user has (Bluesky, the Fediverse or Mastodon, LinkedIn, ...); read back first, naming the account.",
      parameters: { type: "object", properties: { service: { type: "string", description: "The account or service as said (\"Bluesky\", \"Mastodon\"); empty if none was said" },
                                                  text: { type: "string", description: "The words to post" }, it: BOOL } } },
    { id: "joinMeeting", title: "Joining meetings", risk: "open",
      description: "Join a meeting (Zoom, Teams, Google Meet, Webex, Jitsi) from the link in its calendar event: the one now or next, or one by name.",
      parameters: { type: "object", properties: { query: { type: "string", description: "The meeting's name; empty for the next one" },
                                                  service: { type: "string", enum: ["", "zoom", "teams", "meet", "webex", "jitsi"] } } } },
    { id: "inviteReply", title: "Answering invitations", risk: "send",
      description: "Accept, decline or say maybe to a meeting invitation; the organizer is told.",
      parameters: { type: "object", properties: { response: { type: "string", enum: ["accepted", "declined", "tentative"] },
                                                  query: { type: "string", description: "The meeting's name" }, from: { type: "string", description: "Who invited the user" },
                                                  it: BOOL }, required: ["response"] } },
    { id: "emailMark", title: "Archiving, flagging and marking email", risk: "change",
      description: "Archive an email, flag or unflag it, or mark it read or unread (all: every unread one).",
      parameters: { type: "object", properties: { action: { type: "string", enum: ["archive", "read", "unread", "flag", "unflag"] },
                                                  from: { type: "string", description: "Who the email is from" }, query: { type: "string", description: "Words of its subject" },
                                                  it: BOOL, all: BOOL, account: { type: "string", description: "The email account, as said" } }, required: ["action"] } },
    { id: "emailDelete", title: "Deleting email", risk: "delete", description: "Delete an email (read back first).",
      parameters: { type: "object", properties: { from: STR, query: STR, it: BOOL, account: STR } } },
    { id: "saveToDrive", title: "Saving files to cloud drives", risk: "send",
      description: "Upload a file to a cloud drive the user has (Dropbox, Google Drive, OneDrive, Box, Nextcloud, ...); read back first.",
      parameters: { type: "object", properties: { file: { type: "string", description: "The file's name; empty with it" }, drive: { type: "string", description: "The drive as said" },
                                                  it: BOOL }, required: ["drive"] } },
    { id: "eventCalendar", title: "Moving events between calendars", risk: "change",
      description: "Move an event to another calendar or another account's calendar (\"add it to my Google calendar\").",
      parameters: { type: "object", properties: { query: STR, it: BOOL, calendar: { type: "string", description: "The calendar or account as said (\"Google\", \"work\")" } },
                    required: ["calendar"] } },
    { id: "accounts", title: "Your accounts", risk: "read", description: "Tell which accounts are connected through Synergy and what each does.",
      parameters: { type: "object", properties: {} } },
    { id: "shareLocation", title: "Sharing where you are", risk: "send",
      description: "Send someone where the user is (a map link) or when they'll get somewhere (their ETA), by text or on any messaging account; read back first.",
      parameters: { type: "object", properties: { who: { type: "string", description: "Who to send it to" },
                                                  via: { type: "string", description: "The messaging account or network, as said (\"Slack\"); empty for the person's usual one" },
                                                  eta: { type: "boolean", description: "When the user will arrive, rather than where they are" },
                                                  place: { type: "string", description: "Where the user is going, for the ETA" } }, required: ["who"] } }
];
// How people ask for each, in other words (as lib/examples.js has the others'): for a model choosing one.
var EXAMPLES = {
    post: ["put this on my Bluesky: back online", "send a toot saying good morning", "share on LinkedIn that we're hiring"],
    joinMeeting: ["get me into my Zoom meeting", "connect me to the stand-up", "jump on my next call"],
    inviteReply: ["yes to the invite from Alex", "turn down the offsite invitation", "tell them maybe for the planning meeting"],
    emailMark: ["move that email to the archive", "mark Priya's email unread", "star the email from Sofia"],
    emailDelete: ["throw away the email from Alex", "get rid of Priya's last email"],
    saveToDrive: ["put the budget file on my Dropbox", "back this up to Google Drive"],
    eventCalendar: ["put that on my work calendar instead", "switch the dentist appointment over to my Google calendar"],
    accounts: ["which accounts have I added", "show the accounts on this phone"],
    shareLocation: ["let Sam see where I am", "message Priya my ETA to the station on Telegram"]
};
COMMANDS.forEach(function (c) { c.examples = EXAMPLES[c.id]; });
// The account each existing command may be given (lib/commands.js BUILT_IN), for the models too.
var ACCOUNT_ARGS = {
    readMessages: { via: { type: "string", description: "The messaging account or network, as said (\"Slack\", \"Telegram\"); empty for all" } },
    agenda: { calendar: { type: "string", description: "A calendar's name or an account, as said (\"work\", \"Google\"); empty for all" } },
    freeTime: { calendar: { type: "string", description: "A calendar or account, as said; empty for all" } },
    event: { calendar: { type: "string", description: "The calendar or account to put it in, as said (\"Google\", \"work\"); empty for the default" } },
    task: { account: { type: "string", description: "The tasks account, as said (\"Todoist\", \"Microsoft To Do\"); empty for the list's own" } },
    taskList: { account: { type: "string", description: "The tasks account, as said; empty for all" } },
    searchEmail: { account: { type: "string", description: "The email account, as said (\"work\", \"Gmail\"); empty for all" } },
    readEmail: { account: { type: "string", description: "The email account, as said; empty for all" } },
    findFiles: { drive: { type: "string", description: "A cloud drive, as said (\"Dropbox\", \"Google Drive\"); empty for this device" } }
};
// The text command (lib/commands.js BUILT_IN): what shareLocation sends by.
var TEXT = null;
function extend(builtIn) {
    builtIn.forEach(function (c) {
        if (c.id === "text") {
            TEXT = c;
            c.description = "Send a text message (SMS) to a contact, or a message on any messaging account the user has (Slack, Jabber, Matrix, Telegram, Bluesky, the Fediverse, ...), to a person or a group conversation (\"#design\").";
            c.parameters.properties.via = { type: "string", description: "The messaging account or network, as said (\"Slack\", \"Telegram\"); empty for a text message or the person's usual one" };
        }
        var more = ACCOUNT_ARGS[c.id];
        if (more) Object.keys(more).forEach(function (k) { c.parameters.properties[k] = more[k]; });
    });
}

// What a model puts for an argument it has nothing for.
var NOTHING = /^(?:none|null|nil|undefined|n\/a)$/i;
function lower(s) { return String(s || "").toLowerCase().trim(); }
function unique(list) { return list.filter(function (x, i) { return x && list.indexOf(x) === i; }); }

module.exports = function (h) {
    var D = h.D;

    function canonOf(env) { return env.lang.synergy ? env.lang.synergy.canon : null; }
    function noAccount(env, said) { return env.lang.say.noAccountFor(String(said || "")); }
    // Why no account fits: one by that name does other things, or there is none.
    function missing(env, said, capability) {
        return S.accounts(env).then(function (all) {
            var a = S.named(all, said, canonOf(env)).filter(function (x) { return !S.capIn(x, capability); })[0];
            return a ? env.lang.say.notOn(a.name, capability) : noAccount(env, said);
        });
    }
    // The accounts the words name among these, by their names or the service's.
    function namedAmong(env, list, said) { return S.named(list, said, canonOf(env)); }
    // An account a choice named exactly ("Slack (Northwind)"), else by its words.
    function chosen(env, items, said, labelOf) {
        var s = lower(said);
        var exact = items.filter(function (x) { return lower(labelOf(x)) === s; });
        if (exact.length) return exact;
        var accts = namedAmong(env, unique(items.map(function (x) { return x.account; })), said);
        var byAcct = items.filter(function (x) { return accts.indexOf(x.account) >= 0; });
        if (byAcct.length) return byAcct;
        return items.filter(function (x) { return h.matches(labelOf(x), said); });
    }
    function askWhich(args, field, command, labels, text) {
        return { args: args, reply: text, awaiting: { command: command, args: args, field: field, options: labels } };
    }
    // The env with db8 finds of some kinds narrowed, and some calls' parameters added to.
    function scoped(env, opts) {
        var luna = env.luna;
        return Object.assign({}, env, { luna: Object.assign({}, luna, { call: function (uri, p) {
            if (opts.params && opts.params[uri]) p = opts.params[uri](p || {});
            return Promise.resolve(luna.call(uri, p)).then(function (r) {
                if (uri === DB + "find" && r && Array.isArray(r.results) && opts.find && opts.find[p.query.from])
                    r = Object.assign({}, r, { results: r.results.filter(opts.find[p.query.from]) });
                if (opts.seen) opts.seen(uri, p, r);
                return r;
            });
        } }) });
    }
    // The original command, the account's part done.
    function plain(env) { return Object.assign({}, env, { __synergyDone: true }); }

    // ---- Messages -------------------------------------------------------------------------------

    function channelName(who) {
        var w = lower(who).replace(/^(?:the|my|our) /, "");
        var m = /^(#[^\s]+)(?: (?:channel|room|group|chat))?$/.exec(w) || /^([^\s#]+(?: [^\s]+)?) (?:channel|room|group chat|group)$/.exec(w);
        return m ? (m[1].charAt(0) === "#" ? m[1] : "#" + m[1].replace(/\s+/g, "-")) : "";
    }
    function threadNamed(t, name) {
        var n = lower(name).replace(/^#/, ""), d = lower(t.displayName).replace(/^#/, ""), a = lower(t.replyAddress).replace(/^#/, "").replace(/@.*$/, "");
        return !!n && (d === n || a === n || d.replace(/[\s_-]+/g, "") === n.replace(/[\s_-]+/g, ""));
    }
    function looksLikeAddress(who) { return /^[@+#]|@[^\s]+\.|^[^\s@]+@[^\s@]+$/.test(String(who || "").trim()); }
    // A person's address on a network: their card's (ims), else their conversation's there.
    function addressOn(p, net, threads) {
        var im = (p.ims || []).filter(function (x) { return x.type === net.service && x.value; })[0];
        if (im) return { addr: im.value };
        var th = threads.filter(function (t) { return t.personId === p._id && t.replyService === net.service && t.replyAddress; })[0];
        return th ? { addr: th.replyAddress, threadId: th._id } : null;
    }
    // args.chat: the network, account and address a message goes to; or why not; or which.
    // person: the contact, when already found; sms: they have a number (a text unless a
    // conversation says otherwise).
    function chatTarget(env, cmd, args, person, sms) {
        var say = env.lang.say, who = String(args.who || "").trim(), via = String(args.via || "").trim();
        return Promise.all([S.imAccounts(env), S.threads(env)]).then(function (got) {
            var ims = got[0], threads = got[1], nets = ims;
            if (via) {
                nets = chosen(env, ims, via, function (x) { return x.shown; });
                if (!nets.length) nets = ims.filter(function (x) { return h.matches(x.label, via) || S.squash(x.label) === S.squash(via); });
                if (!nets.length) return S.squash(via) === "sms" ? { args: args, reply: say.noSuchContact(who) }
                    : missing(env, via, "MESSAGING").then(function (why) { return { args: args, reply: why }; });
            }
            function target(net, addr, name, extra) {
                args.chat = Object.assign({ service: net.service, kind: net.kind, label: net.shown, username: net.username, addr: addr, accountId: net.account.id,
                                            as: net.several ? net.username : "" }, extra || {});
                args.name = name;
                if (!String(args.message || "").trim() && !args.compose)
                    return { args: args, reply: say.whatToSayOn(name || addr, net.shown), awaiting: { command: "text", args: args, field: "message" } };
                return h.withConfirm(cmd, args, env);
            }
            // A group conversation: "#design", "the design channel".
            var chan = channelName(who);
            if (chan || (via && !person && !looksLikeAddress(who))) {
                var rooms = threads.filter(function (t) { return nets.some(function (n) { return n.service === t.replyService; }) && t.replyAddress && threadNamed(t, chan || who); });
                var services = unique(rooms.map(function (t) { return t.replyService; }));
                if (rooms.length && services.length > 1) {
                    var labels = services.map(function (s) { return nets.filter(function (n) { return n.service === s; })[0].shown; });
                    return askWhich(args, "via", "text", labels, say.whichNetwork(labels));
                }
                if (rooms.length) {
                    var room = rooms[0], onIt = nets.filter(function (n) { return n.service === room.replyService; });
                    if (onIt.length > 1) return askWhich(args, "via", "text", onIt.map(function (n) { return n.shown; }), say.whichAccount(onIt.map(function (n) { return n.shown; })));
                    return target(onIt[0], room.replyAddress, room.displayName || chan, { threadId: room._id });
                }
                if (chan) return { args: args, reply: say.noConversation(chan, via ? nets[0].label : "") };
            }
            // An address on the network said ("@priya:matrix.example").
            if (via && nets.length === 1 && looksLikeAddress(who)) return target(nets[0], who, "");
            var found = person ? Promise.resolve([person]) : h.findPeople(env, who);
            return found.then(function (list) {
                var p = list[0], several = h.ambiguous(list);
                if (several) return { args: args, reply: say.whichPerson(several), awaiting: { command: cmd.id, args: args, field: "who", options: several } };
                if (!p) return { args: args, reply: say.noSuchContact(who) };
                var name = h.personName(p) || who;
                args.personId = p._id;
                var on = nets.map(function (n) { var a = addressOn(p, n, threads); return a ? { net: n, at: a } : null; }).filter(Boolean);
                if (via) {
                    if (!on.length) return { args: args, reply: say.noChatAddress(name, nets[0].label) };
                    if (on.length > 1) return askWhich(args, "via", "text", on.map(function (x) { return x.net.shown; }), say.whichAccount(on.map(function (x) { return x.net.shown; })));
                    return target(on[0].net, on[0].at.addr, name, on[0].at.threadId ? { threadId: on[0].at.threadId } : null);
                }
                // As Messaging would: the network of the latest conversation with them.
                var latest = threads.filter(function (t) { return t.personId === p._id && t.replyService; })[0];
                var there = latest && ims.filter(function (n) { return n.service === latest.replyService; });
                if (latest && there.length === 1 && latest.replyAddress) return target(there[0], latest.replyAddress, name, { threadId: latest._id });
                if (sms) return null;
                if (!on.length) return { args: args, reply: say.noNumber(name) };
                if (on.length > 1) return askWhich(args, "via", "text", on.map(function (x) { return x.net.shown; }), say.whichNetwork(on.map(function (x) { return x.net.shown; })));
                return target(on[0].net, on[0].at.addr, name, on[0].at.threadId ? { threadId: on[0].at.threadId } : null);
            });
        });
    }
    function sendChat(env, args) {
        var say = env.lang.say, c = args.chat, now = env.now(), name = args.name || c.addr;
        var message = { _kind: c.kind, folder: "outbox", status: "pending", serviceName: c.service, username: c.username,
                        messageText: String(args.message), to: [{ addr: c.addr, name: args.name || "" }],
                        localTimestamp: now, timestamp: now, flags: { visible: true, read: true } };
        if (c.threadId) message.conversations = [c.threadId];
        if (!String(args.message || "").trim()) {
            var params = { compose: { ims: [{ value: c.addr, type: c.service }], personId: args.personId || "" } };
            return h.launch(env, MESSAGING_APP, params)
                .then(function () { return { text: say.composing(name), open: { appId: MESSAGING_APP, params: params, title: "Messaging" } }; });
        }
        return h.lunaCall(env, PUT_MESSAGE, { message: message }).then(function (r) {
            var thread = (r && r.threadids && r.threadids[0]) || c.threadId || "";
            return { text: say.sentChat(name, c.label), open: { appId: MESSAGING_APP, params: thread ? { threadId: thread } : {}, title: "Messaging" } };
        });
    }

    // Texts and every account's messages, newest first; or one account's.
    function readMessages(args, env) {
        var say = env.lang.say, now = env.now(), via = String(args.via || "").trim(), who = String(args.who || "").trim();
        return Promise.all([S.find(env, "com.palm.immessage:1"), S.imAccounts(env), S.threads(env)]).then(function (got) {
            var ims = got[1], threads = got[2];
            var im = got[0].filter(function (m) { return m.folder === "inbox" && (!m.flags || m.flags.visible !== false); });
            if (!via && !im.length) return null;
            var nets = ims;
            if (via) {
                nets = chosen(env, ims, via, function (x) { return x.shown; });
                if (!nets.length) nets = ims.filter(function (x) { return h.matches(x.label, via); });
                if (!nets.length) return missing(env, via, "MESSAGING").then(function (why) { return { text: why }; });
                im = im.filter(function (m) {
                    return nets.some(function (n) { return n.service === m.serviceName && (!n.several || !m.username || m.username === n.username); });
                });
            }
            var labelOf = function (m) { var n = ims.filter(function (x) { return x.service === m.serviceName; })[0]; return n ? n.label : ""; };
            var sms = via ? Promise.resolve([]) : S.find(env, "com.palm.smsmessage:1");
            return Promise.all([sms, h.people(env)]).then(function (more) {
                var all = more[1];
                var texts = more[0].filter(function (m) { return m.folder === "inbox" && (!m.flags || m.flags.visible !== false); });
                var finding = who ? h.findPerson(env, who) : Promise.resolve(null);
                return finding.then(function (p) {
                    var room = who && !p ? threads.filter(function (t) { return threadNamed(t, channelName(who) || who); })[0] : null;
                    if (who && !p && !room) return { text: say.noSuchContact(who) };
                    var theirs = function (m) {
                        if (room) return (m.conversations || []).indexOf(room._id) >= 0 || (m.from && (m.from.addr === room.replyAddress));
                        if (!p) return true;
                        var addr = m.from && m.from.addr;
                        if (m.serviceName && /^type_/.test(m.serviceName))
                            return (p.ims || []).some(function (x) { return x.value === addr; }) ||
                                threads.some(function (t) { return t.personId === p._id && (m.conversations || []).indexOf(t._id) >= 0; });
                        return (p.phoneNumbers || []).some(function (n) { return addr && h.samePhone(n.value, addr); });
                    };
                    var msgs = texts.concat(im).filter(theirs).sort(function (a, b) { return (b.localTimestamp || b.timestamp || 0) - (a.localTimestamp || a.timestamp || 0); });
                    var nameOf = function (m) {
                        if (!m.from) return "Someone";
                        var person = all.filter(function (x) { return (x.ims || []).some(function (i) { return i.value === m.from.addr; }); })[0];
                        return (person && h.personName(person)) || m.from.name || h.nameForPhone(all, m.from.addr) || m.from.addr || "Someone";
                    };
                    var unread = args.unread ? msgs.filter(function (m) { return m.flags && m.flags.read === false; }) : null;
                    var shownLabel = via ? nets[0].label : "";
                    var threadOf = function (m) {
                        var t = (m.conversations || [])[0] || m.threadId;
                        return { appId: MESSAGING_APP, params: t ? { threadId: t } : {}, title: "Messaging" };
                    };
                    if (unread && !unread.length) return { text: say.imMessages([], true, shownLabel, now), open: { appId: MESSAGING_APP, params: {}, title: "Messaging" } };
                    var list = unread || msgs.slice(0, 1);
                    if (!list.length) return { text: p ? say.noMessagesFrom(h.personName(p)) : say.imMessages([], false, shownLabel, now) };
                    var first = list[0], fromFirst = nameOf(first), netFirst = labelOf(first);
                    var text = unread ? say.imMessages(unread.map(function (m) { return { from: nameOf(m), net: labelOf(m), text: m.messageText || "" }; }), true, shownLabel, now)
                        : say.lastMessage(fromFirst + (netFirst ? " on " + netFirst : ""), first.messageText || "", first.localTimestamp || first.timestamp, now);
                    var replyTo = room ? room.displayName || who : fromFirst;
                    var reply = netFirst ? { command: "text", args: { who: replyTo, via: netFirst, message: "" } } : { command: "replyMessage", args: { message: "", ask: true } };
                    return { text: text, open: threadOf(first), actions: [{ label: say.replyTo(replyTo), run: reply }],
                             attachments: h.cards(list.map(function (m) {
                                 return { title: nameOf(m), subtitle: [h.whenShown(env, m.localTimestamp || m.timestamp, null, false), labelOf(m)].filter(Boolean).join(" · "),
                                          detail: m.messageText || "", open: threadOf(m) };
                             })) };
                });
            });
        });
    }

    // ---- Calendars ------------------------------------------------------------------------------

    // The calendars the words name: by the calendar's name, else by its account's.
    function calendarsNamed(env, said) {
        var s = lower(said).replace(/\s+calendars?$/, "");
        return S.calendars(env).then(function (cals) {
            var byName = cals.filter(function (c) { return h.words(c.calendar.name) === h.words(s); });
            if (byName.length) return { hits: byName, name: byName[0].calendar.name, all: cals };
            var accts = namedAmong(env, unique(cals.map(function (c) { return c.account; })), s);
            var hits = cals.filter(function (c) { return c.account && accts.indexOf(c.account) >= 0; });
            if (!hits.length && /^(?:local|device|phone|tablet|phoenix|phoenix account|own|personal)$/.test(s))
                hits = cals.filter(function (c) { return c.calendar.syncSource === "Local" || (c.account && c.account.templateId === "com.palm.palmprofile"); });
            if (!hits.length) hits = cals.filter(function (c) { return h.matches(c.calendar.name, s); });
            var name = hits.length && hits[0].account && accts.indexOf(hits[0].account) >= 0 ? hits[0].account.name : hits.length ? hits[0].calendar.name : said;
            return { hits: hits, name: name, all: cals };
        });
    }
    // The one a new event goes in: of those named, one that takes events: the
    // account's own (its name is the account's user name, or "Calendar"), else the first.
    function writableOf(found) {
        var w = found.hits.filter(function (c) { return c.writable; });
        if (!w.length) return null;
        var a = w[0].account;
        return w.filter(function (c) { return a && lower(c.calendar.name) === lower(a.username); })[0] || w.filter(function (c) { return c.calendar.isDefault || c.calendar.primary; })[0]
            || w.filter(function (c) { return /^calendar$/i.test(c.calendar.name || ""); })[0] || w[0];
    }
    function calendarFor(env, args, writing) {
        var say = env.lang.say;
        return calendarsNamed(env, args.calendar).then(function (found) {
            if (!found.hits.length) {
                var svc = env.lang.synergy && env.lang.synergy.serviceOf(args.calendar);
                if (svc) return missing(env, args.calendar, "CALENDAR").then(function (why) { return { reply: why }; });
                return { reply: say.noCalendarCalled(args.calendar, found.all.map(function (c) { return c.calendar.name; }).filter(Boolean)) };
            }
            if (!writing) return { ids: found.hits.map(function (c) { return c.calendar._id; }), name: found.name };
            var w = writableOf(found);
            if (!w) return { reply: say.calendarReadOnly(found.name) };
            return { calendar: w, name: found.name };
        });
    }
    // The calendar a new event goes in, and the kind of its events: the one named, else the
    // first that takes one, the device's own first (the Calendar app's default).
    function pickCalendar(env, id) {
        return S.calendars(env).then(function (cals) {
            if (id) return cals.filter(function (c) { return c.calendar._id === id; })[0] || null;
            var w = cals.filter(function (c) { return c.writable; });
            return w.filter(function (c) { return c.calendar.syncSource === "Local"; })[0] || w[0] || null;
        });
    }
    function onCalendar(out, name, env) {
        if (out && out.text && name) out.text = env.lang.say.onCalendar(out.text, name);
        return out;
    }

    // The event "it" or the words mean.
    function theEvent(env, args) {
        if (args.it || !String(args.query || "").trim()) {
            var f = env.focus;
            if (!f || f.kind !== "event") return Promise.resolve(null);
            return h.dbGet(env, f.id).then(function (ev) {
                if (!ev) return null;
                var now = env.now(), next = D.occurrences(ev, D.startOfDay(now), D.addDays(D.startOfDay(now), 400))[0];
                return { event: ev, title: ev.subject || "(no title)", start: next !== undefined ? next : Number(ev.dtstart) };
            });
        }
        return h.findEvent(env, args.query);
    }
    function eventCalendarPrepare(env, args) {
        var say = env.lang.say;
        return theEvent(env, args).then(function (hit) {
            if (!hit) return { args: args, reply: args.it || !args.query ? say.nothingInFocus() : say.noSuchEvent(args.query) };
            if (hit.ambiguous) return { args: args, reply: say.whichOne(hit.ambiguous) };
            return calendarFor(env, args, true).then(function (c) {
                if (c.reply) return { args: args, reply: c.reply };
                if (hit.event.calendarId === c.calendar.calendar._id) return { args: args, reply: say.alreadyOnCalendar(hit.title, c.name) };
                args.record = hit.event; args.title = hit.title; args.calendarName = c.name;
                args.target = { calendarId: c.calendar.calendar._id, accountId: c.calendar.calendar.accountId || "", kind: c.calendar.eventKind };
                return { args: args };
            });
        });
    }
    function moveEvent(args, env) {
        var say = env.lang.say, old = args.record, now = env.now();
        var copy = Object.assign({}, old, { _kind: args.target.kind, calendarId: args.target.calendarId, accountId: args.target.accountId, lastModified: now });
        ["_id", "_rev", "_del", "_sync", "remoteId", "etag", "uid"].forEach(function (k) { delete copy[k]; });
        return h.dbPut(env, [copy]).then(function (ids) {
            return h.lunaCall(env, DB + "del", { ids: [old._id] }).then(function () {
                var cal = { appId: CALENDAR_APP, params: { showEventDetail: ids[0] }, title: "Calendar" };
                return { text: say.movedToCalendar(args.title, args.calendarName), open: cal,
                         attachments: h.cards([{ title: args.title, subtitle: h.whenShown(env, Number(old.dtstart), old.allDay ? null : Number(old.dtend), !!old.allDay), open: cal }]),
                         undo: { kind: "multi", steps: [{ kind: "db", ids: ids }, { kind: "put", objects: [old] }], what: say.undoWhat.move(args.title) } };
            });
        });
    }

    // ---- Meetings -------------------------------------------------------------------------------
    function joinMeeting(args, env) {
        var say = env.lang.say, now = env.now();
        return Promise.all([h.eventsIn(env, now - 12 * 3600000, D.addDays(D.startOfDay(now), 14)), S.find(env, "com.palm.calendarevent:1")]).then(function (got) {
            var recs = {};
            got[1].forEach(function (e) { recs[e._id] = e; });
            var svc = lower(args.service), q = String(args.query || "").trim();
            var list = got[0].map(function (e) { return Object.assign({ url: S.joinUrlOf(recs[e.id]) }, e); }).filter(function (e) {
                if (!e.url || e.allDay || e.end <= now) return false;
                if (args.eventId) return e.id === args.eventId;
                if (svc && lower(S.meetingService(e.url)).indexOf(svc === "meet" ? "google meet" : svc) < 0) return false;
                return !q || h.matches(e.title + " " + (e.location || ""), q);
            }).sort(function (a, b) { return a.start - b.start; });
            // The one going on (or about to), else the next.
            var e = list.filter(function (x) { return x.start - 10 * 60000 <= now; })[0] || list[0];
            if (!e) return { text: say.noMeetingLink(q || (svc ? svc : "")) };
            var service = S.meetingService(e.url), card = h.eventCard(env, e);
            card.detail = service;
            if (e.start - now > 10 * 60000 && !args.now)
                return { text: say.meetingLater(e.title, service, e.start, now), open: { appId: CALENDAR_APP, params: { showEventDetail: e.id }, title: "Calendar" },
                         attachments: h.cards([card]), actions: [{ label: say.joinNow(), run: { command: "joinMeeting", args: { eventId: e.id, now: true } } }] };
            return h.lunaCall(env, "luna://com.palm.applicationManager/open", { target: e.url }).then(function () {
                return { text: say.joining(e.title, service), attachments: h.cards([card]), data: { url: e.url } };
            });
        });
    }

    // ---- Invitations ----------------------------------------------------------------------------
    var EMAIL_RESPONSE = { accepted: "accept", declined: "decline", tentative: "tentative" };
    var SUBJECT = { accepted: "Accepted: ", declined: "Declined: ", tentative: "Tentative: " };
    function invitePrepare(env, args) {
        var say = env.lang.say, now = env.now();
        var f = env.focus;
        // An email invitation the conversation is about (EAS meeting requests: meetingInfo).
        if ((args.it || (!args.query && !args.from)) && f && f.kind === "email") {
            return h.dbGet(env, f.id).then(function (e) {
                if (!e || !e.meetingInfo || e.meetingInfo.type !== "request") return { args: args, reply: say.noInvites() };
                args.emailId = e._id; args.subject = e.subject || ""; args.meetingInfo = e.meetingInfo;
                return { args: args, confirm: say.confirmInvite(args.response, e.subject || "", Number(e.meetingInfo.startTime) || now, false,
                                                                 e.from ? e.from.name || e.from.addr : "", "", now) };
            });
        }
        return Promise.all([S.ownAddresses(env), S.find(env, "com.palm.calendarevent:1"), S.calendars(env)]).then(function (got) {
            var mine = got[0], cals = {};
            got[2].forEach(function (c) { cals[c.calendar._id] = c; });
            var me = function (ev) { return (ev.attendees || []).filter(function (a) { return a && !a.organizer && a.email && mine[lower(a.email)]; })[0] || null; };
            var organizer = function (ev) { var o = (ev.attendees || []).filter(function (a) { return a && a.organizer; })[0]; return o ? o.commonName || o.email : ""; };
            var next = function (ev) {
                var s = D.occurrences(ev, D.startOfDay(now), D.addDays(D.startOfDay(now), 400))[0];
                return s !== undefined ? s : Number(ev.dtstart);
            };
            var focusEvent = (args.it || (!args.query && !args.from)) && f && f.kind === "event" ? f.id : "";
            var evs = got[1].filter(function (ev) { return next(ev) >= D.startOfDay(now) || focusEvent === ev._id; });
            var pool = evs.filter(function (ev) {
                if (focusEvent) return ev._id === focusEvent;
                if (args.query) return h.matches((ev.subject || "") + " " + (ev.location || ""), args.query);
                if (args.from) return h.matches(organizer(ev), args.from);
                return !!me(ev) && (me(ev).participationStatus || "NEEDS-ACTION") === "NEEDS-ACTION";
            }).sort(function (a, b) { return next(a) - next(b); });
            if (!pool.length) return { args: args, reply: focusEvent || args.query || args.from ? say.noSuchEvent(args.query || args.from || "it") : say.noInvites() };
            var invites = pool.filter(me);
            if (!invites.length) return { args: args, reply: say.notAGuest(pool[0].subject || "(no title)") };
            var waiting = invites.filter(function (ev) { return (me(ev).participationStatus || "NEEDS-ACTION") === "NEEDS-ACTION"; });
            // Several said alike, none named: which (the organizer is told: never a guess).
            var names = unique(invites.map(function (ev) { return ev.subject || "(no title)"; }));
            if (!focusEvent && !args.query && !args.from && names.length > 1)
                return askWhich(args, "query", "inviteReply", names.slice(0, 4), say.whichOne(names));
            var ev = (waiting.length ? waiting : invites)[0], mine1 = me(ev);
            var want = { accepted: "ACCEPTED", declined: "DECLINED", tentative: "TENTATIVE" }[args.response];
            if (mine1.participationStatus === want) return { args: args, reply: say.alreadyAnswered(ev.subject || "(no title)", args.response) };
            var c = cals[ev.calendarId], account = c && c.account && c.account.templateId !== "com.palm.palmprofile" ? c.account.name : "";
            args.eventId = ev._id; args.title = ev.subject || "(no title)"; args.account = account;
            args.oldAttendees = ev.attendees;
            args.attendees = ev.attendees.map(function (a) { return a === mine1 ? Object.assign({}, a, { participationStatus: want }) : a; });
            return { args: args, confirm: say.confirmInvite(args.response, args.title, next(ev), !!ev.allDay, organizer(ev), account, now) };
        });
    }
    function inviteRun(args, env) {
        var say = env.lang.say, now = env.now();
        if (args.emailId) {
            // As Email's Accept / Maybe / Decline (MessageDisplay.js:461-500): the response on the
            // email, which the account's transport sends, and the invitation out of the inbox.
            var mi = Object.assign({}, args.meetingInfo, { response: EMAIL_RESPONSE[args.response], responseSubject: SUBJECT[args.response] + (args.subject || "No Subject") });
            return h.lunaCall(env, DB + "merge", { objects: [{ _id: args.emailId, meetingInfo: mi, flags: { read: true, visible: false } }] })
                .then(function () { return { text: say.inviteEmail(args.response, args.subject), open: { appId: EMAIL_APP, params: {}, title: "Email" } }; });
        }
        return h.lunaCall(env, DB + "merge", { objects: [{ _id: args.eventId, attendees: args.attendees, lastModified: now }] }).then(function () {
            var cal = { appId: CALENDAR_APP, params: { showEventDetail: args.eventId }, title: "Calendar" };
            return { text: say.inviteAnswered(args.response, args.title, args.account), open: cal,
                     undo: { kind: "merge", objects: [{ _id: args.eventId, attendees: args.oldAttendees }], what: say.undoWhat.edit(args.title) } };
        });
    }

    // ---- Tasks ----------------------------------------------------------------------------------

    function taskAccounts(env) { return S.accounts(env).then(function (list) { return S.withCap(list, "TASKS"); }); }
    // The account and list the words mean: args.account, or a list's name that starts or
    // ends with an account's ("todoist shopping"). -> {account, lists, list?} | {reply} | null
    function listIn(env, args) {
        var say = env.lang.say;
        return Promise.all([taskAccounts(env), S.taskLists(env)]).then(function (got) {
            var accts = got[0], lists = got[1], said = String(args.account || "").replace(/\s+(?:tasks?|lists?|to-?do list|inbox)$/i, "").trim();
            var name = String(args.list || "").trim(), acct = null;
            if (said) {
                var hits = namedAmong(env, accts, said);
                if (!hits.length) return missing(env, said, "TASKS").then(function (why) { return { reply: why }; });
                if (hits.length > 1) return { which: hits.map(function (a) { return a.label; }) };
                acct = hits[0];
            } else if (name) {
                // A list by its whole name is that list ("Errands"), whoever's it is.
                if (lists.some(function (l) { return h.words(l.list.name) === h.words(name) || h.words(l.list.name).replace(/ list$/, "") === h.words(name).replace(/ list$/, ""); })) return null;
                var ws = h.words(name).split(" ");
                for (var n = ws.length - 1; n >= 1 && !acct; --n) {
                    [[ws.slice(0, n).join(" "), ws.slice(n).join(" ")], [ws.slice(ws.length - n).join(" "), ws.slice(0, ws.length - n).join(" ")]].forEach(function (pair) {
                        if (acct) return;
                        var a = namedAmong(env, accts, pair[0]);
                        if (a.length === 1) { acct = a[0]; name = pair[1]; }
                    });
                }
                if (!acct) return null;
                name = name.charAt(0).toUpperCase() + name.slice(1);
            } else return null;
            var own = lists.filter(function (l) { return l.account === acct; });
            if (!name) return { account: acct, lists: own };
            var l = own.filter(function (x) { return h.words(x.list.name) === h.words(name) || h.words(x.list.name).replace(/ list$/, "") === h.words(name).replace(/ list$/, ""); })[0]
                || own.filter(function (x) { return h.words(x.list.name).indexOf(h.words(name)) === 0; })[0];
            if (!l) return { reply: say.noListIn(name, acct.name, own.map(function (x) { return x.list.name; })) };
            return { account: acct, lists: [l], list: l };
        });
    }
    // The account's list a new task goes in: its inbox, else its first.
    function inboxOf(found) {
        var own = found.lists;
        return own.filter(function (x) { return x.list.inbox || x.list.isDefault; })[0] || own.filter(function (x) { return /^inbox$/i.test(x.list.name || ""); })[0]
            || own.slice().sort(function (a, b) { return (a.list.sortOrder || 0) - (b.list.sortOrder || 0); })[0];
    }
    function taskPrepare(env, args) {
        return listIn(env, args).then(function (found) {
            if (!found) return { pass: args };
            if (found.reply) return { args: args, reply: found.reply };
            if (found.which) return askWhich(args, "account", "task", found.which, env.lang.say.whichAccount(found.which));
            var l = found.list || inboxOf(found);
            if (!l) return { args: args, reply: env.lang.say.noListIn(args.list || "Inbox", found.account.name, []) };
            args.listId = l.list._id; args.list = l.list.name; args.accountName = found.account.name;
            return { pass: args };
        });
    }
    function taskListRun(args, env) {
        var say = env.lang.say, now = env.now();
        return listIn(env, args).then(function (found) {
            if (!found) return null;
            if (found.reply) return { text: found.reply };
            if (found.which) return { text: say.whichAccount(found.which) };
            var ids = found.lists.map(function (l) { return l.list._id; }), names = {};
            found.lists.forEach(function (l) { names[l.list._id] = l.list.name; });
            return S.find(env, "com.palm.task:1").then(function (tasks) {
                var by = args.day === "today" ? D.addDays(D.startOfDay(now), 1) : args.day === "tomorrow" ? D.addDays(D.startOfDay(now), 2) : args.day === "this week" ? D.weekRange(now).to : 0;
                var open = tasks.filter(function (x) { return !x.completed && ids.indexOf(x.listId) >= 0 && (!by || (x.due && x.due < by)); })
                    .sort(function (a, b) { return (a.due || Infinity) - (b.due || Infinity) || (a.createdTime || 0) - (b.createdTime || 0); });
                var summaries = open.map(function (x) { return x.summary; });
                var where = found.list ? found.list.list.name + " (" + found.account.name + ")" : found.account.label;
                var text = found.list ? (by ? say.tasksDue(where, args.day, summaries) : say.tasks(where, summaries)) : (by ? say.tasksDue(where, args.day, summaries).replace("your " + where + " list", where) : say.tasksIn(where, summaries));
                return { text: text, data: { count: open.length }, open: { appId: TASKS_APP, params: found.list ? { listId: found.list.list._id } : {}, title: "Tasks" },
                         attachments: h.cards(open.map(function (x) {
                             return { title: x.summary, subtitle: [x.due ? h.whenShown(env, x.due, null, !!x.allDay) : "", found.list ? "" : names[x.listId]].filter(Boolean).join(" · "),
                                      open: { appId: TASKS_APP, params: { taskId: x._id }, title: "Tasks" } };
                         })) };
            });
        });
    }

    // ---- Email ----------------------------------------------------------------------------------

    function mailNamed(env, said) {
        var s = lower(said).replace(/\s+(?:e-?mail|mail|inbox|mailbox|account)$/, "");
        return S.mailAccounts(env).then(function (all) {
            var accts = namedAmong(env, all.map(function (m) { return m.account; }), s);
            var hits = all.filter(function (m) { return accts.indexOf(m.account) >= 0 || m.addresses.some(function (a) { return a === s || a.split("@")[1] === s || (a.split("@")[1] || "").split(".")[0] === s; }); });
            return { hits: hits, all: all };
        });
    }
    function mailScope(env, args) {
        var say = env.lang.say;
        return mailNamed(env, args.account).then(function (found) {
            if (!found.hits.length) {
                var svc = env.lang.synergy && env.lang.synergy.serviceOf(args.account);
                if (svc) return missing(env, args.account, "MAIL").then(function (why) { return { reply: why }; });
                return { reply: say.noMailAccountCalled(args.account, found.all.map(function (m) { return m.account.name + (m.mail.email ? " (" + m.mail.email + ")" : ""); })) };
            }
            var folders = {};
            found.hits.forEach(function (m) { m.folders.forEach(function (f) { folders[f._id] = true; }); });
            return { folders: folders, label: found.hits.length === 1 ? found.hits[0].account.name : found.hits.map(function (m) { return m.account.name; }).join(" and ") };
        });
    }
    function inMail(env, folders) {
        return scoped(env, { find: { "com.palm.email:1": function (e) { return !!folders[e.folderId]; } } });
    }
    // The emails meant: the one in focus, or the latest (from someone, about something), or
    // all the unread ones. -> [email]
    function emailsMeant(env, args) {
        var f = env.focus;
        if (args.it || (!args.from && !args.query && !args.all && !args.latest)) {
            if (!f || f.kind !== "email") return Promise.resolve(args.it || (!args.latest && !args.all) ? null : []);
            return h.dbGet(env, f.id).then(function (e) { return e ? [e] : []; });
        }
        var scope = args.folders ? inMail(env, args.folders) : env;
        return h.receivedEmails(scope, args.from || "").then(function (list) {
            if (args.query) list = list.filter(function (e) { return h.matches([e.subject, e.summary].join(" "), args.query); });
            if (args.all) return list.filter(function (e) { return args.action === "unread" ? !(e.flags && e.flags.read === false) : e.flags && e.flags.read === false; });
            return list.slice(0, 1);
        });
    }
    function accountOfEmail(env, e) {
        return S.mailAccounts(env).then(function (all) {
            return all.filter(function (m) { return m.folders.some(function (f) { return f._id === e.folderId; }); })[0] || null;
        });
    }
    var ARCHIVE = /^(?:archive|archives|archived|all mail|\[gmail\]\/all mail)$/i;
    function emailPrepare(cmd, env, args) {
        var say = env.lang.say;
        var scope = args.account ? mailScope(env, args) : Promise.resolve(null);
        return scope.then(function (sc) {
            if (sc && sc.reply) return { args: args, reply: sc.reply };
            if (sc) { args.folders = sc.folders; args.accountLabel = sc.label; }
            return emailsMeant(env, args).then(function (list) {
                if (list === null) return { args: args, reply: say.whichEmail() };
                if (!list.length) return { args: args, reply: args.all ? say.nothingToMark(args.action) : args.from ? say.noEmailFrom(args.from) : say.noEmails() };
                args.ids = list.map(function (e) { return e._id; });
                args.subject = list[0].subject || "";
                args.oldFlags = list.map(function (e) { return { _id: e._id, flags: e.flags || {}, folderId: e.folderId }; });
                return accountOfEmail(env, list[0]).then(function (m) {
                    args.accountLabel = args.accountLabel || (m ? m.account.name : "");
                    if (cmd.id === "emailDelete") {
                        var e = list[0];
                        return { args: args, confirm: say.confirmEmailDelete(e.subject, e.from ? e.from.name || e.from.addr : "", m && m.account.several ? m.account.name : "") };
                    }
                    if (args.action === "archive") {
                        var folder = m && (m.folders.filter(function (f) { return f._id === m.mail.archiveFolderId; })[0] ||
                                           m.folders.filter(function (f) { return ARCHIVE.test(f.displayName || f.name || ""); })[0]);
                        if (!folder) return { args: args, reply: say.noArchive(m ? m.account.name : "email") };
                        args.archiveFolderId = folder._id;
                    }
                    return { args: args };
                });
            });
        });
    }
    function emailMarkRun(args, env) {
        var say = env.lang.say, n = args.ids.length;
        var objects = args.oldFlags.map(function (o) {
            var flags = Object.assign({}, o.flags);
            if (args.action === "read" || args.action === "unread") flags.read = args.action === "read";
            if (args.action === "flag" || args.action === "unflag") flags.flagged = args.action === "flag";
            var out = { _id: o._id, flags: flags };
            // Moved as Email moves it: the folder to go to, and out of sight until the account's transport has.
            if (args.action === "archive") { flags.visible = false; out.destFolderId = args.archiveFolderId; }
            return out;
        });
        return h.lunaCall(env, DB + "merge", { objects: objects }).then(function () {
            var back = args.oldFlags.map(function (o) { var b = { _id: o._id, flags: o.flags }; if (args.action === "archive") b.destFolderId = o.folderId; return b; });
            return { text: say.emailMarked(args.action, args.subject, n), open: { appId: EMAIL_APP, params: n === 1 && args.action !== "archive" ? { emailId: args.ids[0] } : {}, title: "Email" },
                     undo: { kind: "merge", objects: back, what: say.undoWhat.edit(n === 1 ? "the email" : "those emails") } };
        });
    }
    function emailDeleteRun(args, env) {
        var say = env.lang.say;
        return h.lunaCall(env, DB + "del", { ids: args.ids }).then(function () {
            return { text: say.emailDeleted(args.subject, args.ids.length), open: { appId: EMAIL_APP, params: {}, title: "Email" } };
        });
    }

    // ---- Posting --------------------------------------------------------------------------------
    function postLabel(t) { return t.label + (t.as ? " (" + t.as + ")" : ""); }
    function postPrepare(env, args) {
        var say = env.lang.say;
        return S.shareTargets(env).then(function (targets) {
            // With no service named, the accounts that publish (a social account's, or one
            // whose share says who can see it), not every share ("Add to Todoist").
            var said = String(args.service || "").trim();
            var pick = said ? targets : targets.filter(function (t) { return !!t.target.audience || !!S.capIn(t.account, "SOCIAL"); });
            if (said) {
                pick = chosen(env, targets, said, postLabel);
                if (!pick.length) pick = targets.filter(function (t) { return h.matches(t.label, said); });
                if (!pick.length) {
                    return S.accounts(env).then(function (all) {
                        var has = namedAmong(env, all, said)[0];
                        return { args: args, reply: has ? say.cantPostTo(has.provider) : noAccount(env, said) };
                    });
                }
            }
            if (!pick.length) return { args: args, reply: say.noPostAccount() };
            // Several: which, never a guess (it goes out under the user's name).
            if (pick.length > 1) {
                var labels = pick.map(postLabel);
                return askWhich(args, "service", "post", labels, say.whichAccount(labels));
            }
            var t = pick[0];
            var text = String(args.text || "").trim();
            var memo = !text && args.it && env.focus && env.focus.kind === "memo" ? h.dbGet(env, env.focus.id) : Promise.resolve(null);
            return memo.then(function (n) {
                if (n) text = String(n.text || "").trim();
                args.service = postLabel(t);
                if (!text) return { args: args, reply: say.whatToPost(t.label), awaiting: { command: "post", args: args, field: "text" } };
                var accepts = (t.target.accepts && t.target.accepts.text) || {}, max = accepts === true ? 0 : Number(accepts.maxLength) || 0;
                var length = Array.from(text).length;
                if (max && length > max) return { args: args, reply: say.postTooLong(t.label, length, max) };
                var aud = t.target.audience, def = aud && (aud.options || []).filter(function (o) { return o.value === aud.default; })[0];
                args.text = text;
                args.share = { service: t.target.service, accountId: t.account.id, label: t.label, as: t.as, audience: def ? def.value : "" };
                return { args: args, confirm: say.confirmPost(t.label, t.as, text, def ? (aud.label || "Who can see it") + ": " + def.label + "." : "") };
            });
        });
    }
    function postRun(args, env) {
        var say = env.lang.say, s = args.share;
        var params = { accountId: s.accountId, content: { text: args.text }, idempotencyKey: "assistant-" + env.now().toString(36) };
        if (s.audience) params.audience = s.audience;
        return h.lunaCall(env, "luna://" + s.service + "/share", params).then(function (r) {
            var url = (r.posted && r.posted.url) || r.url || "";
            return { text: say.posted(s.label), data: { url: url },
                     actions: url ? [{ label: say.openPost(), run: { command: "website", args: { url: url } } }] : [] };
        }, function (e) {
            return { text: say.postFailed(s.label, e && e.reply && e.reply.errorText ? e.reply.errorText : ""), failed: true };
        });
    }

    // ---- Drives ---------------------------------------------------------------------------------
    function drivesNamed(env, said) {
        return S.drives(env).then(function (all) {
            var hits = chosen(env, all, said, function (d) { return d.account.label; });
            return { hits: hits, all: all };
        });
    }
    function driveLabel(d) { return d.account.label; }
    function findFilesPrepare(env, args) {
        var say = env.lang.say;
        return drivesNamed(env, args.drive).then(function (f) {
            if (!f.hits.length) return missing(env, args.drive, "DOCUMENTS").then(function (why) { return { args: args, reply: why }; });
            if (f.hits.length > 1) return askWhich(args, "drive", "findFiles", f.hits.map(driveLabel), say.whichAccount(f.hits.map(driveLabel)));
            args.drivePath = f.hits[0].path; args.driveLabel = driveLabel(f.hits[0]);
            return { args: args };
        });
    }
    // The file manager's search, on the drive asked for; the file found is what "it" is next.
    function findFilesRun(cmd, args, env) {
        var say = env.lang.say, entries = [];
        var e2 = scoped(env, {
            params: args.drivePath ? (function () { var o = {}; o[FILES + "search"] = function (p) { return Object.assign({}, p, { path: args.drivePath }); }; return o; })() : null,
            seen: function (uri, p, r) { if (uri === FILES + "search" && r && r.entries) entries = r.entries.filter(function (e) { return args.kind !== "pdf" || /\.pdf$/i.test(e.name); }); }
        });
        return Promise.resolve(h.runInner(cmd, args, plain(e2))).then(function (out) {
            if (args.drivePath) {
                out.text = entries.length ? say.filesOn(out.text, args.driveLabel) : say.noFilesOn(args.query, args.driveLabel);
                (((out.attachments || [])[0] || {}).items || []).forEach(function (c) { c.subtitle = String(c.subtitle || "").replace(args.drivePath, args.driveLabel); });
                if (!entries.length) out.open = { appId: FILES_APP, params: { path: args.drivePath }, title: "Files" };
            }
            var files = entries.filter(function (e) { return e.type !== "directory"; });
            if (files.length === 1 || entries.length === 1) { var x = files[0] || entries[0]; out.focus = { kind: "file", id: x.path, title: x.name }; }
            return out;
        });
    }
    function savePrepare(env, args) {
        var say = env.lang.say;
        return drivesNamed(env, args.drive).then(function (f) {
            if (!f.hits.length) return missing(env, args.drive, "DOCUMENTS").then(function (why) { return { args: args, reply: why }; });
            if (f.hits.length > 1) return askWhich(args, "drive", "saveToDrive", f.hits.map(driveLabel), say.whichAccount(f.hits.map(driveLabel)));
            var d = f.hits[0];
            var focus = env.focus && env.focus.kind === "file" ? env.focus : null;
            var file = !String(args.file || "").trim() || args.it
                ? Promise.resolve(focus ? { path: focus.id, name: focus.title || focus.id.replace(/^.*\//, "") } : null)
                : h.lunaCall(env, FILES + "search", { query: String(args.file), limit: 20 }).then(function (r) {
                    var hits = (r.entries || []).filter(function (e) { return e.type !== "directory"; });
                    var q = h.words(args.file);
                    return hits.filter(function (e) { return h.words(e.name.replace(/\.[^.]+$/, "")) === q; })[0] || hits[0] || false;
                }, function () { return false; });
            return file.then(function (x) {
                if (x === null) return { args: args, reply: say.whichFile() };
                if (!x) return { args: args, reply: say.noFileCalled(args.file) };
                args.from = x.path; args.name = x.name; args.to = d.path + "/" + x.name; args.driveLabel = driveLabel(d); args.drivePath = d.path;
                return { args: args, confirm: say.confirmUpload(x.name, args.driveLabel) };
            });
        });
    }
    function saveRun(args, env) {
        var say = env.lang.say;
        return h.lunaCall(env, FILES + "copy", { from: args.from, to: args.to, overwrite: false }).then(function () {
            var files = { appId: FILES_APP, params: { path: args.drivePath }, title: "Files" };
            return { text: say.uploaded(args.name, args.driveLabel), open: files, focus: { kind: "file", id: args.to, title: args.name } };
        }, function (e) {
            return { text: say.uploadFailed(args.name, args.driveLabel, e && e.reply && e.reply.errorText ? e.reply.errorText : ""), failed: true };
        });
    }

    // ---- Accounts -------------------------------------------------------------------------------
    // ---- Where you are, or when you'll be there, sent as a message -----------------------------------
    //
    // The words made here (a map link, as Maps shares a place: apps/maps
    // src/lib/launch.ts osmLink and shareText; or the time the route says),
    // then sent as "text" sends them, on the account chosen as it chooses:
    // the one said, else the person's usual one, else a text; asked when
    // several fit. Read back naming the account.
    function osmLink(lat, lon) {
        return "https://www.openstreetmap.org/?mlat=" + lat.toFixed(6) + "&mlon=" + lon.toFixed(6) + "#map=17/" + lat.toFixed(5) + "/" + lon.toFixed(5);
    }
    var NO_PLACE_SAVED = /^(?:home|work|the office|my office|my house|my place)$/i;
    function sharePrepare(env, args) {
        var say = env.lang.say, place = String(args.place || "").trim();
        args = Object.assign({}, args);
        if (!String(args.who || "").trim())
            return Promise.resolve({ args: args, reply: say.shareWithWhom(!!args.eta) });
        if (args.eta && !place) return Promise.resolve({ args: args, reply: say.whereTo() });
        if (args.eta && NO_PLACE_SAVED.test(place)) return Promise.resolve({ args: args, reply: say.noPlaceSaved(lower(place).replace(/^(?:the |my )/, "").replace(/^(?:office|house|place)$/, function (w) { return w === "office" ? "work" : "home"; })) });
        return h.here(env, "share").then(function (me) {
            if (!args.eta) return { message: say.locationMessage(osmLink(me.lat, me.lon)) };
            return h.resolvePlace(env, place, me).then(function (list) {
                var to = list[0];
                return h.routeSummary(env, me, to, "drive").then(function (sum) {
                    if (!sum) throw Object.assign(new Error("no route"), { said: say.noRoute(to.name) });
                    var at = env.now() + sum.seconds * 1000;
                    return { message: say.etaMessage(to.name, sum.seconds, at), to: to.name, at: at };
                });
            });
        }).then(function (made) {
            var sending = { who: args.who, via: args.via || "", message: made.message };
            return prepare(TEXT, sending, env).then(function (p) { return p.pass ? h.prepareInner(TEXT, p.pass, env) : p; }).then(function (p) {
                var ready = Object.assign({}, p.args || sending, { eta: !!args.eta, place: place, ready: true });
                // Whom, or which account: asked as for a text, and the answer comes back here.
                if (p.awaiting) return { args: ready, reply: p.reply, awaiting: Object.assign({}, p.awaiting, { command: "shareLocation", args: args }) };
                if (p.reply) return { args: ready, reply: p.reply };
                if (!String(ready.message || "").trim() || !(ready.chat || ready.number)) return { args: ready, reply: say.noSuchContact(args.who) };
                var net = ready.chat ? ready.chat.label : "";
                return { args: ready, confirm: say.confirmShare(!!args.eta, ready.name || (ready.chat && ready.chat.addr) || ready.number, net, made.to, made.at) };
            });
        }).catch(function (e) {
            // No location yet (not allowed, off): said when it runs, with what to do (lib/commands.js blockedReply).
            if (e && e.location) return { args: Object.assign({}, args, { ready: false }) };
            if (e && e.said) return { args: args, reply: e.said };
            throw e;
        });
    }
    function shareRun(args, env) {
        if (args.ready) return h.runInner(TEXT, args, env);
        // Here only when the location could not be had: why, and the buttons that fix it, then this again.
        var again = { who: args.who, via: args.via || "", eta: !!args.eta, place: args.place || "" };
        return h.here(env, "share").then(function () {
            return { text: env.lang.say.locationReady(), failed: true };
        }, function (e) {
            if (e && e.location) return h.blockedReply(e, { command: "shareLocation", args: again });
            throw e;
        });
    }

    function accountsRun(args, env) {
        var say = env.lang.say;
        return S.accounts(env).then(function (list) {
            var shown = list.filter(function (a) { return a.templateId !== "com.palm.palmprofile" && a.templateId; }).map(function (a) {
                return { label: a.label, does: say.capabilityWords(unique(a.caps.map(function (c) { return c.capability; }))), id: a.id, templateId: a.templateId };
            // By name: the accounts service gives them in no set order.
            }).sort(function (a, b) { return a.label.localeCompare(b.label); });
            var app = { appId: ACCOUNTS_APP, params: {}, title: "Accounts" };
            return { text: say.accountsList(shown), open: app,
                     attachments: h.cards(shown.map(function (a) { return { title: a.label, subtitle: a.does, open: app }; })) };
        });
    }

    // ---- The hooks lib/commands.js calls ---------------------------------------------------------

    // Before a command's own preparing: -> a promise of its preparation (the
    // account's part decided), or of {pass: args} to go on as the command does.
    function prepare(cmd, args, env) {
        var say = env.lang.say;
        // A model's "nothing" for an argument ("None", "null"): nothing, never
        // an account or a person by that name (Qwen3 0.6B gave readMessages
        // {who: "None", via: "None"} for "anything new on slack").
        Object.keys(args || {}).forEach(function (k) {
            if (typeof args[k] === "string" && NOTHING.test(args[k].trim())) args[k] = "";
        });
        switch (cmd.id) {
        case "text": {
            var via = String(args.via || "").trim();
            if (via && !/^(?:sms|text|texts?|text message)$/i.test(via)) return chatTarget(env, cmd, args, null, false);
            if (args.number || /^[+\d][\d\s().-]{2,}$/.test(String(args.who || "").trim())) return Promise.resolve({ pass: args });
            if (channelName(args.who)) return chatTarget(env, cmd, args, null, false);
            // As Messaging would: their latest conversation's network, if it is a chat one.
            return Promise.all([h.findPeople(env, args.who), S.threads(env)]).then(function (got) {
                var p = got[0].length === 1 || (got[0].length && !h.ambiguous(got[0])) ? got[0][0] : null;
                if (!p) return { pass: args };
                var latest = got[1].filter(function (t) { return t.personId === p._id && t.replyService; })[0];
                if (!latest || !/^type_/.test(latest.replyService)) return { pass: args };
                return chatTarget(env, cmd, args, p, true).then(function (r) { return r || { pass: args }; });
            });
        }
        case "agenda":
        case "freeTime":
            if (!args.calendar) return Promise.resolve({ pass: args });
            return calendarFor(env, args, false).then(function (c) {
                if (c.reply) return { args: args, reply: c.reply };
                args.calendarIds = c.ids; args.calendarName = c.name;
                return { args: args };
            });
        case "event":
            if (!args.calendar) return Promise.resolve({ pass: args });
            return calendarFor(env, args, true).then(function (c) {
                if (c.reply) return { args: args, reply: c.reply };
                args.calendarId = c.calendar.calendar._id; args.calendarName = c.name;
                return { pass: args };
            });
        case "eventCalendar":
            return eventCalendarPrepare(env, args);
        case "task":
            return taskPrepare(env, args);
        case "searchEmail":
        case "readEmail":
            if (!args.account) return Promise.resolve({ pass: args });
            return mailScope(env, args).then(function (sc) {
                if (sc.reply) return { args: args, reply: sc.reply };
                args.folders = sc.folders; args.accountLabel = sc.label;
                return h.prepareInner(cmd, args, inMail(env, sc.folders));
            });
        case "emailMark":
        case "emailDelete":
            return emailPrepare(cmd, env, args);
        case "inviteReply":
            return invitePrepare(env, args);
        case "post":
            return postPrepare(env, args);
        case "findFiles":
            if (!args.drive) return Promise.resolve({ pass: args });
            return findFilesPrepare(env, args);
        case "saveToDrive":
            return savePrepare(env, args);
        case "shareLocation":
            return sharePrepare(env, args);
        }
        return Promise.resolve({ pass: args });
    }
    // In place of a command's own run: a promise of its answer, or null to run as it does.
    function run(cmd, args, env) {
        if (env.__synergyDone) return null;
        switch (cmd.id) {
        case "text": return args.chat ? sendChat(env, args) : null;
        case "readMessages":
            return readMessages(args, env).then(function (r) { return r || h.runInner(cmd, args, plain(env)); });
        case "agenda":
        case "freeTime":
            if (!args.calendarIds) return null;
            var ids = args.calendarIds;
            return Promise.resolve(h.runInner(cmd, args, plain(scoped(env, { find: { "com.palm.calendarevent:1": function (e) { return ids.indexOf(e.calendarId) >= 0; } } }))))
                .then(function (out) { return onCalendar(out, args.calendarName, env); });
        case "eventCalendar": return moveEvent(args, env);
        case "task":
            if (!args.accountName) return null;
            return Promise.resolve(h.runInner(cmd, args, plain(env))).then(function (out) {
                if (out && out.text && !out.failed) out.text = out.text.replace(/\.$/, " in " + args.accountName + ".");
                return out;
            });
        case "taskList":
            if (!args.account && !args.list) return null;
            return taskListRun(args, env).then(function (r) { return r || h.runInner(cmd, args, plain(env)); });
        case "searchEmail":
        case "readEmail":
            if (!args.folders) return null;
            return Promise.resolve(h.runInner(cmd, args, plain(inMail(env, args.folders)))).then(function (out) {
                if (out && out.text) out.text = env.lang.say.inMailbox(out.text, args.accountLabel);
                return out;
            });
        case "emailMark": return emailMarkRun(args, env);
        case "emailDelete": return emailDeleteRun(args, env);
        case "inviteReply": return inviteRun(args, env);
        case "joinMeeting": return joinMeeting(args, env);
        case "post": return postRun(args, env);
        case "findFiles": return findFilesRun(cmd, args, env);
        case "saveToDrive": return saveRun(args, env);
        case "accounts": return accountsRun(args, env);
        case "shareLocation": return shareRun(args, env);
        }
        return null;
    }

    return { COMMANDS: COMMANDS, extend: extend, prepare: prepare, run: run, chatTarget: chatTarget, pickCalendar: pickCalendar };
};
module.exports.COMMANDS = COMMANDS;
