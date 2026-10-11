// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The sign-in page of this package's account types (each template's
// validator.customUI), laid out as apps/dav's DavWizard and the drives'
// DrivesWizard (after the accounts library's sign-in page, enyo
// lib/accounts/source/credentials.js), answering the same way
// (CrossAppResult, as Email's wizard: core-apps com.palm.app.email
// accounts/source/CRUDAccounts.js sendValidResult):
//   create: {returnValue: true, template, templateId, username, credentials, config}
//   modify: {returnValue: true, credentials, config}   (signing in again)
//   cancel: {returnValue: false}
//
// What it shows comes from the connector's service (providerInfo
// {templateId}), so one page serves every account type of Phoenix's
// connectors:
//   {name, help, privacy,
//    oauth: {available, reason?, label?},   "Sign In": the provider's page in
//        the system's sign-in sheet (signIn {templateId, accountId?}); when
//        Phoenix's app is not registered in this build, the reason ("... is
//        not available in this build") instead
//    fields: [{name, caption, hint?, type?: "text" | "password" | "url" | "email", optional?, both?}],
//        a token, an app password or a server typed in (checkCredentials
//        {templateId, username, password, config: the other fields}); a
//        field with both shows with Sign In too, and goes with signIn
//        (Bluesky's handle: whose server to sign in on);
//    fieldsCaption: the button that shows them when Sign In is offered too,
//    link: {caption, url}: where to get the token or password (the browser)}

enyo.kind({
    name: "ConnectorWizard",
    kind: "enyo.VFlexBox",
    className: "enyo-bg connector-wizard",
    components: [
        {kind: "Toolbar", className: "enyo-toolbar-light accounts-header", pack: "center", components: [
            {kind: "Image", name: "titleIcon"},
            {kind: "Control", name: "title", content: ""}
        ]},
        {className: "accounts-header-shadow"},
        {kind: "Scroller", flex: 1, components: [
            {kind: "Control", className: "box-center", components: [
                {kind: "Control", name: "help", className: "connector-help"},
                {kind: "Control", name: "unavailable", className: "connector-unavailable", showing: false},
                {kind: "Control", name: "fields"},
                {kind: "Button", name: "link", className: "accounts-btn", showing: false, onclick: "openLink"},
                {kind: "Accounts.SignUpLink", name: "signUp"},
                {name: "errorBox", kind: "enyo.HFlexBox", className: "error-box", align: "center", showing: false, components: [
                    {name: "errorImage", kind: "Image", src: AccountsUtil.libPath + "images/header-warning-icon.png"},
                    {name: "errorMessage", className: "enyo-text-error", flex: 1}
                ]},
                {name: "signInButton", kind: "ActivityButton", caption: AccountsUtil.BUTTON_SIGN_IN, disabled: true,
                 className: "enyo-button-dark accounts-btn", onclick: "signIn"},
                {kind: "Button", name: "fieldsInstead", className: "accounts-btn", showing: false, onclick: "useFields"},
                {kind: "Control", name: "privacy", className: "connector-privacy"}
            ]}
        ]},
        {className: "accounts-footer-shadow"},
        {kind: "Toolbar", className: "enyo-toolbar-light", components: [
            {kind: "Button", name: "cancelButton", label: AccountsUtil.BUTTON_CANCEL, className: "accounts-toolbar-btn", onclick: "cancel"}
        ]},
        {name: "info", kind: "PalmService", method: "providerInfo", onResponse: "gotInfo"},
        {name: "validate", kind: "PalmService", method: "checkCredentials", onResponse: "validated"},
        {name: "oauth", kind: "PalmService", method: "signIn", onResponse: "validated"},
        {name: "openBrowser", kind: "PalmService", service: "palm://com.palm.applicationManager/", method: "open"},
        {kind: "CrossAppResult", name: "crossAppResult"}
    ],

    create: function (params) {
        this.inherited(arguments);
        this.params = params || {};
        this.mode = this.params.mode || "create";
        var t = this.params.template || (this.params.account && {templateId: this.params.account.templateId}) || {};
        this.template = t;
        this.templateId = t.templateId || "";
        this.$.title.setContent(t.loc_name || "");
        // The template's own icon (this page is the app's accounts/wizard.html).
        var icon = t.icon && (t.icon.loc_48x48 || t.icon.loc_32x32);
        if (icon) this.$.titleIcon.setSrc("../public/accounts/" + this.templateId + "/" + icon);
        // The service is the one the template's validator names.
        var address = (t.validator && t.validator.address) || "";
        this.service = address.replace(/checkCredentials$/, "") || "";
        ["info", "validate", "oauth"].forEach(function (n) { this.$[n].setService(this.service); }, this);
        if (this.mode !== "modify") this.$.signUp.setTemplate(this.params.template || null);
        this.$.info.call({templateId: this.templateId});
    },

    gotInfo: function (inSender, r) {
        if (!r || !r.returnValue) {
            this.$.unavailable.setContent((r && r.errorText) || "This account type could not be reached.");
            this.$.unavailable.show();
            return;
        }
        this.info = r;
        if (r.name && !this.template.loc_name) this.$.title.setContent(r.name);
        this.$.help.setContent(r.help || "");
        this.$.privacy.setContent(r.privacy || "");
        this.$.privacy.setShowing(!!r.privacy);
        var oauth = r.oauth || null;
        var hasFields = !!(r.fields && r.fields.length);
        if (oauth && !oauth.available) {
            this.$.unavailable.setContent(oauth.reason || "Not available in this build.");
            this.$.unavailable.show();
        }
        if (r.link) {
            this.$.link.setCaption(r.link.caption);
            this.$.link.show();
        }
        this.buildFields(r.fields || []);
        if (oauth && oauth.available) {
            this.$.signInButton.setCaption(oauth.label || AccountsUtil.BUTTON_SIGN_IN);
            this.arrange("oauth");
            if (hasFields) {
                this.$.fieldsInstead.setCaption(r.fieldsCaption || "Sign In Another Way");
                this.$.fieldsInstead.show();
            }
        } else if (hasFields) {
            this.arrange("fields");
        } else {
            this.$.signInButton.hide();
        }
    },

    buildFields: function (fields) {
        this.fieldNames = [];
        fields.forEach(function (f) {
            var group = this.$.fields.createComponent({kind: "RowGroup", name: f.name + "Group", caption: f.caption, className: "accounts-group", owner: this});
            var input = {name: f.name, owner: this, changeOnInput: true, onchange: "fieldChanged", onkeydown: "checkForEnter",
                         spellcheck: false, autocorrect: false, hint: f.hint || ""};
            if (f.type === "password") input.kind = "PasswordInput";
            else {
                input.kind = "Input";
                input.autoCapitalize = "lowercase";
                if (f.type === "url" || f.type === "email") input.inputType = f.type;
            }
            group.createComponent(input);
            this.fieldNames.push(f);
        }, this);
        this.$.fields.render();
    },

    arrange: function (how) {
        this.how = how;
        (this.fieldNames || []).forEach(function (f) { this.$[f.name + "Group"].setShowing(how === "fields" || (how === "oauth" && !!f.both)); }, this);
        var only = (this.fieldNames || []).filter(function (f) { return !f.both; });
        this.$.link.setShowing(how === "fields" && !!(this.info && this.info.link));
        this.$.fieldsInstead.setShowing(how === "oauth" && only.length > 0);
        this.fieldChanged();
    },

    useFields: function () { this.arrange("fields"); },

    openLink: function () {
        if (this.info && this.info.link) this.$.openBrowser.call({target: this.info.link.url});
    },

    fieldChanged: function () {
        var ready = true;
        var how = this.how;
        if (how === "fields" || how === "oauth") {
            ready = (this.fieldNames || []).filter(function (f) { return how === "fields" || f.both; }).every(function (f) {
                return f.optional || !!String(this.$[f.name].getValue() || "").trim();
            }, this);
        } else ready = false;
        this.$.signInButton.setDisabled(!ready || !!this.signingIn);
    },

    checkForEnter: function (inSender, inEvent) {
        if (inEvent.keyCode === 13 && !this.$.signInButton.getDisabled()) {
            this.signIn();
            return true;
        }
    },

    busy: function (on) {
        this.signingIn = on;
        this.$.signInButton.setActive(on);
        this.$.signInButton.setCaption(on ? AccountsUtil.BUTTON_SIGNING_IN
            : (this.how === "oauth" && this.info && this.info.oauth && this.info.oauth.label) || AccountsUtil.BUTTON_SIGN_IN);
        if (on) this.$.signInButton.setDisabled(true);
        else this.fieldChanged();
    },

    signIn: function () {
        this.$.errorBox.hide();
        this.busy(true);
        var o = {templateId: this.templateId};
        if (this.mode === "modify" && this.params.account) o.accountId = this.params.account._id;
        if (this.how === "oauth") {
            (this.fieldNames || []).forEach(function (f) { if (f.both) o[f.name] = String(this.$[f.name].getValue() || "").trim(); }, this);
            return this.$.oauth.call(o);
        }
        var config = {};
        (this.fieldNames || []).forEach(function (f) {
            var v = this.$[f.name].getValue();
            if (f.type !== "password") v = String(v || "").trim();
            if (f.name === "username" || f.name === "password") o[f.name] = v;
            else config[f.name] = v;
        }, this);
        o.config = config;
        this.$.validate.call(o);
    },

    errorText: function (r) {
        switch (r && r.errorCode) {
        case "CANCELED": return "";
        case "ACCESS_DENIED": return "You did not allow Phoenix.";
        case "NOT_AVAILABLE": case "TIMEOUT": case "UNSUPPORTED_CAPABILITY": case "NEEDS_RELAY": return r.errorText;
        case "UNSUPPORTED": return "Signing in this way is not available on this device yet.";
        case "400_BAD_REQUEST": case "401_UNAUTHORIZED": return r.errorText || AccountError.getErrorText(r.errorCode);
        }
        return AccountError.getErrorText((r && r.errorCode) || "UNKNOWN_ERROR");
    },

    validated: function (inSender, r) {
        this.busy(false);
        if (!r || !r.returnValue) {
            var text = this.errorText(r);
            if (text) {
                this.$.errorMessage.setContent(text);
                this.$.errorBox.show();
            }
            return;
        }
        var result = {returnValue: true, credentials: r.credentials, config: r.config};
        if (this.mode !== "modify") {
            result.template = this.params.template;
            result.templateId = this.templateId;
            result.username = r.username;
        }
        this.$.crossAppResult.sendResult(result);
    },

    cancel: function () {
        this.$.crossAppResult.sendResult({returnValue: false});
    }
});
