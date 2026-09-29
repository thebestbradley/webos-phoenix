// Enyo 2 Demo: a two-panel Onyx sampler. On a tablet both panels show (the
// Panels kind's CollapsingArranger); on a phone one at a time, and the back
// gesture returns to the list.

enyo.kind({
	name: "demo.App",
	kind: "FittableRows",
	classes: "onyx enyo-fit demo-app",
	sections: [
		{title: "Buttons", kind: "demo.ButtonsPage"},
		{title: "Inputs", kind: "demo.InputsPage"},
		{title: "Pickers", kind: "demo.PickersPage"},
		{title: "Popups & Menus", kind: "demo.PopupsPage"},
		{title: "Progress & Sliders", kind: "demo.ProgressPage"},
		{title: "Lists", kind: "demo.ListsPage", fill: true},
		{title: "System (webOS)", kind: "demo.SystemPage"}
	],
	components: [
		{kind: "Signals", onkeyup: "keyup"},
		{name: "panels", kind: "Panels", fit: true, arrangerKind: "CollapsingArranger",
			realtimeFit: true, classes: "demo-panels", components: [
				{kind: "FittableRows", classes: "demo-nav", components: [
					{kind: "onyx.Toolbar", components: [{content: "Enyo 2 Demo"}]},
					{kind: "Scroller", fit: true, horizontal: "hidden", components: [
						{name: "nav", kind: "Repeater", onSetupItem: "setupNav", components: [
							{name: "navItem", kind: "onyx.Item", tapHighlight: true, ontap: "navTap",
								classes: "demo-nav-item"}
						]},
						{classes: "demo-note", content: "Enyo 2.5.2 with Onyx and Layout, the last " +
							"release that runs without a build step. Temporary app."}
					]}
				]},
				{kind: "FittableRows", classes: "demo-content", components: [
					{kind: "onyx.Toolbar", components: [
						{name: "back", kind: "onyx.Button", content: "Back", ontap: "showNav",
							classes: "demo-back"},
						{name: "title"}
					]},
					{name: "pageScroller", kind: "Scroller", fit: true, horizontal: "hidden",
						classes: "demo-scroller", components: [
							{name: "page", classes: "demo-page"}
						]},
					{name: "fillPage", fit: true, showing: false, classes: "demo-fill"}
				]}
			]}
	],
	selected: 0,
	create: function () {
		this.inherited(arguments);
		this.$.nav.setCount(this.sections.length);
		this.showSection(0);
	},
	rendered: function () {
		this.inherited(arguments);
		this.updateBack();
	},
	resizeHandler: function () {
		this.inherited(arguments);
		this.updateBack();
	},
	setupNav: function (inSender, inEvent) {
		var item = inEvent.item.$.navItem;
		item.setContent(this.sections[inEvent.index].title);
		item.addRemoveClass("onyx-selected", inEvent.index === this.selected);
		return true;
	},
	navTap: function (inSender, inEvent) {
		this.showSection(inEvent.index);
		this.$.nav.build();
		this.$.nav.render();
		// On a tablet both panels already show; index 1 would slide the list away.
		if (this.narrow()) {
			this.$.panels.setIndex(1);
		}
	},
	showSection: function (index) {
		var s = this.sections[index];
		this.selected = index;
		this.$.title.setContent(s.title);
		this.$.page.destroyClientControls();
		this.$.fillPage.destroyClientControls();
		var host = s.fill ? this.$.fillPage : this.$.page;
		host.createComponent({kind: s.kind}, {owner: this});
		this.$.pageScroller.setShowing(!s.fill);
		this.$.fillPage.setShowing(!!s.fill);
		if (this.hasNode()) {
			host.render();
			this.$.pageScroller.scrollToTop();
			this.resize();
		}
	},
	showNav: function () {
		this.$.panels.setIndex(0);
	},
	// Phones show one panel at a time; only then is Back needed.
	narrow: function () {
		return this.$.panels.hasNode() && this.$.panels.hasNode().clientWidth <= 800;
	},
	updateBack: function () {
		this.$.back.setShowing(this.narrow());
	},
	// The back gesture arrives as Escape (keyIdentifier U+1200001 on webOS).
	keyup: function (inSender, inEvent) {
		if ((inEvent.keyCode === 27 || inEvent.keyIdentifier === "U+1200001") &&
				this.narrow() && this.$.panels.getIndex() > 0) {
			this.showNav();
			inEvent.preventDefault();
			return true;
		}
	}
});
