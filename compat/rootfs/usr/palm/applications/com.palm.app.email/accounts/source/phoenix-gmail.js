// Phoenix compat: Gmail in the Email account wizard, with an app password.
//
// The original had Gmail as a branded account type: the Google template
// (com.palm.google) with a MAIL capability served by the IMAP transport
// with Google's servers (imap.gmail.com 993 SSL, smtp.gmail.com 465 SSL;
// the template's MAIL "config", as in core-apps com.palm.app.accounts
// mock/accountsFirstLaunch_firstLaunch_accounts_templates_listAccountTemplates.json),
// listed on its own in Email's Add Account ("Branded templates show up as
// unique mail account types on account creation, even though they may
// rely on a standard transport", mail/source/settings/MasterSettings.js:65-71).
// Its sign-in is this wizard's: the address and password, then the
// wizard's table of known domains (AccountWizard.PredefinedAccounts,
// AccountWizard.js:1720-1721, protocol GOOGLE) checks them against
// Google's servers with the template's validator, and mojomail's IMAP
// transport treats the account as Gmail's (ImapAccount::IsGoogle, the
// templateId com.palm.google: CheckOutboxCommand.cpp:53, Gmail files sent
// mail itself).
//
// Phoenix's com.palm.google (compat/rootfs/usr/palm/public/accounts/) is
// that Gmail type, mail only (Phoenix's Google connector,
// com.webosphoenix.google, does contacts, calendars and tasks), validated
// by the IMAP transport. Google no longer takes an account's own password
// over IMAP and SMTP: a mail app signs in with an app password, which
// Google makes only once 2-Step Verification is on. So, for a Gmail
// account only (the template's id), this file:
//
// 1. Says so on the sign-in page: PASSWORD reads APP PASSWORD, and a note
//    below it says to turn on 2-Step Verification and make one, with a
//    link to Google's page (https://myaccount.google.com/apppasswords,
//    opened in the browser by the application manager, as MailApp.showHelp
//    opens its help page, MailApp.js:585-589).
// 2. Checks any address against Google's servers: a Google Workspace
//    address (you@yourcompany.com) is sent as address@gmail.com, the
//    wizard's own way of naming the servers to use (AccountWizard.js:967-972:
//    "me@mydomain.com@gmail.com will validate against gmail's servers"),
//    and the account keeps the address typed. The spaces Google shows in an
//    app password ("abcd efgh ijkl mnop") are left out.
// 3. Says what to do when Google refuses the password. Google's IMAP
//    answers "[ALERT] Application-specific password required" to an
//    account's own password (and its SMTP 534-5.7.9), "Invalid credentials"
//    to a wrong one; the transport reports either as a bad user name or
//    password (mojomail LoginCommand.cpp:86-103) with Google's line as the
//    errorText, and the wizard would show "Bad username or password." Here
//    the dialog says which, how to make an app password, and offers
//    Google's page.
// 4. Fills Manual Setup with Google's servers (IMAP, imap.gmail.com 993
//    SSL; smtp.gmail.com 465 SSL), the user name the address. Choosing an
//    outgoing encryption there gives Google's port for it: SSL 465, TLS 587
//    (Google's settings for mail apps); the original's
//    ManualConfig.checkOutPorts gives 25 for TLS unless the port is 587
//    already (ManualConfig.js:297-318), a port Google keeps for servers and
//    many networks block.
// 5. Edit Account (a new app password after the old one was revoked) takes
//    it as Google shows it too: the spaces are left out there as well
//    (SimpleConfig.validateAccount sends the field as typed in edit mode).
// 6. Signs in with the whole address only. When a login is refused the
//    wizard tries again with the part before the @ (_maybeAdjustAndRetry,
//    AccountWizard.js:308-341), and the second refusal is the one shown:
//    Google's reason for the first ("not enabled for IMAP use") was lost,
//    and for a Workspace address (you@example.org) the second try names
//    another Google account altogether (you, i.e. you@gmail.com). Google
//    signs in to IMAP and SMTP with the whole address, so for Gmail there
//    is no second try.
// 7. Says when Google's IMAP is off for the account ("Your account is not
//    enabled for IMAP use": a Workspace administrator's setting), and, for
//    an app password, that Google's App Passwords page says the setting is
//    not available while 2-Step Verification is off (or a Workspace
//    administrator does not allow app passwords).
//
// Other account types are unchanged.

/*global enyo, $L, SimpleConfig, ManualConfig, ProtocolSettings, CRUDAccounts, EmailAccount, EmailAccountValidation, EmailApp, AccountWizard */
(function () {
    "use strict";

    var GMAIL = "com.palm.google";
    var APP_PASSWORDS = "https://myaccount.google.com/apppasswords";
    var TWO_STEP = "https://myaccount.google.com/signinoptions/twosv";
    var GOOGLE_DOMAIN = /@(gmail|googlemail)\.com$/i;

    function isGmail(account) {
        return !!account && typeof account.getTemplateId === "function" && account.getTemplateId() === GMAIL;
    }

    function openAppPasswords() {
        EmailApp.Util.callService("palm://com.palm.applicationManager/open", {target: APP_PASSWORDS});
    }

    // What Google's refusal means, from its own words (the errorText).
    function gmailRefusal(err) {
        var code = err && err.errorCode;
        if (code !== EmailAccount.BAD_USERNAME_OR_PASSWORD && code !== EmailAccountValidation.BAD_EMAIL_OR_PASSWORD &&
                code !== EmailAccount.ACCOUNT_WEB_LOGIN_REQUIRED) {
            return null;
        }
        var said = String((err && err.errorText) || "");
        if (/not enabled for IMAP/i.test(said)) {
            return {
                title: $L("IMAP is off for this Gmail account"),
                text: $L("Google's mail server is turned off for this account. In Gmail on the web, Settings, Forwarding and POP/IMAP, turn on IMAP; for a Google Workspace address, your administrator may have to allow it. Then try again."),
                noAppPassword: true
            };
        }
        if (/application-specific password required|5\.7\.9/i.test(said)) {
            return {
                title: $L("Gmail needs an app password"),
                text: $L("Google does not take your Google account's own password here. Turn on 2-Step Verification for your Google account, make an app password at myaccount.google.com/apppasswords, and type that app password instead. If that page says the setting is not available, 2-Step Verification is still off (turn it on at myaccount.google.com/signinoptions/twosv), or your Google Workspace administrator does not allow app passwords."),
                twoStep: true
            };
        }
        if (code === EmailAccount.ACCOUNT_WEB_LOGIN_REQUIRED || /web login required|signin.*browser/i.test(said)) {
            return {
                title: $L("Sign in to Google in the browser"),
                text: $L("Google wants you to sign in once in the browser before mail apps may. Sign in at mail.google.com, then try again with an app password from myaccount.google.com/apppasswords.")
            };
        }
        return {
            title: $L("Google did not accept the app password"),
            text: $L("Check the email address and the app password. An app password is 16 letters, made at myaccount.google.com/apppasswords once 2-Step Verification is on; make a new one if this one was revoked (changing your Google password revokes them all).")
        };
    }

    if (typeof SimpleConfig === "function") {
        var create = SimpleConfig.prototype.create;
        SimpleConfig.prototype.create = function () {
            create.apply(this, arguments);
            // The note, under the password and above Sign In (hidden but for Gmail).
            var button = this.$.createButton;
            var note = this.createComponent({name: "gmailNote", kind: "Control", className: "phoenix-gmail-note", showing: false, components: [
                {name: "gmailNoteText", kind: "Control",
                 content: $L("Gmail signs in with an app password, not your Google password. Turn on 2-Step Verification for your Google account, then make an app password and type it above. (Without 2-Step Verification, Google's page says the setting is not available.)")},
                {name: "gmailNoteLink", kind: "Control", className: "phoenix-gmail-link", content: $L("Make an app password at myaccount.google.com"),
                 onclick: "openGmailAppPasswords"}
            ]}, {owner: this, container: button.container});
            // Placed before Sign In (it was made last).
            [note.container.controls, note.parent.children].forEach(function (list) {
                list.splice(list.indexOf(note), 1);
                list.splice(list.indexOf(button), 0, note);
            });
            // The PASSWORD group, to call it APP PASSWORD for Gmail.
            for (var n in this.$) {
                if (this.$.hasOwnProperty(n) && this.$[n] instanceof enyo.RowGroup && this.$[n].caption === $L("PASSWORD")) {
                    this.passwordGroup = this.$[n];
                }
            }
        };

        SimpleConfig.prototype.openGmailAppPasswords = function () {
            openAppPasswords();
            return true;
        };

        var loadAccount = SimpleConfig.prototype.loadAccount;
        SimpleConfig.prototype.loadAccount = function (toLoad) {
            loadAccount.apply(this, arguments);
            var gmail = isGmail(toLoad);
            this.$.gmailNote.setShowing(gmail);
            if (this.passwordGroup) this.passwordGroup.setCaption(gmail ? $L("APP PASSWORD") : $L("PASSWORD"));
            this.$.email.setHint(gmail ? "you@gmail.com" : "");
        };

        var validateAccount = SimpleConfig.prototype.validateAccount;
        SimpleConfig.prototype.validateAccount = function () {
            if (this.wizard) this.wizard.phoenixGmail = isGmail(this.account) && !this.editMode;
            if (isGmail(this.account) && this.editMode) {
                // A new app password, as Google shows it: without its spaces.
                this.$.password.setValue(this.$.password.getValue().replace(/\s+/g, ""));
            }
            if (!isGmail(this.account) || this.editMode) return validateAccount.apply(this, arguments);
            var email = this.$.email.getValue().trim();
            var password = this.$.password.getValue().replace(/\s+/g, "");
            this.$.createButton.setActive(true);
            this.gmailAddress = email;
            this.wizard.determineAccountSettings({
                emailAddress: GOOGLE_DOMAIN.test(email) ? email : email + "@gmail.com",
                password: password
            }, this.createSuccess.bind(this), this.createError.bind(this));
        };

        var createSuccess = SimpleConfig.prototype.createSuccess;
        SimpleConfig.prototype.createSuccess = function () {
            // A Workspace address checked as address@gmail.com keeps its own case and form.
            var r = isGmail(this.account) && this.wizard && this.wizard.responseObject;
            if (r && r.template && r.template.templateId === GMAIL && this.gmailAddress) {
                var typed = this.gmailAddress.toLowerCase();
                if (r.username && r.username.toLowerCase() === typed) r.username = typed;
                if (r.config && r.config.email && r.config.email.toLowerCase() === typed) r.config.email = typed;
            }
            return createSuccess.apply(this, arguments);
        };

        var createError = SimpleConfig.prototype.createError;
        SimpleConfig.prototype.createError = function (err) {
            var refusal = isGmail(this.account) && gmailRefusal(err);
            if (!refusal) return createError.apply(this, arguments);
            this._stopButton();
            var said = String((err && err.errorText) || "").trim();
            var html = enyo.string.escapeHtml(refusal.text);
            if (said) html += "<br><br><span class='phoenix-gmail-said'>" + enyo.string.escapeHtml($L("Google said:") + " " + said) + "</span>";
            var choices = refusal.noAppPassword ? [] : [{label: $L("Make an App Password"), value: "apppasswords"}];
            if (refusal.twoStep) choices.push({label: $L("Turn On 2-Step Verification"), value: "twostep"});
            choices.push({label: $L("OK"), value: "dismiss"});
            this.owner.showError({
                title: refusal.title,
                message: html,
                choices: choices,
                onChoose: function (value) {
                    if (value === "apppasswords") openAppPasswords();
                    if (value === "twostep") EmailApp.Util.callService("palm://com.palm.applicationManager/open", {target: TWO_STEP});
                }
            });
        };
    }

    if (typeof AccountWizard === "function") {
        var maybeAdjustAndRetry = AccountWizard.prototype._maybeAdjustAndRetry;
        AccountWizard.prototype._maybeAdjustAndRetry = function () {
            return this.phoenixGmail ? false : maybeAdjustAndRetry.apply(this, arguments);
        };
    }

    if (typeof ManualConfig === "function") {
        var checkOutPorts = ManualConfig.prototype.checkOutPorts;
        ManualConfig.prototype.checkOutPorts = function (inSender) {
            // (inSender: the encryption was changed; else the port is filled in only when empty.)
            if (!isGmail(this.account) || !inSender || this.$.acctType.getValue() === AccountWizard.EAS) return checkOutPorts.apply(this, arguments);
            var encryption = this.$.outEncryption.getValue();
            if (encryption === ProtocolSettings.SSL) this.$.outPort.setValue(465);
            else if (encryption === ProtocolSettings.TLS) this.$.outPort.setValue(587);
            else return checkOutPorts.apply(this, arguments);
        };
    }

    if (typeof CRUDAccounts === "function") {
        var makeDummyMailAccount = CRUDAccounts.prototype.makeDummyMailAccount;
        CRUDAccounts.prototype.makeDummyMailAccount = function () {
            var m = makeDummyMailAccount.apply(this, arguments);
            if ((this.wizardTemplate || {}).templateId !== GMAIL) return m;
            m.type = AccountWizard.IMAP;
            m.server = "imap.gmail.com";
            m.port = 993;
            m.encryption = "ssl";
            m.smtpConfig = {useSmtpAuth: true, server: "smtp.gmail.com", port: 465, encryption: "ssl"};
            return m;
        };
    }
})();
