// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// LinkedIn's data export's Connections.csv (Settings, Data privacy, Get a
// copy of your data: "Connections"), read into contacts: name, company and
// position, the profile's address, the email address when the person
// allowed it, and when you connected. The file starts with a few lines of
// notes before its header ("First Name,Last Name,URL,Email Address,Company,
// Position,Connected On"); the columns are found by name, so a column more
// or in another order still reads.

"use strict";

/** RFC 4180 CSV -> rows of fields (quotes, doubled quotes, CRLF, line breaks in quotes). */
function parseCsv(text) {
    var rows = [], row = [], field = "", q = false;
    var s = String(text || "").replace(/^﻿/, "");
    for (var i = 0; i < s.length; i++) {
        var c = s[i];
        if (q) {
            if (c === "\"") {
                if (s[i + 1] === "\"") { field += "\""; i++; } else q = false;
            } else field += c;
        } else if (c === "\"" && field === "") q = true;
        else if (c === ",") { row.push(field); field = ""; }
        else if (c === "\n" || c === "\r") {
            if (c === "\r" && s[i + 1] === "\n") i++;
            row.push(field); rows.push(row); row = []; field = "";
        } else field += c;
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    return rows;
}

var MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

/** "05 Oct 2024" (LinkedIn's) or "2024-10-05" -> "5 Oct 2024", or "". */
function connectedOn(v) {
    var s = String(v || "").trim();
    var m = /^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})$/.exec(s);
    if (m && MONTHS[m[2].toLowerCase()] !== undefined) return Number(m[1]) + " " + m[2].charAt(0).toUpperCase() + m[2].slice(1, 3).toLowerCase() + " " + m[3];
    m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (m) return Number(m[3]) + " " + ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m[2]) - 1] + " " + m[1];
    return s;
}

/**
 * Connections.csv's text -> [{remoteId, fields}] for the CONTACTS
 * capability; throws when there is no such header (not the right file).
 */
function readConnections(text) {
    var rows = parseCsv(text);
    var h = -1, cols = null;
    for (var i = 0; i < Math.min(rows.length, 20); i++) {
        var lower = rows[i].map(function (x) { return String(x).trim().toLowerCase(); });
        if (lower.indexOf("first name") >= 0 && lower.indexOf("last name") >= 0) { h = i; cols = lower; break; }
    }
    if (h < 0) throw Object.assign(new Error("This is not LinkedIn's Connections.csv (no First Name and Last Name columns)"), { errorCode: "400_BAD_REQUEST" });
    var col = function (r, name) { var k = cols.indexOf(name); return k >= 0 ? String(r[k] || "").trim() : ""; };
    var out = [], seen = {};
    rows.slice(h + 1).forEach(function (r) {
        var first = col(r, "first name"), last = col(r, "last name");
        if (!first && !last) return;
        var url = col(r, "url"), email = col(r, "email address"), company = col(r, "company"), position = col(r, "position");
        var id = url || (first + " " + last + "|" + company).toLowerCase();
        if (seen[id]) return;
        seen[id] = true;
        var on = connectedOn(col(r, "connected on"));
        out.push({
            remoteId: id,
            fields: {
                name: { givenName: first, familyName: last },
                organizations: company || position ? [{ name: company, title: position, type: "type_work" }] : [],
                urls: url ? [{ value: url, type: "type_profile" }] : [],
                emails: email ? [{ value: email, type: "type_work" }] : [],
                note: on ? "LinkedIn connection since " + on : ""
            }
        });
    });
    return out;
}

module.exports = { parseCsv: parseCsv, readConnections: readConnections, connectedOn: connectedOn };
