// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Sign-in page of the iCloud account (template com.webosphoenix.icloud, a
// preset of the CardDAV & CalDAV transport: apps/dav/service/lib/presets.js).
// No server field: the hosts are the preset's. The Apple Account's email
// address and an app-specific password, with how to make one. Otherwise as
// DavWizard.js: launched by the accounts library's CrossAppUI with
// enyo.windowParams {mode: "create", template} or {mode: "modify", account},
// it calls the template's validator (org.webosphoenix.service.dav/checkCredentials)
// and answers through CrossAppResult as Email's wizard does (core-apps
// com.palm.app.email accounts/source/CRUDAccounts.js sendValidResult).
//
// Apple's own page on app-specific passwords (support.apple.com/102654):
// made at account.apple.com, Sign-In and Security, App-Specific Passwords;
// the Apple Account must have two-factor authentication on. iCloud answers
// the account's own password with 401 like a wrong one, so a refused
// sign-in says to use an app-specific password.

enyo.kind({
    name: "IcloudWizard",
    kind: "enyo.VFlexBox",
    className: "enyo-bg dav-wizard",
    SERVICE: "palm://org.webosphoenix.service.dav/",
    TEMPLATE_ID: "com.webosphoenix.icloud",
    APPLE_ACCOUNT: "https://account.apple.com",
    APPLE_HELP: "https://support.apple.com/102654",
    components: [
        {kind: "Toolbar", className: "enyo-toolbar-light accounts-header", pack: "center", components: [
            {kind: "Image", src: "/usr/palm/public/accounts/com.webosphoenix.icloud/images/icloud-48x48.png"},
            {kind: "Control", content: "iCloud"}
        ]},
        {className: "accounts-header-shadow"},
        {kind: "Scroller", flex: 1, components: [
            {kind: "Control", className: "box-center", components: [
                {kind: "HtmlContent", name: "help", className: "dav-help", onLinkClick: "openLink",
                 content: "Your iCloud contacts and calendars, kept in step both ways.<br><br>" +
                          "Sign in with your Apple Account's email address and an <b>app-specific password</b>, " +
                          "not your Apple Account's own password. To make one, sign in at " +
                          "<a href=\"https://account.apple.com\">account.apple.com</a>, open Sign-In and Security, " +
                          "then App-Specific Passwords. Your Apple Account needs two-factor authentication turned on. " +
                          "The password reaches only mail, contacts and calendars, and you can revoke it there at any time " +
                          "(<a href=\"https://support.apple.com/102654\">Apple's help</a>).<br><br>" +
                          "iCloud Reminders are not included: Apple stopped serving them to other apps when Reminders was upgraded in iOS 13."},
                {kind: "RowGroup", caption: "APPLE ACCOUNT EMAIL", className: "accounts-group", components: [
                    {kind: "Input", name: "username", hint: "you@icloud.com", spellcheck: false, autocorrect: false,
                     autoCapitalize: "lowercase", inputType: "email", changeOnInput: true, onchange: "fieldChanged", onkeydown: "checkForEnter"}
                ]},
                {kind: "RowGroup", caption: "APP-SPECIFIC PASSWORD", className: "accounts-group", components: [
                    {kind: "PasswordInput", name: "password", hint: "xxxx-xxxx-xxxx-xxxx", changeOnInput: true,
                     onchange: "fieldChanged", onkeydown: "checkForEnter"}
                ]},
                {name: "errorBox", kind: "enyo.HFlexBox", className: "error-box", align: "center", showing: false, components: [
                    {kind: "Image", src: AccountsUtil.libPath + "images/header-warning-icon.png"},
                    {name: "errorMessage", className: "enyo-text-error", flex: 1}
                ]},
                {name: "signInButton", kind: "ActivityButton", caption: AccountsUtil.BUTTON_SIGN_IN, disabled: true,
                 className: "enyo-button-dark accounts-btn", onclick: "signIn"}
            ]}
        ]},
        {className: "accounts-footer-shadow"},
        {kind: "Toolbar", className: "enyo-toolbar-light", components: [
            {kind: "Button", label: AccountsUtil.BUTTON_CANCEL, className: "accounts-toolbar-btn", onclick: "cancel"}
        ]},
        {name: "validate", kind: "PalmService", onResponse: "validated"},
        {name: "openUrl", kind: "PalmService", service: "palm://com.palm.applicationManager/", method: "open"},
        {kind: "CrossAppResult", name: "crossAppResult"}
    ],

    create: function (params) {
        this.inherited(arguments);
        this.params = params || {};
        this.mode = this.params.mode || "create";
        this.$.validate.setService(this.SERVICE);
        this.$.validate.setMethod("checkCredentials");
        if (this.mode === "modify" && this.params.account) {
            // A new app-specific password for the same Apple Account.
            this.$.username.setValue(this.params.account.username || "");
            this.$.username.setDisabled(true);
        }
    },

    openLink: function (inSender, url) {
        // Only Apple's two pages are linked from here.
        if (url === this.APPLE_ACCOUNT || url === this.APPLE_ACCOUNT + "/" || url === this.APPLE_HELP)
            this.$.openUrl.call({target: url});
    },

    // An Apple Account is an email address.
    usernameOk: function () {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.$.username.getValue().trim());
    },

    fieldChanged: function () {
        this.$.signInButton.setDisabled(!(this.usernameOk() && this.$.password.getValue()));
    },

    checkForEnter: function (inSender, inEvent) {
        if (inEvent.keyCode === 13 && !this.$.signInButton.getDisabled()) {
            this.signIn();
            return true;
        }
    },

    signIn: function () {
        this.$.errorBox.hide();
        this.$.signInButton.setActive(true);
        this.$.signInButton.setDisabled(true);
        this.$.signInButton.setCaption(AccountsUtil.BUTTON_SIGNING_IN);
        var params = {
            username: this.$.username.getValue().trim(),
            // Apple shows it as xxxx-xxxx-xxxx-xxxx; spaces copied with it are not part of it.
            password: this.$.password.getValue().replace(/\s+/g, ""),
            templateId: this.TEMPLATE_ID,
            config: {}
        };
        if (this.mode === "modify" && this.params.account)
            params.accountId = this.params.account._id;
        this.$.validate.call(params);
    },

    errorText: function (code) {
        if (code === "401_UNAUTHORIZED")
            return "iCloud did not accept this email address and password. Use an app-specific password from " +
                   "account.apple.com (Sign-In and Security, App-Specific Passwords), not your Apple Account's own password.";
        if (code === "UNSUPPORTED_CAPABILITY")
            return "iCloud did not offer contacts or calendars for this Apple Account. Check that Contacts and Calendars " +
                   "are turned on for iCloud on one of your Apple devices.";
        return AccountError.getErrorText(code || "UNKNOWN_ERROR");
    },

    validated: function (inSender, inResponse) {
        this.$.signInButton.setActive(false);
        this.$.signInButton.setCaption(AccountsUtil.BUTTON_SIGN_IN);
        this.fieldChanged();
        if (!inResponse || !inResponse.returnValue) {
            this.$.errorMessage.setContent(this.errorText(inResponse && inResponse.errorCode));
            this.$.errorBox.show();
            return;
        }
        var result = {returnValue: true, credentials: inResponse.credentials, config: inResponse.config};
        if (this.mode !== "modify") {
            result.template = this.params.template;
            result.templateId = this.TEMPLATE_ID;
            result.username = inResponse.username || this.$.username.getValue().trim();
        }
        this.$.crossAppResult.sendResult(result);
    },

    cancel: function () {
        this.$.crossAppResult.sendResult({returnValue: false});
    }
});
