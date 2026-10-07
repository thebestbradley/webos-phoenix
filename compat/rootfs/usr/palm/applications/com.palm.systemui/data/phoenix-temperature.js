// Phoenix compat: the battery's temperature warnings (docs/M6-PLAN.md F4
// item 9), as Jason Robitaille's "Device Temperature Warnings" patch for
// luna-systemui (2011) gave them: the battery's temperature is checked
// every 5 minutes (com.palm.power batteryStatusQuery; powerd's
// batteryStatus signals say it too, as it changes), and the user is
// warned at 45 °C and again at 50 °C:
//   45 °C  a banner, "Device is warm: 46 °C", with the alert sound;
//   50 °C  a popup alert (TemperatureAlert, app/PowerdAlerts), "Device Too
//          Hot", as luna-systemui's Low Battery alert is drawn.
// Each warns once until the temperature falls 2 °C below its mark.
// Added to PowerdService.js (unchanged) by the depends.js overlay.

(function () {
	var WARM = 45, HOT = 50, EASE = 2, EVERY = 5 * 60 * 1000;
	var P = PowerdService.prototype;
	var create = P.create;
	P.create = function () {
		create.apply(this, arguments);
		this.createComponent({kind: "PalmService", name: "phoenixTemperatureQuery", service: "palm://com.palm.power/com/palm/power/",
			method: "batteryStatusQuery", onSuccess: "phoenixTemperature"}, {owner: this});
		this.phoenixWarned = 0;
		var self = this;
		this.phoenixTemperatureTimer = setInterval(function () { self.$.phoenixTemperatureQuery.call(); }, EVERY);
	};
	var handle = P.handlePowerNotifications;
	P.handlePowerNotifications = function (inSender, inResponse) {
		if (inResponse && inResponse.temperature_C !== undefined) this.phoenixTemperature(inSender, inResponse);
		return handle.apply(this, arguments);
	};
	P.phoenixTemperature = function (inSender, inResponse) {
		var t = Number(inResponse && inResponse.temperature_C);
		if (isNaN(t)) return;
		// Cooled down below a mark: it may warn of it again.
		if (this.phoenixWarned >= HOT && t < HOT - EASE) this.phoenixWarned = WARM;
		if (this.phoenixWarned >= WARM && t < WARM - EASE) this.phoenixWarned = 0;
		if (t >= HOT && this.phoenixWarned < HOT) {
			this.phoenixWarned = HOT;
			enyo.windows.openPopup("app/PowerdAlerts/powerdalerts.html", "TemperatureAlert",
				{temperature: Math.round(t), sound: "/usr/palm/sounds/alert.wav", soundclass: "alerts"}, undefined, 150);
		} else if (t >= WARM && this.phoenixWarned < WARM) {
			this.phoenixWarned = WARM;
			var text = new enyo.g11n.Template($L("Device is warm: #{t} °C")).evaluate({t: Math.round(t)});
			enyo.windows.addBannerMessage(text, "{}", "/usr/lib/luna/system/luna-systemui/images/notification-small-error.png",
				"alerts", "/usr/palm/sounds/alert.wav");
		}
	};
})();
