// Phoenix compat: the back gesture in Calendar on a phone.
//
// AppView.js's backHandler (app/AppView.js:114-120) goes back in its pane
// and then keeps the gesture (event.preventDefault()) unless the pane shows
// "calendar"; but the calendar view's name is "calendarView" (AppView.js:58),
// so Back was always kept and did nothing at the top: on a phone the card
// never went back to the app that opened it (the Assistant's "Open
// Calendar"), and Back over the Event Details dialog did nothing either (the
// dialog closes on Escape only when the focus is inside it,
// BasicPopup.keydownHandler, and the gesture reaches the page's body).
// Here Back closes an open dialog first, then goes back in the pane, and at
// the calendar view lets the gesture go, as the original meant to.

(function () {
    var proto = calendar.AppView.prototype;
    proto.backHandler = function backHandler(from, event) {
        var popups = ["deleteDialog", "detailPopup", "jumpToDialog"];
        for (var i = 0; i < popups.length; i++) {
            var p = this.$[popups[i]];
            if (p && p.isOpen) {
                p.close(event, "popup:escape");
                event.preventDefault();
                return;
            }
        }
        if (this.$.pane.getViewName() != "calendarView") {
            this.closeView();
            event.preventDefault();
        }
    };
})();
