// Phoenix compat: a Gmail account's errors in plain words.
//
// Once a Gmail account (com.palm.google: accounts/source/phoenix-gmail.js)
// works, Google can stop taking its app password: the person revoked it at
// myaccount.google.com/apppasswords, or changed their Google password,
// which revokes them all. The transport then cannot log in and sets the
// account's error, BAD_USERNAME_OR_PASSWORD with Google's own line
// ("[AUTHENTICATIONFAILED] Invalid credentials", SMTP's "535-5.7.8
// Username and Password not accepted"; mojomail LoginCommand.cpp:86-103),
// and Email says "Bad username or password" on its dashboard
// (DashboardManager.accountError, EmailAccount.getDashboardErrorString)
// and in the folder's error popup (Mail.getErrorPopupInfoForAccount,
// EmailAccount.getErrorString). For a Gmail account those say what
// happened and what to do instead: make a new app password and enter it in
// the account's settings; the Google account's own password ("Application-
// specific password required"); IMAP turned off ("Your account is not
// enabled for IMAP use"). Other accounts are unchanged.

/*global enyo, $L, EmailAccount, DashboardManager, Mail */
(function () {
    "use strict";

    var GMAIL = "com.palm.google";

    function isGmail(accountId) {
        var list = enyo.application && enyo.application.accounts;
        var account = list && list.getAccount && list.getAccount(accountId);
        return !!account && typeof account.getTemplateId === "function" && account.getTemplateId() === GMAIL;
    }

    // Google's refusal in plain words, or null (not a login refused).
    function gmailText(errorCode, errorText) {
        var said = String(errorText || "");
        if (/not enabled for IMAP/i.test(said)) {
            return $L("IMAP is off for this Gmail account. Turn it on in Gmail on the web (Settings, Forwarding and POP/IMAP); for a Google Workspace address, ask your administrator.");
        }
        if (/application-specific password required|5\.7\.9/i.test(said)) {
            return $L("Gmail needs an app password, not your Google password. Make one at myaccount.google.com/apppasswords and enter it in this account's settings.");
        }
        if (errorCode === EmailAccount.ACCOUNT_WEB_LOGIN_REQUIRED) {
            return $L("Google wants you to sign in once at mail.google.com in the browser. Then Email can sign in again.");
        }
        if (errorCode === EmailAccount.BAD_USERNAME_OR_PASSWORD) {
            return $L("Google no longer accepts this account's app password: it was revoked, or your Google password changed. Make a new app password at myaccount.google.com/apppasswords and enter it in this account's settings.");
        }
        return null;
    }

    // fn with EmailAccount[name] answering text, then as it was.
    function saying(name, text, fn) {
        var was = EmailAccount[name];
        EmailAccount[name] = function () { return text; };
        try {
            return fn();
        } finally {
            EmailAccount[name] = was;
        }
    }

    if (typeof DashboardManager === "function") {
        var accountError = DashboardManager.prototype.accountError;
        DashboardManager.prototype.accountError = function (accountId, errorCode, errorText) {
            var text = isGmail(accountId) && gmailText(errorCode, errorText);
            var self = this, args = arguments;
            if (!text) return accountError.apply(this, args);
            return saying("getDashboardErrorString", text, function () { return accountError.apply(self, args); });
        };
    }

    if (typeof Mail === "function") {
        var popupInfo = Mail.prototype.getErrorPopupInfoForAccount;
        Mail.prototype.getErrorPopupInfoForAccount = function (accountId) {
            var account = enyo.application.accounts.getAccount(accountId);
            var error = account && this.getErrorForAccount(account);
            var text = error && isGmail(accountId) && gmailText(error.errorCode, error.errorText);
            var self = this, args = arguments;
            if (!text) return popupInfo.apply(this, args);
            return saying("getErrorString", text, function () { return popupInfo.apply(self, args); });
        };
    }

    window.PhoenixGmailErrors = { text: gmailText };
})();
