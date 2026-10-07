// @@@LICENSE
//
//      Copyright (c) 2010-2013 LG Electronics, Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// LICENSE@@@

// Phoenix compat overlay (docs/M6-PLAN.md F4): luna-systemui's
// app/PowerdAlerts/PowerdAlerts.js, unchanged but for PowerOffAlert, the
// menu held Power opens. As in webOS CE 3.1.0's (Screenshots/
// PowerOptions.jpg, from Jason Robitaille's "Advanced Reset Options"
// patch), it offers Luna Restart (the system UI starts again:
// org.webosphoenix.system/restartUi) and Device Restart
// (com.palm.power/shutdown/machineReboot, as PowerResetAlert below) beside
// Airplane Mode, Shut Down and Cancel, in three rows (the restarts in the
// alternate, yellow, buttons, as there): the popup keeps the height
// PowerdService.js opens it at (135).

/*
 * Popup Alert for Low Battery Warning.
 */

enyo.kind({
	name: "LowBatteryAlert",
	kind: "VFlexBox",
	components: [
		{
			kind: enyo.Control,
			className: "notification-container",
			domAttributes:{
				"x-palm-popup-content": " "
			},
			components: [
				{
					className: "notification-icon icon-low-battery"
				},
				{
					className: "notification-text",
					components: [
						{
							className: "title",
							content: $L("Low Battery")
						},
						{
							className: "message",
							content: $L("The device will shut down very soon. Charge your device.")
						}
					]
				}
			]
		 },
		 {kind: "NotificationButton", className: "enyo-notification-button-affirmative", layoutKind:"HFlexLayout", pack:"center", onclick:"closeAlert", components:[{content: $L("OK")}]},
	],
	
	create: function() {
		this.inherited(arguments);
		//PalmSystem.playSoundNotification("alerts", "/usr/palm/sounds/battery_low.mp3", 3000);
	},
	
	closeAlert: function() {
		close();
	},
	
});

/*
 * Popup Alert for Power Off.
 */

enyo.kind({
	name: "PowerOffAlert",
	kind: "VFlexBox",
	inAirplaneMode: false,
	components: [
		 {kind: "NotificationButton", className:"enyo-notification-button-affirmative", layoutKind:"HFlexLayout", 
			 components:[
		                   {flex:1, name:"flightmode", content: $L("Airplane Mode"), onclick: "changeFlightMode"},
		                   {name:"infoIcon", className:"info-icon", onclick: "showInfo"}
		                ]
		 },
		 {kind: "HFlexBox", className: "phoenix-power-row", components: [
			 {kind: "NotificationButton", flex: 1, className: "enyo-notification-button-alternate", layoutKind:"HFlexLayout", pack:"center", onclick:"restartLuna", components:[{content: $L("Luna Restart")}]},
			 {kind: "NotificationButton", flex: 1, className: "enyo-notification-button-alternate", layoutKind:"HFlexLayout", pack:"center", onclick:"restartDevice", components:[{content: $L("Device Restart")}]}
		 ]},
		 {kind: "HFlexBox", className: "phoenix-power-row", components: [
			 {kind: "NotificationButton", flex: 1, className: "enyo-notification-button-negative", layoutKind:"HFlexLayout", pack:"center",  onclick:"poweroff", components:[{content: $L("Shut Down")}]},
			 {kind: "NotificationButton", flex: 1, className: "enyo-notification-button", layoutKind:"HFlexLayout", pack:"center", onclick:"closeAlert", components:[{content: $L("Cancel")}]}
		 ]},
		 {kind:"PalmService", name:"launchHelp", service:"palm://com.palm.applicationManager/", method:"open"},
		 {kind: "PalmService", name:"shutdown", service:"palm://com.palm.power/shutdown/", method:"machineOff"},
		 {kind: "PalmService", name:"reboot", service:"palm://com.palm.power/shutdown/", method:"machineReboot"},
		 {kind: "PalmService", name:"restartUi", service:"palm://org.webosphoenix.system/", method:"restartUi"}
	],
	
	create: function() {
		this.inherited(arguments);
		this.inAirplaneMode = enyo.application.getSystemPreferences().airplaneMode;
		this.$.flightmode.setContent(this.inAirplaneMode ? $L("Turn off Airplane Mode") : $L("Airplane Mode"));
	},
	
	changeFlightMode: function(inSender) {
		enyo.application.getSystemService().setAirplaneMode(!this.inAirplaneMode);
		close();
	},
	
	showInfo: function(inSender) {
		var callParams = {
      		id: 'com.palm.app.help',
      		params: {
          		target: "http://help.palm.com/basics/turn_phone_on_off/basics_wireless_services_on_off.html"
      		}
  		};
		this.$.launchHelp.call(callParams);
		close();
	},
	
	restartLuna: function(inSender) {
		this.$.restartUi.call({});
		close();
	},
	
	restartDevice: function(inSender) {
		this.$.reboot.call({
			reason: "Restart selected by User in PowerOff Dialog"
		});
		close();
	},
	
	poweroff: function(inSender) { 
		this.$.shutdown.call({
			reason: "Shutdown request by User"
		});
		close();
	},
	
	closeAlert: function() {
		close();
	},
	
});

/*
 * Popup Alert for Power Reset.
 */

enyo.kind({
	name: "PowerResetAlert",
	kind: "VFlexBox",
	components: [
		 {kind: "NotificationButton", className: "enyo-notification-button-alternate", layoutKind:"HFlexLayout", pack:"center", onclick:"restart", components:[{content: $L("Restart")}]},
		 {kind: "NotificationButton", className: "enyo-notification-button-negative", layoutKind:"HFlexLayout", pack:"center", onclick:"shutdown", components:[{content: $L("Shut Down")}]},
		 {kind: "NotificationButton", className: "enyo-notification-button", layoutKind:"HFlexLayout", pack:"center", onclick:"closeAlert", components:[{content: $L("Cancel")}]},
		 {kind: "PalmService", name:"reboot", service:"palm://com.palm.power/shutdown/", method:"machineReboot"},
		 {kind: "PalmService", name:"shutdown", service:"palm://com.palm.power/shutdown/", method:"machineOff"}
	],
	
	create: function() {
		this.inherited(arguments);
	},
	
	restart: function() {
		this.$.reboot.call({
				reason: "Restart selected by User in PowerOff Dialog"
			});
		close();
	},
	
	shutdown:function() {
		this.$.shutdown.call({
				reason: "Shutdown request by User"
		});
		close();
	},
	
	closeAlert: function() {
		close();
	},
	
});

enyo.kind({
	name: "NotChargingAlert",
	kind: "VFlexBox",
	components: [
		{
			kind: enyo.Control,
			className: "notification-container",
			domAttributes:{
				"x-palm-popup-content": " "
			},
			components: [
				{
					className: "notification-icon icon-warning"
				},
				{
					className: "notification-text",
					components: [
						{
							className: "title",
							content: $L("Device May Not Charge")
						},
						{
							className: "message",
							content: $L("Your device is connected to a charging source that provides less than the recommended voltage or current. To reliably charge, use the power adapter and USB cable that came with your device.")
						}
					]
				}
			]
		 },
		 {kind: "NotificationButton", className: "enyo-notification-button-affirmative", layoutKind:"HFlexLayout", pack:"center", onclick:"closeAlert", components:[{content: $L("OK")}]}
	],
	
	create: function() {
		this.inherited(arguments);
	},
	
	closeAlert: function() {
		close();
	},
	
});
