// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// webOS Phoenix: Just Type's "From your phone" group. Not in the original
// luna-applauncher; added through this overlay's depends.js (which lists
// the original files, then this one), so the original files stay as they
// are (compat/README.md).
//
// What Search your phone (org.webosphoenix.service.index, services/index:
// the user's things by what they mean, with EmbeddingGemma 2 on the
// device) finds for the words typed, under the exact matches (the apps'
// content searches, DbSearch) and above the web searches: at most five,
// each with its app's icon, its title and a line of what matched; a tap
// opens the app on it, as a content result does (DbSearch.js
// handleContentItemTap: appLauncher.launchApp(id, params)). The search
// waits for half a second of no typing, as DbSearch's does
// (Util.debounce(..., 0.5)), asks for at least three letters, leaves out
// what has the words typed themselves (skipLiteral: those are the content
// searches' above), and shows nothing while the index is off. The query's
// embedding is one call to the model, kept by the service for the next
// keystroke that comes back to the same words.
//
// MainView's list of searches (its Scroller's components) gets this one
// after DbSearch, before the kind is first made: MainView.searchTermChanged
// and cleanup then call its setSearchTerm and cleanup with the others'.
// The views that show only contacts, content or actions hide it.

enyo.kind({
	name: "PhoenixPhoneSearch",
	kind: "VFlexBox",
	published: {
		searchTerm: ""
	},
	components: [
		{kind: "PalmService", name: "search", service: "palm://org.webosphoenix.service.index/", method: "search", onResponse: "gotResults"},
		{kind: "RowGroup", name: "group", caption: "", showing: false, components: [
			{kind: "VirtualRepeater", name: "list", onSetupRow: "setupRow", components: [
				{kind: "Item", name: "row", tapHighlight: true, onclick: "rowTap", components: [
					{kind: "HFlexBox", align: "center", components: [
						{name: "icon", className: "list-icon phoenix-phone-icon"},
						{kind: "VFlexBox", flex: 1, components: [
							{name: "title", className: "dbcontent-display1 phoenix-phone-text"},
							{name: "detail", className: "dbcontent-display2 phoenix-phone-text"}
						]}
					]}
				]}
			]}
		]}
	],
	SEARCHMINLENGTH: 3,
	LIMIT: 5,

	create: function() {
		this.inherited(arguments);
		this.results = [];
		this.asked = "";
		this.$.group.setCaption($L("From your phone"));
		this.delayedSearch = Util.debounce(undefined, enyo.bind(this, "startSearch"), 0.5);
	},

	searchTermChanged: function() {
		if (!this.searchTerm || this.searchTerm.length < this.SEARCHMINLENGTH) {
			this.show([]);
			return;
		}
		this.delayedSearch();
	},

	startSearch: function() {
		if (!this.searchTerm || this.searchTerm.length < this.SEARCHMINLENGTH)
			return;
		this.asked = this.searchTerm;
		this.$.search.call({query: this.searchTerm, limit: this.LIMIT, skipLiteral: true});
	},

	gotResults: function(inSender, inResponse) {
		// An answer to words typed since: the next one comes.
		if (this.asked !== this.searchTerm)
			return;
		this.show(inResponse && inResponse.returnValue && inResponse.results ? inResponse.results : []);
	},

	show: function(results) {
		this.results = results.slice(0, this.LIMIT);
		this.$.group.setShowing(this.results.length > 0);
		this.$.list.render();
	},

	setupRow: function(inSender, inIndex) {
		var r = this.results[inIndex];
		if (!r)
			return false;
		var esc = enyo.string.escapeHtml;
		if (r.icon)
			this.$.icon.applyStyle("background-image", "url(" + r.icon + ")");
		else
			this.$.icon.addClass("generic");
		this.$.title.setContent(esc(r.title || r.sourceTitle));
		var when = r.time ? new Date(r.time).toLocaleDateString(undefined, {month: "short", day: "numeric"}) : "";
		var line = r.snippet && r.snippet !== r.title ? r.snippet : [r.who, r.place].filter(Boolean).join(" · ");
		this.$.detail.setContent(esc([r.sourceTitle, r.who && line.indexOf(r.who) < 0 ? r.who : "", when].filter(Boolean).join(" · ") + (line ? ": " + line : "")));
		if (inIndex == this.results.length - 1)
			this.$.row.addClass("enyo-last");
		return true;
	},

	rowTap: function(inSender, inEvent) {
		var r = this.results[inEvent.rowIndex];
		if (r && r.open)
			enyo.$.justTypeApp.$.appLauncher.launchApp(r.open.appId, r.open.params || {});
	},

	cleanup: function() {
		this.asked = "";
		this.show([]);
	}
});

(function() {
	var list = MainView.prototype.kindComponents[0].components, at = 0;
	for (var i = 0; i < list.length; i++)
		if (list[i].name == "dbSearch")
			at = i + 1;
	list.splice(at, 0, {kind: "PhoenixPhoneSearch", name: "phoenixPhoneSearch"});
	// Only in the view of everything: hidden where MainView hides DbSearch.
	function only(method, shown) {
		var original = MainView.prototype[method];
		MainView.prototype[method] = function(view) {
			var r = original.apply(this, arguments);
			if (this.$.phoenixPhoneSearch)
				this.$.phoenixPhoneSearch.setShowing(shown(view));
			return r;
		};
	}
	only("showView", function(view) { return view == "all"; });
	only("hideEverything", function() { return false; });
	only("showActionsOnly", function() { return false; });
})();
