// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Sign-in page of the Fediverse account: the handle (@you@example.social),
// then the server's own sign-in page in the system's browser sheet. Laid
// out as apps/dav's DavWizard (after the accounts library's sign-in page,
// enyo lib/accounts/source/credentials.js), and answering the same way
// (CrossAppResult, as Email's wizard: core-apps com.palm.app.email
// accounts/source/CRUDAccounts.js sendValidResult):
//   create: {returnValue: true, template, templateId, username, credentials, config}
//   modify: {returnValue: true, credentials, config}   (signing in again)
//   cancel: {returnValue: false}
//
// org.webosphoenix.service.fediverse/signIn {handle, accountId?} finds the
// server (WebFinger, NodeInfo), registers the app with it, and asks the
// OAuth service for the sign-in, whose sheet shows over this card; the
// password is typed on the server's page only. The answer is what the
// template's validator gives: credentials hold the key of the token in
// the key store, never the token.

enyo.kind({
    name: "FediverseWizard",
    kind: "enyo.VFlexBox",
    className: "enyo-bg fediverse-wizard",
    SERVICE: "palm://org.webosphoenix.service.fediverse/",
    TEMPLATE: "com.webosphoenix.fediverse",
    components: [
        {kind: "Toolbar", className: "enyo-toolbar-light accounts-header", pack: "center", components: [
            // The app's own template icon (this page is its accounts/wizard.html): the
            // Fediverse is a removable package, not in the system's templates folder.
            {kind: "Image", name: "titleIcon", src: "../public/accounts/com.webosphoenix.fediverse/images/fediverse-48x48.png"},
            {kind: "Control", name: "title", content: "Fediverse"}
        ]},
        {className: "accounts-header-shadow"},
        {kind: "Scroller", flex: 1, components: [
            {kind: "Control", className: "box-center", components: [
                {kind: "Control", className: "fediverse-help", content: "Mastodon, GoToSocial, Akkoma, Pixelfed and the other servers of the Fediverse. The people you follow show up in Contacts, direct mentions in Messaging, and the rest as notifications."},
                {kind: "RowGroup", caption: "YOUR ADDRESS", className: "accounts-group", components: [
                    {kind: "Input", name: "handle", hint: "@you@example.social", spellcheck: false, autocorrect: false,
                     autoCapitalize: "lowercase", inputType: "email", changeOnInput: true, onchange: "fieldChanged", onkeydown: "checkForEnter"}
                ]},
                {kind: "Control", className: "fediverse-hint", content: "Next, your server's own page asks you to sign in and to allow Phoenix. Phoenix never sees your password."},
                {name: "errorBox", kind: "enyo.HFlexBox", className: "error-box", align: "center", showing: false, components: [
                    {name: "errorImage", kind: "Image", src: AccountsUtil.libPath + "images/header-warning-icon.png"},
                    {name: "errorMessage", className: "enyo-text-error", flex: 1}
                ]},
                {name: "signInButton", kind: "ActivityButton", caption: AccountsUtil.BUTTON_SIGN_IN, disabled: true,
                 className: "enyo-button-dark accounts-btn", onclick: "signIn"},
                {kind: "Control", className: "fediverse-privacy", content: "Your posts and messages stay between your phone and your server; no Phoenix server is involved. Direct mentions are not private: the admins of the servers can read them."}
            ]}
        ]},
        {className: "accounts-footer-shadow"},
        {kind: "Toolbar", className: "enyo-toolbar-light", components: [
            {kind: "Button", name: "cancelButton", label: AccountsUtil.BUTTON_CANCEL, className: "accounts-toolbar-btn", onclick: "cancel"}
        ]},
        {name: "signInCall", kind: "PalmService", onResponse: "signedIn"},
        {kind: "CrossAppResult", name: "crossAppResult"}
    ],

    create: function (params) {
        this.inherited(arguments);
        this.params = params || {};
        this.mode = this.params.mode || "create";
        this.$.signInCall.setService(this.SERVICE);
        this.$.signInCall.setMethod("signIn");
        if (this.mode === "modify" && this.params.account) {
            // Signing in again (the server refused the token): the same account.
            this.$.handle.setValue("@" + (this.params.account.username || ""));
            this.$.handle.setDisabled(true);
            this.fieldChanged();
        }
    },

    fieldChanged: function () {
        var h = this.$.handle.getValue().trim();
        this.$.signInButton.setDisabled(!/^@?[^@\s]+@[^@\s]+$/.test(h) && !/^https?:\/\/[^\/]+\/@[^\/]+/.test(h));
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
        var params = {handle: this.$.handle.getValue().trim()};
        if (this.mode === "modify" && this.params.account)
            params.accountId = this.params.account._id;
        this.$.signInCall.call(params);
    },

    errorText: function (r) {
        switch (r && r.errorCode) {
        case "CANCELED": return "";
        case "ACCESS_DENIED": return "You did not allow Phoenix on your server.";
        case "INVALID_USER": return r.errorText || "There is no such account.";
        case "UNSUPPORTED_CAPABILITY": return r.errorText;
        case "UNSUPPORTED": return "Signing in this way is not available on this device yet.";
        case "DUPLICATE_ACCOUNT": return AccountError.getErrorText("DUPLICATE_ACCOUNT");
        }
        return AccountError.getErrorText((r && r.errorCode) || "UNKNOWN_ERROR");
    },

    signedIn: function (inSender, inResponse) {
        this.$.signInButton.setActive(false);
        this.$.signInButton.setCaption(AccountsUtil.BUTTON_SIGN_IN);
        this.fieldChanged();
        if (!inResponse || !inResponse.returnValue) {
            var text = this.errorText(inResponse);
            if (text) {
                this.$.errorMessage.setContent(text);
                this.$.errorBox.show();
            }
            return;
        }
        var result = {returnValue: true, credentials: inResponse.credentials, config: inResponse.config};
        if (this.mode !== "modify") {
            result.template = this.params.template;
            result.templateId = this.TEMPLATE;
            result.username = inResponse.username;
        }
        this.$.crossAppResult.sendResult(result);
    },

    cancel: function () {
        this.$.crossAppResult.sendResult({returnValue: false});
    }
});
