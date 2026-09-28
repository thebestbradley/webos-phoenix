// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Keeps com.palm.person:1 records for synced contacts: the part of the
// contacts linker (third_party/app-services/com.palm.service.contacts.linker)
// that the Contacts app cannot do without. The apps list and show persons,
// never contacts, so a contact without a person is invisible.
//
// On webOS the linker watches com.palm.contact:1 (its activity
// activities/com.palm.service.contacts.linker/com.palm.service.contacts.linker.json)
// and runs Autolinker.performAutolink (autolinker.js) on each change. Neither
// webOS OSE nor the simulator runs it yet, so the DAV transport calls this
// after each sync. It applies the linker's strongest rules only: a contact
// joins an existing person with the same email address (similarEmail), the
// same mobile number (similarPhoneNumber, mobile) or the same given and
// family name (similarName); each weighs 100 in autoLinkUnit.js, the match
// threshold. Once the real linker runs on the device, turn this off
// (linkPersons: false) and it takes over.
//
// Person fields are built the way runtime/sample-data.js builds them (the
// shape the Contacts app reads): names, emails and phone numbers with
// normalizedValue, organization, photos, sortKey, searchTerms.

"use strict";

var PERSON_KIND = "com.palm.person:1";

// PhoneNumber.normalizePhoneNumber for NANP numbers, as runtime/sample-data.js:
// the digits of each part reversed, subscriber and exchange first.
function normalizePhone(value) {
    var d = String(value || "").replace(/\D/g, "");
    var rev = function (s) { return s.split("").reverse().join(""); };
    if (d.length === 11 && d.charAt(0) === "1") d = d.slice(1);
    if (d.length === 10) return "-" + rev(d.slice(6)) + rev(d.slice(3, 6)) + "-" + rev(d.slice(0, 3)) + "--";
    return "-" + rev(d) + "---";
}

function emptyName() { return { givenName: "", familyName: "", middleName: "", honorificPrefix: "", honorificSuffix: "" }; }

function buildPerson(existing, contacts) {
    var p = existing ? JSON.parse(JSON.stringify(existing)) : { _kind: PERSON_KIND, favorite: false,
        ringtone: { location: "", name: "" }, reminder: "", launcherId: "", relations: [], anniversary: "", gender: "" };
    p.contactIds = contacts.map(function (c) { return c._id; });
    var named = contacts.filter(function (c) { return c.name && (c.name.givenName || c.name.familyName); })[0] || contacts[0] || {};
    p.name = Object.assign(emptyName(), named.name || {});
    p.names = [];
    contacts.forEach(function (c) {
        if (!c.name) return;
        var n = Object.assign(emptyName(), c.name);
        if (!p.names.some(function (x) { return JSON.stringify(x) === JSON.stringify(n); })) p.names.push(n);
    });
    p.nickname = (contacts.filter(function (c) { return c.nickname; })[0] || {}).nickname || "";
    var seen = {};
    p.emails = [];
    p.phoneNumbers = [];
    p.addresses = [];
    p.urls = [];
    p.ims = [];
    contacts.forEach(function (c) {
        (c.emails || []).forEach(function (e) {
            var k = "e" + String(e.value).toLowerCase();
            if (seen[k] || !e.value) return;
            seen[k] = true;
            p.emails.push({ value: e.value, type: e.type || "type_other", primary: !!e.primary,
                            normalizedValue: String(e.value).toLowerCase(), favoriteData: {} });
        });
        (c.phoneNumbers || []).forEach(function (e) {
            var n = normalizePhone(e.value), k = "p" + n;
            if (seen[k] || !e.value) return;
            seen[k] = true;
            p.phoneNumbers.push({ value: e.value, type: e.type || "type_other", primary: !!e.primary,
                                  normalizedValue: n, speedDial: "", favoriteData: {} });
        });
        (c.addresses || []).forEach(function (a) { p.addresses.push(a); });
        (c.urls || []).forEach(function (u) { p.urls.push(u); });
        (c.ims || []).forEach(function (im) {
            p.ims.push({ value: im.value, type: im.type, primary: !!im.primary,
                         normalizedValue: String(im.value).toLowerCase(), favoriteData: {} });
        });
    });
    var org = contacts.map(function (c) { return (c.organizations || [])[0]; }).filter(Boolean)[0];
    p.organization = org ? Object.assign({ name: "", title: "", department: "", type: "", description: "",
                                           startDate: "", endDate: "", location: {} }, org)
                         : { name: "", title: "", department: "", type: "", description: "", startDate: "", endDate: "",
                             location: { country: "", locality: "", postalCode: "", primary: false, region: "", streetAddress: "", type: "type_work" } };
    p.notes = contacts.map(function (c) { return c.note; }).filter(Boolean);
    p.birthday = (contacts.filter(function (c) { return c.birthday; })[0] || {}).birthday || "";
    p.anniversary = (contacts.filter(function (c) { return c.anniversary; })[0] || {}).anniversary || p.anniversary || "";
    var withPhoto = contacts.filter(function (c) { return (c.photos || []).some(function (ph) { return ph.localPath || ph.value; }); })[0];
    if (withPhoto) {
        var ph = withPhoto.photos.filter(function (x) { return x.localPath || x.value; })[0];
        var path = ph.localPath || ph.value;
        p.photos = { accountId: withPhoto.accountId || "", contactId: withPhoto._id, bigPhotoId: ph._id || "", squarePhotoId: ph._id || "",
                     bigPhotoPath: path, squarePhotoPath: path, listPhotoPath: path, listPhotoSource: path };
    } else {
        p.photos = { accountId: "", bigPhotoId: "", bigPhotoPath: "", contactId: "", listPhotoPath: "", listPhotoSource: "",
                     squarePhotoId: "", squarePhotoPath: "" };
    }
    var family = p.name.familyName || "", given = p.name.givenName || "";
    p.sortKey = family || given ? (family + "\t" + given).toLowerCase() : (p.organization.name || p.nickname || "").toLowerCase();
    var terms = [];
    if (family || given) terms.push((given.charAt(0) + family).toLowerCase(), (family + given).toLowerCase());
    if (p.organization.name) terms.push(p.organization.name.toLowerCase().replace(/\s+/g, ""));
    p.searchTerms = terms;
    return p;
}

// A person to link a new contact to, or null (the linker's strongest rules).
function findSimilar(db, contact) {
    var tries = [];
    (contact.emails || []).forEach(function (e) {
        if (e.value) tries.push({ prop: "emails.normalizedValue", val: String(e.value).toLowerCase() });
    });
    (contact.phoneNumbers || []).forEach(function (e) {
        if (e.value && e.type === "type_mobile") tries.push({ prop: "phoneNumbers.normalizedValue", val: normalizePhone(e.value) });
    });
    var n = contact.name || {};
    var i = 0;
    function next() {
        if (i < tries.length) {
            var t = tries[i++];
            return db.find({ from: PERSON_KIND, where: [{ prop: t.prop, op: "=", val: t.val }], limit: 1 }).then(function (r) {
                return r[0] || next();
            });
        }
        if (n.givenName && n.familyName) {
            return db.find({ from: PERSON_KIND, where: [{ prop: "names.familyName", op: "=", val: n.familyName },
                                                         { prop: "names.givenName", op: "=", val: n.givenName }], limit: 1 })
                .then(function (r) { return r[0] || null; });
        }
        return Promise.resolve(null);
    }
    return next();
}

// Brings persons up to date after a sync: changedIds were added or
// changed, removedIds deleted. Returns the ids of persons written.
function updatePersons(db, changedIds, removedIds) {
    var touched = {};
    function personOf(contactId) {
        return db.find({ from: PERSON_KIND, where: [{ prop: "contactIds", op: "=", val: contactId }], limit: 1 })
            .then(function (r) { return r[0] || null; });
    }
    function rebuild(person, extraContactIds, dropIds) {
        var ids = (person ? person.contactIds || [] : []).concat(extraContactIds || []).filter(function (id, i, a) {
            return a.indexOf(id) === i && (dropIds || []).indexOf(id) < 0;
        });
        return (ids.length ? db.get(ids) : Promise.resolve([])).then(function (contacts) {
            contacts = contacts.filter(function (c) { return c && !c._del; });
            if (!contacts.length) {
                return person && person._id ? db.del([person._id]).then(function () { return null; }) : null;
            }
            var p = buildPerson(person, contacts);
            return db.put([p]).then(function (r) { touched[r[0].id] = true; return p; });
        });
    }
    var chain = Promise.resolve();
    (removedIds || []).forEach(function (id) {
        chain = chain.then(function () {
            return personOf(id).then(function (person) { if (person) return rebuild(person, [], [id]); });
        });
    });
    (changedIds || []).forEach(function (id) {
        chain = chain.then(function () {
            return personOf(id).then(function (person) {
                if (person) return rebuild(person);
                return db.get([id]).then(function (r) {
                    var contact = r[0];
                    if (!contact) return null;
                    return findSimilar(db, contact).then(function (similar) { return rebuild(similar, [id]); });
                });
            });
        });
    });
    return chain.then(function () { return Object.keys(touched); });
}

module.exports = { updatePersons: updatePersons, buildPerson: buildPerson, normalizePhone: normalizePhone, PERSON_KIND: PERSON_KIND };
