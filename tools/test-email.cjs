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
//      what apps may read is refused.
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
        check(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join("; ") : ""));
        await browser.close();
    } finally {
        server.kill();
    }
    console.log(failures ? `\n${failures} check(s) failed` : "\nall passed");
    process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
