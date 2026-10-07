// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The page that adds a Subscribed Calendar (template com.webosphoenix.webcal;
// docs/M6-PLAN.md F4 item 8, after the webOS Archive's WebCal Sync): the
// address of a public .ics calendar (http, https or webcal) and, if the
// user likes, a name. Laid out like DavWizard.js; the validator
// (org.webosphoenix.service.dav/checkCredentials) reads the file, and the
// result goes back through CrossAppResult as there:
//   create: {returnValue: true, template, templateId, username (the
//           calendar's name), credentials {common: {url}}, config}
//   modify: a new address for the same subscription
//   cancel: {returnValue: false}

enyo.kind({
    name: "WebcalWizard",
    kind: "enyo.VFlexBox",
    className: "enyo-bg dav-wizard",
    SERVICE: "palm://org.webosphoenix.service.dav/",
    components: [
        {kind: "Toolbar", className: "enyo-toolbar-light accounts-header", pack: "center", components: [
            {kind: "Image", src: "/usr/palm/public/accounts/com.webosphoenix.dav/images/dav-48x48.png"},
            {kind: "Control", content: "Subscribed Calendar"}
        ]},
        {className: "accounts-header-shadow"},
        {kind: "Scroller", flex: 1, components: [
            {kind: "Control", className: "box-center", components: [
                {kind: "Control", className: "dav-help", content: "A public calendar: holidays, a team's games, a school's terms. Its events are read again every 30 minutes and cannot be changed here."},
                {kind: "RowGroup", caption: "CALENDAR ADDRESS", className: "accounts-group", components: [
                    {kind: "Input", name: "url", hint: "webcal://example.com/calendar.ics", spellcheck: false, autocorrect: false,
                     autoCapitalize: "lowercase", inputType: "url", changeOnInput: true, onchange: "fieldChanged", onkeydown: "checkForEnter"}
                ]},
                {kind: "RowGroup", caption: "NAME (OPTIONAL)", className: "accounts-group", components: [
                    {kind: "Input", name: "name", hint: "The calendar's own name", changeOnInput: true, onkeydown: "checkForEnter"}
                ]},
                {name: "errorBox", kind: "enyo.HFlexBox", className: "error-box", align: "center", showing: false, components: [
                    {kind: "Image", src: AccountsUtil.libPath + "images/header-warning-icon.png"},
                    {name: "errorMessage", className: "enyo-text-error", flex: 1}
                ]},
                {name: "signInButton", kind: "ActivityButton", caption: "Subscribe", disabled: true,
                 className: "enyo-button-dark accounts-btn", onclick: "subscribe"}
            ]}
        ]},
        {className: "accounts-footer-shadow"},
        {kind: "Toolbar", className: "enyo-toolbar-light", components: [
            {kind: "Button", label: AccountsUtil.BUTTON_CANCEL, className: "accounts-toolbar-btn", onclick: "cancel"}
        ]},
        {name: "validate", kind: "PalmService", onResponse: "validated"},
        {kind: "CrossAppResult", name: "crossAppResult"}
    ],

    create: function (params) {
        this.inherited(arguments);
        this.params = params || {};
        this.mode = this.params.mode || "create";
        this.$.validate.setService(this.SERVICE);
        this.$.validate.setMethod("checkCredentials");
        if (this.mode === "modify" && this.params.account) {
            this.$.name.setValue(this.params.account.username || "");
            this.$.name.setDisabled(true);
        }
    },

    fieldChanged: function () {
        this.$.signInButton.setDisabled(!this.$.url.getValue().trim());
    },

    checkForEnter: function (inSender, inEvent) {
        if (inEvent.keyCode === 13 && !this.$.signInButton.getDisabled()) {
            this.subscribe();
            return true;
        }
    },

    subscribe: function () {
        this.$.errorBox.hide();
        this.$.signInButton.setActive(true);
        this.$.signInButton.setDisabled(true);
        var config = {url: this.$.url.getValue().trim()};
        if (this.$.name.getValue().trim()) config.name = this.$.name.getValue().trim();
        var params = {username: config.name || "", password: "", templateId: "com.webosphoenix.webcal", config: config};
        if (this.mode === "modify" && this.params.account) params.accountId = this.params.account._id;
        this.$.validate.call(params);
    },

    validated: function (inSender, inResponse) {
        this.$.signInButton.setActive(false);
        this.fieldChanged();
        if (!inResponse || !inResponse.returnValue) {
            var code = (inResponse && inResponse.errorCode) || "UNKNOWN_ERROR";
            this.$.errorMessage.setContent(code === "400_BAD_REQUEST" && inResponse.errorText ? inResponse.errorText : AccountError.getErrorText(code));
            this.$.errorBox.show();
            return;
        }
        var result = {returnValue: true, credentials: inResponse.credentials, config: inResponse.config};
        if (this.mode !== "modify") {
            result.template = this.params.template;
            result.templateId = "com.webosphoenix.webcal";
            result.username = inResponse.username;
        }
        this.$.crossAppResult.sendResult(result);
    },

    cancel: function () {
        this.$.crossAppResult.sendResult({returnValue: false});
    }
});
