// Phoenix compat: Contacts on a phone.
//
// The TouchPad Contacts app shows its contact list (320 px) and the
// selected contact's details side by side (SplitPane). A phone card is
// only 320 px wide, so there the details replace the list when a contact
// is tapped, and the back gesture returns to the list. ContactsApp already
// has a backHandler for this narrow mode (views "contacts"/"details"), but
// the released app never wires it to the back gesture; this does, and
// otherwise leaves the app's navigation alone. On wider cards nothing
// changes. Styles: css/phoenix-compat.css. A contact another app opened
// Contacts on ($caller) closes on Back instead (callerOpened, below).

/*global enyo, SplitPane, ContactsApp, PalmSystem */
(function () {
    "use strict";

    var NARROW = 480; // px; phone cards are 320 wide (452 in landscape)

    function narrow() {
        return (document.body ? document.body.offsetWidth : window.innerWidth) <= NARROW;
    }

    var split = SplitPane.prototype;
    var create = split.create, contactClick = split.contactClick, showPerson = split.showPerson;

    split.create = function () {
        create.apply(this, arguments);
        this.addClass("phoenix-splitpane");
    };

    // Show the details pane instead of the list (phone only; the class has
    // no effect on wider cards).
    split.phoenixShowDetails = function (inShow) {
        if (this.hasClass("phoenix-details") === !!inShow) {
            return;
        }
        this.addRemoveClass("phoenix-details", !!inShow);
        // Lists and scrollers measure themselves; let them re-layout.
        this.resized();
    };

    // The contact another app opened Contacts on to show it (launch params
    // {id, $caller}: the Assistant's "Open Contacts", applicationManager
    // launch {returnToCaller}). Back there is not Contacts' to take: the
    // runtime closes the card and the caller is in front again
    // (runtime/phoenix-runtime.js runtime.back). A contact tapped in the
    // list is the user's own navigation, and Back returns to the list.
    function callerOpened(id) {
        var p = {};
        try { p = JSON.parse((window.PalmSystem && PalmSystem.launchParams) || "{}") || {}; } catch (e) { p = {}; }
        return typeof p.$caller === "string" && p.$caller !== "" && !!id && p.id === id;
    }

    split.contactClick = function (inSender, inPerson) {
        this.phoenixFromCaller = false;
        var r = contactClick.apply(this, arguments);
        this.phoenixShowDetails(true);
        return r;
    };

    split.showPerson = function (inSender, inPersonId, inPerson) {
        var r = showPerson.apply(this, arguments);
        this.phoenixFromCaller = !inSender && callerOpened(inPersonId);
        if (inPersonId || inPerson) {
            this.phoenixShowDetails(true);
        }
        return r;
    };

    var app = ContactsApp.prototype;
    var appCreate = app.create;

    app.create = function () {
        appCreate.apply(this, arguments);
        this.createComponent({kind: "ApplicationEvents", onBack: "phoenixBack"});
    };

    app.phoenixBack = function (inSender, inEvent) {
        var split = this.$.splitPane;
        if (narrow() && this.$.pane.getViewName() === "splitPane" && split.hasClass("phoenix-details")) {
            if (split.phoenixFromCaller) {
                return false;
            }
            split.phoenixShowDetails(false);
            inEvent.preventDefault();
            return true;
        }
        // Other views (edit, preferences, accounts): the app's own handler.
        return this.backHandler(inSender, inEvent);
    };
})();
