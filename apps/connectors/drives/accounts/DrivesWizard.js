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
//   SFTP          the server and port, the user name, and a password or a
//                 key: one made here (Make a Key: its public key shown, to
//                 copy into the server's ~/.ssh/authorized_keys) or one of
//                 the user's own pasted in; a folder on the server
//                 (optional). Sign In first shows the server's key
//                 (sftpHostKey) to trust, as ssh asks the first time; on
//                 signing in again a changed key is said in red, with the
//                 one trusted before

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
        box: "Your Box in Files, the file pickers and Save to Files.",
        sftp: "A folder of any SSH server (a NAS, a Raspberry Pi, your own server) in Files, the file pickers and Save to Files, over SFTP."
    },
    AUTH_ITEMS: [
        {caption: "Password", value: "password"},
        {caption: "A key made on this device", value: "device"},
        {caption: "A key of my own", value: "import"}
    ],
    components: [
        {kind: "Toolbar", className: "enyo-toolbar-light accounts-header", pack: "center", components: [
            {kind: "Image", name: "titleIcon"},
            {kind: "Control", name: "title", content: "Drive"}
        ]},
        {className: "accounts-header-shadow"},
        {kind: "Scroller", name: "scroller", flex: 1, components: [
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
                {kind: "RowGroup", name: "portGroup", caption: "PORT", className: "accounts-group", showing: false, components: [
                    {kind: "Input", name: "port", value: "22", spellcheck: false, autocorrect: false, inputType: "number",
                     changeOnInput: true, onchange: "fieldChanged", onkeydown: "checkForEnter"}
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
                {kind: "RowGroup", name: "authGroup", caption: "SIGN IN WITH", className: "accounts-group", showing: false, components: [
                    {kind: "ListSelector", name: "auth", value: "password", onChange: "authChanged", items: []}
                ]},
                {kind: "RowGroup", name: "passwordGroup", caption: "APP PASSWORD", className: "accounts-group", components: [
                    {kind: "PasswordInput", name: "password", changeOnInput: true, onchange: "fieldChanged", onkeydown: "checkForEnter"}
                ]},
                {kind: "Control", name: "keyBox", className: "drives-key", showing: false, components: [
                    {kind: "Button", name: "makeKey", caption: "Make a Key", className: "accounts-btn", onclick: "makeKey"},
                    {kind: "Control", name: "keyHint", className: "drives-hint",
                     content: "Phoenix makes an Ed25519 key and keeps it sealed on this device. Its public half goes on the server."},
                    {kind: "Control", name: "publicKey", className: "drives-public-key", showing: false},
                    {kind: "Control", name: "keyInfo", className: "drives-hint drives-key-info", showing: false},
                    {kind: "Control", name: "keyHow", className: "drives-hint", showing: false,
                     content: "Put this line in ~/.ssh/authorized_keys on the server (with ssh-copy-id, or in your NAS's settings), then Sign In."},
                    {kind: "Button", name: "copyKey", caption: "Copy Public Key", className: "accounts-btn", showing: false, onclick: "copyKey"}
                ]},
                {kind: "RowGroup", name: "importGroup", caption: "PRIVATE KEY", className: "accounts-group", showing: false, components: [
                    {kind: "RichText", name: "privateKey", richContent: false, className: "drives-private-key",
                     hint: "Paste the private key (the file without .pub)", spellcheck: false, autocorrect: false,
                     changeOnInput: true, onchange: "fieldChanged"}
                ]},
                {kind: "RowGroup", name: "folderGroup", caption: "FOLDER (OPTIONAL)", className: "accounts-group", showing: false, components: [
                    {kind: "Input", name: "folder", hint: "Your home folder", spellcheck: false, autocorrect: false, autoCapitalize: "lowercase",
                     changeOnInput: true, onchange: "fieldChanged", onkeydown: "checkForEnter"}
                ]},
                {kind: "Control", name: "trustBox", className: "drives-trust", showing: false, components: [
                    {kind: "Control", name: "trustWarning", className: "drives-trust-warning", showing: false},
                    {kind: "Control", name: "trustTitle", className: "drives-trust-title"},
                    {kind: "Control", name: "fingerprint", className: "drives-fingerprint"},
                    {kind: "Control", name: "trustHelp", className: "drives-hint"},
                    {kind: "Button", name: "trustButton", caption: "Trust and Sign In", className: "enyo-button-affirmative accounts-btn", onclick: "trust"},
                    {kind: "Button", name: "distrustButton", caption: "Do Not Trust", className: "accounts-btn", onclick: "distrust"}
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
        {name: "hostKey", kind: "PalmService", onResponse: "gotHostKey"},
        {name: "makeKeySvc", kind: "PalmService", onResponse: "keyMade"},
        {name: "importKeySvc", kind: "PalmService", onResponse: "keyImported"},
        {name: "forgetKeySvc", kind: "PalmService"},
        {name: "accountKeySvc", kind: "PalmService", onResponse: "gotAccountKey"},
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
        [["info", "providerInfo"], ["validate", "checkCredentials"], ["oauth", "signIn"], ["flowStart", "loginFlowStart"], ["flowPoll", "loginFlowPoll"],
         ["hostKey", "sftpHostKey"], ["makeKeySvc", "sftpMakeKey"], ["importKeySvc", "sftpImportKey"], ["forgetKeySvc", "sftpForgetKey"],
         ["accountKeySvc", "sftpPublicKey"]]
            .forEach(function (x) { this.$[x[0]].setService(this.SERVICE); this.$[x[0]].setMethod(x[1]); }, this);
        if (this.mode !== "modify") this.$.signUp.setTemplate(this.params.template || null);
        if (this.provider === "sftp") {
            this.$.auth.setItems(this.AUTH_ITEMS);
            this.$.privacy.setContent("Your files go between this device and your server only, encrypted by SSH; no Phoenix server is in between.");
        }
        this.arrange(this.provider === "nextcloud" ? "flow" : "fields");
        this.$.info.call({templateId: this.templateId});
        if (this.mode === "modify" && this.params.account) {
            // Signing in again: the same account.
            var name = this.params.account.username || "";
            if (this.provider === "sftp") {
                // user@host[:port][:folder]
                var m = /^([^@]+)@(\[[^\]]+\]|[^:]+)(?::(\d+))?(?::(\/.*))?$/.exec(name);
                if (m) {
                    this.$.username.setValue(m[1]);
                    this.$.server.setValue(m[2].replace(/^\[|\]$/g, ""));
                    this.$.port.setValue(m[3] || "22");
                    this.$.folder.setValue(m[4] || "");
                }
                this.$.accountKeySvc.call({accountId: this.params.account._id});
            } else {
                this.$.username.setValue(name);
            }
        }
    },

    // Which fields show: "flow" (Nextcloud's server only), "fields" (the rest).
    arrange: function (how) {
        var p = this.provider;
        this.how = how;
        var dav = p === "nextcloud" || p === "owncloud" || p === "webdav";
        var sftp = p === "sftp";
        this.$.serverGroup.setShowing(dav || p === "s3" || sftp);
        this.$.serverGroup.setCaption(p === "webdav" ? "ADDRESS" : p === "s3" ? "ENDPOINT" : "SERVER");
        this.$.server.setHint(p === "webdav" ? "https://dav.example.com/files/" : p === "s3" ? "https://minio.example.com" :
                              sftp ? "nas.local or 192.168.1.20" : "cloud.example.com");
        this.$.userGroup.setShowing((dav && how === "fields") || p === "s3" || sftp);
        this.$.userGroup.setCaption(p === "s3" ? "ACCESS KEY ID" : "USER NAME");
        if (sftp) this.$.username.setInputType("text");
        this.$.passwordGroup.setShowing((dav && how === "fields") || p === "s3" || (sftp && this.authMode() === "password"));
        this.$.passwordGroup.setCaption(p === "s3" ? "SECRET ACCESS KEY" : p === "webdav" || sftp ? "PASSWORD" : "APP PASSWORD");
        ["presetGroup", "regionGroup", "bucketGroup", "prefixGroup"].forEach(function (n) { this.$[n].setShowing(p === "s3"); }, this);
        ["portGroup", "authGroup", "folderGroup"].forEach(function (n) { this.$[n].setShowing(sftp); }, this);
        this.$.keyBox.setShowing(sftp && this.authMode() === "device");
        this.$.importGroup.setShowing(sftp && this.authMode() === "import");
        this.$.passwordInstead.setShowing(p === "nextcloud" && how === "flow");
        this.fieldChanged();
    },

    // ---- SFTP: the way of signing in, keys, the server's key ---------------------------------

    authMode: function () { return this.provider === "sftp" ? this.$.auth.getValue() : "password"; },

    authChanged: function () {
        this.hideTrust();
        this.arrange(this.how);
    },

    makeKey: function () {
        this.$.errorBox.hide();
        this.$.makeKey.setDisabled(true);
        this.$.makeKeySvc.call({comment: (this.$.username.getValue().trim() || "phoenix") + "-phoenix"});
    },
    keyMade: function (inSender, r) {
        this.$.makeKey.setDisabled(false);
        if (!r || !r.returnValue) return this.validated(inSender, r);
        if (this.deviceKey && this.deviceKey.made) this.forgetKeys([this.deviceKey.keyId]);
        r.made = true;
        this.madeKeys = (this.madeKeys || []).concat([r.keyId]);
        this.showKey(r, true);
    },
    showKey: function (r, made) {
        this.deviceKey = r;
        this.$.makeKey.setCaption(made || r.keyId ? "Make Another Key" : "Make a Key");
        // (Text: Enyo escapes a control's content.)
        this.$.publicKey.setContent(r.publicKey);
        this.$.publicKey.show();
        this.$.keyInfo.setContent(r.description + " " + r.fingerprint);
        this.$.keyInfo.show();
        this.$.keyHow.show();
        this.$.copyKey.show();
        this.fieldChanged();
        if (made) this.$.scroller.scrollIntoView(this.$.keyBox.hasNode() ? this.$.keyBox.hasNode().offsetTop : 0, 0);
    },
    // Signing in again: the key the account has.
    gotAccountKey: function (inSender, r) {
        if (!r || !r.returnValue) return;
        this.$.auth.setValue("device");
        this.arrange(this.how);
        this.showKey(r, false);
    },
    copyKey: function () {
        var text = this.deviceKey && this.deviceKey.publicKey;
        if (!text) return;
        var done = function () { this.$.copyKey.setCaption("Copied"); }.bind(this);
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(done, function () { this.copyWithSelection(text); done(); }.bind(this));
        } else {
            this.copyWithSelection(text);
            done();
        }
    },
    copyWithSelection: function (text) {
        var t = document.createElement("textarea");
        t.value = text;
        t.style.position = "fixed";
        t.style.opacity = "0";
        document.body.appendChild(t);
        t.select();
        try { document.execCommand("copy"); } catch (e) { /* nothing to copy with */ }
        document.body.removeChild(t);
    },
    keyImported: function (inSender, r) {
        if (!r || !r.returnValue) return this.validated(inSender, r);
        this.madeKeys = (this.madeKeys || []).concat([r.keyId]);
        this.importedKey = r;
        this.importedText = this.$.privateKey.getValue();
        this.askHostKey();
    },
    // Keys made or taken on this page: those in ids (all when none given) leave the key store.
    forgetKeys: function (ids) {
        var gone = ids || this.madeKeys || [];
        gone.forEach(function (id) { this.$.forgetKeySvc.call({keyId: id}); }, this);
        this.madeKeys = (this.madeKeys || []).filter(function (id) { return gone.indexOf(id) < 0; });
    },
    forgetMadeKey: function () {
        if (this.importedKey) this.forgetKeys([this.importedKey.keyId]);
    },
    keyIdForSignIn: function () {
        var a = this.authMode();
        if (a === "device") return this.deviceKey && this.deviceKey.keyId;
        if (a === "import") return this.importedKey && this.importedKey.keyId;
        return null;
    },

    sftpSignIn: function () {
        // A pasted key goes to the key store first (and is checked there).
        if (this.authMode() === "import" && !this.importedKey) {
            return this.$.importKeySvc.call({privateKey: this.$.privateKey.getValue()});
        }
        this.askHostKey();
    },
    askHostKey: function () {
        var req = {server: this.$.server.getValue().trim(), port: Number(this.$.port.getValue()) || 22};
        if (this.mode === "modify" && this.params.account) req.accountId = this.params.account._id;
        this.$.hostKey.call(req);
    },
    gotHostKey: function (inSender, r) {
        if (!r || !r.returnValue) return this.validated(inSender, r);
        this.serverKey = r.hostKey;
        // The key the account already trusts: on without asking.
        if (r.known) return this.sftpValidate();
        this.busy(false);
        this.$.signInButton.hide();
        this.$.trustWarning.setShowing(!!r.changed);
        if (r.changed) {
            this.$.trustWarning.setContent("WARNING: this server's key has changed. It was " + r.previous.fingerprint +
                                           ". Someone could be intercepting the connection, or the server was reinstalled. Trust the new key " +
                                           "only if its owner tells you it changed.");
        }
        this.$.trustTitle.setContent((r.changed ? "The server's new key (" : "The server's key (") + r.hostKey.description + ")");
        this.$.fingerprint.setContent(r.hostKey.fingerprint);
        this.$.trustHelp.setContent("This is the first time Phoenix connects to " + r.host +
                                    ". Check that the server shows the same fingerprint (ssh-keygen -lf /etc/ssh/ssh_host_" +
                                    (r.hostKey.type === "ssh-rsa" ? "rsa" : r.hostKey.type === "ssh-ed25519" ? "ed25519" : "ecdsa") + "_key.pub), then trust it. " +
                                    "Phoenix keeps it and refuses a different one.");
        if (r.changed) this.$.trustHelp.setContent("Check the new fingerprint with the server's owner before you trust it.");
        this.$.trustButton.setCaption(r.changed ? "Trust the New Key" : "Trust and Sign In");
        this.$.trustBox.show();
        // It is below the fields: brought into view.
        this.$.scroller.scrollToBottom();
    },
    trust: function () {
        this.hideTrust();
        this.$.signInButton.show();
        this.busy(true);
        this.sftpValidate();
    },
    distrust: function () {
        this.hideTrust();
        this.$.signInButton.show();
        this.serverKey = null;
        this.fieldChanged();
    },
    hideTrust: function () { this.$.trustBox.hide(); this.$.signInButton.show(); },
    sftpValidate: function () {
        var config = {server: this.$.server.getValue().trim(), port: Number(this.$.port.getValue()) || 22, folder: this.$.folder.getValue().trim(),
                      hostKey: this.serverKey};
        var keyId = this.keyIdForSignIn();
        if (keyId) config.sshKey = keyId;
        var p = {templateId: this.templateId, username: this.$.username.getValue().trim(), config: config};
        if (!keyId) p.password = this.$.password.getValue();
        if (this.mode === "modify" && this.params.account) p.accountId = this.params.account._id;
        this.$.validate.call(p);
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
        else if (p === "sftp") {
            var a = this.authMode(), port = Number(this.$.port.getValue());
            // A pasted key changed after it was taken: taken again at Sign In.
            if (this.importedKey && this.$.privateKey.getValue() !== this.importedText) { this.forgetMadeKey(); this.importedKey = null; }
            ready = v("server") && v("username") && port >= 1 && port <= 65535 &&
                    (a === "password" ? !!this.$.password.getValue() : a === "device" ? !!this.deviceKey : !!this.$.privateKey.getValue().trim());
        } else if (p === "s3") {
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
        if (p === "sftp") return this.sftpSignIn();
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
        // SFTP's answers say what to do (put the key on the server, ...).
        if (this.provider === "sftp" && r && r.errorText && r.errorCode !== "UNKNOWN_ERROR") return r.errorText;
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
                // Below a long form (SFTP's): brought into view.
                this.$.scroller.scrollToBottom();
            }
            return;
        }
        // The key used is the account's now; the others made here go.
        if (this.provider === "sftp") {
            var used = this.keyIdForSignIn();
            this.forgetKeys((this.madeKeys || []).filter(function (id) { return id !== used; }));
            this.madeKeys = [];
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
        // Keys made or taken here that no account took.
        this.forgetKeys();
        this.$.crossAppResult.sendResult({returnValue: false});
    }
});
