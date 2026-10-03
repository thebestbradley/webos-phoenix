// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Sign-in page for a CardDAV & CalDAV account: server address, user name and
// (app) password. Laid out like the accounts library's own sign-in page
// (enyo lib/accounts/source/credentials.js, Accounts.credentialView), which
// has no field for a server.
//
// Launched by the accounts library's CrossAppUI (lib/accounts/source/cross-app.js)
// with enyo.windowParams {mode: "create", template, capability} or
// {mode: "modify", account}. It calls the template's validator,
// org.webosphoenix.service.dav/checkCredentials, and answers through
// CrossAppResult as Email's wizard does (core-apps com.palm.app.email
// accounts/source/CRUDAccounts.js sendValidResult):
//   create: {returnValue: true, template, templateId, username, credentials, config}
//           -> AccountsUI shows the capability switches and creates the account
//   modify: {returnValue: true, credentials, config}
//           -> Accounts.crossAppUI calls modifyAccount with them
//   cancel: {returnValue: false}

enyo.kind({
    name: "DavWizard",
    kind: "enyo.VFlexBox",
    className: "enyo-bg dav-wizard",
    SERVICE: "palm://org.webosphoenix.service.dav/",
    components: [
        {kind: "Toolbar", className: "enyo-toolbar-light accounts-header", pack: "center", components: [
            {kind: "Image", name: "titleIcon", src: "/usr/palm/public/accounts/com.webosphoenix.dav/images/dav-48x48.png"},
            {kind: "Control", name: "title", content: "CardDAV & CalDAV"}
        ]},
        {className: "accounts-header-shadow"},
        {kind: "Scroller", flex: 1, components: [
            {kind: "Control", className: "box-center", components: [
                {kind: "Control", className: "dav-help", content: "Contacts and calendars from iCloud, Fastmail, Nextcloud, Radicale or any other CardDAV / CalDAV server. Use an app password where the provider offers one."},
                {kind: "RowGroup", caption: "SERVER", className: "accounts-group", components: [
                    {kind: "Input", name: "server", hint: "cloud.example.com", spellcheck: false, autocorrect: false,
                     autoCapitalize: "lowercase", inputType: "url", changeOnInput: true, onchange: "fieldChanged", onkeydown: "checkForEnter"}
                ]},
                {kind: "RowGroup", caption: "USER NAME", className: "accounts-group", components: [
                    {kind: "Input", name: "username", spellcheck: false, autocorrect: false, autoCapitalize: "lowercase",
                     inputType: "email", changeOnInput: true, onchange: "fieldChanged", onkeydown: "checkForEnter"}
                ]},
                {kind: "RowGroup", caption: "APP PASSWORD", className: "accounts-group", components: [
                    {kind: "PasswordInput", name: "password", changeOnInput: true, onchange: "fieldChanged", onkeydown: "checkForEnter"}
                ]},
                {name: "errorBox", kind: "enyo.HFlexBox", className: "error-box", align: "center", showing: false, components: [
                    {name: "errorImage", kind: "Image", src: AccountsUtil.libPath + "images/header-warning-icon.png"},
                    {name: "errorMessage", className: "enyo-text-error", flex: 1}
                ]},
                {name: "signInButton", kind: "ActivityButton", caption: AccountsUtil.BUTTON_SIGN_IN, disabled: true,
                 className: "enyo-button-dark accounts-btn", onclick: "signIn"}
            ]}
        ]},
        {className: "accounts-footer-shadow"},
        {kind: "Toolbar", className: "enyo-toolbar-light", components: [
            {kind: "Button", name: "cancelButton", label: AccountsUtil.BUTTON_CANCEL, className: "accounts-toolbar-btn", onclick: "cancel"}
        ]},
        {name: "validate", kind: "PalmService", onResponse: "validated"},
        {name: "settings", kind: "PalmService", onResponse: "gotSettings"},
        {kind: "CrossAppResult", name: "crossAppResult"}
    ],

    create: function (params) {
        this.inherited(arguments);
        this.params = params || {};
        this.mode = this.params.mode || "create";
        this.$.validate.setService(this.SERVICE);
        this.$.validate.setMethod("checkCredentials");
        this.$.settings.setService(this.SERVICE);
        this.$.settings.setMethod("accountSettings");
        if (this.mode === "modify" && this.params.account) {
            // A new password for an existing account: user and server stay.
            this.$.username.setValue(this.params.account.username || "");
            this.$.username.setDisabled(true);
            this.$.server.setDisabled(true);
            this.$.settings.call({accountId: this.params.account._id});
        }
    },

    gotSettings: function (inSender, inResponse) {
        if (inResponse && inResponse.returnValue) {
            this.$.server.setValue(inResponse.serverUrl || "");
            this.fieldChanged();
        }
    },

    fieldChanged: function () {
        var ready = this.$.server.getValue().trim() && this.$.username.getValue().trim() && this.$.password.getValue();
        this.$.signInButton.setDisabled(!ready);
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
            password: this.$.password.getValue(),
            templateId: "com.webosphoenix.dav",
            config: {serverUrl: this.$.server.getValue().trim()}
        };
        if (this.mode === "modify" && this.params.account)
            params.accountId = this.params.account._id;
        this.$.validate.call(params);
    },

    validated: function (inSender, inResponse) {
        this.$.signInButton.setActive(false);
        this.$.signInButton.setCaption(AccountsUtil.BUTTON_SIGN_IN);
        this.fieldChanged();
        if (!inResponse || !inResponse.returnValue) {
            this.$.errorMessage.setContent(AccountError.getErrorText((inResponse && inResponse.errorCode) || "UNKNOWN_ERROR"));
            this.$.errorBox.show();
            return;
        }
        var result = {returnValue: true, credentials: inResponse.credentials, config: inResponse.config};
        if (this.mode !== "modify") {
            result.template = this.params.template;
            result.templateId = "com.webosphoenix.dav";
            result.username = inResponse.username || this.$.username.getValue().trim();
        }
        this.$.crossAppResult.sendResult(result);
    },

    cancel: function () {
        this.$.crossAppResult.sendResult({returnValue: false});
    }
});
