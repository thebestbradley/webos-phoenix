// Phoenix compat: the Email window's message view, and phone navigation.
//
// 1. DivHtmlView.setRedirects. MessageDisplay.rendered() calls
//    this.$.body.setRedirects(...) whenever PalmSystem exists, a leftover
//    from when the message body was an enyo.WebView (redirect rules only
//    matter to a WebView navigating). The released app shows bodies in a
//    DivHtmlView, which has no such method, so rendering the message view
//    throws. A no-op keeps the released behaviour of the div view: links
//    are handled by its own click handler.
//
// 2. One pane at a time on a phone. The window is an enyo.SlidingPane of
//    folders | message list | message. Below 500 px the SlidingPane itself
//    switches to showing one view at a time, and the app's back handler
//    already walks back through them, but the TouchPad app never selects
//    the next view when a folder or a message is tapped (all three are
//    always on screen there; MailApp.slideInMessageListPane is empty). On a
//    single-view SlidingPane, show the message list when a folder is
//    chosen and the message when one is tapped. Wider cards are unchanged.
//
// 3. Print. MessagePane.renderDocument prints the message with
//    callBody("printFrame", [...]), which, written for an enyo.WebView body,
//    calls the view's printFrame or else its callBrowserAdapter; the
//    DivHtmlView has neither, so Print threw and the print dialog waited
//    for ever. Here the div view prints what it shows: the message's
//    heading (subject, from, to, date as the header shows them) and its
//    sanitized HTML, as a page of its own, through the print manager
//    (__phoenixRuntime.print.renderHtml; on a device, the print service).
//
// 4. Opened by another app to show a message (launch params {emailId,
//    $caller}: the Assistant's "Open Email", applicationManager launch
//    {returnToCaller}). Back there closes the card (MailApp's backHandler
//    would slide to the folders), so the caller is in front again, as
//    runtime.back does for other apps (runtime/phoenix-runtime.js). Once the user picks a folder or a message, Back walks
//    the panes as before.
//
// 5. Open Email in New Card. The original has it: MailApp's app menu
//    lists "Open Email in New Card" (mail/source/MailApp.js:87), the
//    message view's handler sends the message on (MessagePane.js:350-355,
//    doOpenNewCard("email", {message})), and MailApp.openNewCard
//    (MailApp.js:634-641) opens the message viewer, a card of its own
//    (emailviewer/, EmailViewerWindow.js: the message alone, with Reply,
//    Forward and Delete), with enyo.windows.activate and {message} as its
//    window params; each one a new card ("emailviewer-<n>"). The release
//    left it unreachable: the message view hid the item
//    (getAppMenuConfigs, MessagePane.js:243: showing: false) and the
//    viewer could not show a message (its depends.js missed DivHtmlView,
//    see emailviewer/depends.js here; EmailViewerWindow.js:69-70 calls
//    MessagePane.currentMessage(), which the release no longer has). Here:
//    - currentMessage() is the message view's MessageLoader (a
//      MessageDisplay: hookupSenderPhoto, resize), what the viewer asks it
//      for;
//    - the app menu shows "Open Email in New Card" while a message is in
//      view (on a phone, while the message pane is the one shown);
//    - a message held in the list (or right-clicked, in the simulator)
//      opens a menu in the app's own PopupSelect, as the message body's
//      hold menu does (MessageDisplay.js:166, 235-258): Open in New Card
//      (the same MailApp.openNewCard), Mark As Read / Mark As Unread (the
//      message view's toggle, MessagePane.js:86, 407) and Delete (asked as
//      the message view asks, MessagePane.js:251-258, when the
//      confirm-delete preference is on; then as a swipe deletes,
//      Mail.deleteMessage, Mail.js:943-954). Drafts and the outbox open in
//      Compose rather than a message view (Mail.itemClick, Mail.js:758-761),
//      so their messages have no Open in New Card. A hold no longer goes on
//      to open the message when the finger lifts.

/*global enyo, DivHtmlView, MailApp, MessagePane, Mail, Email, MailDialogPrompt, $L */
(function () {
    "use strict";

    if (typeof MessagePane === "function" && !MessagePane.prototype.currentMessage) {
        MessagePane.prototype.currentMessage = function () {
            return this.$.messageLoader;
        };
    }

    if (typeof DivHtmlView === "function" && !DivHtmlView.prototype.setRedirects) {
        DivHtmlView.prototype.setRedirects = function () {};
    }

    if (typeof DivHtmlView === "function" && !DivHtmlView.prototype.printFrame) {
        DivHtmlView.prototype.printFrame = function (inFrameName, inJobID) {
            var rt = window.__phoenixRuntime;
            if (!rt || !rt.print || !inJobID) {
                return;
            }
            var display = this.owner, text = function (inName) {
                var c = display && display.$ && display.$[inName];
                return c && c.hasNode() ? (c.node.textContent || "").replace(/\s+/g, " ").trim() : "";
            };
            var esc = enyo.string.escapeHtml;
            var subject = text("subject");
            var when = [text("whenMonth"), text("whenDay"), text("whenTime")].filter(Boolean).join(" ");
            var lines = [["From", text("from")], ["To", text("to").replace(/^To:\s*/i, "")], ["Date", when]];
            var head = "<h2 style='font: bold 18pt sans-serif; margin: 0 0 6pt'>" + esc(subject) + "</h2>";
            lines.forEach(function (l) {
                if (l[1]) {
                    head += "<div style='font: 10pt sans-serif; color: #444'><b>" + l[0] + ":</b> " + esc(l[1]) + "</div>";
                }
            });
            var body = this.$.wrapper && this.$.wrapper.hasNode() ? this.$.wrapper.node.innerHTML : "";
            rt.print.renderHtml(inJobID, {
                title: subject,
                html: "<!doctype html><html><head><meta charset='utf-8'><title>" + esc(subject) + "</title></head>" +
                      "<body style='font: 11pt sans-serif'>" + head + "<hr>" + body + "</body></html>"
            });
        };
    }

    if (typeof MailApp !== "function") {
        return;
    }
    var app = MailApp.prototype;
    var folderChosen = app.folderChosen, selectMessage = app.selectMessage;
    var displayMessageLaunch = app.handleDisplayMessageLaunch, backHandler = app.backHandler;

    app.handleDisplayMessageLaunch = function (inParams) {
        var r = displayMessageLaunch.apply(this, arguments);
        this.phoenixFromCaller = !!(r && inParams && typeof inParams.$caller === "string" && inParams.$caller);
        return r;
    };

    app.backHandler = function (inSender, e) {
        if (this.phoenixFromCaller) {
            // The mail window is opened by the app's headless page
            // (enyo.windows.activate), so its own launch params do not
            // carry $caller for the runtime to see: close it here.
            if (e && e.preventDefault) {
                e.preventDefault();
            }
            window.close();
            return true;
        }
        return backHandler.apply(this, arguments);
    };

    function singleView(inApp) {
        var pane = inApp.$.slidingPane;
        return pane && !pane.multiView;
    }

    app.folderChosen = function (inSender, inFolder) {
        this.phoenixFromCaller = false;
        var r = folderChosen.apply(this, arguments);
        if (singleView(this)) {
            this.$.slidingPane.selectView(this.$.mailSliding);
        }
        return r;
    };

    app.selectMessage = function (inSender, inMessage, inUserActivated) {
        if (inUserActivated) {
            this.phoenixFromCaller = false;
        }
        var r = selectMessage.apply(this, arguments);
        if (singleView(this) && inMessage && inUserActivated) {
            this.$.slidingPane.selectView(this.$.bodySliding);
        }
        return r;
    };
})();

// 5. Open Email in New Card (see the top of this file).
(function () {
    "use strict";

    if (typeof MessagePane === "function") {
        var paneMenu = MessagePane.prototype.getAppMenuConfigs;
        MessagePane.prototype.getAppMenuConfigs = function () {
            var r = paneMenu.apply(this, arguments);
            var app = this.owner, pane = app && app.$ && app.$.slidingPane;
            // In view: beside the list (multiView), or the pane shown.
            var inView = !pane || pane.multiView || pane.view === app.$.bodySliding;
            if (r && r.openNewCard) {
                r.openNewCard.showing = !this.standalone && !!this.$.messageLoader.email && inView;
            }
            return r;
        };
    }

    if (typeof Mail !== "function") {
        return;
    }
    var list = Mail.prototype;
    var create = list.create, destroy = list.destroy, rendered = list.rendered, itemClick = list.itemClick;

    list.create = function () {
        create.apply(this, arguments);
        this.createComponent({name: "phoenixItemMenu", kind: "PopupSelect", onSelect: "phoenixItemMenuSelect"}, {owner: this});
        this.$.mailItem.onmousehold = "phoenixItemHold";
        // A new press: the click that ends a hold is past.
        this.phoenixPress = enyo.bind(this, function () { this.phoenixHeld = false; });
        document.addEventListener("mousedown", this.phoenixPress, true);
    };

    list.destroy = function () {
        document.removeEventListener("mousedown", this.phoenixPress, true);
        return destroy.apply(this, arguments);
    };

    // A right-click in the simulator (a mouse) holds a message too; Enyo 1.0
    // has no contextmenu event, so it is read from the list's node: the row
    // under it carries its index (enyo.RowServer, rowIndex).
    list.rendered = function () {
        rendered.apply(this, arguments);
        var node = this.$.mailList.hasNode();
        if (node && !node.phoenixContextMenu) {
            node.phoenixContextMenu = true;
            node.addEventListener("contextmenu", enyo.bind(this, function (e) {
                for (var el = e.target; el && el !== node; el = el.parentNode) {
                    var i = el.getAttribute && el.getAttribute("rowIndex");
                    if (i !== null && i !== undefined && i !== "") {
                        e.preventDefault();
                        this.phoenixShowItemMenu(Number(i), e);
                        return;
                    }
                }
            }));
        }
    };

    list.phoenixItemHold = function (inSender, inEvent) {
        if (this.$.mailList.getSelection().multi || inEvent.rowIndex === undefined) {
            return;
        }
        this.phoenixHeld = true;
        this.phoenixShowItemMenu(inEvent.rowIndex, inEvent);
        return true;
    };

    list.itemClick = function () {
        if (this.phoenixHeld) {
            this.phoenixHeld = false;
            return;
        }
        return itemClick.apply(this, arguments);
    };

    list.phoenixShowItemMenu = function (inIndex, inEvent) {
        var msg = this.$.mailList.fetch(inIndex);
        if (!msg || !this.folder) {
            return;
        }
        this.phoenixMenuIndex = inIndex;
        this.phoenixMenuMessage = msg;
        var items = [];
        var account = this._getAccountFromFolder(this.folder);
        var composed = account && (account.getOutboxFolderId() === msg.folderId || account.getDraftsFolderId() === msg.folderId);
        if (!composed && this.owner && this.owner.openNewCard) {
            items.push({caption: $L("Open in New Card"), value: "newCard"});
        }
        var read = (msg.flags || {read: true}).read;
        items.push({caption: read ? $L("Mark As Unread") : $L("Mark As Read"), value: "toggleRead"});
        items.push({caption: $L("Delete"), value: "delete"});
        this.$.phoenixItemMenu.setItems(items);
        this.$.phoenixItemMenu.openAtEvent(inEvent);
    };

    list.phoenixItemMenuSelect = function (inSender, inSelected) {
        var msg = this.phoenixMenuMessage;
        if (!msg) {
            return;
        }
        switch (inSelected.getValue()) {
        case "newCard":
            this.owner.openNewCard(this, "email", {message: msg});
            break;
        case "toggleRead":
            Email.setEmailFlags({ids: [msg._id]}, {read: !(msg.flags || {read: true}).read}, null);
            break;
        case "delete":
            if (enyo.application.prefs.get("confirmDeleteOnSwipe")) {
                MailDialogPrompt.displayPrompt(this, {
                    caption: $L("Delete Message"),
                    message: $L("Delete the selected message?"),
                    acceptButtonCaption: $L("Delete"),
                    onAccept: "phoenixConfirmDelete"
                });
            } else {
                this.phoenixConfirmDelete();
            }
            break;
        }
    };

    list.phoenixConfirmDelete = function () {
        var msg = this.phoenixMenuMessage, i = this.phoenixMenuIndex;
        if (!msg) {
            return;
        }
        var newer = this.$.mailList.fetch(i - 1), older = this.$.mailList.fetch(i + 1);
        Email.deleteEmails({id: msg._id});
        this.doMessageDeleted({next: newer || older});
    };
})();
