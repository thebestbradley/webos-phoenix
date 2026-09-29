// One kind per section of the sampler. Each is a plain Onyx page; App.js
// puts the selected one in the right-hand panel.

enyo.kind({
	name: "demo.Section",
	kind: "onyx.Groupbox",
	classes: "demo-section",
	published: {title: ""},
	components: [
		{kind: "onyx.GroupboxHeader", name: "header"},
		{name: "client", classes: "demo-section-body"}
	],
	create: function () {
		this.inherited(arguments);
		this.titleChanged();
	},
	titleChanged: function () {
		this.$.header.setContent(this.title);
	}
});

enyo.kind({
	name: "demo.ButtonsPage",
	components: [
		{kind: "demo.Section", title: "Buttons", components: [
			{kind: "onyx.Button", content: "Button", ontap: "tapped"},
			{kind: "onyx.Button", content: "Affirmative", classes: "onyx-affirmative", ontap: "tapped"},
			{kind: "onyx.Button", content: "Negative", classes: "onyx-negative", ontap: "tapped"},
			{kind: "onyx.Button", content: "Blue", classes: "onyx-blue", ontap: "tapped"},
			{kind: "onyx.Button", content: "Dark", classes: "onyx-dark", ontap: "tapped"},
			{kind: "onyx.Button", content: "Disabled", disabled: true}
		]},
		{kind: "demo.Section", title: "Toggles", components: [
			{classes: "demo-row", components: [
				{content: "Toggle button", classes: "demo-label"},
				{kind: "onyx.ToggleButton", value: true}
			]},
			{classes: "demo-row", components: [
				{content: "Checkbox", classes: "demo-label"},
				{kind: "onyx.Checkbox", checked: true}
			]},
			{kind: "onyx.RadioGroup", components: [
				{content: "Day", active: true},
				{content: "Week"},
				{content: "Month"}
			]}
		]},
		{kind: "demo.Section", title: "Icon buttons", components: [
			{kind: "onyx.IconButton", src: "$lib/onyx/images/more.png"},
			{kind: "onyx.IconButton", src: "$lib/onyx/images/search-input-search.png"}
		]},
		{name: "result", classes: "demo-result", content: "Tap a button."}
	],
	tapped: function (inSender) {
		this.$.result.setContent("Tapped “" + inSender.getContent() + "”");
	}
});

enyo.kind({
	name: "demo.InputsPage",
	components: [
		{kind: "demo.Section", title: "Text", components: [
			{kind: "onyx.InputDecorator", classes: "demo-wide", components: [
				{kind: "onyx.Input", placeholder: "Type here", oninput: "typed"}
			]},
			{kind: "onyx.InputDecorator", classes: "demo-wide", components: [
				{kind: "onyx.Input", type: "password", placeholder: "Password"}
			]},
			{kind: "onyx.InputDecorator", classes: "demo-wide", components: [
				{kind: "onyx.TextArea", placeholder: "A longer note", classes: "demo-textarea"}
			]},
			{kind: "onyx.InputDecorator", classes: "demo-wide", components: [
				{kind: "onyx.RichText", placeholder: "Rich text (select and use Ctrl+B)"}
			]}
		]},
		{name: "result", classes: "demo-result"}
	],
	typed: function (inSender) {
		this.$.result.setContent("Input: " + inSender.getValue());
	}
});

enyo.kind({
	name: "demo.PickersPage",
	components: [
		{kind: "demo.Section", title: "Picker", components: [
			{kind: "onyx.PickerDecorator", onSelect: "picked", components: [
				{},
				{kind: "onyx.Picker", components: [
					{content: "Palm Pre"},
					{content: "Palm Pre 2"},
					{content: "HP Veer"},
					{content: "HP Pre 3", active: true},
					{content: "HP TouchPad"}
				]}
			]},
			{kind: "onyx.PickerDecorator", onSelect: "picked", components: [
				{},
				{kind: "onyx.IntegerPicker", min: 1, max: 12, value: 3}
			]}
		]},
		{kind: "demo.Section", title: "Date and time", components: [
			{kind: "onyx.DatePicker", onSelect: "dated"},
			{tag: "br"},
			{kind: "onyx.TimePicker", onSelect: "dated"}
		]},
		{name: "result", classes: "demo-result"}
	],
	picked: function (inSender, inEvent) {
		this.$.result.setContent("Picked: " + inEvent.content);
	},
	dated: function (inSender, inEvent) {
		this.$.result.setContent("Selected: " + inEvent.value.toLocaleString());
	}
});

enyo.kind({
	name: "demo.PopupsPage",
	components: [
		{kind: "demo.Section", title: "Menus", components: [
			{kind: "onyx.MenuDecorator", onSelect: "menuItem", components: [
				{content: "Show menu"},
				{kind: "onyx.Menu", components: [
					{content: "Cut"},
					{content: "Copy"},
					{content: "Paste"},
					{classes: "onyx-menu-divider"},
					{content: "Select all"}
				]}
			]},
			{kind: "onyx.MenuDecorator", components: [
				{kind: "onyx.Button", content: "Contextual popup"},
				{kind: "onyx.ContextualPopup", title: "Share", floating: true,
					actionButtons: [
						{content: "Email", name: "email"},
						{content: "Message", name: "message"}
					],
					onTap: "shareAction",
					components: [{content: "Send this link to someone.", style: "padding: 10px;"}]
				}
			]}
		]},
		{kind: "demo.Section", title: "Popups", components: [
			{kind: "onyx.Button", content: "Modal popup", ontap: "showModal"},
			{kind: "onyx.TooltipDecorator", components: [
				{kind: "onyx.Button", content: "Hover for a tooltip"},
				{kind: "onyx.Tooltip", content: "Onyx tooltip"}
			]}
		]},
		{name: "result", classes: "demo-result"},
		{name: "modal", kind: "onyx.Popup", centered: true, modal: true, floating: true, scrim: true,
			classes: "demo-popup", components: [
				{content: "Delete this card?", classes: "demo-popup-title"},
				{kind: "onyx.Button", content: "Delete", classes: "onyx-negative", ontap: "closeModal"},
				{kind: "onyx.Button", content: "Cancel", ontap: "closeModal"}
			]}
	],
	menuItem: function (inSender, inEvent) {
		this.$.result.setContent("Menu: " + inEvent.originator.getContent());
	},
	shareAction: function (inSender, inEvent) {
		this.$.result.setContent("Share via " + inEvent.originator.getContent());
		return true;
	},
	showModal: function () {
		this.$.modal.show();
	},
	closeModal: function (inSender) {
		this.$.result.setContent("Popup: " + inSender.getContent());
		this.$.modal.hide();
	}
});

enyo.kind({
	name: "demo.ProgressPage",
	components: [
		{kind: "demo.Section", title: "Progress", components: [
			{kind: "onyx.ProgressBar", name: "bar", progress: 25},
			{kind: "onyx.ProgressBar", progress: 60, barClasses: "onyx-light", animateStripes: true},
			{kind: "onyx.ProgressButton", name: "download", progress: 40, onCancel: "cancelled"},
			{kind: "onyx.Spinner", classes: "onyx-light"}
		]},
		{kind: "demo.Section", title: "Sliders", components: [
			{kind: "onyx.Slider", value: 25, onChanging: "sliding", onChange: "sliding"},
			{kind: "onyx.RangeSlider", rangeMin: 0, rangeMax: 100, rangeStart: 20, rangeEnd: 70,
				showLabels: true, onChanging: "ranging", onChange: "ranging"}
		]},
		{name: "result", classes: "demo-result"}
	],
	sliding: function (inSender, inEvent) {
		var v = Math.round(inEvent.value);
		this.$.bar.setProgress(v);
		this.$.download.setProgress(v);
		this.$.result.setContent("Slider: " + v);
	},
	ranging: function (inSender) {
		this.$.result.setContent("Range: " + Math.round(inSender.getRangeStart()) +
			" – " + Math.round(inSender.getRangeEnd()));
	},
	cancelled: function () {
		this.$.result.setContent("Download cancelled");
	}
});

enyo.kind({
	name: "demo.ListsPage",
	kind: "FittableRows",
	classes: "enyo-fit",
	names: ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf", "Hotel",
		"India", "Juliet", "Kilo", "Lima", "Mike", "November", "Oscar", "Papa", "Quebec",
		"Romeo", "Sierra", "Tango", "Uniform", "Victor", "Whiskey", "X-ray", "Yankee", "Zulu"],
	components: [
		{kind: "onyx.Toolbar", components: [
			{kind: "onyx.RadioGroup", onActivate: "tabChanged", components: [
				{content: "Flyweight list", active: true},
				{content: "Drawer"}
			]}
		]},
		{name: "list", kind: "List", fit: true, count: 500, onSetupItem: "setupItem",
			components: [
				{name: "item", kind: "onyx.Item", tapHighlight: true, ontap: "itemTap", components: [
					{name: "name", classes: "demo-item-name"},
					{name: "index", classes: "demo-item-index"}
				]}
			]},
		{name: "drawerPage", showing: false, fit: true, classes: "demo-page-pad", components: [
			{kind: "onyx.Button", content: "Open / close the drawer", ontap: "toggleDrawer"},
			{name: "drawer", kind: "onyx.Drawer", open: false, components: [
				{classes: "demo-drawer", content: "Drawers slide open and closed, as in the Enyo 1 apps."}
			]}
		]},
		{name: "result", classes: "demo-result"}
	],
	setupItem: function (inSender, inEvent) {
		var i = inEvent.index;
		this.$.name.setContent(this.names[i % this.names.length] + " " + (Math.floor(i / this.names.length) + 1));
		this.$.index.setContent("#" + i);
		this.$.item.addRemoveClass("onyx-selected", inSender.isSelected(i));
		return true;
	},
	itemTap: function (inSender, inEvent) {
		this.$.result.setContent("Row " + inEvent.index + " of 500 (the list renders only the rows on screen)");
	},
	tabChanged: function (inSender, inEvent) {
		if (!inEvent.originator.getActive()) {
			return;
		}
		var list = inEvent.originator.indexInContainer() === 0;
		this.$.list.setShowing(list);
		this.$.drawerPage.setShowing(!list);
		this.resize();
	},
	toggleDrawer: function () {
		this.$.drawer.setOpen(!this.$.drawer.getOpen());
	}
});

// The webOS side: enyo-webos's webOS.js on Phoenix's PalmSystem and
// PalmServiceBridge.
enyo.kind({
	name: "demo.SystemPage",
	components: [
		{kind: "demo.Section", title: "Versions", components: [
			{name: "versions", allowHtml: true, classes: "demo-mono"}
		]},
		{kind: "demo.Section", title: "Device (webOS.deviceInfo)", components: [
			{name: "device", allowHtml: true, classes: "demo-mono"}
		]},
		{kind: "demo.Section", title: "Luna services (webOS.service.request)", components: [
			{kind: "onyx.Button", content: "Get system time", ontap: "getTime"},
			{kind: "onyx.Button", content: "Show a banner", ontap: "banner"},
			{name: "service", allowHtml: true, classes: "demo-mono"}
		]}
	],
	rendered: function () {
		this.inherited(arguments);
		var v = [];
		for (var k in enyo.version) {
			v.push(k + " " + enyo.version[k]);
		}
		var p = [];
		for (var f in webOS.platform) {
			if (webOS.platform[f]) {
				p.push(f);
			}
		}
		v.push("webOS.js " + webOS.libVersion + " (platform: " + (p.join(", ") || "none") + ")");
		v.push("app " + (webOS.fetchAppId() || "(no PalmSystem)"));
		this.$.versions.setContent(v.map(this.escape).join("<br>"));
		webOS.deviceInfo(this.bindSafely(function (d) {
			var lines = [];
			for (var key in d) {
				lines.push(key + ": " + d[key]);
			}
			this.$.device.setContent(lines.map(this.escape).join("<br>"));
		}));
	},
	getTime: function () {
		this.$.service.setContent("Calling…");
		webOS.service.request("luna://com.palm.systemservice", {
			method: "time/getSystemTime",
			onSuccess: this.bindSafely(function (r) {
				this.$.service.setContent(this.escape("localtime: " + JSON.stringify(r.localtime)) +
					"<br>" + this.escape("timezone: " + r.timezone));
			}),
			onFailure: this.bindSafely(function (e) {
				this.$.service.setContent(this.escape("Failed: " + (e.errorText || JSON.stringify(e))));
			})
		});
	},
	banner: function () {
		webOS.notification.showToast({message: "Hello from Enyo 2", icon: "icon.png"},
			this.bindSafely(function (id) {
				this.$.service.setContent(this.escape("Banner shown (" + id + ")"));
			}));
	},
	escape: function (s) {
		return enyo.dom.escape(String(s));
	}
});
