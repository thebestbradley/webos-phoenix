// Phoenix compat overlay: the Enyo accounts library's original depends.js
// plus css/phoenix-compat.css, which lets its 500 px account pages (used by
// Accounts, Contacts, Calendar and Email) fit a phone card, and
// source/phoenix-signup.js, the "Don't have an account? Sign up" link of a
// template with a signUp (docs/SYNERGY-SDK.md). source/cross-app.js is an
// overlay of the original's (a template's own sign-in page is framed only
// when it is Phoenix's own, rule C17 on the device). Nothing else is changed.
enyo.depends(
	"css/accounts-list.css",
	"css/phoenix-compat.css",
	"source/util.js",
	"source/remove-account.js",
	"source/duplicate-check.js",
	"source/accounts-list.js",
	"source/add-account.js",
	"source/check-first-launch.js",
	"source/credentials.js",
	"source/phoenix-signup.js",
	"source/cross-app.js",
	"source/entry-add.js",
	"source/entry-first-launch.js",
	"source/entry-modify.js",
	"source/errors.js",
	"source/get-accounts.js",
	"source/get-templates.js",
	"source/login-utils.js",
	"source/modify.js",
	"source/sim-account.js",
	"$enyo/g11n/phone/"
);
