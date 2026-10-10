// Phoenix compat: what the app menu's Share shares in Memos.
//
// Every app menu has Share after Edit (the runtime adds both to Enyo's
// AppMenu; docs/SHARE-AND-FILES.md). In the editor it shares the memo
// shown, as plain text, through the system's share sheet; on the wall,
// what is selected. The editor's own envelope button still sends the memo
// to Email, as on the TouchPad (EditView.js:72, EditAgent.sendMemo).

/*global AppView */
(function () {
    var rt = window.__phoenixRuntime;
    if (!rt || !rt.setShareContent)
        return;
    var proto = AppView.prototype, create = proto.create;
    proto.create = function () {
        create.apply(this, arguments);
        var app = this;
        rt.setShareContent(function () {
            var edit = app.$.edit;
            if (!edit || !edit.showing || !edit.$.memoInput)
                return null;
            var node = edit.$.memoInput.hasNode();
            var text = node ? String(node.innerText || "").replace(/^\s+|\s+$/g, "") : "";
            return text ? { title: text.split("\n")[0].slice(0, 60), text: text } : null;
        });
    };
})();
