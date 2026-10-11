// @vitest-environment node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Assistant on what is connected through Synergy (lib/synergy.js,
// lib/commands-synergy.js, lib/lang/en-synergy.js), through the service, on
// the stand-in device with the user's accounts (test/accounts-world.cjs:
// the templates and kinds are the connectors' own, read from this tree).
// And a connector no code here knows, to show it works the same.

import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { at, device, NOW } from "./test/device";

const req = createRequire(import.meta.url);
const world = req("./test/accounts-world.cjs") as { seed(put: (o: any) => string): void; DRIVE_FILES: Record<string, object[]> };
const grammar = req("./lib/grammar.js") as { parse(t: string, ctx: object): { command: string; args: any } | null };

const synergy = (more?: (put: (o: any) => string) => void, opts: object = {}) =>
    device({ seed: (put) => { world.seed(put); if (more) more(put); }, driveFiles: world.DRIVE_FILES, ...opts });
const sentMessages = (d: ReturnType<typeof device>) => d.called("messaging/putMessage").map((c) => c.params.message);

// A third party's chat connector, installed after this code was written: its
// template and kinds as the kit makes them (docs/SYNERGY-SDK.md), nothing more.
const ACME = {
    templateId: "org.example.acmechat", loc_name: "Acme Chat",
    capabilityProviders: [
        { capability: "MESSAGING", capabilitySubtype: "IM", serviceName: "type_acmechat", id: "org.example.acmechat.im", loc_shortName: "Acme",
          dbkinds: { immessage: "com.palm.immessage.acmechat:1" }, implementation: "palm://org.example.service.acmechat/" },
        { capability: "TASKS", id: "org.example.acmechat.tasks", loc_name: "Boards", dbkinds: { task: "com.palm.task.acmechat:1", tasklist: "com.palm.tasklist.acmechat:1" } },
    ],
};
const ACME_APP = { id: "org.example.acmechat", title: "Acme Chat",
                   shareTargets: [{ types: ["text/plain"], label: "Acme Chat", connector: { templateId: "org.example.acmechat", service: "org.example.service.acmechat",
                                                                                            accepts: { text: { maxLength: 40 } }, accountLabel: "{username}" } }] };
function acme(put: (o: any) => string) {
    put({ _id: "acct-acme", _kind: "com.palm.account:1", templateId: "org.example.acmechat", username: "jordan@acme.example", beingDeleted: false,
          capabilityProviders: [{ id: "org.example.acmechat.im", capability: "MESSAGING" }, { id: "org.example.acmechat.tasks", capability: "TASKS" }] });
    put({ _id: "p-ola", _kind: "com.palm.person:1", name: { givenName: "Ola", familyName: "Berg" }, phoneNumbers: [], emails: [], ims: [{ value: "ola@acme.example", type: "type_acmechat" }] });
    put({ _id: "tl-acme", _kind: "com.palm.tasklist.acmechat:1", accountId: "acct-acme", name: "Launch board", taskKind: "com.palm.task.acmechat:1" });
    put({ _id: "im-ola", _kind: "com.palm.immessage.acmechat:1", folder: "inbox", serviceName: "type_acmechat", username: "jordan@acme.example",
          from: { addr: "ola@acme.example", name: "Ola Berg" }, messageText: "Ship it?", localTimestamp: NOW - 60000, flags: { read: false, visible: true } });
}
const acmeDevice = () => synergy(acme, { templates: { "org.example.acmechat": ACME }, apps: [ACME_APP],
                                         kinds: { "com.palm.immessage.acmechat:1": "com.palm.immessage:1", "com.palm.task.acmechat:1": "com.palm.task:1",
                                                  "com.palm.tasklist.acmechat:1": "com.palm.tasklist:1" } });

describe("the grammar hears accounts by their names", () => {
    const ctx = { now: NOW, names: ["sam", "sam delgado", "kai", "priya"],
                  accounts: [{ phrases: ["slack"], caps: ["MESSAGING"] }, { phrases: ["acme chat", "acme"], caps: ["MESSAGING", "TASKS"] },
                             { phrases: ["work mail", "jordan@northwind.example"], caps: ["MAIL"] }, { phrases: ["dropbox"], caps: ["DOCUMENTS"] }] };
    const cases: [string, string, object][] = [
        ["text Sam on Slack: running late", "text", { who: "sam", message: "running late", via: "slack" }],
        ["message Ola on Acme Chat saying ship it", "text", { who: "ola", message: "ship it", via: "acme chat" }],
        ["message the #design channel on slack: love it", "text", { who: "the #design channel", message: "love it", via: "slack" }],
        ["read my unread slack messages", "readMessages", { unread: true, via: "slack" }],
        ["what's on my work calendar tomorrow", "agenda", { range: "day", calendar: "work" }],
        ["add lunch with Sam friday at noon to my google calendar", "event", { title: "Lunch with Sam", calendar: "google" }],
        ["add it to my google calendar", "eventCalendar", { it: true, calendar: "google" }],
        ["any new emails in my work account", "searchEmail", { unread: true, account: "work" }],
        ["read my latest email in my work mail inbox", "readEmail", { account: "work mail" }],
        ["what's on my microsoft to do", "taskList", { account: "microsoft to do" }],
        ["add milk to todoist", "task", { text: "Milk", account: "todoist" }],
        ["add milk to my acme board list", "task", { text: "Milk", list: "Acme board" }],
        ["find the budget file on dropbox", "findFiles", { query: "budget", drive: "dropbox" }],
        ["save it to google drive", "saveToDrive", { it: true, drive: "google drive" }],
        ["post to bluesky: hello", "post", { service: "bluesky", text: "hello" }],
        ["toot good morning", "post", { service: "mastodon", text: "good morning" }],
        ["share this on linkedin", "post", { service: "linkedin", it: true }],
        ["join my next meeting", "joinMeeting", { query: "" }],
        ["accept the invite from alex", "inviteReply", { response: "accepted", from: "alex" }],
        ["tentatively accept the design review", "inviteReply", { response: "tentative", query: "design review" }],
        ["archive it", "emailMark", { action: "archive", it: true }],
        ["mark all as read", "emailMark", { action: "read", all: true }],
        ["delete the email from alex", "emailDelete", { from: "alex" }],
        ["what accounts do I have", "accounts", {}],
    ];
    for (const [text, command, args] of cases) {
        it(`"${text}"`, () => {
            const r = grammar.parse(text, ctx);
            expect(r?.command).toBe(command);
            expect(r?.args).toMatchObject(args);
        });
    }
    it("leaves words that name no account to the other rules", () => {
        expect(grammar.parse("text Sam I'm on the train", ctx)).toMatchObject({ command: "text", args: { who: "sam", message: "I'm on the train" } });
        expect(grammar.parse("read the newest message in my inbox", ctx)).toBeNull();
        expect(grammar.parse("what's on my calendar today", ctx)?.args.calendar).toBeUndefined();
        expect(grammar.parse("add milk to my shopping list", ctx)).toMatchObject({ command: "task", args: { list: "Shopping" } });
        expect(grammar.parse("maybe", ctx)).toBeNull();
    });
});

describe("messages on every messaging account", () => {
    it("sends on the account asked for, from its user name, read back first", async () => {
        const d = synergy();
        const q = await d.ask("text Sam on Slack: running five minutes late");
        expect(q).toMatchObject({ status: "pending", text: "Send \"running five minutes late\" to Sam Delgado on Slack?" });
        expect(sentMessages(d)).toHaveLength(0);
        expect((await d.confirm(q)).text).toBe("Sent to Sam Delgado on Slack.");
        expect(sentMessages(d)[0]).toMatchObject({ _kind: "com.palm.immessage.slack:1", serviceName: "type_slack", username: "jordan@Northwind", folder: "outbox",
                                                  status: "pending", to: [{ addr: "sam@Northwind", name: "Sam Delgado" }], conversations: ["th-sam-slack"] });
    });
    it("posts in a channel by the conversation's name", async () => {
        const d = synergy();
        const q = await d.ask("message the #design channel on slack: love the mock-ups");
        expect(q.text).toBe("Send \"love the mock-ups\" to #design on Slack?");
        await d.confirm(q);
        expect(sentMessages(d)[0]).toMatchObject({ to: [{ addr: "#design@Northwind" }], conversations: ["th-design"] });
    });
    it("goes as Messaging would: the latest conversation's network, else asks which", async () => {
        const d = synergy();
        // Sam's latest conversation is his texts.
        expect((await d.ask("text Sam see you soon")).text).toBe("Send \"see you soon\" to Sam Delgado?");
        d.newThread();
        // Kai is on Jabber and Slack, and was never written to: which, never a guess.
        const q = await d.ask("text Kai see you at the stand-up");
        expect(q).toMatchObject({ status: "ask", text: "On Slack or Jabber?" });
        const r = await d.choose(q, "pick:1");
        expect(r.messages.at(-1)).toMatchObject({ status: "pending", text: "Send \"see you at the stand-up\" to Kai Tanaka on Jabber?" });
        // Noor is on Telegram only.
        d.newThread();
        expect((await d.ask("text Noor running late")).text).toBe("Send \"running late\" to Noor Haddad on Unofficial Telegram?");
    });
    it("says what is out of reach or missing", async () => {
        const d = synergy();
        expect((await d.ask("text Sam on Signal: hi")).text).toBe("I can't reach Signal: Signal has no way in for other apps.");
        expect((await d.ask("message Priya on Matrix: hi")).text).toBe("You're not signed in to Matrix. Add the account in Accounts first.");
        expect((await d.ask("message the #ops channel on slack: hi")).text).toBe("I couldn't find a conversation called “#ops” on Slack.");
        expect((await d.ask("text Noor on Slack: hi")).text).toBe("Noor Haddad has no Slack address in your contacts.");
    });
    it("asks what to say when nothing was", async () => {
        const d = synergy();
        expect(await d.ask("message Kai on jabber")).toMatchObject({ status: "ask", text: "What should I say to Kai Tanaka on Jabber?" });
        expect((await d.ask("I'm running late")).text).toBe("Send \"I'm running late\" to Kai Tanaka on Jabber?");
    });
    it("reads every account's new messages, or one account's", async () => {
        const d = synergy();
        expect((await d.ask("read my unread slack messages")).text).toBe(
            "You have 2 new Slack messages. #design: “Alex Rivera: the new launcher mock-ups are up”; Sam Delgado: “Can you look at the release notes before lunch?”.");
        const all = await d.ask("read my new messages");
        expect(all.text).toMatch(/^You have 3 new messages\. Sam Delgado: “Running 5 min late”; #design on Slack: /);
        expect((await d.ask("what did Sam say on slack")).text).toBe("Sam Delgado on Slack said, today at 9:10 AM: “Can you look at the release notes before lunch?”");
        expect((await d.ask("any new messages on telegram")).text).toBe("You have no new Unofficial Telegram messages.");
    });
});

describe("calendars and meetings", () => {
    it("reads one account's or one calendar's events", async () => {
        const d = synergy();
        expect((await d.ask("what's on my work calendar tomorrow")).text).toBe("Tomorrow on your Work calendar you have 1 event: “Design review” at 4:00 PM.");
        expect((await d.ask("what's on my family calendar this week")).text).toBe("This week on your Family calendar you have 1 event: “Soccer practice” Saturday 9:00 AM.");
        expect((await d.ask("what's on my google calendar")).text).toBe("Nothing on your Google calendar today.");
        expect((await d.ask("what's on my soccer calendar")).text).toMatch(/^You don't have a calendar called “soccer”\. Your calendars: /);
    });
    it("adds to an account's calendar in its own kind, for its connector to send on", async () => {
        const d = synergy();
        expect((await d.ask("add lunch with Sam friday at noon to my google calendar")).text).toBe("Added “Lunch with Sam” to your Google calendar, on Friday at 12:00 PM.");
        expect(d.of("com.palm.calendarevent.google:1").find((e) => e.subject === "Lunch with Sam")).toMatchObject({ calendarId: "cal-google", accountId: "acct-google" });
        expect((await d.ask("add a call with Zoe tomorrow at 9 to my zoom calendar")).text).toBe("Your Zoom calendar is read only: I can't add to it.");
    });
    it("moves an event to another account's calendar, and back on undo", async () => {
        const d = synergy();
        await d.ask("add a meeting with Sam tomorrow at 3");
        const local = d.of("com.palm.calendarevent:1").find((e) => e.subject === "Meeting with Sam");
        expect((await d.ask("add it to my google calendar")).text).toBe("Moved “Meeting with Sam” to your Google calendar.");
        expect(d.db.has(local._id)).toBe(false);
        expect(d.of("com.palm.calendarevent.google:1").find((e) => e.subject === "Meeting with Sam")).toMatchObject({ calendarId: "cal-google", dtstart: at(8, 15) });
        const u = await d.ask("undo");
        await d.confirm(u);
        expect(d.of("com.palm.calendarevent.google:1").find((e) => e.subject === "Meeting with Sam")).toBeUndefined();
        expect(d.of("com.palm.calendarevent:1").find((e) => e.subject === "Meeting with Sam")).toMatchObject({ calendarId: "cal-local" });
    });
    it("joins the meeting about to start; a later one waits for Join Now", async () => {
        const d = synergy();
        expect((await d.ask("join my next meeting")).text).toBe("Joining “Weekly sync” on Zoom.");
        expect(d.called("applicationManager/open").at(-1)!.params).toEqual({ target: "https://zoom.us/j/5551234567" });
        const later = await d.ask("join the design review");
        expect(later.text).toBe("“Design review” on Microsoft Teams is tomorrow at 4:00 PM. Join it then, or now?");
        const r = await d.choose(later, "do:0");
        expect(r.messages.at(-1).text).toBe("Joining “Design review” on Microsoft Teams.");
        expect(d.called("applicationManager/open").at(-1)!.params.target).toBe("https://teams.microsoft.com/l/meetup-join/19%3ameeting_review");
        expect((await d.ask("join the webex call")).text).toBe("I couldn't find a meeting “webex” with a link to join.");
    });
    it("answers an invitation on the user's attendee entry, read back naming the organizer", async () => {
        const d = synergy();
        const q = await d.ask("accept the invite from alex");
        expect(q).toMatchObject({ status: "pending", text: "Accept “Design review” (tomorrow at 4:00 PM) from Alex Rivera on your Work calendar? Alex will be told." });
        expect((await d.confirm(q)).text).toBe("Accepted “Design review”. The organizer is told when your Work account syncs.");
        expect(d.db.get("ev-review").attendees[1]).toMatchObject({ email: "jordan@northwind.example", participationStatus: "ACCEPTED" });
        expect((await d.ask("accept the design review")).text).toBe("You've already accepted “Design review”.");
        // The one invitation left waiting, with none named.
        const n = await d.ask("decline the invitation");
        expect(n.text).toBe("Decline “Team offsite” (on Friday, October 16 at 9:00 AM) from Priya Nair on your Google calendar? Priya will be told.");
        expect((await d.ask("accept the soccer practice")).text).toBe("“Soccer practice” isn't an invitation to you: you're not one of its guests.");
    });
    it("answers an email invitation as Email's Accept does", async () => {
        const d = synergy((put) => put({ _id: "mail-invite", _kind: "com.palm.imap.email:1", folderId: "fw-inbox", subject: "Budget sync", from: { name: "Hannah Brooks", addr: "hannah@northwind.example" },
                                        timestamp: NOW - 60000, flags: { read: false, visible: true }, meetingInfo: { type: "request", startTime: at(9, 11), endTime: at(9, 12) } }));
        await d.ask("read my latest email");
        const q = await d.ask("say maybe to it");
        expect(q.text).toBe("Say maybe to “Budget sync” (on Friday at 11:00 AM) from Hannah Brooks? Hannah will be told.");
        await d.confirm(q);
        expect(d.db.get("mail-invite")).toMatchObject({ meetingInfo: { type: "request", response: "tentative", responseSubject: "Tentative: Budget sync" }, flags: { visible: false } });
    });
});

describe("tasks on every tasks account", () => {
    it("adds to an account's list, in its kind", async () => {
        const d = synergy();
        expect((await d.ask("add milk to my todoist shopping list")).text).toBe("Added “Milk” to your Shopping list in Todoist.");
        expect(d.of("com.palm.task.todoist:1").find((t) => t.summary === "Milk")).toMatchObject({ listId: "tl-todo-shop", accountId: "acct-todoist" });
        expect((await d.ask("add batteries to todoist")).text).toBe("Added “Batteries” to your Inbox list in Todoist.");
        expect((await d.ask("add stamps to my todoist errands list")).text).toBe("Todoist has no list called “Errands”. Its lists: Inbox, Home and Shopping.");
        expect((await d.ask("add stamps to my google tasks")).text).toBe("Added “Stamps” to your My Tasks list in Google.");
    });
    it("reads an account's tasks or one of its lists", async () => {
        const d = synergy();
        expect((await d.ask("what's on my microsoft to do")).text).toBe("Work (Microsoft): “Submit the expense report” and “Order toner”.");
        expect((await d.ask("what's on my todoist home list")).text).toBe("Your Home (Todoist) list: “Fix the gate” and “Call the plumber”.");
        expect((await d.ask("what's on my todoist")).text).toBe("Todoist: “Fix the gate”, “Call the plumber” and “Coffee beans”.");
    });
});

describe("email on every email account", () => {
    it("reads one account's mail", async () => {
        const d = synergy();
        expect((await d.ask("any new emails in my work account")).text).toBe("In Work Mail: 1 unread email: “Q4 budget review” from Hannah Brooks.");
        expect((await d.ask("read my latest email in my work account")).text).toBe(
            "In Work Mail: from Hannah Brooks, today at 9:35 AM: “Q4 budget review”. Please look over the Q4 numbers before Friday.");
        expect((await d.ask("any new emails in my gmail")).text).toBe("Your Google account doesn't bring email to Phoenix.");
        expect((await d.ask("any new emails in my school account")).text).toBe(
            "You don't have an email account called “school”. Your email accounts: Personal (jordan@example.com) and Work Mail (jordan@northwind.example).");
    });
    it("archives, marks and flags as Email does, each undone", async () => {
        const d = synergy();
        await d.ask("read my latest email in my work account");
        expect((await d.ask("flag it")).text).toBe("Flagged “Q4 budget review”.");
        expect(d.db.get("mail-q4").flags).toMatchObject({ flagged: true, read: false, visible: true });
        expect((await d.ask("mark it as read")).text).toBe("Marked “Q4 budget review” as read.");
        expect((await d.ask("archive it")).text).toBe("Archived “Q4 budget review”.");
        // Moved as Email moves mail (facades/Email.js moveEmailsToFolder): where to, and hidden until the transport has.
        expect(d.db.get("mail-q4")).toMatchObject({ destFolderId: "fw-archive", flags: { visible: false, read: true, flagged: true } });
        await d.confirm(await d.ask("undo"));
        expect(d.db.get("mail-q4")).toMatchObject({ destFolderId: "fw-inbox", flags: { visible: true } });
        expect((await d.ask("archive the email from alex")).text).toBe("Your email account has no Archive folder. Open Email to move it.");
    });
    it("deletes only after the read-back", async () => {
        const d = synergy();
        const q = await d.ask("delete the email from hannah");
        expect(q).toMatchObject({ status: "pending", text: "Delete “Q4 budget review” from Hannah Brooks in Work Mail?" });
        expect(d.db.has("mail-q4")).toBe(true);
        await d.confirm(q);
        expect(d.db.has("mail-q4")).toBe(false);
    });
    it("marks all the unread ones read", async () => {
        const d = synergy();
        const n = (await d.of("com.palm.email:1").concat(d.of("com.palm.imap.email:1"))).filter((e) => e.flags?.read === false).length;
        expect((await d.ask("mark all as read")).text).toBe(`Marked ${n} emails as read.`);
        expect(d.of("com.palm.imap.email:1").every((e) => e.flags.read)).toBe(true);
    });
});

describe("posting", () => {
    it("reads back the post naming the account, then posts through the account's share", async () => {
        const d = synergy();
        const q = await d.ask("post to bluesky: shipping the new launcher today");
        expect(q).toMatchObject({ status: "pending", text: "Post to Bluesky as @jordan.bsky.social: “shipping the new launcher today”?" });
        expect(d.state.shared).toHaveLength(0);
        const done = await d.confirm(q);
        expect(done.text).toBe("Posted to Bluesky.");
        expect(d.state.shared[0]).toMatchObject({ service: "org.webosphoenix.service.bluesky", params: { accountId: "acct-bluesky", content: { text: "shipping the new launcher today" } } });
    });
    it("says who can see it, asks what to say, and asks which account when none is named", async () => {
        const d = synergy();
        expect((await d.ask("toot hello fediverse")).text).toBe("Post to Fediverse as @jordan@mastodon.example: “hello fediverse”? Who can see it: Public.");
        d.newThread();
        expect((await d.ask("share this on linkedin")).text).toBe("What should the post on LinkedIn say?");
        const q = await d.ask("we're hiring a designer");
        expect(q.text).toBe("Post to LinkedIn as Jordan Avery: “We're hiring a designer”? Who can see it: Anyone.");
        await d.confirm(q);
        expect(d.state.shared.at(-1).params).toMatchObject({ accountId: "acct-linkedin", audience: "PUBLIC" });
        d.newThread();
        // Not "Add to Todoist": a post goes where posts go.
        const w = await d.ask("post: hello everyone");
        expect(w.text).toBe("Which account: Bluesky (@jordan.bsky.social), LinkedIn (Jordan Avery) or Fediverse (@jordan@mastodon.example)?");
        expect((await d.ask("tweet hello")).text).toBe("I can't reach X (Twitter): Phoenix has no account for it.");
    });
    it("keeps to the service's length", async () => {
        const d = synergy();
        expect((await d.ask("post to bluesky: " + "a".repeat(301))).text).toBe("That's 301 characters, and Bluesky takes 300. Say it shorter?");
    });
});

describe("drives", () => {
    it("finds a drive's files, and uploads what was found to another after the read-back", async () => {
        const d = synergy();
        const f = await d.ask("find the budget file on dropbox");
        expect(f.text).toBe("I found “Budget 2027.xlsx” on Dropbox.");
        expect(d.called("filemanager/search").at(-1)!.params).toMatchObject({ query: "budget", path: "/media/drives/acct-dropbox" });
        const q = await d.ask("save it to google drive");
        expect(q).toMatchObject({ status: "pending", text: "Upload “Budget 2027.xlsx” to Google Drive?" });
        await d.confirm(q);
        expect(d.state.copied).toEqual([{ from: "/media/drives/acct-dropbox/Finance/Budget 2027.xlsx", to: "/media/drives/acct-gdrive/Budget 2027.xlsx", overwrite: false }]);
        expect((await d.ask("find the trip itinerary on google drive")).text).toBe("I found “Trip itinerary.pdf” on Google Drive.");
        expect((await d.ask("upload the budget file to box")).text).toBe("You're not signed in to Box. Add the account in Accounts first.");
    });
});

describe("a connector no code here knows", () => {
    it("is heard, sent on, read, listed and posted to as soon as its account is there", async () => {
        const d = acmeDevice();
        const q = await d.ask("message Ola on Acme Chat: ship it");
        expect(q.text).toBe("Send \"ship it\" to Ola Berg on Acme?");
        await d.confirm(q);
        expect(sentMessages(d)[0]).toMatchObject({ _kind: "com.palm.immessage.acmechat:1", serviceName: "type_acmechat", username: "jordan@acme.example",
                                                  to: [{ addr: "ola@acme.example" }] });
        expect((await d.ask("read my unread acme chat messages")).text).toBe("You have 1 new Acme message. Ola Berg: “Ship it?”.");
        expect((await d.ask("add the release notes to my acme chat launch board list")).text).toBe("Added “The release notes” to your Launch board list in Acme Chat.");
        expect(d.of("com.palm.task.acmechat:1")[0]).toMatchObject({ listId: "tl-acme", accountId: "acct-acme" });
        const p = await d.ask("post to acme chat: we shipped");
        expect(p.text).toBe("Post to Acme Chat as jordan@acme.example: “we shipped”?");
        await d.confirm(p);
        expect(d.state.shared.at(-1)).toMatchObject({ service: "org.example.service.acmechat", params: { accountId: "acct-acme", content: { text: "we shipped" } } });
        expect((await d.ask("what accounts do I have")).text).toContain("Acme Chat for messages and tasks");
    });
});
