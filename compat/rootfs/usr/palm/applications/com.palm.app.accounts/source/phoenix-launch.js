// Phoenix compat: open the add flow of one account type from a launch, and
// deliver the original's own "changelogin" launch.
// Added to the original by depends.js, after AccountManager.js; the
// original files are unchanged.
//
// The Marketplace's Connections view offers "Set up" after it installs a
// connector, which launches Accounts with {templateId}. Accounts then opens
// that template's sign-in (its custom UI or the credentials view) as if it
// had been picked in "Add an Account" (AccountManager.js AddAccount,
// entry-add.js addSelectedAccount); Back goes to the "Add an Account" list.
// A templateId Accounts does not know leaves it on its main view. The
// original takes no such params: only {launchType: "changelogin",
// accountId} (AccountManager.js windowParamsChangeHandler and
// applicationRelaunchHandler, which nothing called: Enyo 1.0 sends window
// events only to ApplicationEvents components, Dispatcher.js:280-321, and
// Accounts has none). So Email's "Sign-in problem" dashboard
// (DashboardManager.js:695) and the sync alerts opened Accounts on its main
// view; here those two handlers get their params: the account's
// credentials view opens (AccountManager.js:108-140, 186-195).
(function () {
	var proto = AccountManager.prototype;

	function wanted(params) {
		return params && typeof params.templateId === "string" && params.templateId ? params.templateId : null;
	}

	// Opens the add flow once the templates are there; true when it did.
	proto.phoenixAddTemplate = function () {
		var id = this.phoenixTemplateId;
		var template = id && (this.templates || []).filter(function (t) { return t.templateId === id; })[0];
		if (!template)
			return false;
		delete this.phoenixTemplateId;
		this.selectViewByName("AccountsView");
		this.$.AccountsView.AddAccount(this.templates);
		this.$.AccountsView.addSelectedAccount(this, template);
		return true;
	};

	// Launched: enyo.windowParams holds the launch params before create
	// (palm/system/windows/manager.js:143-147).
	var create = proto.create;
	proto.create = function () {
		create.apply(this, arguments);
		this.phoenixTemplateId = wanted(enyo.windowParams);
		this.windowParamsChangeHandler(this, {params: enyo.windowParams});
		this.createComponent({kind: "ApplicationEvents", onApplicationRelaunch: "phoenixRelaunch"});
	};

	// Relaunched while running.
	proto.phoenixRelaunch = function (inSender, inEvent) {
		var p = inEvent && inEvent.params;
		if (p && p.launchType === "changelogin")
			return this.applicationRelaunchHandler(inSender, inEvent);
		var id = wanted(p);
		if (!id)
			return false;
		this.phoenixTemplateId = id;
		// Not in the list the app has (a connector installed since): get the
		// accounts and templates again; onAccountsAvailable comes back here.
		if (this.templates && !this.phoenixAddTemplate())
			this.$.accounts.getAccounts();
		return true;
	};

	var available = proto.onAccountsAvailable;
	proto.onAccountsAvailable = function () {
		var r = available.apply(this, arguments);
		if (this.phoenixTemplateId && !this.phoenixAddTemplate())
			delete this.phoenixTemplateId;
		return r;
	};
})();
