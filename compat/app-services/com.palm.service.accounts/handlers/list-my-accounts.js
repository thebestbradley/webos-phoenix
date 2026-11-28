// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Phoenix's addition to Open webOS's accounts service (compat/app-services/
// README.md): listMyAccounts {templateId?, capability?} -> {results}, the
// accounts listAccounts would answer, less those the caller may not read.
//
// listAccounts answers every account on the device (handlers/list-accounts.js
// checks no caller), so only transports and system apps may hold it
// (phoenix.accounts.list). An app that needs a picker of its own accounts (a
// connector's compose page, docs/SYNERGY-SDK.md "The compose page") asks
// here instead (phoenix.accounts.mine). Which accounts: those whose
// template's readPermissions name the caller, with the very check
// getAccountInfo and readCredentials make (utils.js Utils.hasPermission:
// the caller's app id, or its service name, against the template's
// readPermissions; Accounts itself reads every one; a template without
// readPermissions is read by no one else). So the list never shows an
// account whose details the caller could not then read.

/*global ListAccountsCommandAssistant Utils console */
function ListMyAccountsCommandAssistant() {

	this.run = function(future) {
		var message = this.controller.message;
		new ListAccountsCommandAssistant().run.bind(this)(future);
		future.then(function() {
			var results = future.result.results || [];
			var readable = results.filter(function(account) {
				try {
					return Utils.hasPermission("readPermissions", account, message) === true;
				} catch (e) {
					return false;   // hasPermission throws (and logs) for an account the caller may not read
				}
			});
			console.log("ListMyAccounts: " + readable.length + " of " + results.length + " readable by the caller");
			future.result = { results: readable };
		});
	};

}
