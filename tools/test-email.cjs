#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The simulated mail transports under the original Email (com.palm.app.email),
// in headless Chromium with the simulator's runtime and its sample IMAP
// account (runtime/phoenix-runtime.js, "Email transports"):
//
//   1. com.palm.smtp saveDraft answers the email's _id, as mojomail's
//      SaveEmailCommand does (and emailId, as before): Email's Composition
//      keeps it, so saving the draft again changes it, not a second draft;
//   2. a message moved to a folder (the app's Email.moveEmailsToFolder:
//      destFolderId, hidden) is moved there by the transport and shows again;
//      one moved to the folder it is in stays (Undo);
//   3. a deleted message (Email.deleteEmails: db8 del) goes to the account's
//      Trash; deleted there, it is gone (SyncLocalChangesCommand.cpp:470-478);
//   4. a folder's sync writes com.palm.account.syncstate:1 while it runs
//      (INCREMENTAL_SYNC, then IDLE);
//   5. com.palm.pop/parseEmlMessage reads an .eml file: headers, the body,
//      the alternative, an attachment, in the file cache; a file outside
//      what apps may read is refused;
//   6. Gmail with an app password, added as a person adds it (Preferences &
//      Accounts, Add Account, Gmail: compat/rootfs's com.palm.google and
//      accounts/source/phoenix-gmail.js) against stand-ins for Google's
//      servers: the sign-in asks for an app password and links Google's
//      page; the Google account's own password is refused with what to do;
//      Manual Setup has Google's servers; the app password makes the account
//      (com.palm.google, imap.gmail.com 993 SSL, smtp.gmail.com 465 SSL, the
//      server's folders), and mail sent from it lands in its Sent Mail;
//   7. Gmail's edge cases: 2-Step Verification off, Manual Setup's 587 and
//      465, the same address again, IMAP off, a Workspace address, the app
//      password revoked later (the account flagged, a send refused), a new
//      one in Edit Account, an attachment over Gmail's 25 MB, removal.
//
//   node tools/test-email.cjs [--tablet] [--out DIR]

"use strict";
const { spawn, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

async function drained(pending) {
    const r = await pending;
    try { await r.arrayBuffer(); } catch (e) { /* the status is what counts */ }
    return r;
}
function loadPlaywright() {
    try { return require("playwright"); } catch (e) { /* global install */ }
    return require(path.join(execSync("npm root -g").toString().trim(), "playwright"));
}

const REPO = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const tablet = args.includes("--tablet");
const outIdx = args.indexOf("--out");
const outDir = outIdx >= 0 ? args[outIdx + 1] : path.join(REPO, "build", "email-tests", tablet ? "tablet" : "phone");
const port = 8700 + Math.floor(Math.random() * 90);
const origin = `http://127.0.0.1:${port}`;
const EMAIL = `${origin}/usr/palm/applications/com.palm.app.email/index.html`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
function check(cond, what) {
    console.log(`${cond ? "ok  " : "FAIL"} ${what}`);
    if (!cond) failures++;
    return cond;
}
async function waitForServer(url, ms) {
    const until = Date.now() + ms;
    while (Date.now() < until) {
        try { if ((await drained(fetch(url))).ok) return; } catch (e) { /* retry */ }
        await sleep(100);
    }
    throw new Error("server did not start");
}

async function main() {
    const { chromium } = loadPlaywright();
    fs.mkdirSync(outDir, { recursive: true });
    const server = spawn("python3", [path.join(__dirname, "serve-rootfs.py"), "--port", String(port)], { stdio: "ignore" });
    try {
        await waitForServer(`${origin}/apps.json`, 10000);
        const browser = await chromium.launch();
        const context = await browser.newContext({ viewport: tablet ? { width: 1024, height: 740 } : { width: 320, height: 452 } });
        const errors = [];
        context.on("page", (p) => p.on("pageerror", (e) => errors.push(e.message)));
        // Email as it starts: its headless page, which opens the mail card.
        const launcher = await context.newPage();
        const opened = context.waitForEvent("page", { predicate: (p) => /\/mail\/index\.html/.test(p.url()), timeout: 20000 });
        await launcher.goto(EMAIL);
        const page = await opened;
        await page.waitForFunction(() => window.enyo && window.Email && Email.moveEmailsToFolder && enyo.application && enyo.application.accounts, null, { timeout: 20000 });
        const call = (url, params) => page.evaluate(([u, p]) => new Promise((r) => __phoenixRuntime.dispatch(u, p, r, { cancelled: () => false })), [url, params]);
        const get = async (id) => ((await call("palm://com.palm.db/find", { query: { from: "com.palm.email:1", where: [{ prop: "_id", op: "=", val: id }] , incDel: true } })).results || [])[0];
        const until = async (fn, ms) => { for (let t = 0; t < (ms || 5000); t += 100) { const v = await fn(); if (v) return v; await sleep(100); } return null; };
        const account = (await call("palm://com.palm.db/find", { query: { from: "com.palm.mail.account:1" } })).results[0];
        check(account && account._kind === "com.palm.imap.account:1" && account.trashFolderId, "the sample IMAP account, with its Trash");

        // 1. saveDraft's _id; the draft saved again is the same one.
        const first = await call("palm://com.palm.smtp/saveDraft", { accountId: account.accountId,
            email: { subject: "Plans", to: [{ addr: "alex.rivera@example.com", type: "to" }], parts: [{ type: "body", mimeType: "text/html", content: "<p>First</p>" }] } });
        check(first.returnValue && typeof first._id === "string" && first.emailId === first._id, `saveDraft answers {_id} (and emailId) (${JSON.stringify(first)})`);
        await call("palm://com.palm.smtp/saveDraft", { accountId: account.accountId,
            email: { _id: first._id, subject: "Plans, again", parts: [{ type: "body", mimeType: "text/html", content: "<p>Second</p>" }] } });
        const drafts = (await call("palm://com.palm.db/find", { query: { from: "com.palm.email:1", where: [{ prop: "folderId", op: "=", val: account.draftsFolderId }] } })).results;
        check(drafts.length === 1 && drafts[0].subject === "Plans, again", `saved again with that _id, the draft changes (${drafts.map((d) => d.subject).join(", ")})`);
        const sent = await call("palm://com.palm.smtp/sendMail", { accountId: account.accountId,
            email: { subject: "Sent now", to: [{ addr: "alex.rivera@example.com", type: "to" }], parts: [{ type: "body", mimeType: "text/html", content: "<p>Hi</p>" }] } });
        check(sent.returnValue && sent._id && (await get(sent._id)).folderId === account.sentFolderId, "sendMail answers {_id}; the message is in Sent");

        // 2. A move, as the app makes it.
        const RECEIPTS = "phoenix-sample-folder-receipts";
        await page.evaluate((dest) => new Promise((r) => Email.moveEmailsToFolder({ id: "phoenix-sample-email-1" }, dest, r)), RECEIPTS);
        const hidden = await get("phoenix-sample-email-1");
        check(hidden.destFolderId === RECEIPTS && hidden.flags.visible === false, "Email marks the move (destFolderId) and hides the message");
        const moved = await until(async () => { const e = await get("phoenix-sample-email-1"); return e.folderId === RECEIPTS && e; });
        check(moved && moved.destFolderId === null && moved.flags.visible === true && moved.flags.read === false,
              `the transport moves it to Receipts and shows it again, its flags kept (${moved && JSON.stringify(moved.flags)})`);
        // Taken back before the transport moved it (a move to where it is): it stays.
        await call("palm://com.palm.db/merge", { objects: [{ _id: "phoenix-sample-email-3", destFolderId: account.inboxFolderId, flags: { visible: true } }] });
        await sleep(1500);
        check((await get("phoenix-sample-email-3")).folderId === account.inboxFolderId, "a move to the folder it is in leaves it there");

        // 3. A delete, as the app makes it: to Trash; from Trash: gone.
        await page.evaluate(() => new Promise((r) => Email.deleteEmails({ id: "phoenix-sample-email-2" }, r)));
        const trashed = await until(async () => { const e = await get("phoenix-sample-email-2"); return e && !e._del && e.folderId === account.trashFolderId && e; });
        check(!!trashed, "a deleted message goes to the account's Trash");
        await page.evaluate(() => new Promise((r) => Email.deleteEmails({ id: "phoenix-sample-email-2" }, r)));
        check(await until(async () => !(await get("phoenix-sample-email-2"))), "deleted in Trash, it is gone");
        // The Trash, as the app lists it.
        const inTrash = (await call("palm://com.palm.db/find", { query: { from: "com.palm.email:1", where: [{ prop: "folderId", op: "=", val: account.trashFolderId }] } })).results;
        check(inTrash.length === 0, `the Trash is empty again (${inTrash.length})`);

        // 4. A folder's sync and its state.
        await call("palm://com.palm.imap/syncFolder", { accountId: account.accountId, folderId: account.inboxFolderId });
        const state = async () => ((await call("palm://com.palm.tempdb/find", { query: { from: "com.palm.account.syncstate:1",
            where: [{ prop: "collectionId", op: "=", val: account.inboxFolderId }] } })).results || []);
        const during = await state();
        check(during.length === 1 && during[0].syncState === "INCREMENTAL_SYNC" && during[0].accountId === account.accountId
              && during[0].capabilityProvider === "com.palm.imap.mail" && during[0].busAddress === "com.palm.imap",
              `while the Inbox syncs: INCREMENTAL_SYNC (${JSON.stringify(during.map((s) => s.syncState))})`);
        const after = await until(async () => { const s = await state(); return s.length === 1 && s[0].syncState === "IDLE" && s; }, 4000);
        check(!!after, "when it is done: IDLE, the state replaced (one object)");

        // 5. An .eml file, as Files opens one.
        const eml = ["From: \"Ann =?utf-8?Q?M=C3=BCller?=\" <ann@example.com>", "To: Bob <bob@example.com>, carol@example.com",
            "Cc: \"Doe, Jane\" <jane@example.com>", "Subject: =?UTF-8?B?Q2Fmw6kgcGxhbnM=?=", "Date: Tue, 6 Oct 2026 10:00:00 +0200",
            "Message-ID: <plans@example.com>", "X-Priority: 1", "MIME-Version: 1.0", "Content-Type: multipart/mixed; boundary=\"outer\"", "",
            "--outer", "Content-Type: multipart/alternative; boundary=inner", "",
            "--inner", "Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: quoted-printable", "", "Caf=C3=A9 at 10?", "",
            "--inner", "Content-Type: text/html; charset=utf-8", "", "<p>Café at <b>10</b>?</p>", "--inner--", "",
            "--outer", "Content-Type: application/pdf; name=\"menu.pdf\"", "Content-Disposition: attachment; filename*=utf-8''men%C3%BC.pdf",
            "Content-Transfer-Encoding: base64", "", "JVBERi0xLjQK", "--outer--", ""].join("\r\n");
        const file = "/media/internal/Downloads/plans.eml";
        const wrote = await call("luna://org.webosphoenix.filemanager/write", { path: file, data: eml, overwrite: true });
        check(wrote.returnValue, "an .eml file in Downloads");
        const parsed = await call("palm://com.palm.pop/parseEmlMessage", { filePath: file });
        const m = parsed.email || {};
        check(parsed.returnValue && m._kind === "com.palm.email:1" && m.subject === "Café plans" && m.priority === "high"
              && m.messageId === "<plans@example.com>" && m.timestamp === Date.UTC(2026, 9, 6, 8, 0, 0),
              `parseEmlMessage: the subject, date, priority and id (${m.subject}, ${m.timestamp})`);
        check(m.from && m.from.addr === "ann@example.com" && m.from.name === "Ann Müller"
              && JSON.stringify((m.to || []).map((t) => [t.type, t.addr, t.name])) === JSON.stringify([["to", "bob@example.com", "Bob"],
                  ["to", "carol@example.com", "carol@example.com"], ["cc", "jane@example.com", "Doe, Jane"]]),
              "... the sender and recipients, names decoded, the address as the name where there is none");
        const parts = m.parts || [];
        const body = parts.find((p) => p.type === "body"), alt = parts.find((p) => p.type === "altText"), att = parts.find((p) => p.type === "attachment");
        check(body && body.mimeType === "text/html" && alt && alt.mimeType === "text/plain" && att && att.name === "menü.pdf" && att.mimeType === "application/pdf",
              `... the HTML body, the plain alternative, the attachment (${parts.map((p) => p.type + " " + p.mimeType).join(", ")})`);
        const bodyText = body && await page.evaluate((p) => PalmSystem.getResource(p), body.path);
        check(bodyText === "<p>Café at <b>10</b>?</p>" && m.summary === "Café at 10?", `... the body in the file cache (${bodyText}), its preview the summary`);
        const pdf = att && await call("luna://org.webosphoenix.filemanager/read", { path: att.path, encoding: "base64" });
        check(pdf && pdf.data === "JVBERi0xLjQK", "... the attachment's bytes in the file cache");
        const outside = await call("palm://com.palm.pop/parseEmlMessage", { filePath: "/etc/palm/luna.conf" });
        check(outside.returnValue === false && outside.errorText === "error parsing eml", "a file outside what apps may read: \"error parsing eml\"");
        const none = await call("palm://com.palm.pop/parseEmlMessage", {});
        check(none.returnValue === false && none.errorText === "Invalid query string", "no filePath: \"Invalid query string\"");

        await page.screenshot({ path: path.join(outDir, "email.png") });

        // 6. Gmail with an app password, as a person adds it: Preferences &
        //    Accounts, Add Account, Gmail, the address and password. Google's
        //    servers are stand-ins (the store's "mailServerStandIns": the
        //    simulated transports' validateAccount answers as they would).
        const IMAP_ASP = "NO [ALERT] Application-specific password required: https://support.google.com/accounts/answer/185833 (Failure)";
        const SMTP_ASP = "534-5.7.9 Application-specific password required. For more information, go to https://support.google.com/mail/?p=InvalidSecondFactor";
        const GMAIL_USER = "phoenix.tester@gmail.com", APP_PASSWORD = "abcdefghijklmnop", GOOGLE_PASSWORD = "my-google-password";
        const WORKSPACE_USER = "you@example.org", IMAP_OFF_USER = "imap.off@gmail.com";
        const IMAP_OFF = "NO [ALERT] Your account is not enabled for IMAP use. Please visit your Gmail settings page and enable your account for IMAP access. (Failure)";
        const TOO_LARGE = "552-5.3.4 Your message exceeded Google's message size limits. For more information, go to https://support.google.com/mail/?p=MaxSizeError";
        const standIns = (app) => ({
            "imap.gmail.com": { logins: { [GMAIL_USER]: app, [WORKSPACE_USER]: APP_PASSWORD, [IMAP_OFF_USER]: APP_PASSWORD }, refusals: { [GOOGLE_PASSWORD]: IMAP_ASP },
                                refusal: "NO [AUTHENTICATIONFAILED] Invalid credentials (Failure)", disabled: { [IMAP_OFF_USER]: IMAP_OFF },
                                folders: [{ name: "[Gmail]/Drafts", special: "drafts" }, { name: "[Gmail]/Sent Mail", special: "sent" },
                                          { name: "[Gmail]/Trash", special: "trash" }, { name: "[Gmail]/Spam" }, { name: "[Gmail]/All Mail" }] },
            "smtp.gmail.com": { logins: { [GMAIL_USER]: app, [WORKSPACE_USER]: APP_PASSWORD, [IMAP_OFF_USER]: APP_PASSWORD }, refusals: { [GOOGLE_PASSWORD]: SMTP_ASP },
                                refusal: "535-5.7.8 Username and Password not accepted.", maxMessageBytes: 25 * 1024 * 1024, tooLarge: TOO_LARGE }
        });
        const setStandIns = (app) => page.evaluate((v) => localStorage.setItem("phoenix:mailServerStandIns", JSON.stringify(v)), standIns(app));
        await setStandIns(APP_PASSWORD);
        await page.evaluate(() => Object.values(enyo.$).find((c) => c.kindName === "MailApp").showPreferences());
        await page.waitForFunction(() => { const m = Object.values(enyo.$).find((c) => c.kindName === "MasterSettings"); return m && m.$.preferences; });
        await page.evaluate(() => Object.values(enyo.$).find((c) => c.kindName === "MasterSettings").showAddAccount());
        const gmailItem = page.getByText("Gmail", { exact: true });
        check(await gmailItem.waitFor({ state: "visible", timeout: 10000 }).then(() => true, () => false), "Add Account lists Gmail beside Email Account");
        await page.screenshot({ path: path.join(outDir, "gmail-1-add-account.png") });
        await gmailItem.click();
        const wizardFrame = await until(async () => page.frames().find((f) => /accounts\/wizard\.html/.test(f.url())), 10000);
        await wizardFrame.waitForFunction(() => window.enyo && enyo.$ && Object.values(enyo.$).some((c) => c.kindName === "SimpleConfig" && c.account));
        const wizardText = await wizardFrame.evaluate(() => document.body.innerText);
        check(/APP PASSWORD/.test(wizardText) && /2-Step Verification/.test(wizardText) && /Make an app password at myaccount\.google\.com/.test(wizardText),
              "Gmail's sign-in asks for an APP PASSWORD and says how to make one (2-Step Verification)");
        // The link opens Google's page in the browser (the application manager's open).
        await wizardFrame.evaluate(() => {
            window.__opened = [];
            __phoenixRuntime.services["com.palm.applicationManager"]["/open"] = (p, reply) => { window.__opened.push(p.target); reply({ returnValue: true }); };
        });
        await wizardFrame.locator(".phoenix-gmail-link").click();
        const linkOpened = await until(() => wizardFrame.evaluate(() => window.__opened[0]), 10000);
        check(linkOpened === "https://myaccount.google.com/apppasswords", `the link opens https://myaccount.google.com/apppasswords (${linkOpened})`);
        await page.screenshot({ path: path.join(outDir, "gmail-2-sign-in.png") });
        const emailInput = wizardFrame.locator("#cRUDAccounts_simpleConfig_email_input");
        const passInput = wizardFrame.locator("#cRUDAccounts_simpleConfig_password_input");
        const signIn = wizardFrame.locator("#cRUDAccounts_simpleConfig_createButton");
        const dialog = async () => (await wizardFrame.locator("#cRUDAccounts_errorDialog").isVisible()) &&
            wizardFrame.evaluate(() => document.getElementById("cRUDAccounts_errorDialog").innerText);
        await emailInput.fill(GMAIL_USER);
        // The Google account's own password: refused, and said why.
        await passInput.fill(GOOGLE_PASSWORD);
        await signIn.click();
        const refused = await until(dialog, 30000);
        check(!!refused && /Gmail needs an app password/.test(refused) && /myaccount\.google\.com\/apppasswords/.test(refused) &&
              /Application-specific password required/.test(refused) && /Make an App Password/.test(refused),
              "the Google password is refused: \"Gmail needs an app password\", how to make one, and Google's own words");
        check(/setting is not available/.test(refused) && /2-Step Verification is still off/.test(refused) && /Turn On 2-Step Verification/.test(refused),
              "... and, as Google's App Passwords page has no setting while 2-Step Verification is off, says so and offers to turn it on");
        await page.screenshot({ path: path.join(outDir, "gmail-3-refused.png") });
        await wizardFrame.locator(".enyo-button:visible", { hasText: /^Turn On 2-Step Verification$/ }).first().click();
        const twoStep = await until(() => wizardFrame.evaluate(() => window.__opened.find((u) => /twosv/.test(u))), 10000);
        check(twoStep === "https://myaccount.google.com/signinoptions/twosv", `Turn On 2-Step Verification opens Google's page (${twoStep})`);
        // A wrong app password: Google's "Invalid credentials".
        await passInput.fill("wrongwrongwrongw");
        await signIn.click();
        const wrong = await until(dialog, 30000);
        check(!!wrong && /Google did not accept the app password/.test(wrong) && /Invalid credentials/.test(wrong), "a wrong app password: \"Google did not accept the app password\"");
        await wizardFrame.locator(".enyo-button:visible", { hasText: /^OK$/ }).first().click();
        // Manual Setup has Google's servers in it.
        await wizardFrame.getByText("Manual Setup", { exact: true }).click();
        const manual = await wizardFrame.evaluate(() => ["inHost", "inPort", "inEncryption", "outHost", "outPort", "outEncryption", "inUser"]
            .map((n) => document.getElementById("cRUDAccounts_manualConfig_" + n + (/Encryption/.test(n) ? "" : "_input")))
            .map((el) => el ? (el.value !== undefined && el.tagName === "INPUT" ? el.value : el.innerText.trim()) : null));
        check(manual[0] === "imap.gmail.com" && manual[1] === "993" && manual[3] === "smtp.gmail.com" && manual[4] === "465" && manual[6] === GMAIL_USER,
              `Manual Setup is filled with Google's servers, the address as the user name (${JSON.stringify(manual)})`);
        // Its outgoing encryption gives Google's port for it: TLS 587, SSL 465 (not the original's 25 for TLS).
        const outPortFor = (enc) => wizardFrame.evaluate((e) => {
            const m = Object.values(enyo.$).find((c) => c.kindName === "ManualConfig");
            m.$.outEncryption.setValue(e);
            m.checkOutPorts(m.$.outEncryption);
            return String(m.$.outPort.getValue());
        }, enc);
        const tls = await outPortFor("tls"), ssl = await outPortFor("ssl");
        check(tls === "587" && ssl === "465", `Manual Setup: TLS goes with port 587, SSL with 465 (${tls}, ${ssl})`);
        await page.screenshot({ path: path.join(outDir, "gmail-4-manual.png") });
        await wizardFrame.evaluate(() => Object.values(enyo.$).find((c) => c.kindName === "CRUDAccounts").showSimpleConfig());
        // The app password, as Google shows it (with spaces): taken.
        await passInput.fill("abcd efgh ijkl mnop");
        await signIn.click();
        const confirm = page.locator("#mailApp_masterSettings_addAccountView_modifyAccountView_createAccountButton");
        check(await confirm.waitFor({ state: "visible", timeout: 30000 }).then(() => true, () => false), "the app password is taken; Accounts asks to create the account");
        await confirm.click();
        const gmailAccount = await until(async () => ((await call("palm://com.palm.db/find", { query: { from: "com.palm.account:1",
            where: [{ prop: "templateId", op: "=", val: "com.palm.google" }] } })).results || [])[0], 20000);
        check(gmailAccount && gmailAccount.username === GMAIL_USER, `the account is Gmail's (com.palm.google), named by the address (${gmailAccount && gmailAccount.username})`);
        const gmailCreds = gmailAccount && await call("luna://com.palm.service.accounts/readCredentials", { accountId: gmailAccount._id, name: "common" });
        check(gmailCreds && gmailCreds.credentials && gmailCreds.credentials.password === APP_PASSWORD, "its password is the app password, without the spaces");
        const gmailMail = gmailAccount && await until(async () => ((await call("palm://com.palm.db/find", { query: { from: "com.palm.mail.account:1",
            where: [{ prop: "accountId", op: "=", val: gmailAccount._id }] } })).results || [])[0], 20000);
        check(gmailMail && gmailMail._kind === "com.palm.imap.account:1" && gmailMail.server === "imap.gmail.com" && gmailMail.port === 993 &&
              gmailMail.encryption === "ssl" && gmailMail.username === GMAIL_USER && gmailMail.smtpConfig.server === "smtp.gmail.com" &&
              gmailMail.smtpConfig.port === 465 && gmailMail.smtpConfig.encryption === "ssl",
              `the IMAP transport's account: imap.gmail.com 993 SSL, smtp.gmail.com 465 SSL, the address as the user name (${gmailMail && JSON.stringify([gmailMail.server, gmailMail.port, gmailMail.smtpConfig])})`);
        const sentFolder = gmailMail && ((await call("palm://com.palm.db/get", { ids: [gmailMail.sentFolderId] })).results || [])[0];
        check(sentFolder && sentFolder.serverFolderName === "[Gmail]/Sent Mail", `its folders are the server's ([Gmail]/Sent Mail is Sent: ${sentFolder && sentFolder.displayName})`);
        const viaGmail = gmailMail && await call("palm://com.palm.smtp/sendMail", { accountId: gmailAccount._id,
            email: { subject: "From Gmail", to: [{ addr: "alex.rivera@example.com", type: "to" }], parts: [{ type: "body", mimeType: "text/html", content: "<p>Hi</p>" }] } });
        check(viaGmail && viaGmail.returnValue && (await get(viaGmail._id)).folderId === gmailMail.sentFolderId, "mail sent from it is in its Sent Mail");
        check(await until(() => page.evaluate((id) => !!enyo.application.accounts.getAccount(id), gmailAccount._id), 20000),
              "Email lists the Gmail account");
        await page.screenshot({ path: path.join(outDir, "gmail-5-accounts.png") });

        // 7. Gmail's edge cases: a second time, a Workspace address, IMAP off,
        //    the app password revoked later, a send refused, a message too
        //    large, a new app password in Edit Account, the account removed.
        const gmailAccounts = async () => ((await call("palm://com.palm.db/find", { query: { from: "com.palm.account:1",
            where: [{ prop: "templateId", op: "=", val: "com.palm.google" }] } })).results || []).filter((a) => !a.beingDeleted);
        // Add Account, Gmail, the address and password, Sign In: the wizard's frame
        // (the same iframe each time, a new page in it: the one not marked stale).
        const wizardFrames = () => page.frames().filter((f) => /accounts\/wizard\.html/.test(f.url()));
        const signInGmail = async (address, password) => {
            for (const f of wizardFrames()) await f.evaluate(() => { window.__stale = true; }).catch(() => {});
            await page.evaluate(() => Object.values(enyo.$).find((c) => c.kindName === "MasterSettings").showAddAccount());
            await page.locator("#mailApp_masterSettings_addAccountView_addAccountView_list").getByText("Gmail", { exact: true }).click();
            const frame = await until(async () => {
                for (const f of wizardFrames()) {
                    // Ready once Gmail's account is loaded into the page (phoenix-gmail.js's loadAccount ends with the hint).
                    const fresh = await f.evaluate(() => !window.__stale && !!window.enyo && !!enyo.$ &&
                        Object.values(enyo.$).some((c) => c.kindName === "SimpleConfig" && c.account && c.$.email.getHint() === "you@gmail.com")).catch(() => false);
                    if (fresh) return f;
                }
                return null;
            }, 30000);
            if (!frame) throw new Error("no Gmail sign-in page");
            await frame.locator("#cRUDAccounts_simpleConfig_email_input").fill(address);
            await frame.locator("#cRUDAccounts_simpleConfig_password_input").fill(password);
            const typed = await frame.evaluate(() => { const c = Object.values(enyo.$).find((x) => x.kindName === "SimpleConfig"); return [c.$.email.getValue(), c.$.password.getValue()]; });
            if (typed[0] !== address || typed[1] !== password) throw new Error("the sign-in page did not keep what was typed: " + JSON.stringify(typed));
            await frame.locator("#cRUDAccounts_simpleConfig_createButton").click();
            return frame;
        };
        const dialogIn = (frame) => async () => (await frame.locator("#cRUDAccounts_errorDialog").isVisible()) &&
            frame.evaluate(() => document.getElementById("cRUDAccounts_errorDialog").innerText);
        // The same address again (as typed with capitals, the app password without spaces): a duplicate.
        const dupFrame = await signInGmail("Phoenix.Tester@gmail.com", APP_PASSWORD);
        const dup = await until(dialogIn(dupFrame), 30000);
        check(!!dup && /Duplicate account/i.test(dup) && (await gmailAccounts()).length === 1,
              "the same Gmail address again (capitals, app password without spaces): \"Duplicate account\", no second account (" + String(dup).replace(/\s+/g, " ") + ")");
        await page.screenshot({ path: path.join(outDir, "gmail-6-duplicate.png") });
        await dupFrame.locator(".enyo-button:visible", { hasText: /^Done$/ }).first().click().catch(() => {});
        // Gmail's IMAP turned off for the account (a Workspace administrator's setting): said so.
        const offFrame = await signInGmail(IMAP_OFF_USER, APP_PASSWORD);
        const off = await until(dialogIn(offFrame), 30000);
        if (!off) console.log("    (the page shows: " + await offFrame.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 300)).catch((e) => e.message) + ")");
        check(!!off && /IMAP is off for this Gmail account/.test(off) && /Forwarding and POP\/IMAP/.test(off) && !/Make an App Password/.test(off),
              "IMAP turned off in Gmail: \"IMAP is off for this Gmail account\", where to turn it on, no app password offered (" + String(off).replace(/\s+/g, " ") + ")");
        await page.screenshot({ path: path.join(outDir, "gmail-7-imap-off.png") });
        await offFrame.locator(".enyo-button:visible", { hasText: /^OK$/ }).first().click();
        // A Google Workspace address: checked against Google's servers, the account keeps the address.
        const wsFrame = await signInGmail(WORKSPACE_USER, APP_PASSWORD);
        const confirmWs = page.locator("#mailApp_masterSettings_addAccountView_modifyAccountView_createAccountButton");
        check(await confirmWs.waitFor({ state: "visible", timeout: 30000 }).then(() => true, () => false), "a Google Workspace address (you@example.org) signs in against Google's servers");
        await confirmWs.click();
        const ws = await until(async () => (await gmailAccounts()).find((a) => a.username === WORKSPACE_USER), 20000);
        const wsMail = ws && await until(async () => ((await call("palm://com.palm.db/find", { query: { from: "com.palm.mail.account:1",
            where: [{ prop: "accountId", op: "=", val: ws._id }] } })).results || [])[0], 20000);
        check(wsMail && wsMail.server === "imap.gmail.com" && wsMail.username === WORKSPACE_USER && wsMail.smtpConfig.server === "smtp.gmail.com",
              `... a Gmail account named by it, on Google's servers (${wsMail && [wsMail.username, wsMail.server, wsMail.smtpConfig.server].join(", ")})`);
        void wsFrame;

        // The app password revoked at Google later (a new one made, or the Google password changed).
        const NEW_APP = "qrstuvwxyzabcdef";
        await setStandIns(NEW_APP);
        await call("palm://com.palm.imap/syncAccount", { accountId: gmailAccount._id });
        const flagged = await until(async () => { const m = (await call("palm://com.palm.db/get", { ids: [gmailMail._id] })).results[0]; return m.error && m.error.errorCode && m; }, 20000);
        const states = await call("palm://com.palm.tempdb/find", { query: { from: "com.palm.account.syncstate:1", where: [{ prop: "accountId", op: "=", val: gmailAccount._id }] } });
        check(flagged && flagged.error.errorCode === 1000 && /Invalid credentials/.test(flagged.error.errorText) &&
              (states.results || []).some((x) => x.syncState === "ERROR" && x.errorCode === "401_UNAUTHORIZED"),
              "the app password revoked at Google: the account is flagged (its error, Google's line; its sync state ERROR, 401)");
        const said = await until(() => page.evaluate((id) => {
            const mail = Object.values(enyo.$).find((c) => c.kindName === "Mail");
            const info = mail && mail.getErrorPopupInfoForAccount(id);
            return info && info.components.map((c) => c.content).join(" ");
        }, gmailAccount._id), 20000);
        check(!!said && /app password: it was revoked/.test(said) && /myaccount\.google\.com\/apppasswords/.test(said),
              "... and Email says what happened and what to do (" + said + ")");
        // A message sent now: refused by Google's SMTP server, kept in the Outbox.
        const refusedSend = await call("palm://com.palm.smtp/sendMail", { accountId: gmailAccount._id,
            email: { subject: "Refused", to: [{ addr: "alex.rivera@example.com", type: "to" }], parts: [{ type: "body", mimeType: "text/html", content: "<p>Hi</p>" }] } });
        const kept = refusedSend.returnValue && await get(refusedSend._id);
        const acctNow = (await call("palm://com.palm.db/get", { ids: [gmailMail._id] })).results[0];
        check(kept && kept.folderId === gmailMail.outboxFolderId && kept.sendStatus.error && kept.sendStatus.error.errorCode === 1000 &&
              /5\.7\.8/.test(kept.sendStatus.error.errorText) && acctNow.smtpConfig.error && acctNow.smtpConfig.error.errorCode === 1000,
              "a send refused by Google's SMTP server: the message stays in the Outbox with Google's line, the account's outgoing error set");
        // Edit Account: the new app password, as Google shows it (with spaces).
        await page.evaluate((id) => Object.values(enyo.$).find((c) => c.kindName === "MasterSettings").showEditMode(id), gmailAccount._id);
        const editPass = await until(async () => {
            const ids = await page.evaluate(() => Array.from(document.querySelectorAll("input[type=password]")).filter((e) => e.offsetParent).map((e) => e.id));
            return ids[0];
        }, 20000);
        check(!!editPass, "Edit Account opens with the password field (" + editPass + ")");
        if (editPass) {
            await page.locator("#" + editPass).fill("qrst uvwx yzab cdef");
            await page.evaluate(() => Object.values(enyo.$).find((c) => c.kindName === "SimpleConfig" && c.editMode).validateAccount());
        }
        const fixed = await until(async () => {
            const c = await call("luna://com.palm.service.accounts/readCredentials", { accountId: gmailAccount._id, name: "common" });
            return c.credentials && c.credentials.password === NEW_APP && c;
        }, 30000);
        check(!!fixed, "the new app password, typed with Google's spaces in Edit Account, is kept without them");
        await call("palm://com.palm.imap/syncAccount", { accountId: gmailAccount._id });
        const cleared = await until(async () => { const m = (await call("palm://com.palm.db/get", { ids: [gmailMail._id] })).results[0]; return !m.error && m; }, 20000);
        check(!!cleared, "... and the account's error clears at its next sync");
        // A message over Gmail's 25 MB: refused for good (Google's line), not sent again and again.
        await page.evaluate(() => window.__phoenixRuntime.fileManager.localFiles.write("/media/internal/Downloads/video.mov", new Uint8Array(20 * 1024 * 1024), false));
        await page.evaluate(() => window.__phoenixRuntime.fileManager.localFiles.write("/media/internal/Downloads/photo.jpg", new Uint8Array(2 * 1024 * 1024), false));
        const withParts = (subject, file) => call("palm://com.palm.smtp/sendMail", { accountId: gmailAccount._id, email: { subject, to: [{ addr: "alex.rivera@example.com", type: "to" }],
            parts: [{ type: "body", mimeType: "text/html", content: "<p>Here</p>" }, { type: "attachment", name: file.replace(/^.*\//, ""), path: file, mimeType: "application/octet-stream" }] } });
        const huge = await withParts("Too large", "/media/internal/Downloads/video.mov");
        const hugeMail = huge.returnValue && await get(huge._id);
        check(hugeMail && hugeMail.folderId === gmailMail.outboxFolderId && hugeMail.sendStatus.fatalError === true && hugeMail.sendStatus.error.errorCode === 6000 &&
              /552-5\.3\.4/.test(hugeMail.sendStatus.error.errorText),
              "a 20 MB attachment (27 MB sent, over Gmail's 25 MB): refused for good with Google's line, kept in the Outbox");
        const photo = await withParts("A photo", "/media/internal/Downloads/photo.jpg");
        check(photo.returnValue && (await get(photo._id)).folderId === gmailMail.sentFolderId, "a 2 MB attachment is sent");
        // Removed: its mail account, folders, mail and sync states go with it.
        const folderIds = ((await call("palm://com.palm.db/find", { query: { from: "com.palm.folder:1", where: [{ prop: "accountId", op: "=", val: gmailAccount._id }] } })).results || [])
            .map((f) => f._id);
        await call("luna://com.palm.service.accounts/deleteAccount", { accountId: gmailAccount._id });
        const removed = await until(async () => !(await gmailAccounts()).some((a) => a._id === gmailAccount._id), 20000);
        const leftMail = (await call("palm://com.palm.db/find", { query: { from: "com.palm.mail.account:1", where: [{ prop: "accountId", op: "=", val: gmailAccount._id }] } })).results || [];
        const leftFolders = (await call("palm://com.palm.db/get", { ids: folderIds })).results.filter(Boolean);
        const leftEmails = [];
        for (const id of [viaGmail._id, refusedSend._id, huge._id, photo._id]) { const e = await get(id); if (e && !e._del) leftEmails.push(id); }
        const leftStates = (await call("palm://com.palm.tempdb/find", { query: { from: "com.palm.account.syncstate:1", where: [{ prop: "accountId", op: "=", val: gmailAccount._id }] } })).results || [];
        check(removed && !leftMail.length && !leftFolders.length && !leftEmails.length && !leftStates.length,
              `the Gmail account removed: its mail account, ${folderIds.length} folders, its mail and its sync states are gone ` +
              `(left: ${leftMail.length} account, ${leftFolders.length} folders, ${leftEmails.length} emails, ${leftStates.length} states)`);
        check((await gmailAccounts()).some((a) => a.username === WORKSPACE_USER), "... and the other Gmail account stays");

        check(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join("; ") : ""));
        await browser.close();
    } finally {
        server.kill();
    }
    console.log(failures ? `\n${failures} check(s) failed` : "\nall passed");
    process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
