// Phoenix compat: the browser's community features (docs/M6-PLAN.md F4
// item 7; docs/COMMUNITY-FEATURES.md, the 2012 browser patches by minego,
// kyle3om and others). Added to the original by depends.js, after its own
// sources; the original files are unchanged.
//
//   Private Browsing  an app menu check item, per card. The card's toolbar
//                     turns red (as the Private Browsing patch drew it),
//                     its pages go to no history, and its page view uses a
//                     private profile (phoenix-sim's simBrowser): cookies,
//                     cache and storage go when its last private card
//                     closes. A new card opened from it is private too.
//   Find on Page      the app menu item Isis had commented out, and its
//                     FindBar's prev and next (empty in the release), with
//                     the count of matches ("2 of 7").
//   Block Ads & Trackers  Preferences > Content: the page view's requests
//                     to the hosts of the content blocker's list fail
//                     (system preference browserContentBlocker; the shell
//                     applies it: shell/sim/simbrowser.h).
//   Websites          Preferences: Mobile Site (webOS's user agent, the
//                     default) or Desktop Site (browserUserAgent).
// Default Web Search Engine: the original's list, then Phoenix's other
// engines (DuckDuckGo, Bing, Startpage and a custom one from Settings >
// Just Type: com.palm.universalsearch's OptionalSearchList in the
// runtime). The browser and Just Type share the default, as on webOS.

/*global enyo, $L, Preferences, BrowserApp, Browser, FindBar, ActionBar */
(function () {
	"use strict";

	// A kind's declared components (enyo.kind keeps them as kindComponents),
	// searched depth first.
	function findDecl(list, test) {
		for (var i = 0; list && i < list.length; i++) {
			if (test(list[i])) return {list: list, index: i, item: list[i]};
			var r = findDecl(list[i].components, test);
			if (r) return r;
		}
		return null;
	}

	// ---- Preferences: Block Ads & Trackers, Websites ------------------------------

	var P = Preferences.prototype;
	var content = findDecl(P.kindComponents, function (c) { return c.kind === "RowGroup" && c.caption === $L("Content"); });
	if (content) {
		// After Enable JavaScript, in the Toggle rows' own form.
		var row = findDecl(content.item.components, function (c) {
			return c.components && c.components[0] && c.components[0].preference === "enableJavascript";
		});
		content.item.components.splice(row ? row.index + 1 : content.item.components.length, 0,
			{kind: "LabeledContainer", caption: $L("Block Ads & Trackers"), components: [
				{kind: "ToggleButton", name: "browserContentBlocker", onChange: "togglePreferenceClick",
					preference: "browserContentBlocker", type: "System"}
			]});
		content.list.splice(content.index + 1, 0,
			{kind: "RowGroup", caption: $L("Websites"), style: "margin-bottom: 10px", components: [
				{kind: "ListSelector", name: "browserUserAgent", value: "mobile", onChange: "phoenixUserAgentChange", items: [
					{caption: $L("Mobile Site"), value: "mobile"},
					{caption: $L("Desktop Site"), value: "desktop"}
				]}
			]});
	}
	var updatePreferences = P.updatePreferences;
	P.updatePreferences = function (inPreferences) {
		var rest = {}, ua;
		for (var k in inPreferences) {
			if (k === "browserUserAgent") ua = inPreferences[k];
			else rest[k] = inPreferences[k];
		}
		updatePreferences.call(this, rest);
		if (ua !== undefined && this.$.browserUserAgent)
			this.$.browserUserAgent.setValue(ua === "desktop" ? "desktop" : "mobile");
	};
	P.phoenixUserAgentChange = function (inSender) {
		this.fireChange("browserUserAgent", "System", inSender.getValue());
	};

	// ---- The app: preferences, the app menu, private cards ------------------------

	var A = enyo.BrowserApp.prototype;
	var menu = findDecl(A.kindComponents, function (c) { return c.kind === "AppMenu"; });
	if (menu) {
		menu.item.components.unshift(
			{name: "phoenixFindItem", caption: $L("Find on Page"), onclick: "showFindOnPage"},
			{name: "phoenixPrivateItem", kind: "MenuCheckItem", caption: $L("Private Browsing"), onclick: "phoenixTogglePrivate"});
	}

	// The original's, with the browser's two system preferences of Phoenix's.
	A.fetchPreferences = function () {
		var systemPreferences = ["flashplugins", "click2play", "browserContentBlocker", "browserUserAgent"];
		this.$.systemPrefsService.call({keys: systemPreferences}, {method: "getPreferences", onSuccess: "gotSystemPreferences", subscribe: true});
		this.$.browserPrefsService.call(undefined, {method: "find", onSuccess: "gotBrowserPreferences", subscribe: true});
		this.$.universalSearchService.call();
	};

	// The original's, with Phoenix's other engines (OptionalSearchList:
	// DuckDuckGo, Bing, Startpage, the custom one) after the shipped ones.
	A.gotUniversalSearchList = function (inSender, inResponse) {
		this.searchPreferences = [];
		var all = (inResponse.UniversalSearchList || []).concat(inResponse.OptionalSearchList || []), seen = {};
		for (var i = 0, s; (s = all[i]); i++) {
			if (s.type === "web" && s.enabled && !seen[s.id]) {
				seen[s.id] = true;
				this.searchPreferences.push(s);
			}
		}
		this.searchPreferencesChanged();
		this.setDefaultSearch(inResponse.defaultSearchEngine);
	};

	var toggleAppMenuItems = A.toggleAppMenuItems;
	A.toggleAppMenuItems = function () {
		toggleAppMenuItems.apply(this, arguments);
		if (this.$.phoenixFindItem) this.$.phoenixFindItem.setDisabled(!this.isBrowserShowing());
		var item = this.$.phoenixPrivateItem;
		if (item) {
			// An app menu row like the others (AppMenuItem's class), with
			// MenuCheckItem's check mark.
			if (item.$.item && !item.$.item.hasClass("enyo-appmenu-item")) item.$.item.addClass("enyo-appmenu-item");
			item.setChecked(!!this.phoenixPrivate);
		}
	};

	A.phoenixTogglePrivate = function () {
		this.phoenixSetPrivate(!this.phoenixPrivate);
	};
	A.phoenixSetPrivate = function (inOn) {
		this.phoenixPrivate = !!inOn;
		if (this.phoenixPrivate) this.addClass("phoenix-private");
		else this.removeClass("phoenix-private");
		this.$.pane.viewByName("browser").phoenixSetPrivate(this.phoenixPrivate);
	};

	var rendered = A.rendered;
	A.rendered = function () {
		var p = window.PalmSystem ? enyo.windowParams : this.processQueryString();
		if (p && (p.phoenixPrivate === true || p.phoenixPrivate === "true")) this.phoenixSetPrivate(true);
		rendered.apply(this, arguments);
	};

	// A private card's pages are not history.
	var updateHistory = A.updateHistory;
	A.updateHistory = function () {
		if (this.phoenixPrivate) return;
		updateHistory.apply(this, arguments);
	};

	// New cards from a private card are private.
	A.newCardClick = function () {
		enyo.windows.openWindow("index.html", null, this.phoenixPrivate ? {phoenixPrivate: true} : undefined);
	};

	// ---- The page view: private, find ---------------------------------------------

	var B = Browser.prototype;
	B.phoenixSetPrivate = function (inOn) {
		this.phoenixPrivate = !!inOn;
		this.$.view.callBrowserAdapter("setPrivateBrowsing", [this.phoenixPrivate]);
	};
	B.openNewCard = function () {
		enyo.windows.openWindow("index.html", null, this.phoenixPrivate ? {phoenixPrivate: true} : null);
	};
	B.newCardClick = function (inTapInfo) {
		var p = {url: inTapInfo.linkUrl};
		if (this.phoenixPrivate) p.phoenixPrivate = true;
		enyo.windows.openWindow("index.html", null, p);
	};

	var browserRendered = B.rendered;
	B.rendered = function () {
		browserRendered.apply(this, arguments);
		var n = this.hasNode(), self = this;
		if (n && !this.phoenixFindListener) {
			// The page view's count of matches (the runtime's BrowserAdapter).
			this.phoenixFindListener = function (e) {
				var d = e.detail || {};
				self.$.findBar.setCount(d.active || 0, d.total || 0);
			};
			n.addEventListener("phoenixfindresult", this.phoenixFindListener);
		}
	};
	// The page view is declared height 100%, and its plugin keeps the pixel
	// size it first measured (BasicWebView.cacheBoxSize): the find bar would
	// lie under the page. While the bar shows the view takes what is left,
	// and the plugin is measured again.
	B.phoenixFitView = function () {
		var inner = this.$.view.$.view;
		if (!inner || !inner.cacheBoxSize) return;
		inner.applyStyle("width", "100%");
		inner.applyStyle("height", "100%");
		inner.cacheBoxSize();
		inner.updateViewportSize();
	};
	var showFind = B.showFind;
	B.showFind = function () {
		this.$.view.applyStyle("height", "0px");
		showFind.apply(this, arguments);
		this.phoenixFitView();
	};
	B.phoenixFindClosed = function () {
		this.$.view.applyStyle("height", "100%");
		this.phoenixFitView();
	};
	B.phoenixFindText = function () {
		return this.$.findBar.$.input.getValue();
	};
	B.goToNext = function () {
		var t = this.phoenixFindText();
		if (t.length >= 2) this.$.view.callBrowserAdapter("findInPage", [t, false]);
	};
	B.goToPrevious = function () {
		var t = this.phoenixFindText();
		if (t.length >= 2) this.$.view.callBrowserAdapter("findInPage", [t, true]);
	};

	// ---- The find bar: the count, and done clears the highlight -------------------

	var F = FindBar.prototype;
	// The release asks for changeOnKeypress, which Enyo 1.0's Input does not
	// have (only RichText): it searched only when the field lost focus.
	// changeOnInput searches as the words are typed, as the bar meant to.
	var field = findDecl(F.kindComponents, function (c) { return c.name === "input"; });
	if (field) field.item.changeOnInput = true;
	var findCreate = F.create;
	F.create = function () {
		findCreate.apply(this, arguments);
		this.addClass("phoenix-findbar");
		// The space between the field and the buttons: none on a phone.
		var spacer = this.children[1];
		if (spacer && spacer !== this.$.input && spacer !== this.$.prev) spacer.addClass("phoenix-find-spacer");
		this.createComponent({name: "count", className: "phoenix-find-count"}, {owner: this});
		var kids = this.children, count = this.$.count;
		kids.splice(kids.indexOf(count), 1);
		kids.splice(kids.indexOf(this.$.prev), 0, count);
	};
	F.setCount = function (inActive, inTotal) {
		var text = "";
		if (this.$.input.getValue().length >= 2)
			text = inTotal ? enyo.macroize($L("{$active} of {$total}"), {active: inActive || 1, total: inTotal}) : $L("No matches");
		this.$.count.setContent(text);
	};
	var inputChange = F.inputChange;
	F.inputChange = function () {
		inputChange.apply(this, arguments);
		if (this.$.input.getValue().length < 2) this.$.count.setContent("");
	};
	// The share menu (Add Bookmark, Share Link, Add to Launcher) opens with
	// its right edge at the share button's (ActionBar.js:102-107), on the
	// TouchPad's wide bar. On a phone the button is mid-bar and the menu
	// reached past the left edge: Popup.clampPosition keeps the popup's box
	// on screen, but the menu's frame is drawn outside it (its negative
	// margins), so its left side was cut off. It is moved right by as much.
	var AB = ActionBar.prototype;
	var showSharePopup = AB.showSharePopup;
	AB.showSharePopup = function () {
		showSharePopup.apply(this, arguments);
		var n = this.$.sharePopup.hasNode();
		if (!n) return;
		var left = 0;
		for (var e = n; e; e = e.firstElementChild)
			left = Math.min(left, e.getBoundingClientRect().left);
		if (left < 0)
			n.style.left = (n.offsetLeft - left) + "px";
	};

	var findClose = F.close;
	F.close = function () {
		findClose.apply(this, arguments);
		this.$.count.setContent("");
		this.doFind("");
		if (this.owner && this.owner.phoenixFindClosed) this.owner.phoenixFindClosed();
	};
})();
