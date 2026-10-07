// Phoenix compat: the battery's second temperature warning (50 °C;
// data/phoenix-temperature.js, after Jason Robitaille's Device Temperature
// Warnings patch), a popup alert drawn as luna-systemui's Low Battery
// alert (PowerdAlerts.js LowBatteryAlert): its warning icon, a title, what
// to do, OK. powerdalerts.html (overlay) makes it for the window named
// "TemperatureAlert"; the temperature comes in its launch params.

enyo.kind({
	name: "TemperatureAlert",
	kind: "VFlexBox",
	components: [
		{
			kind: enyo.Control,
			className: "notification-container",
			domAttributes: {"x-palm-popup-content": " "},
			components: [
				{className: "notification-icon icon-warning"},
				{className: "notification-text", components: [
					{className: "title", content: $L("Device Too Hot")},
					{name: "message", className: "message"}
				]}
			]
		},
		{kind: "NotificationButton", className: "enyo-notification-button-affirmative", layoutKind: "HFlexLayout", pack: "center",
			onclick: "closeAlert", components: [{content: $L("OK")}]}
	],
	create: function () {
		this.inherited(arguments);
		var t = (enyo.windowParams && enyo.windowParams.temperature) || 50;
		this.$.message.setContent(new enyo.g11n.Template($L("The battery is #{t} °C. Close apps you are not using, unplug the charger, and let the device cool down.")).evaluate({t: t}));
	},
	closeAlert: function () {
		close();
	}
});
