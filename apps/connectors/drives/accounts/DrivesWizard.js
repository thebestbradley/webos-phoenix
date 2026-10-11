// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Sign-in page of the drive accounts (each template's validator.customUI):
// one page for every drive, its fields chosen by the template, laid out as
// apps/dav's DavWizard and apps/fediverse's FediverseWizard (after the
// accounts library's sign-in page, enyo lib/accounts/source/credentials.js),
// answering the same way (CrossAppResult, as Email's wizard: core-apps
// com.palm.app.email accounts/source/CRUDAccounts.js sendValidResult):
//   create: {returnValue: true, template, templateId, username, credentials, config}
//   modify: {returnValue: true, credentials, config}   (signing in again)
//   cancel: {returnValue: false}
//
//   Nextcloud     the server; "Sign In" opens the server's own login page in
//                 the browser (Login Flow v2) and waits for the app password
//                 it gives; or an app password typed in
//   ownCloud      the server, the user name and an app password
//   WebDAV        the folder's address, the user name and (app) password
//   S3 storage    the provider (Backblaze B2, Wasabi, Amazon S3, or MinIO
//                 and other servers: an endpoint), region, bucket, an
//                 optional folder in it, and an access key
//   Dropbox, OneDrive, Google Drive, Box
//                 "Sign In": the provider's page in the system's browser
//                 sheet (org.webosphoenix.service.drives/signIn, OAuth with
//                 PKCE); "not available in this build" when Phoenix's app
//                 is not registered in this image (providerInfo)

enyo.kind({
    name: "DrivesWizard",
    kind: "enyo.VFlexBox",
    className: "enyo-bg drives-wizard",
    SERVICE: "palm://org.webosphoenix.service.drives/",
    HELP: {
        nextcloud: "Your Nextcloud's files in Files, the file pickers and Save to Files. Sign in on your server's own page; Phoenix gets an app password you can revoke there.",
        owncloud: "Your ownCloud's files in Files, the file pickers and Save to Files. Make an app password in ownCloud's personal settings (Security).",
        webdav: "Any WebDAV server's files in Files, the file pickers and Save to Files: the address of the folder, your user name and password (an app password where the server has them).",
        s3: "A bucket of S3-compatible storage as a drive: Backblaze B2, Wasabi, Amazon S3, MinIO and others. Make an access key for the bucket in your provider's console.",
        dropbox: "Your Dropbox in Files, the file pickers and Save to Files.",
        onedrive: "Your OneDrive in Files, the file pickers and Save to Files.",
        googledrive: "Google Drive in Files, the file pickers and Save to Files. Phoenix sees the files it saves there or opens from there, not the rest of your drive (Google's per-file access).",
        box: "Your Box in Files, the file pickers and Save to Files."
    },
    components: [
        {kind: "Toolbar", className: "enyo-toolbar-light accounts-header", pack: "center", components: [
            {kind: "Image", name: "titleIcon"},
            {kind: "Control", name: "title", content: "Drive"}
        ]},
        {className: "accounts-header-shadow"},
        {kind: "Scroller", flex: 1, components: [
            {kind: "Control", className: "box-center", components: [
                {kind: "Control", name: "help", className: "drives-help"},
                {kind: "Control", name: "unavailable", className: "drives-unavailable", showing: false},
                {kind: "RowGroup", name: "presetGroup", caption: "PROVIDER", className: "accounts-group", showing: false, components: [
                    {kind: "ListSelector", name: "preset", value: "b2", onChange: "presetChanged", items: []}
                ]},
                {kind: "RowGroup", name: "serverGroup", caption: "SERVER", className: "accounts-group", components: [
                    {kind: "Input", name: "server", hint: "cloud.example.com", spellcheck: false, autocorrect: false,
                     autoCapitalize: "lowercase", inputType: "url", changeOnInput: true, onchange: "fieldChanged", onkeydown: "checkForEnter"}
                ]},
                {kind: "RowGroup", name: "regionGroup", caption: "REGION", className: "accounts-group", showing: false, components: [
                    {kind: "Input", name: "region", spellcheck: false, autocorrect: false, autoCapitalize: "lowercase",
                     changeOnInput: true, onchange: "fieldChanged", onkeydown: "checkForEnter"}
                ]},
                {kind: "RowGroup", name: "bucketGroup", caption: "BUCKET", className: "accounts-group", showing: false, components: [
                    {kind: "Input", name: "bucket", spellcheck: false, autocorrect: false, autoCapitalize: "lowercase",
                     changeOnInput: true, onchange: "fieldChanged", onkeydown: "checkForEnter"}
                ]},
                {kind: "RowGroup", name: "prefixGroup", caption: "FOLDER IN THE BUCKET (OPTIONAL)", className: "accounts-group", showing: false, components: [
                    {kind: "Input", name: "prefix", hint: "phone", spellcheck: false, autocorrect: false, autoCapitalize: "lowercase",
                     changeOnInput: true, onchange: "fieldChanged", onkeydown: "checkForEnter"}
                ]},
                {kind: "RowGroup", name: "userGroup", caption: "USER NAME", className: "accounts-group", components: [
                    {kind: "Input", name: "username", spellcheck: false, autocorrect: false, autoCapitalize: "lowercase",
                     inputType: "email", changeOnInput: true, onchange: "fieldChanged", onkeydown: "checkForEnter"}
                ]},
                {kind: "RowGroup", name: "passwordGroup", caption: "APP PASSWORD", className: "accounts-group", components: [
                    {kind: "PasswordInput", name: "password", changeOnInput: true, onchange: "fieldChanged", onkeydown: "checkForEnter"}
                ]},
                {kind: "Control", name: "waiting", className: "drives-hint", showing: false,
                 content: "Sign in on your server's page in the browser and allow Phoenix. This page goes on by itself."},
                {kind: "Accounts.SignUpLink", name: "signUp"},
                {name: "errorBox", kind: "enyo.HFlexBox", className: "error-box", align: "center", showing: false, components: [
                    {name: "errorImage", kind: "Image", src: AccountsUtil.libPath + "images/header-warning-icon.png"},
                    {name: "errorMessage", className: "enyo-text-error", flex: 1}
                ]},
                {name: "signInButton", kind: "ActivityButton", caption: AccountsUtil.BUTTON_SIGN_IN, disabled: true,
                 className: "enyo-button-dark accounts-btn", onclick: "signIn"},
                {kind: "Button", name: "passwordInstead", caption: "Use an App Password Instead", className: "accounts-btn", showing: false,
                 onclick: "usePassword"},
                {kind: "Control", name: "privacy", className: "drives-privacy",
                 content: "Your files go between this device and the provider only; no Phoenix server is in between."}
            ]}
        ]},
        {className: "accounts-footer-shadow"},
        {kind: "Toolbar", className: "enyo-toolbar-light", components: [
            {kind: "Button", name: "cancelButton", label: AccountsUtil.BUTTON_CANCEL, className: "accounts-toolbar-btn", onclick: "cancel"}
        ]},
        {name: "info", kind: "PalmService", onResponse: "gotInfo"},
        {name: "validate", kind: "PalmService", onResponse: "validated"},
        {name: "oauth", kind: "PalmService", onResponse: "validated"},
        {name: "flowStart", kind: "PalmService", onResponse: "flowStarted"},
        {name: "flowPoll", kind: "PalmService", onResponse: "flowPolled"},
        {name: "openBrowser", kind: "PalmService", service: "palm://com.palm.applicationManager/", method: "open"},
        {kind: "CrossAppResult", name: "crossAppResult"}
    ],

    create: function (params) {
        this.inherited(arguments);
        this.params = params || {};
        this.mode = this.params.mode || "create";
        var t = this.params.template || (this.params.account && {templateId: this.params.account.templateId}) || {};
        this.templateId = t.templateId || "com.webosphoenix.drive.webdav";
        this.provider = this.templateId.replace(/^com\.webosphoenix\.drive\./, "");
        this.oauth = ["dropbox", "onedrive", "googledrive", "box"].indexOf(this.provider) >= 0;
        this.$.title.setContent((t.loc_name || this.provider));
        // The template's own icon (this page is the app's accounts/wizard.html).
        this.$.titleIcon.setSrc("../public/accounts/" + this.templateId + "/images/drive-48x48.png");
        this.$.help.setContent(this.HELP[this.provider] || "");
        [["info", "providerInfo"], ["validate", "checkCredentials"], ["oauth", "signIn"], ["flowStart", "loginFlowStart"], ["flowPoll", "loginFlowPoll"]]
            .forEach(function (x) { this.$[x[0]].setService(this.SERVICE); this.$[x[0]].setMethod(x[1]); }, this);
        if (this.mode !== "modify") this.$.signUp.setTemplate(this.params.template || null);
        this.arrange(this.provider === "nextcloud" ? "flow" : "fields");
        this.$.info.call({templateId: this.templateId});
        if (this.mode === "modify" && this.params.account) {
            // Signing in again: the same account.
            this.$.username.setValue(this.params.account.username || "");
        }
    },

    // Which fields show: "flow" (Nextcloud's server only), "fields" (the rest).
    arrange: function (how) {
        var p = this.provider;
        this.how = how;
        var dav = p === "nextcloud" || p === "owncloud" || p === "webdav";
        this.$.serverGroup.setShowing(dav || p === "s3");
        this.$.serverGroup.setCaption(p === "webdav" ? "ADDRESS" : p === "s3" ? "ENDPOINT" : "SERVER");
        this.$.server.setHint(p === "webdav" ? "https://dav.example.com/files/" : p === "s3" ? "https://minio.example.com" : "cloud.example.com");
        this.$.userGroup.setShowing((dav && how === "fields") || p === "s3");
        this.$.userGroup.setCaption(p === "s3" ? "ACCESS KEY ID" : "USER NAME");
        this.$.passwordGroup.setShowing((dav && how === "fields") || p === "s3");
        this.$.passwordGroup.setCaption(p === "s3" ? "SECRET ACCESS KEY" : p === "webdav" ? "PASSWORD" : "APP PASSWORD");
        ["presetGroup", "regionGroup", "bucketGroup", "prefixGroup"].forEach(function (n) { this.$[n].setShowing(p === "s3"); }, this);
        this.$.passwordInstead.setShowing(p === "nextcloud" && how === "flow");
        this.fieldChanged();
    },

    gotInfo: function (inSender, r) {
        if (!r || !r.returnValue) return;
        this.info = r;
        // A build registered for Google's full scope (docs/DEVELOPER-APPS.md): the whole drive.
        if (r.scope === "drive") this.$.help.setContent("Your Google Drive in Files, the file pickers and Save to Files.");
        if (!r.available) {
            this.$.unavailable.setContent(r.reason || "Not available in this build.");
            this.$.unavailable.show();
            this.$.signInButton.setDisabled(true);
            this.$.signInButton.hide();
        }
        if (r.presets) {
            this.presets = {};
            this.$.preset.setItems(r.presets.map(function (x) { this.presets[x.id] = x; return {caption: x.name, value: x.id}; }, this));
            this.$.preset.setValue("b2");
            this.presetChanged();
        }
    },

    presetChanged: function () {
        var x = this.presets && this.presets[this.$.preset.getValue()];
        if (!x) return;
        this.$.region.setValue(x.region || "");
        // An endpoint of their own only for MinIO and other servers.
        this.$.serverGroup.setShowing(!x.endpoint);
        this.fieldChanged();
    },

    fieldChanged: function () {
        var v = function (n) { return this.$[n].getValue().trim(); }.bind(this);
        var p = this.provider, ready;
        if (this.oauth) ready = true;
        else if (p === "s3") {
            var x = this.presets && this.presets[this.$.preset.getValue()];
            ready = v("bucket") && v("username") && this.$.password.getValue() && (x && x.endpoint ? v("region") : v("server"));
        } else if (this.how === "flow") ready = !!v("server");
        else ready = v("server") && v("username") && this.$.password.getValue();
        if (!this.info || this.info.available !== false) this.$.signInButton.setDisabled(!ready || !!this.polling);
    },

    checkForEnter: function (inSender, inEvent) {
        if (inEvent.keyCode === 13 && !this.$.signInButton.getDisabled()) {
            this.signIn();
            return true;
        }
    },

    usePassword: function () {
        this.stopPolling();
        this.arrange("fields");
    },

    busy: function (on) {
        this.$.signInButton.setActive(on);
        this.$.signInButton.setCaption(on ? AccountsUtil.BUTTON_SIGNING_IN : AccountsUtil.BUTTON_SIGN_IN);
        if (on) this.$.signInButton.setDisabled(true);
        else this.fieldChanged();
    },

    signIn: function () {
        this.$.errorBox.hide();
        this.busy(true);
        var p = this.provider;
        var withAccount = function (o) {
            if (this.mode === "modify" && this.params.account) o.accountId = this.params.account._id;
            return o;
        }.bind(this);
        if (this.oauth) return this.$.oauth.call(withAccount({templateId: this.templateId}));
        if (p === "nextcloud" && this.how === "flow") return this.$.flowStart.call({server: this.$.server.getValue().trim()});
        var config;
        if (p === "s3") {
            config = {preset: this.$.preset.getValue(), region: this.$.region.getValue().trim(), bucket: this.$.bucket.getValue().trim(),
                      prefix: this.$.prefix.getValue().trim()};
            if (this.$.serverGroup.getShowing()) config.endpoint = this.$.server.getValue().trim();
        } else {
            config = {server: this.$.server.getValue().trim()};
        }
        this.$.validate.call(withAccount({templateId: this.templateId, username: this.$.username.getValue().trim(),
                                          password: this.$.password.getValue(), config: config}));
    },

    // Login Flow v2: the server's page in the browser, then a poll every two seconds.
    flowStarted: function (inSender, r) {
        if (!r || !r.returnValue) return this.validated(inSender, r);
        this.flow = r;
        this.$.openBrowser.call({target: r.loginUrl});
        this.$.waiting.show();
        this.polling = setInterval(this.poll.bind(this), 2000);
        this.pollUntil = Date.now() + 20 * 60 * 1000;
        this.poll();
    },
    poll: function () {
        if (!this.flow) return;
        if (Date.now() > this.pollUntil) {
            this.stopPolling();
            return this.validated(null, {returnValue: false, errorCode: "TIMEOUT", errorText: "The sign-in took too long. Try again."});
        }
        this.$.flowPoll.call({server: this.flow.server, pollEndpoint: this.flow.pollEndpoint, pollToken: this.flow.pollToken});
    },
    flowPolled: function (inSender, r) {
        if (r && r.returnValue && r.done === false) return;
        this.stopPolling();
        this.validated(inSender, r);
    },
    stopPolling: function () {
        if (this.polling) clearInterval(this.polling);
        this.polling = null;
        this.flow = null;
        this.$.waiting.hide();
    },

    errorText: function (r) {
        switch (r && r.errorCode) {
        case "CANCELED": return "";
        case "ACCESS_DENIED": return "You did not allow Phoenix.";
        case "NOT_AVAILABLE": case "TIMEOUT": case "UNSUPPORTED_CAPABILITY": return r.errorText;
        case "UNSUPPORTED": return "Signing in this way is not available on this device yet.";
        case "400_BAD_REQUEST": return r.errorText || AccountError.getErrorText("400_BAD_REQUEST");
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
        this.stopPolling();
        this.$.crossAppResult.sendResult({returnValue: false});
    }
});
