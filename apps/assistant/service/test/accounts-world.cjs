// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The user's accounts connected through Synergy, for the stand-in device
// (test/device.cjs) in the tests and the evaluation (tools/eval-assistant.cjs):
// one of each kind of connector Phoenix has, with its data in the kinds its
// connector keeps it in (apps/connectors/*/configuration/db/kinds, the
// templates in public/accounts): Slack, Bluesky, the Fediverse, Jabber and
// Unofficial Telegram for messages; Google and Microsoft (named "Work") for
// calendars, tasks and contacts; Zoom's meetings; Todoist; Dropbox and Google
// Drive; LinkedIn; two email accounts ("Personal" and "Work Mail").
// Wednesday 7 October 2026, 10:00 (test/device.cjs NOW).
//
//   seed(put)       the accounts and their data
//   DRIVE_FILES     the drives' files, by account (device opts.driveFiles)

"use strict";

function at(d, h, m) { return new Date(2026, 9, d, h, m || 0, 0).getTime(); }
var NOW = at(7, 10);

function account(put, id, templateId, username, caps, extra) {
    put(Object.assign({ _id: id, _kind: "com.palm.account:1", templateId: templateId, username: username, beingDeleted: false,
                        capabilityProviders: caps.map(function (c) { return { id: templateId + "." + c[0], capability: c[1] }; }) }, extra || {}));
}

function seed(put) {
    // ---- The accounts ----------------------------------------------------------------------
    account(put, "acct-slack", "com.webosphoenix.slack", "jordan@Northwind", [["messaging", "MESSAGING"], ["contacts", "CONTACTS"]]);
    account(put, "acct-bluesky", "com.webosphoenix.bluesky", "jordan.bsky.social", [["contacts", "CONTACTS"], ["messaging", "MESSAGING"], ["notifications", "SOCIAL"]]);
    account(put, "acct-fedi", "com.webosphoenix.fediverse", "jordan@mastodon.example", [["contacts", "CONTACTS"], ["messaging", "MESSAGING"], ["notifications", "SOCIAL"]]);
    account(put, "acct-xmpp", "com.webosphoenix.xmpp", "jordan@chat.example", [["contacts", "CONTACTS"], ["im", "MESSAGING"]]);
    account(put, "acct-tg", "com.webosphoenix.telegram", "+13035550199", [["contacts", "CONTACTS"], ["im", "MESSAGING"]]);
    account(put, "acct-google", "com.webosphoenix.google", "jordan.avery@gmail.com", [["contacts", "CONTACTS"], ["calendar", "CALENDAR"], ["tasks", "TASKS"]]);
    account(put, "acct-ms", "com.webosphoenix.microsoft", "jordan@northwind.example", [["contacts", "CONTACTS"], ["calendar", "CALENDAR"], ["tasks", "TASKS"]], { alias: "Work" });
    account(put, "acct-zoom", "com.webosphoenix.zoom", "jordan@northwind.example", [["calendar", "CALENDAR"]]);
    account(put, "acct-todoist", "com.webosphoenix.todoist", "jordan@example.com", [["tasks", "TASKS"]]);
    account(put, "acct-dropbox", "com.webosphoenix.drive.dropbox", "jordan@example.com", [["files", "DOCUMENTS"]]);
    account(put, "acct-gdrive", "com.webosphoenix.drive.googledrive", "jordan.avery@gmail.com", [["files", "DOCUMENTS"]]);
    account(put, "acct-linkedin", "com.webosphoenix.linkedin", "Jordan Avery", [["contacts", "CONTACTS"]]);
    // The email accounts (mojomail's IMAP template): the device's own (test/device.cjs mail-acct) and a work one.
    put({ _id: "acct-mail", _kind: "com.palm.account:1", templateId: "com.palm.imap", username: "jordan@example.com", alias: "Personal", beingDeleted: false,
          capabilityProviders: [{ id: "com.palm.imap.mail", capability: "MAIL" }] });
    put({ _id: "acct-workmail", _kind: "com.palm.account:1", templateId: "com.palm.imap", username: "jordan@northwind.example", alias: "Work Mail", beingDeleted: false,
          capabilityProviders: [{ id: "com.palm.imap.mail", capability: "MAIL" }] });
    // IM accounts' login states (Messaging's My Status writes them).
    put({ _id: "login-xmpp", _kind: "com.palm.imloginstate.xmpp:1", accountId: "acct-xmpp", serviceName: "type_jabber", username: "jordan@chat.example", state: "online", availability: 0 });
    put({ _id: "login-tg", _kind: "com.palm.imloginstate.telegram:1", accountId: "acct-tg", serviceName: "type_telegram", username: "+13035550199", state: "online", availability: 0 });

    // ---- People, merged across accounts (their chat addresses on their cards) --------------
    put({ _id: "p-sam", _kind: "com.palm.person:1", name: { givenName: "Sam", familyName: "Delgado" }, phoneNumbers: [{ value: "(303) 555-0135", type: "type_mobile" }],
          emails: [{ value: "sam@example.com", type: "type_home" }], ims: [{ value: "sam@Northwind", type: "type_slack" }] });
    put({ _id: "p-priya", _kind: "com.palm.person:1", name: { givenName: "Priya", familyName: "Nair" }, phoneNumbers: [{ value: "(415) 555-0123", type: "type_mobile" }], emails: [],
          ims: [{ value: "priya@chat.example", type: "type_jabber" }] });
    put({ _id: "p-kai", _kind: "com.palm.person:1", name: { givenName: "Kai", familyName: "Tanaka" }, phoneNumbers: [], emails: [{ value: "kai@northwind.example", type: "type_work" }],
          ims: [{ value: "kai@chat.example", type: "type_jabber" }, { value: "kai@Northwind", type: "type_slack" }] });
    put({ _id: "p-noor", _kind: "com.palm.person:1", name: { givenName: "Noor", familyName: "Haddad" }, phoneNumbers: [], emails: [],
          ims: [{ value: "+13035550150", type: "type_telegram" }] });

    // ---- Conversations (Messaging's threads) and messages ----------------------------------
    // Sam's texts (test/device.cjs sms-1) are the latest with Sam: a text goes as a text.
    put({ _id: "t-sam", _kind: "com.palm.chatthread:1", displayName: "Sam Delgado", personId: "p-sam", replyService: "sms", replyAddress: "3035550135",
          timestamp: NOW - 10 * 60000, unreadCount: 1 });
    put({ _id: "t-priya", _kind: "com.palm.chatthread:1", displayName: "Priya Nair", personId: "p-priya", replyService: "sms", replyAddress: "4155550123",
          timestamp: NOW - 3600000, unreadCount: 0 });
    put({ _id: "th-sam-slack", _kind: "com.palm.chatthread:1", displayName: "Sam Delgado", personId: "p-sam", replyService: "type_slack", replyAddress: "sam@Northwind",
          timestamp: NOW - 50 * 60000, unreadCount: 1 });
    put({ _id: "th-design", _kind: "com.palm.chatthread:1", displayName: "#design", replyService: "type_slack", replyAddress: "#design@Northwind",
          timestamp: NOW - 20 * 60000, unreadCount: 1 });
    put({ _id: "th-priya-xmpp", _kind: "com.palm.chatthread:1", displayName: "Priya Nair", personId: "p-priya", replyService: "type_jabber", replyAddress: "priya@chat.example",
          timestamp: NOW - 2 * 86400000, unreadCount: 0 });
    put({ _id: "im-sam", _kind: "com.palm.immessage.slack:1", accountId: "acct-slack", folder: "inbox", status: "successful", serviceName: "type_slack", username: "jordan@Northwind",
          from: { addr: "sam@Northwind", name: "Sam Delgado" }, messageText: "Can you look at the release notes before lunch?", conversations: ["th-sam-slack"],
          localTimestamp: NOW - 50 * 60000, timestamp: NOW - 50 * 60000, flags: { read: false, visible: true } });
    put({ _id: "im-design", _kind: "com.palm.immessage.slack:1", accountId: "acct-slack", folder: "inbox", status: "successful", serviceName: "type_slack", username: "jordan@Northwind",
          from: { addr: "#design@Northwind", name: "#design" }, messageText: "Alex Rivera: the new launcher mock-ups are up", conversations: ["th-design"],
          localTimestamp: NOW - 20 * 60000, timestamp: NOW - 20 * 60000, flags: { read: false, visible: true } });
    put({ _id: "im-priya", _kind: "com.palm.immessage.xmpp:1", folder: "inbox", status: "successful", serviceName: "type_jabber", username: "jordan@chat.example",
          from: { addr: "priya@chat.example", name: "Priya Nair" }, messageText: "See you at the meetup", conversations: ["th-priya-xmpp"],
          localTimestamp: NOW - 2 * 86400000, timestamp: NOW - 2 * 86400000, flags: { read: true, visible: true } });

    // ---- Calendars and events --------------------------------------------------------------
    put({ _id: "cal-google", _kind: "com.palm.calendar.google:1", accountId: "acct-google", name: "jordan.avery@gmail.com", isReadOnly: false, syncSource: "Google" });
    put({ _id: "cal-family", _kind: "com.palm.calendar.google:1", accountId: "acct-google", name: "Family", isReadOnly: false, syncSource: "Google" });
    put({ _id: "cal-ms", _kind: "com.palm.calendar.microsoft:1", accountId: "acct-ms", name: "Calendar", isReadOnly: false, syncSource: "Microsoft" });
    put({ _id: "cal-zoom", _kind: "com.palm.calendar.zoom:1", accountId: "acct-zoom", name: "Zoom", isReadOnly: true, syncSource: "Zoom" });
    // A Teams meeting on the work calendar this afternoon, to which Jordan is invited (Graph's attendees).
    put({ _id: "ev-review", _kind: "com.palm.calendarevent.microsoft:1", accountId: "acct-ms", calendarId: "cal-ms", subject: "Design review", location: "Microsoft Teams Meeting",
          dtstart: at(8, 16), dtend: at(8, 17), allDay: false, tzId: "UTC", joinUrl: "https://teams.microsoft.com/l/meetup-join/19%3ameeting_review",
          note: "Join Microsoft Teams meeting: https://teams.microsoft.com/l/meetup-join/19%3ameeting_review",
          attendees: [{ email: "alex@example.com", commonName: "Alex Rivera", organizer: true },
                      { email: "jordan@northwind.example", commonName: "Jordan Avery", organizer: false, participationStatus: "NEEDS-ACTION", role: "REQ-PARTICIPANT" }] });
    // Zoom's meeting starting in five minutes.
    put({ _id: "ev-sync", _kind: "com.palm.calendarevent.zoom:1", accountId: "acct-zoom", calendarId: "cal-zoom", subject: "Weekly sync", location: "Zoom",
          dtstart: at(7, 10, 5), dtend: at(7, 10, 35), allDay: false, tzId: "UTC", url: "https://zoom.us/j/5551234567", joinUrl: "https://zoom.us/j/5551234567",
          note: "Join Zoom meeting: https://zoom.us/j/5551234567" });
    // Google: an invitation from Priya, and the family's.
    put({ _id: "ev-offsite", _kind: "com.palm.calendarevent.google:1", accountId: "acct-google", calendarId: "cal-google", subject: "Team offsite", location: "Lakeview Lodge",
          dtstart: at(16, 9), dtend: at(16, 17), allDay: false, tzId: "UTC",
          attendees: [{ email: "priya@example.net", commonName: "Priya Nair", organizer: true },
                      { email: "jordan.avery@gmail.com", commonName: "Jordan Avery", organizer: false, participationStatus: "NEEDS-ACTION", role: "REQ-PARTICIPANT" }] });
    put({ _id: "ev-soccer", _kind: "com.palm.calendarevent.google:1", accountId: "acct-google", calendarId: "cal-family", subject: "Soccer practice", location: "Riverside Park",
          dtstart: at(10, 9), dtend: at(10, 10, 30), allDay: false, tzId: "UTC" });

    // ---- Task lists and tasks --------------------------------------------------------------
    put({ _id: "tl-todo-inbox", _kind: "com.palm.tasklist.todoist:1", accountId: "acct-todoist", name: "Inbox", inbox: true, sortOrder: 100, taskKind: "com.palm.task.todoist:1" });
    put({ _id: "tl-todo-home", _kind: "com.palm.tasklist.todoist:1", accountId: "acct-todoist", name: "Home", sortOrder: 101, taskKind: "com.palm.task.todoist:1" });
    put({ _id: "tl-todo-shop", _kind: "com.palm.tasklist.todoist:1", accountId: "acct-todoist", name: "Shopping", sortOrder: 102, taskKind: "com.palm.task.todoist:1" });
    put({ _id: "tl-ms-tasks", _kind: "com.palm.tasklist.microsoft:1", accountId: "acct-ms", name: "Tasks", sortOrder: 200, taskKind: "com.palm.task.microsoft:1" });
    put({ _id: "tl-ms-office", _kind: "com.palm.tasklist.microsoft:1", accountId: "acct-ms", name: "Office", sortOrder: 201, taskKind: "com.palm.task.microsoft:1" });
    put({ _id: "tl-google", _kind: "com.palm.tasklist.google:1", accountId: "acct-google", name: "My Tasks", sortOrder: 300, taskKind: "com.palm.task.google:1" });
    put({ _id: "t-gate", _kind: "com.palm.task.todoist:1", accountId: "acct-todoist", listId: "tl-todo-home", summary: "Fix the gate", completed: false, createdTime: 10 });
    put({ _id: "t-plumber", _kind: "com.palm.task.todoist:1", accountId: "acct-todoist", listId: "tl-todo-home", summary: "Call the plumber", completed: false, createdTime: 11 });
    put({ _id: "t-coffee", _kind: "com.palm.task.todoist:1", accountId: "acct-todoist", listId: "tl-todo-shop", summary: "Coffee beans", completed: false, createdTime: 12 });
    put({ _id: "t-expenses", _kind: "com.palm.task.microsoft:1", accountId: "acct-ms", listId: "tl-ms-tasks", summary: "Submit the expense report", due: at(8, 0), allDay: true,
          completed: false, createdTime: 20 });
    put({ _id: "t-toner", _kind: "com.palm.task.microsoft:1", accountId: "acct-ms", listId: "tl-ms-office", summary: "Order toner", completed: false, createdTime: 21 });
    put({ _id: "t-passport", _kind: "com.palm.task.google:1", accountId: "acct-google", listId: "tl-google", summary: "Renew the passport", completed: false, createdTime: 30 });

    // ---- Email: the two accounts' folders and mail -------------------------------------------
    put({ _id: "mail-acct", _kind: "com.palm.imap.account:1", accountId: "acct-mail", email: "jordan@example.com", realName: "Jordan Avery", inboxFolderId: "f-inbox",
          trashFolderId: "f-trash" });
    put({ _id: "f-inbox", _kind: "com.palm.imap.folder:1", accountId: "acct-mail", displayName: "Inbox" });
    put({ _id: "f-trash", _kind: "com.palm.imap.folder:1", accountId: "acct-mail", displayName: "Trash" });
    put({ _id: "mail-work-acct", _kind: "com.palm.imap.account:1", accountId: "acct-workmail", email: "jordan@northwind.example", realName: "Jordan Avery",
          inboxFolderId: "fw-inbox", trashFolderId: "fw-trash", sentFolderId: "fw-sent" });
    put({ _id: "fw-inbox", _kind: "com.palm.imap.folder:1", accountId: "acct-workmail", displayName: "Inbox" });
    put({ _id: "fw-archive", _kind: "com.palm.imap.folder:1", accountId: "acct-workmail", displayName: "Archive" });
    put({ _id: "fw-trash", _kind: "com.palm.imap.folder:1", accountId: "acct-workmail", displayName: "Trash" });
    put({ _id: "fw-sent", _kind: "com.palm.imap.folder:1", accountId: "acct-workmail", displayName: "Sent" });
    put({ _id: "mail-q4", _kind: "com.palm.imap.email:1", folderId: "fw-inbox", subject: "Q4 budget review", from: { name: "Hannah Brooks", addr: "hannah@northwind.example" },
          summary: "Please look over the Q4 numbers before Friday.", timestamp: NOW - 25 * 60000, flags: { read: false, visible: true } });
    put({ _id: "mail-badge", _kind: "com.palm.imap.email:1", folderId: "fw-inbox", subject: "Your new badge", from: { name: "Northwind IT", addr: "it@northwind.example" },
          summary: "Pick up your new badge at the front desk.", timestamp: NOW - 5 * 3600000, flags: { read: true, visible: true } });
}

// The drives' files, as their connectors list them (paths under /media/drives/<accountId>).
var DRIVE_FILES = {
    "acct-dropbox": [{ name: "Budget 2027.xlsx", path: "/media/drives/acct-dropbox/Finance/Budget 2027.xlsx", type: "file", size: 48000, mtime: at(5, 9), remote: true }],
    "acct-gdrive": [{ name: "Trip itinerary.pdf", path: "/media/drives/acct-gdrive/Travel/Trip itinerary.pdf", type: "file", size: 120000, mtime: at(3, 18), remote: true }]
};

module.exports = { seed: seed, DRIVE_FILES: DRIVE_FILES };
