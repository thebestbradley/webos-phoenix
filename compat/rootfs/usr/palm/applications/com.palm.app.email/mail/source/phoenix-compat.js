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

/*global enyo, DivHtmlView, MailApp */
(function () {
    "use strict";

    if (typeof DivHtmlView === "function" && !DivHtmlView.prototype.setRedirects) {
        DivHtmlView.prototype.setRedirects = function () {};
    }

    if (typeof MailApp !== "function") {
        return;
    }
    var app = MailApp.prototype;
    var folderChosen = app.folderChosen, selectMessage = app.selectMessage;

    function singleView(inApp) {
        var pane = inApp.$.slidingPane;
        return pane && !pane.multiView;
    }

    app.folderChosen = function (inSender, inFolder) {
        var r = folderChosen.apply(this, arguments);
        if (singleView(this)) {
            this.$.slidingPane.selectView(this.$.mailSliding);
        }
        return r;
    };

    app.selectMessage = function (inSender, inMessage, inUserActivated) {
        var r = selectMessage.apply(this, arguments);
        if (singleView(this) && inMessage && inUserActivated) {
            this.$.slidingPane.selectView(this.$.bodySliding);
        }
        return r;
    };
})();
