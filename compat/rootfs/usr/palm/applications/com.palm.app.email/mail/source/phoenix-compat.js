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

/*global enyo, DivHtmlView, MailApp */
(function () {
    "use strict";

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
