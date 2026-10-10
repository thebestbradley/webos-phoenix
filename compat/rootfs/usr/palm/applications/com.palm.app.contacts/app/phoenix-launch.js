// Phoenix compat: the launches other webOS apps sent Contacts that the
// TouchPad Contacts app (ContactsApp.js:93-125 handleLaunchParams) does not
// read, translated into the ones it does, in one place
// (docs/LAUNCH-CONTRACTS.md; tools/launch-contracts.json lists the keys):
//
// - {launchType: "reminder", personId, focusField}: Just Type's "Add
//   Reminder" on a contact (luna-applauncher data/AppLauncher.js:179-186).
//   The webOS 2.x Contacts opened that person's reminder; the TouchPad app
//   keeps the reminder in the person's details, so the person is shown.
// - {personId} alone: the person, as {id} (Contacts reads "id" only, :111).
// - {target: "opencontact://{...}"}: Calendar's "Add to Contacts" on an
//   attendee ({launchType: "addToContacts", name, points: [{type: "email",
//   value}]}, core-apps com.palm.app.calendar app/shared/LunaAppManager.js:
//   111-124), which luna-sysmgr handed to Contacts by its scheme
//   (compat/rootfs/usr/palm/command-resource-handlers.json): a new contact
//   with that name and address, as {launchType: "newContact", contact}.
//
// Everything else goes to the original as it is.

/*global ContactsApp */
(function () {
    "use strict";

    var app = ContactsApp.prototype;
    var handle = app.handleLaunchParams;

    function splitName(name) {
        var words = String(name || "").trim().split(/\s+/).filter(Boolean);
        if (!words.length) {
            return undefined;
        }
        return words.length === 1 ? {givenName: words[0]} : {givenName: words.slice(0, -1).join(" "), familyName: words[words.length - 1]};
    }

    // opencontact://{json} -> the new contact it describes, else null.
    function openContact(target) {
        var m = /^opencontact:(?:\/\/)?(.*)$/i.exec(String(target || "")), p;
        if (!m) {
            return null;
        }
        try {
            p = JSON.parse(m[1]);
        } catch (e) {
            try { p = JSON.parse(decodeURIComponent(m[1])); } catch (e2) { return null; }
        }
        if (!p || typeof p !== "object") {
            return null;
        }
        var contact = {}, name = splitName(p.name);
        if (name) {
            contact.name = name;
        }
        (p.points || []).forEach(function (pt) {
            if (!pt || !pt.value) {
                return;
            }
            if (pt.type === "email") {
                (contact.emails = contact.emails || []).push({value: pt.value});
            } else if (pt.type === "phone") {
                (contact.phoneNumbers = contact.phoneNumbers || []).push({value: pt.value});
            }
        });
        return {launchType: "newContact", contact: contact};
    }

    // Exposed for tools/test-launch-contracts.cjs.
    app.phoenixLaunchParams = function (p) {
        if (!p || typeof p !== "object") {
            return p;
        }
        if (p.launchType === "reminder" && p.personId) {
            return {launchType: "showPerson", id: p.personId};
        }
        if (!p.launchType && !p.id && p.personId) {
            return {launchType: "showPerson", id: p.personId};
        }
        return openContact(p.target) || p;
    };

    app.handleLaunchParams = function (launchParams) {
        return handle.call(this, this.phoenixLaunchParams(launchParams));
    };
}());
