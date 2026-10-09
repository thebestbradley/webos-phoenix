// Phoenix compat: the back gesture in Memos on a phone.
//
// Memos was a TouchPad app, which had no back gesture: nothing in it listens
// for Enyo's "back" (ApplicationEvents onBack), and on a phone Back in the
// editor did nothing. Here it does what the editor's "All Memos" button
// does (EditView.js:46-51 returnToGrid: the memo is saved and the wall
// comes back); on the wall it is left to the system.

(function () {
    var proto = AppView.prototype, create = proto.create;
    proto.create = function () {
        create.apply(this, arguments);
        this.createComponent({ kind: "ApplicationEvents", onBack: "phoenixBack", owner: this });
    };
    proto.phoenixBack = function (sender, event) {
        if (this.$.edit && this.$.edit.showing) {
            this.$.edit.returnToGrid();
            event.preventDefault();
        }
    };
})();
