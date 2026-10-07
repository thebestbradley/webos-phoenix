// Phoenix compat: a contact's own tones (docs/M6-PLAN.md F4; the
// community's "SMS Tone per Contact" and ringtone-per-contact patches).
//
// Edit gains a Tones group above Delete: Ringtone (the person's own
// ringtone, com.palm.person ringtone, which Phone already rings with) and
// Message tone (what Messaging's notification of a text from them plays).
// The released app has Edit.ringtoneClick but no view behind it (its
// Ringtones.js is missing, see that file), so the picker here is a
// PopupSelect of "Default", the system's tones and the ringtones
// (com.palm.systemservice ringtone/listRingtones).
//
// The ringtone is saved with the person. The message tone lives beside it
// in org.webosphoenix.contacttone:1 {personId, messageTone: {name,
// location}}: the contacts framework saves the person whole from the
// fields it knows (Person.getDBObject), so a field of Phoenix's own on the
// person would not survive the next edit. It is written once the person is
// saved (doneUpdateContact), when the person has its id.

/*global enyo, $L, Edit, PalmCall */
(function () {
    "use strict";

    var TONE_KIND = "org.webosphoenix.contacttone:1";
    // The alert and notification tones LunaSysMgr shipped, before the ringtones.
    var SYSTEM_TONES = [
        { name: "Alert", fullPath: "/usr/palm/sounds/alert.wav" },
        { name: "Notification", fullPath: "/usr/palm/sounds/notification.wav" }
    ];

    function db(method, params) {
        return PalmCall.call("palm://com.palm.db/", method, params);
    }

    var edit = Edit.prototype;
    var create = edit.create, renderContact = edit.renderContact, doneUpdateContact = edit.doneUpdateContact;

    edit.create = function () {
        create.apply(this, arguments);
        var before = this.$.deleteButton, box = before.container;
        box.createComponent({name: "phoenixTones", kind: "RowGroup", caption: $L("Tones"), components: [
            {name: "phoenixRingtoneRow", kind: "Item", layoutKind: "HFlexLayout", align: "center", tapHighlight: true,
                onclick: "phoenixPickRingtone", components: [
                    {content: $L("Ringtone"), flex: 1},
                    {name: "phoenixRingtoneName", className: "phoenix-tone-name"}
                ]},
            {name: "phoenixMessageToneRow", kind: "Item", layoutKind: "HFlexLayout", align: "center", tapHighlight: true,
                onclick: "phoenixPickMessageTone", components: [
                    {content: $L("Message tone"), flex: 1},
                    {name: "phoenixMessageToneName", className: "phoenix-tone-name"}
                ]}
        ]}, {owner: this});
        // Above Delete.
        var kids = box.children, group = this.$.phoenixTones;
        kids.splice(kids.indexOf(group), 1);
        kids.splice(kids.indexOf(before), 0, group);
        this.createComponent({name: "phoenixToneMenu", kind: "PopupSelect", onSelect: "phoenixToneSelected"}, {owner: this});
        this.phoenixTones = [];
        var that = this;
        PalmCall.call("palm://com.palm.systemservice/ringtone/", "listRingtones", {}).then(function (f) {
            var r = f.result || {};
            that.phoenixTones = SYSTEM_TONES.concat(r.ringtones || []);
        });
        db("putKind", {id: TONE_KIND, owner: "com.palm.app.contacts", indexes: [{name: "personId", props: [{name: "personId"}]}]});
    };

    edit.renderContact = function () {
        renderContact.apply(this, arguments);
        var rt = this.person.getRingtone();
        this.phoenixRingtone = rt && rt.getLocation() ? {name: rt.getName(), fullPath: rt.getLocation()} : null;
        this.phoenixMessageTone = null;
        this.phoenixMessageToneChanged = false;
        this.phoenixShowTones();
        var id = this.person.getId(), that = this;
        if (id) {
            db("find", {query: {from: TONE_KIND, where: [{prop: "personId", op: "=", val: id}]}}).then(function (f) {
                var t = (f.result && f.result.results || [])[0];
                if (t && t.messageTone && t.messageTone.location && !that.phoenixMessageToneChanged) {
                    that.phoenixMessageTone = {name: t.messageTone.name, fullPath: t.messageTone.location};
                    that.phoenixShowTones();
                }
            });
        }
    };

    edit.phoenixShowTones = function () {
        this.$.phoenixRingtoneName.setContent(this.phoenixRingtone ? this.phoenixRingtone.name : $L("Default"));
        this.$.phoenixMessageToneName.setContent(this.phoenixMessageTone ? this.phoenixMessageTone.name : $L("Default"));
    };

    edit.phoenixOpenToneMenu = function (which, current) {
        this.phoenixPicking = which;
        var items = [{caption: $L("Default"), value: ""}];
        this.phoenixTones.forEach(function (t) {
            items.push({caption: t.name, value: t.fullPath});
        });
        this.$.phoenixToneMenu.setItems(items);
        this.$.phoenixToneMenu.openAtCenter();
    };
    edit.phoenixPickRingtone = function () {
        this.phoenixOpenToneMenu("ringtone");
    };
    edit.phoenixPickMessageTone = function () {
        this.phoenixOpenToneMenu("message");
    };
    // inSelected: the menu's item (as Edit.onPhotoMenuSelect takes it).
    edit.phoenixToneSelected = function (inSender, inSelected) {
        var inValue = inSelected && inSelected.getValue ? inSelected.getValue() : inSelected;
        var tone = null;
        this.phoenixTones.forEach(function (t) {
            if (t.fullPath === inValue) {
                tone = t;
            }
        });
        if (this.phoenixPicking === "ringtone") {
            this.phoenixRingtone = tone;
            var rt = this.person.getRingtone();
            rt.setName(tone ? tone.name : "");
            rt.setLocation(tone ? tone.fullPath : "");
            this.newPersonIsDirty = true;
        } else {
            this.phoenixMessageTone = tone;
            this.phoenixMessageToneChanged = true;
        }
        this.phoenixShowTones();
    };

    // Saved: the message tone, now that the person has its id.
    edit.doneUpdateContact = function () {
        var id = this.person.getId(), tone = this.phoenixMessageTone, args = arguments, that = this;
        if (!id || !this.phoenixMessageToneChanged) {
            return doneUpdateContact.apply(this, args);
        }
        this.phoenixMessageToneChanged = false;
        db("find", {query: {from: TONE_KIND, where: [{prop: "personId", op: "=", val: id}]}}).then(function (f) {
            var old = (f.result && f.result.results || []).map(function (t) { return t._id; });
            var next = old.length ? db("del", {ids: old}) : null;
            var put = function () {
                return tone ? db("put", {objects: [{_kind: TONE_KIND, personId: id, messageTone: {name: tone.name, location: tone.fullPath}}]}) : null;
            };
            if (next) {
                next.then(function () { put(); });
            } else {
                put();
            }
        });
        return doneUpdateContact.apply(this, args);
    };
}());
