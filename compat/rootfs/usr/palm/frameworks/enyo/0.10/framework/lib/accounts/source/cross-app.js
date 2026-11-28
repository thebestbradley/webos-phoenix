// webOS Phoenix overlay: the accounts library's cross-app.js (third_party/enyo-1.0
// framework/lib/accounts/source/cross-app.js, Apache-2.0) with one change:
// before it frames a template's own sign-in page (validator.customUI), it
// asks the Marketplace's service whether the page is Phoenix's own
// (org.webosphoenix.service.packages/checkSignInPage, group
// phoenix.packages.signin; apps/marketplace/service/packagesservice.js,
// "Sign-in pages"). The page is a frame of this card (Accounts, or Calendar's
// and Email's account pages) and calls with its name and groups, which in
// Accounts hold every Phoenix connector's sign-in group
// (compat/app-permissions.json). The catalogs refuse a third party's page
// (connector rule C17); this covers a package that never went through one
// (a Developer Mode sideload, nova install, a Preware feed). A page that is
// not Phoenix's own, or a check that cannot be made, is not framed: the
// view says why instead (C17's words), and Back returns as a cancelled page
// does ({returnValue: false}). Everything else is the original's.

// Handle cross-app launch for custom validation UI
// If an account is being modified


enyo.kind({
	name: "Accounts.crossAppUI",
	kind: enyo.Control,
	events: {
		onResult: "",
		onCrossAppUILoaded: "",
	},
	components: [
		{kind: "CrossAppUI", name:"crossAppUI", tabIndex: -1},
		{name: "refused", kind: enyo.Control, className: "accounts-signin-refused", showing: false, components: [
			{name: "refusedText", kind: enyo.Control, className: "accounts-signin-refused-text"},
			{name: "refusedBack", kind: "Button", caption: "Back", onclick: "refusedDone"}
		]},
		{name: "modifyAccount", kind: "PalmService", service: enyo.palmServices.accounts, method: "modifyAccount"},
		{name: "checkSignInPage", kind: "PalmService", service: "palm://org.webosphoenix.service.packages/", method: "checkSignInPage",
		 onResponse: "gotSignInCheck"},
	],
	// C17's words (apps/shared/connector-kit/src/tools/checks.ts THIRD_PARTY_SIGNIN),
	// when the service gives none.
	refusedMessage: "Custom sign-in pages from third-party connectors aren't supported yet; use the connector kit's standard sign-in",
	uncheckedMessage: "This sign-in page can't be opened: it could not be checked",

	launchCrossAppUI: function(ui, params) {
		// Save the accountId if modifying the account so the credentials can be saved later
		if (params && params.mode === "modify" && params.account)
			this.accountId = params.account._id;
		// Phoenix: only a page the Marketplace's service says is Phoenix's own is framed.
		var template = params && (params.template || params.account);
		var templateId = template && template.templateId;
		this.$.refused.hide();
		this.$.crossAppUI.show();
		this.pending = {ui: ui, params: params, seq: (this.pending ? this.pending.seq : 0) + 1};
		if (!ui || typeof ui.appId !== "string" || !ui.appId || typeof templateId !== "string" || !templateId) {
			this.refuse(this.uncheckedMessage);
			return;
		}
		console.log("Custom UI: checking " + ui.appId + "/" + ui.name + " for " + templateId);
		var seq = this.pending.seq;
		this.$.checkSignInPage.call({appId: ui.appId, templateId: templateId}, {seq: seq});
	},

	gotSignInCheck: function(inSender, inResponse, inRequest) {
		var p = this.pending;
		if (!p || !inRequest || inRequest.seq !== p.seq)
			return;
		if (!inResponse || inResponse.returnValue !== true) {
			// The check could not be made (no service, refused by the bus): not framed either.
			this.refuse(this.uncheckedMessage + (inResponse && inResponse.errorText ? " (" + inResponse.errorText + ")" : ""));
			return;
		}
		if (inResponse.allowed !== true) {
			this.refuse(inResponse.errorText);
			return;
		}
		this.pending = {seq: p.seq};
		this.openCrossAppUI(p.ui, p.params);
	},

	refuse: function(text) {
		console.log("Custom UI: not opened: " + (text || this.refusedMessage));
		this.$.crossAppUI.hide();
		this.$.refusedText.setContent(enyo.string.escapeHtml(text || this.refusedMessage));
		this.$.refused.show();
	},

	refusedDone: function() {
		this.pending = {seq: this.pending ? this.pending.seq : 0};
		this.$.refused.hide();
		this.$.crossAppUI.show();
		this.accountId = undefined;
		this.doResult({returnValue: false});
	},

	// The original's launchCrossAppUI.
	openCrossAppUI: function(ui, params) {
		console.log("Custom UI: Opening iFrame " + ui.appId + "/" + ui.name);
		this.$.crossAppUI.path = ui.name;
		this.$.crossAppUI.setParams(params);
		this.$.crossAppUI.setApp(ui.appId);
		this.$.crossAppUI.onResult = "handleCrossAppUIResult";
		this.$.crossAppUI.onload = 'doCrossAppUILoaded';
	},

	// Handle the validation response from the custom UI
	handleCrossAppUIResult: function(inSender, msg) {
		//console.log("Accounts.crossAppUI:" + enyo.json.stringify(msg));
		if (this.accountId) {
			// Account was being modified.  If there is a validation object then save it
			if (msg && msg.returnValue && (msg.credentials || msg.config)) {
				console.log("Updating credentials for account " + this.accountId);
				// Modify the account
				var params = {
					"accountId": this.accountId,
					"object": {
						config: msg.config,
						credentials: msg.credentials,
					}
				};
				this.$.modifyAccount.call(params);
			}
		}
		this.doResult(msg);
		this.$.crossAppUI.onResult = "";
		this.$.crossAppUI.params = null;
		this.$.crossAppUI.path = null;
		this.$.crossAppUI.setApp();
		delete this.$.crossAppUI.onload;
	}
});
