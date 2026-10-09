// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// sample-data.js: SIMULATOR-ONLY DEMO DATA.
//
// phoenix-runtime.js loads this file once, the first time an app runs in
// phoenix-sim or the browser dev server, and puts the objects it returns
// into the simulated db8, so the core apps have something to show: an
// owner profile, the HP webOS profile account (local contacts and
// calendar) and an email account, a few contacts, this week's calendar
// events, memos and emails. It is never used on a device.
//
// Every name, address and phone number here is fictional (example.com,
// 555-01xx numbers). Dates are relative to the moment the data is created.
//
// Object shapes follow what the real services store: accounts as
// com.palm.service.accounts creates them, persons as
// com.palm.service.contacts.linker builds them from contacts, calendar
// events as the Calendar app saves them, and email accounts, folders and
// messages as the mojomail IMAP transport syncs them.

/* exported phoenixSampleData */
var phoenixSampleData = function (now) {
    "use strict";

    var DAY = 24 * 60 * 60 * 1000;
    var PROFILE_ACCOUNT = "phoenix-sample-account-profile";
    var MAIL_ACCOUNT = "phoenix-sample-account-mail";

    var owner = { firstName: "Jordan", lastName: "Avery", email: "jordan.avery@example.com" };

    var objects = [];
    function add(o) { objects.push(o); return o; }

    // ---- Accounts ------------------------------------------------------------------

    add({
        _id: PROFILE_ACCOUNT,
        _kind: "com.palm.account:1",
        templateId: "com.palm.palmprofile",
        username: owner.email,
        beingDeleted: false,
        capabilityProviders: [
            { id: "com.palm.palmprofile.contacts", capability: "CONTACTS" },
            { id: "com.palm.palmprofile.calendar", capability: "CALENDAR" },
            { id: "com.palm.palmprofile.tasks", capability: "TASKS" },
            { id: "com.palm.palmprofile.memos", capability: "MEMOS" },
            { id: "com.palm.palmprofile.voice", capability: "PHONE" },
            { id: "com.palm.palmprofile.sms", capability: "MESSAGING" },
            { id: "com.palm.palmprofile.localfilestore", capability: "LOCAL.FILESTORAGE" }
        ]
    });

    add({
        _id: MAIL_ACCOUNT,
        _kind: "com.palm.account:1",
        templateId: "com.palm.imap",
        username: owner.email,
        alias: "Example Mail",
        beingDeleted: false,
        capabilityProviders: [{ id: "com.palm.imap.mail", capability: "MAIL" }]
    });

    // The apps' first-launch screens (Enyo accounts library) have been
    // seen, as on a device that has been set up.
    ["com.palm.app.contacts", "com.palm.app.calendar", "com.palm.app.email"].forEach(function (appId) {
        add({ _kind: "com.palm.firstlaunch:1", appId: appId, _sync: false });
    });

    // ---- Contacts --------------------------------------------------------------------
    //
    // Local contacts of the HP webOS profile account, and the person the
    // contacts linker makes of each (one contact per person here).

    // Contacts preferences (ContactsLib.AppPrefs singleton), as saved after
    // the first launch.
    add({
        _kind: "com.palm.app.contacts.prefs:1",
        listSortOrder: "LAST_FIRST",
        defaultAccountId: PROFILE_ACCOUNT,
        contactsPhoneRegion: "us"
    });

    // PhoneNumber.normalizePhoneNumber for NANP numbers: the digits of each
    // part reversed, subscriber and exchange first ("650-555-0123" ->
    // "-3210555-056--").
    function normalizePhone(value) {
        var d = value.replace(/\D/g, "");
        var rev = function (s) { return s.split("").reverse().join(""); };
        if (d.length === 10) return "-" + rev(d.slice(6)) + rev(d.slice(3, 6)) + "-" + rev(d.slice(0, 3)) + "--";
        return "-" + rev(d) + "---";
    }

    function contact(id, c) {
        var o = {
            _id: id,
            _kind: "com.palm.contact.palmprofile:1",
            accountId: PROFILE_ACCOUNT,
            name: { givenName: c.given || "", familyName: c.family || "", middleName: "", honorificPrefix: "", honorificSuffix: "" },
            nickname: c.nickname || "",
            emails: (c.emails || []).map(function (e) { return { value: e[1], type: e[0], primary: false }; }),
            phoneNumbers: (c.phones || []).map(function (e) { return { value: e[1], type: e[0], primary: false }; }),
            addresses: (c.addresses || []).map(function (a) {
                return { type: a[0], streetAddress: a[1], locality: a[2], region: a[3], postalCode: a[4], country: a[5], primary: false };
            }),
            organizations: c.company ? [{ name: c.company, title: c.title || "", department: "", type: "", description: "",
                                          startDate: "", endDate: "", location: {} }] : [],
            urls: (c.urls || []).map(function (u) { return { value: u, type: "type_work" }; }),
            ims: [],
            photos: [],
            relations: [],
            tags: [],
            birthday: c.birthday || "",
            anniversary: "",
            gender: "",
            note: c.note || ""
        };
        add(o);

        var family = o.name.familyName, given = o.name.givenName;
        var sortKey = family || given ? (family + "\t" + given).toLowerCase() : (c.company || "").toLowerCase();
        var terms = [];
        if (family || given) terms.push((given.charAt(0) + family).toLowerCase(), (family + given).toLowerCase());
        if (c.company) terms.push(c.company.toLowerCase().replace(/\s+/g, ""));
        add({
            _id: "person-" + id,
            _kind: "com.palm.person:1",
            contactIds: [id],
            name: o.name,
            names: [o.name],
            nickname: o.nickname,
            emails: o.emails.map(function (e) {
                return { value: e.value, type: e.type, primary: false, normalizedValue: e.value.toLowerCase(), favoriteData: {} };
            }),
            phoneNumbers: o.phoneNumbers.map(function (e) {
                return { value: e.value, type: e.type, primary: false, normalizedValue: normalizePhone(e.value), speedDial: "", favoriteData: {} };
            }),
            addresses: o.addresses,
            organization: o.organizations[0] || { name: "", title: "", department: "", type: "", description: "", startDate: "", endDate: "",
                                                  location: { country: "", locality: "", postalCode: "", primary: false, region: "", streetAddress: "", type: "type_work" } },
            urls: o.urls,
            ims: [],
            notes: o.note ? [o.note] : [],
            relations: [],
            photos: { accountId: "", bigPhotoId: "", bigPhotoPath: "", contactId: "", listPhotoPath: "", listPhotoSource: "", squarePhotoId: "", squarePhotoPath: "" },
            birthday: o.birthday,
            anniversary: "",
            gender: "",
            favorite: !!c.favorite,
            ringtone: { location: "", name: "" },
            reminder: "",
            launcherId: "",
            sortKey: sortKey,
            searchTerms: terms
        });
    }

    contact("phoenix-sample-contact-1", {
        given: "Alex", family: "Rivera", company: "Northwind Labs", title: "Product Designer",
        phones: [["type_mobile", "(408) 555-0144"], ["type_work", "(408) 555-0198"]],
        emails: [["type_work", "alex.rivera@example.com"]],
        addresses: [["type_work", "100 Market Street", "San Jose", "CA", "95113", "United States"]]
    });
    contact("phoenix-sample-contact-2", {
        given: "Priya", family: "Natarajan", birthday: "1988-04-12",
        phones: [["type_mobile", "(650) 555-0117"]],
        emails: [["type_home", "priya.natarajan@example.net"]]
    });
    contact("phoenix-sample-contact-3", {
        given: "Marcus", family: "Chen", company: "Harbor & Pine", title: "Chef",
        phones: [["type_home", "(415) 555-0163"]],
        emails: [["type_home", "marcus.chen@example.org"]],
        note: "Allergic to peanuts."
    });
    contact("phoenix-sample-contact-4", {
        given: "Sofia", family: "Lindqvist", company: "Example University", title: "Research Fellow",
        phones: [["type_work", "(617) 555-0108"]],
        emails: [["type_work", "sofia.lindqvist@example.edu"]],
        urls: ["http://www.example.edu/~slindqvist"]
    });
    contact("phoenix-sample-contact-5", {
        given: "Daniel", family: "Okafor", nickname: "Dan",
        phones: [["type_mobile", "(312) 555-0155"]],
        emails: [["type_home", "dan.okafor@example.com"]],
        addresses: [["type_home", "42 Lakeview Avenue", "Chicago", "IL", "60614", "United States"]]
    });
    contact("phoenix-sample-contact-6", {
        given: "Hannah", family: "Brooks", company: "Northwind Labs", title: "Engineering Manager",
        phones: [["type_work", "(408) 555-0120"], ["type_mobile", "(408) 555-0189"]],
        emails: [["type_work", "hannah.brooks@example.com"]]
    });
    contact("phoenix-sample-contact-7", {
        company: "Bistro Verde",
        phones: [["type_work", "(212) 555-0188"]],
        urls: ["http://www.example.com/bistroverde"],
        addresses: [["type_work", "7 Orchard Lane", "New York", "NY", "10002", "United States"]]
    });

    // The people Phone and Messaging's demo calls and conversations are with
    // (runtime seedPhoneDemoData looks them up by name). They are the
    // favourites. Numbers are unique in their last 7 digits, which is what
    // caller ID compares.
    [
        ["Ada", "Palmer", true, [["type_mobile", "(408) 555-0142"]]],
        ["Marcus", "Reyes", true, [["type_mobile", "(650) 555-0187"], ["type_work", "(650) 555-0110"]]],
        ["Priya", "Nair", true, [["type_mobile", "(415) 555-0123"]]],
        ["Lena", "Okafor", true, [["type_mobile", "(212) 555-0164"]]],
        ["Jonah", "Whitfield", false, [["type_home", "(408) 555-0199"]]],
        ["Sam", "Delgado", false, [["type_mobile", "(303) 555-0135"]]],
        ["Theo", "Lindqvist", false, [["type_work", "(206) 555-0171"]]]
    ].forEach(function (p, i) {
        contact("phoenix-sample-contact-" + (8 + i), { given: p[0], family: p[1], favorite: p[2], phones: p[3] });
    });

    // ---- Calendar ----------------------------------------------------------------------
    //
    // The profile account's local calendar (as CalendarsManager creates it)
    // and events around today: dtstart/dtend in ms, all-day events from
    // midnight to 23:59:59 as the Calendar app saves them.

    var CALENDAR = "phoenix-sample-calendar";
    var tz = (Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");

    add({
        _id: CALENDAR,
        _kind: "com.palm.calendar:1",
        accountId: PROFILE_ACCOUNT,
        name: "Phoenix Account",
        isReadOnly: false,
        syncSource: "Local",
        excludeFromAll: false,
        color: "blue"
    });

    function at(dayOffset, hour, minute) {
        var d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset, hour, minute || 0, 0, 0);
        return d.getTime();
    }

    var eventCount = 0;
    function event(e) {
        eventCount += 1;
        var o = add({
            _id: "phoenix-sample-event-" + eventCount,
            _kind: "com.palm.calendarevent:1",
            calendarId: CALENDAR,
            accountId: PROFILE_ACCOUNT,
            subject: e.subject,
            location: e.location || "",
            note: e.note || "",
            dtstart: e.allDay ? at(e.day, 0) : at(e.day, e.start[0], e.start[1]),
            dtend: e.allDay ? at(e.day, 23, 59) + 59 * 1000 : at(e.day, e.end[0], e.end[1]),
            allDay: !!e.allDay,
            tzId: tz,
            alarm: [{ action: "display", alarmTrigger: { value: e.allDay ? "-P1D" : "-PT15M", valueType: "DURATION" } }],
            attendees: (e.attendees || []).map(function (a) {
                return { email: a[1], commonName: a[0], organizer: false };
            })
        });
        if (e.rrule) o.rrule = e.rrule;
    }

    event({ day: 0, start: [9, 30], end: [10, 0], subject: "Team stand-up", location: "Room 4B",
            rrule: { freq: "WEEKLY", interval: 1, rules: [{ ruleType: "BYDAY", ruleValue: [{ day: 1 }, { day: 2 }, { day: 3 }, { day: 4 }, { day: 5 }] }] } });
    event({ day: 0, start: [12, 30], end: [13, 30], subject: "Lunch with Priya", location: "Bistro Verde",
            attendees: [["Priya Natarajan", "priya.natarajan@example.net"]] });
    event({ day: 0, start: [15, 0], end: [16, 0], subject: "Design review", location: "Northwind Labs",
            note: "Bring the new launcher mock-ups.", attendees: [["Alex Rivera", "alex.rivera@example.com"], ["Hannah Brooks", "hannah.brooks@example.com"]] });
    event({ day: 1, start: [8, 0], end: [9, 0], subject: "Gym" });
    event({ day: 1, start: [18, 30], end: [21, 0], subject: "Dinner at Marcus's", location: "42 Lakeview Avenue" });
    event({ day: 2, allDay: true, subject: "Priya's birthday" });
    event({ day: 2, start: [14, 0], end: [15, 30], subject: "Dentist", location: "Downtown Dental" });
    event({ day: 3, start: [10, 0], end: [11, 0], subject: "Call with Sofia", note: "Research collaboration" });
    event({ day: 4, start: [17, 0], end: [18, 0], subject: "Farmers market" });
    event({ day: -1, start: [11, 0], end: [12, 0], subject: "Quarterly planning", location: "Room 2A" });
    event({ day: 5, allDay: true, subject: "Weekend hike", location: "Coastal trail" });

    // ---- Memos -----------------------------------------------------------------------
    //
    // As the Memos app saves them (app/models/Memo.js): text, a title of its
    // first 50 characters, a colour, and a position string for the order
    // on the wall (new memos go before "m").

    [["Groceries\nMilk, eggs, spinach\nCoffee beans\nBirthday card for Priya", "yellow"],
     ["Ideas for the launcher: bigger quick launch icons, card stack shadows", "blue"],
     ["Wi-Fi at the cabin: network \"Lakeview\", password on the fridge", "green"],
     ["Books to read\n- A Field Guide to Coastal Birds\n- The Soul of a New Machine", "pink"]
    ].forEach(function (m, i) {
        add({
            _id: "phoenix-sample-memo-" + (i + 1),
            _kind: "com.palm.note:1",
            text: m[0],
            title: m[0].substring(0, 50),
            color: m[1],
            position: String.fromCharCode("m".charCodeAt(0) + i),
            createdTimestamp: now.getTime() - (i + 1) * DAY,
            modifiedTimestamp: now.getTime() - (i + 1) * DAY
        });
    });

    // ---- Email -----------------------------------------------------------------------
    //
    // An IMAP account as the mojomail IMAP transport stores it
    // (com.palm.imap.account:1, folders, messages). The Email app derives
    // folder and message sort keys itself. Message bodies are files, as in
    // the transport's file cache; here they are served from
    // /usr/share/phoenix/runtime/sample-mail/.

    var FOLDERS = {
        inbox: "phoenix-sample-folder-inbox",
        drafts: "phoenix-sample-folder-drafts",
        sent: "phoenix-sample-folder-sent",
        outbox: "phoenix-sample-folder-outbox",
        trash: "phoenix-sample-folder-trash",
        receipts: "phoenix-sample-folder-receipts"
    };

    add({
        _id: "phoenix-sample-imap-account",
        _kind: "com.palm.imap.account:1",
        accountId: MAIL_ACCOUNT,
        templateId: "com.palm.imap",
        username: owner.email,
        email: owner.email,
        realName: owner.firstName + " " + owner.lastName,
        server: "imap.example.com",
        port: 993,
        encryption: "ssl",
        syncFrequencyMins: -1,
        syncWindowDays: 7,
        signature: "",
        notifications: { enabled: true, type: "mute", ringtoneName: "", ringtonePath: "" },
        smtpConfig: { server: "smtp.example.com", port: 587, encryption: "tls", username: owner.email, useSmtpAuth: true },
        inboxFolderId: FOLDERS.inbox,
        draftsFolderId: FOLDERS.drafts,
        sentFolderId: FOLDERS.sent,
        outboxFolderId: FOLDERS.outbox,
        trashFolderId: FOLDERS.trash
    });

    [["inbox", "Inbox", true], ["drafts", "Drafts"], ["sent", "Sent"], ["outbox", "Outbox"],
     ["trash", "Trash"], ["receipts", "Receipts"]].forEach(function (f) {
        add({
            _id: FOLDERS[f[0]],
            _kind: "com.palm.imap.folder:1",
            accountId: MAIL_ACCOUNT,
            parentId: null,
            displayName: f[1],
            favorite: !!f[2],
            serverFolderName: f[0] === "inbox" ? "INBOX" : f[1],
            delimiter: "/",
            selectable: true
        });
    });

    var mailCount = 0;
    function mail(m) {
        mailCount += 1;
        var fromMe = m.folder === "sent";
        var me = { name: owner.firstName + " " + owner.lastName, addr: owner.email };
        var from = fromMe ? me : { name: m.from[0], addr: m.from[1] };
        var to = fromMe ? [{ name: m.to[0], addr: m.to[1], type: "to" }] : [{ name: me.name, addr: me.addr, type: "to" }];
        add({
            _id: "phoenix-sample-email-" + mailCount,
            _kind: "com.palm.imap.email:1",
            folderId: FOLDERS[m.folder || "inbox"],
            from: { name: from.name, addr: from.addr, type: "from" },
            to: to.concat((m.cc || []).map(function (c) { return { name: c[0], addr: c[1], type: "cc" }; })),
            subject: m.subject,
            summary: m.summary,
            timestamp: now.getTime() - m.ago * 60 * 1000,
            flags: { read: !!m.read, flagged: !!m.flagged, replied: !!m.replied, visible: true },
            parts: [{ type: "body", mimeType: "text/html", charset: "utf-8",
                      path: "/usr/share/phoenix/runtime/sample-mail/" + m.body + ".html" }],
            messageId: "<phoenix-sample-" + mailCount + "@example.com>",
            uid: 1000 + mailCount,
            // Mail already on the device, not new mail to announce: the
            // Email app marks a message in with its initialRev
            // (EmailProcessor.js _setInitialRev), and its DashboardManager
            // announces those with a later one than it found at start.
            // Without it the app marked them as it started, sometimes after
            // that look, and showed the unread ones as new mail.
            initialRev: 1
        });
    }

    mail({ ago: 25, from: ["Alex Rivera", "alex.rivera@example.com"], subject: "Launcher mock-ups for Thursday",
           summary: "Hi Jordan, here are the latest launcher mock-ups ahead of Thursday's design review.", body: "mockups",
           cc: [["Hannah Brooks", "hannah.brooks@example.com"]] });
    mail({ ago: 70, from: ["Priya Natarajan", "priya.natarajan@example.net"], subject: "Lunch today?",
           summary: "Are we still on for lunch at Bistro Verde? I can book a table for 12:30.", body: "lunch" });
    mail({ ago: 60 * 20, read: true, from: ["Northwind Labs IT", "it-helpdesk@example.com"], subject: "Scheduled maintenance this weekend",
           summary: "The build servers will be offline on Saturday from 8:00 to 12:00 for scheduled maintenance.", body: "maintenance" });
    mail({ ago: 60 * 44, read: true, flagged: true, from: ["Sofia Lindqvist", "sofia.lindqvist@example.edu"], subject: "Paper draft for review",
           summary: "Thanks for offering to read the draft. The discussion section is still rough.", body: "paper" });
    mail({ ago: 60 * 70, read: true, replied: true, from: ["Daniel Okafor", "dan.okafor@example.com"], subject: "Photos from the hike",
           summary: "Great day out on Saturday! I've put the photos in a shared album.", body: "hike" });
    mail({ ago: 60 * 98, read: true, folder: "receipts", from: ["Example Books", "orders@example.com"], subject: "Your order has shipped",
           summary: "Order #1042 has shipped and should arrive on Friday.", body: "order" });
    mail({ ago: 60 * 69, read: true, folder: "sent", to: ["Daniel Okafor", "dan.okafor@example.com"], subject: "Re: Photos from the hike",
           summary: "These are fantastic, thanks for sharing! The one at the summit is my favourite.", body: "reply" });

    // The accounts' credentials, as the accounts service keeps them once an
    // account is set up (a device never has an account without them;
    // luna-systemui's "Accounts: Action Needed" says so). Demo values.
    var credentials = {};
    credentials[MAIL_ACCOUNT] = { common: { password: "phoenix-demo" } };

    return {
        version: 2,
        profile: owner,
        objects: objects,
        credentials: credentials
    };
};
