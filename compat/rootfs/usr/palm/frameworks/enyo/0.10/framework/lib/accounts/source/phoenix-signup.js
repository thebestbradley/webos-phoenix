// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Phoenix addition to the Enyo accounts library (compat overlay, loaded by
// depends.js after credentials.js): "Don't have an account? Sign up" under
// the sign-in fields, for an account template that says where a person
// without an account gets one (the template's `signUp`: {url?, servers?:
// [{name, url}]}, which phoenix-connector writes from a connector's
// definition; docs/SYNERGY-SDK.md "Sign-up link"). The original had no
// such link: Palm's Synergy accounts (Google, Facebook, Exchange) were
// accounts people already had.
//
//   Accounts.SignUpLink   a kind for sign-in pages of their own (a
//                         template's validator.customUI, as the Fediverse's):
//                         {kind: "Accounts.SignUpLink", name: "signUp"},
//                         then this.$.signUp.setTemplate(template)
//   Accounts.credentials  the library's own user name and password page
//                         (credentials.js) shows it when creating an account
//                         of such a template, between the fields and the
//                         error box
//
// The link opens the page in the browser (com.palm.applicationManager/open);
// suggested servers are links of their own. Only https addresses are shown.

enyo.kind({
	name: "Accounts.SignUpLink",
	kind: enyo.Control,
	className: "accounts-signup",
	showing: false,
	published: {
		template: null
	},
	components: [
		{name: "line", kind: enyo.Control, components: [
			{name: "ask", kind: enyo.Control, nodeTag: "span", content: "Don't have an account? "},
			{name: "link", kind: enyo.Control, nodeTag: "span", className: "accounts-signup-link", content: "Sign up", onclick: "openPage"}
		]},
		{name: "servers", kind: enyo.Control, className: "accounts-signup-servers", showing: false},
		{name: "open", kind: "PalmService", service: "palm://com.palm.applicationManager/", method: "open"}
	],
	https: function(v) {
		return typeof v === "string" && v.length <= 500 && /^https:\/\/[^\s\/?#]+[^\s]*$/i.test(v);
	},
	templateChanged: function() {
		var s = this.template && this.template.signUp;
		if (typeof s === "string")
			s = {url: s};
		var url = s && this.https(s.url) ? s.url : "";
		var servers = (s && enyo.isArray(s.servers) ? s.servers : []).filter(function(x) {
			return x && typeof x.name === "string" && x.name && this.https(x.url);
		}, this).slice(0, 10);
		this.url = url;
		this.$.servers.destroyControls();
		if (servers.length) {
			this.$.servers.createComponent({kind: enyo.Control, nodeTag: "span", content: url ? "Or join " : "Join "}, {owner: this});
			servers.forEach(function(x, i) {
				if (i)
					this.$.servers.createComponent({kind: enyo.Control, nodeTag: "span", content: i === servers.length - 1 ? " or " : ", "}, {owner: this});
				this.$.servers.createComponent({kind: enyo.Control, nodeTag: "span", className: "accounts-signup-link", content: enyo.string.escapeHtml(x.name),
				                                address: x.url, onclick: "openServer"}, {owner: this});
			}, this);
		}
		this.$.link.setShowing(!!url);
		this.$.ask.setContent(url ? "Don't have an account? " : "Don't have an account?");
		this.$.servers.setShowing(servers.length > 0);
		this.setShowing(!!url || servers.length > 0);
		if (this.hasNode())
			this.render();
	},
	openPage: function() {
		if (this.url)
			this.$.open.call({target: this.url});
	},
	openServer: function(inSender) {
		this.$.open.call({target: inSender.address});
	}
});

// The library's own sign-in page: the link between the fields and the
// error box, for a new account of a template with a signUp.
(function() {
	var proto = Accounts.credentials.prototype;
	var list = proto.kindComponents || [];
	var at = 0;
	for (; at < list.length && list[at].name !== "errorBox"; at++)
		;
	proto.kindComponents = list.slice(0, at).concat([{name: "phoenixSignUp", kind: "Accounts.SignUpLink"}], list.slice(at));
	var display = proto.displayCredentialsView;
	proto.displayCredentialsView = function(account, capability) {
		display.apply(this, arguments);
		// Creating an account: the template, with no _id yet.
		this.$.phoenixSignUp.setTemplate(account && !account._id ? account : null);
	};
})();
