// Phoenix compat: the cycling new-email dashboard (see
// ../source/phoenix-dashboard.js). Enyo's DashboardContent, showing one new
// email at a time instead of the stack: every 4 s the next, newest first,
// with when it came at the right of the sender, the count's badge saying
// which of how many ("2/5"), and a trash can that deletes the one shown.
// A tap opens the one shown; swiping the dashboard away closes it, as
// before.

/*global enyo */
enyo.kind({
	name: "PhoenixCyclingDashboardContent",
	kind: "enyo.DashboardContent",
	cycleInterval: 4000,
	index: 0,
	create: function() {
		this.inherited(arguments);
		this.$.topSwipeable.createComponents([
			{name: "phoenixTime", className: "phoenix-dashboard-time"},
			{name: "phoenixDelete", className: "phoenix-dashboard-delete", onclick: "deleteTapHandler"}
		], {owner: this});
		this.addClass("phoenix-cycling");
	},
	destroy: function() {
		this.stopCycle();
		this.inherited(arguments);
	},
	// The email shown: index 0 is the newest (the layers end with it).
	current: function() {
		var len = this.layers.length;
		return len ? this.layers[len - 1 - (this.index % len)] : null;
	},
	updateContents: function() {
		var len = this.layers.length;
		if (!len) {
			this.stopCycle();
			this.indicateNewContent(false);
			window.close();
			return;
		}
		if (this.index >= len) {
			this.index = 0;
		}
		var layer = this.current();
		this.$.layer0.setLayer(layer);
		this.$.layer1.setLayer(null);
		this.$.layer2.setLayer(null);
		this.$.layer0.setSwipeable(false);
		this.$.topSwipeable.setSwipeable(true);
		this.setIcon(layer.icon);
		this.$.phoenixTime.setContent(this.formatTime(layer.timestamp));
		if (len > 1) {
			this.$.count.setContent((this.index + 1) + "/" + len);
			this.$.badge.show();
			this.startCycle();
		} else {
			this.$.badge.hide();
			this.stopCycle();
		}
	},
	handleNewLayers: function(params) {
		// New mail: shown first.
		var layers = (params && params.layers) || [];
		if (layers.length > this.layers.length) {
			this.index = 0;
		}
		this.inherited(arguments);
	},
	startCycle: function() {
		if (!this.cycleTimer) {
			this.cycleTimer = window.setInterval(enyo.bind(this, "cycle"), this.cycleInterval);
		}
	},
	stopCycle: function() {
		if (this.cycleTimer) {
			window.clearInterval(this.cycleTimer);
			this.cycleTimer = undefined;
		}
	},
	cycle: function() {
		if (this.layers.length > 1) {
			this.index = (this.index + 1) % this.layers.length;
			this.updateContents();
		}
	},
	// "9:41 AM" today, else "Jun 5".
	formatTime: function(ts) {
		if (!ts) {
			return "";
		}
		var d = new Date(ts), now = new Date();
		if (d.toDateString() === now.toDateString()) {
			return d.toLocaleTimeString([], {hour: "numeric", minute: "2-digit"});
		}
		return d.toLocaleDateString([], {month: "short", day: "numeric"});
	},
	iconTapHandler: function(inSender, event) {
		this.sendEventToApp("doIconTap", [this.current(), this.makeFakeEvent(event)]);
		event.stopPropagation();
		return true;
	},
	msgTapHandler: function(inSender, event) {
		this.sendEventToApp("doMessageTap", [this.current(), this.makeFakeEvent(event)]);
		event.stopPropagation();
		return true;
	},
	deleteTapHandler: function(inSender, event) {
		var layer = this.current();
		event.stopPropagation();
		if (!layer) {
			return true;
		}
		this.sendEventToApp("doDeleteEmail", [layer]);
		// Gone here at once; the app's new layers follow.
		this.layers = this.layers.filter(function(l) { return l !== layer; });
		this.updateContents();
		return true;
	}
});
