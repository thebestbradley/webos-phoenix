// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// vCard 3.0 / 4.0 (RFC 2426, RFC 6350; 2.1 is read too) <-> the legacy
// webOS contact, com.palm.contact:1 (schema:
// third_party/app-services/com.palm.service.contacts.linker/db/kinds/com.palm.contact).
// Type names follow the contacts framework's own vCard importer and
// exporter (third_party/loadable-frameworks/contacts/javascript/vCard/VCard.js,
// the PhoneNumber, EmailAddress, Address, Url and IMAddress TYPE constants
// in javascript/properties/), with two deliberate differences: a number
// typed CELL and WORK is a mobile (VCard.js checks WORK first), and vCard 4
// and IMPP are understood.
//
//   toContact(text)                 -> { uid, version, contact }
//   fromContact(contact, base, opt) -> vCard text
//
// fromContact() starts from the last vCard the server sent (base) and only
// replaces the properties this mapping understands, so fields the Contacts
// app has no place for (categories, custom labels, X- properties, ...) are
// not lost when a contact edited on the device is written back.

"use strict";

var CL = require("./contentline");

var PRODID = "-//webOS Phoenix//CardDAV sync//EN";

// Properties this mapping owns; everything else in a vCard is preserved.
var MAPPED = ["N", "FN", "NICKNAME", "TEL", "EMAIL", "ADR", "BDAY", "ANNIVERSARY", "X-ANNIVERSARY", "NOTE",
              "PHOTO", "ORG", "TITLE", "URL", "IMPP", "X-AIM", "X-GTALK", "X-GOOGLE-TALK", "X-JABBER", "X-MSN",
              "X-YAHOO", "X-SKYPE", "X-SKYPE-USERNAME", "X-ICQ", "X-QQ", "X-IM", "LABEL"];

var IM_PROPS = {
    "X-AIM": "type_aim", "X-GTALK": "type_gtalk", "X-GOOGLE-TALK": "type_gtalk", "X-JABBER": "type_jabber",
    "X-MSN": "type_msn", "X-YAHOO": "type_yahoo", "X-SKYPE": "type_skype", "X-SKYPE-USERNAME": "type_skype",
    "X-ICQ": "type_icq", "X-QQ": "type_qq", "X-IM": "type_default"
};
// IMPP URI schemes and Apple's X-SERVICE-TYPE names -> IMAddress.TYPE.
var IMPP_SCHEMES = { xmpp: "type_jabber", aim: "type_aim", skype: "type_skype", ymsgr: "type_yahoo",
                     msnim: "type_msn", icq: "type_icq", gtalk: "type_gtalk", qq: "type_qq", irc: "type_irc" };
var IM_SERVICE_NAMES = { jabber: "type_jabber", aim: "type_aim", skype: "type_skype", yahoo: "type_yahoo",
                         msn: "type_msn", icq: "type_icq", gtalk: "type_gtalk", googletalk: "type_gtalk",
                         qq: "type_qq", facebook: "type_facebook", gadugadu: "type_gadugadu" };
var IM_OUT = { type_jabber: ["xmpp", "Jabber"], type_aim: ["aim", "AIM"], type_skype: ["skype", "Skype"],
               type_yahoo: ["ymsgr", "Yahoo"], type_msn: ["msnim", "MSN"], type_icq: ["icq", "ICQ"],
               type_gtalk: ["xmpp", "GoogleTalk"], type_qq: ["x-apple", "QQ"], type_irc: ["irc", "IRC"],
               type_facebook: ["xmpp", "Facebook"], type_gadugadu: ["x-apple", "GaduGadu"] };

function types(p) {
    var out = [];
    (p.params.TYPE || []).forEach(function (t) {
        String(t).split(",").forEach(function (x) { if (x) out.push(x.trim().toUpperCase()); });
    });
    return out;
}

function isPref(p) {
    return types(p).indexOf("PREF") >= 0 || !!(p.params.PREF && +p.params.PREF[0] === 1);
}

function phoneType(t) {
    var has = function (x) { return t.indexOf(x) >= 0; };
    if (has("FAX")) return has("HOME") ? "type_personal_fax" : "type_work_fax";
    if (has("CELL") || has("MOBILE") || has("IPHONE")) return "type_mobile";
    if (has("PAGER")) return "type_pager";
    if (has("CAR")) return "type_car";
    if (has("MAIN")) return "type_main";
    if (has("WORK")) return "type_work";
    if (has("HOME")) return "type_home";
    return "type_other";
}

function homeWorkOther(t) {
    if (t.indexOf("WORK") >= 0) return "type_work";
    if (t.indexOf("HOME") >= 0) return "type_home";
    return "type_other";
}

// BDAY / ANNIVERSARY -> "yyyy-mm-dd", "0000" for an unknown year.
function parseDateValue(p) {
    if (!p) return "";
    var v = CL.textOf(p).trim(), m;
    var omit = p.params["X-APPLE-OMIT-YEAR"] && p.params["X-APPLE-OMIT-YEAR"][0];
    if ((m = /^--(\d{2})-?(\d{2})/.exec(v))) return "0000-" + m[1] + "-" + m[2];
    if ((m = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(v))) return (omit && m[1] === omit ? "0000" : m[1]) + "-" + m[2] + "-" + m[3];
    return "";
}

function dataUrlFromPhoto(p) {
    var v = p.value.trim();
    if (/^data:/i.test(v) || /^(https?|file):/i.test(v)) return v;
    var enc = ((p.params.ENCODING || [])[0] || "").toUpperCase();
    if (enc === "B" || enc === "BASE64") {
        var t = (types(p)[0] || "JPEG").toLowerCase();
        var mime = t.indexOf("/") >= 0 ? t : "image/" + (t === "jpg" ? "jpeg" : t);
        return "data:" + mime + ";base64," + v.replace(/\s+/g, "");
    }
    return /^(https?|file):/i.test(v) ? v : "";
}

function toContact(text) {
    var card = CL.parse(text).filter(function (c) { return c.name === "VCARD"; })[0];
    if (!card) throw new Error("no VCARD in resource");
    var get = function (n) { return CL.first(card, n); };
    var all = function (n) { return CL.find(card, n); };
    var version = get("VERSION") ? get("VERSION").value.trim() : "3.0";

    var contact = {
        name: { familyName: "", givenName: "", middleName: "", honorificPrefix: "", honorificSuffix: "" },
        nickname: "", birthday: "", anniversary: "", note: "",
        phoneNumbers: [], emails: [], addresses: [], organizations: [], urls: [], ims: [], photos: []
    };

    var n = get("N");
    if (n) {
        var parts = CL.splitValue(CL.textOf(n), ";");
        contact.name = {
            familyName: parts[0] || "", givenName: parts[1] || "", middleName: parts[2] || "",
            honorificPrefix: parts[3] || "", honorificSuffix: parts[4] || ""
        };
    }
    var fn = get("FN") ? CL.unescapeText(CL.textOf(get("FN"))).trim() : "";
    var org = get("ORG");
    // No structured name: a vCard for a company has only ORG; otherwise the
    // formatted name becomes the given name.
    if (!n || !(contact.name.familyName || contact.name.givenName || contact.name.middleName)) {
        var orgName = org ? CL.splitValue(CL.textOf(org), ";")[0] : "";
        if (fn && fn !== orgName) contact.name.givenName = fn;
    }
    if (get("NICKNAME")) contact.nickname = CL.splitValue(CL.textOf(get("NICKNAME")), ",")[0] || "";
    if (get("NOTE")) contact.note = CL.unescapeText(CL.textOf(get("NOTE")));
    contact.birthday = parseDateValue(get("BDAY"));
    contact.anniversary = parseDateValue(get("ANNIVERSARY") || get("X-ANNIVERSARY"));

    all("TEL").forEach(function (p) {
        var v = CL.unescapeText(CL.textOf(p)).replace(/^tel:/i, "").trim();
        if (v) contact.phoneNumbers.push({ value: v, type: phoneType(types(p)), primary: isPref(p) });
    });
    all("EMAIL").forEach(function (p) {
        var v = CL.unescapeText(CL.textOf(p)).replace(/^mailto:/i, "").trim();
        if (v) contact.emails.push({ value: v, type: homeWorkOther(types(p)), primary: isPref(p) });
    });
    all("ADR").forEach(function (p) {
        var a = CL.splitValue(CL.textOf(p), ";");
        var street = [a[0], a[1], a[2]].filter(function (s) { return s && s.trim(); }).join("\n");
        var addr = { streetAddress: street, locality: a[3] || "", region: a[4] || "", postalCode: a[5] || "",
                     country: a[6] || "", type: homeWorkOther(types(p)), primary: isPref(p) };
        if (street || addr.locality || addr.region || addr.postalCode || addr.country) contact.addresses.push(addr);
    });
    if (org || get("TITLE")) {
        var o = org ? CL.splitValue(CL.textOf(org), ";") : [];
        contact.organizations.push({
            name: o[0] || "", department: o.slice(1).filter(Boolean).join(", "),
            title: get("TITLE") ? CL.unescapeText(CL.textOf(get("TITLE"))) : "", type: "type_work"
        });
    }
    all("URL").forEach(function (p) {
        var v = CL.unescapeText(CL.textOf(p)).trim();
        if (v) contact.urls.push({ value: v, type: homeWorkOther(types(p)), primary: isPref(p) });
    });
    all("IMPP").forEach(function (p) {
        var v = CL.textOf(p).trim(), m = /^([a-z][a-z0-9+.\-]*):(.*)$/i.exec(v);
        var service = ((p.params["X-SERVICE-TYPE"] || [])[0] || "").toLowerCase().replace(/\s+/g, "");
        var type = IM_SERVICE_NAMES[service] || (m && IMPP_SCHEMES[m[1].toLowerCase()]) || "type_default";
        var addr = m ? decodeURIComponent(m[2]) : v;
        if (addr) contact.ims.push({ value: addr, type: type, label: homeWorkOther(types(p)), primary: isPref(p) });
    });
    Object.keys(IM_PROPS).forEach(function (name) {
        all(name).forEach(function (p) {
            var v = CL.unescapeText(CL.textOf(p)).trim();
            var dup = contact.ims.some(function (im) { return im.value === v && im.type === IM_PROPS[name]; });
            if (v && !dup) contact.ims.push({ value: v, type: IM_PROPS[name], label: homeWorkOther(types(p)), primary: false });
        });
    });
    var photo = get("PHOTO");
    if (photo) {
        var url = dataUrlFromPhoto(photo);
        if (url) contact.photos.push({ value: url, type: "type_big", primary: true });
    }
    var uid = get("UID") ? CL.textOf(get("UID")).trim().replace(/^urn:uuid:/i, "") : "";
    return { uid: uid, version: version, contact: contact };
}

// ---- Writing ----------------------------------------------------------------------

function typeParam(v4, list) {
    return v4 ? list.map(function (t) { return t.toLowerCase(); }) : list;
}

function phoneOut(type) {
    switch (type) {
    case "type_mobile": return ["CELL"];
    case "type_home": case "type_home2": return ["HOME"];
    case "type_work": case "type_work2": case "type_company": return ["WORK"];
    case "type_main": return ["MAIN"];
    case "type_personal_fax": return ["HOME", "FAX"];
    case "type_work_fax": return ["WORK", "FAX"];
    case "type_pager": return ["PAGER"];
    case "type_car": return ["CAR"];
    default: return ["VOICE"];
    }
}

function hwOut(type) {
    return type === "type_home" || type === "type_homepage" ? ["HOME"] : type === "type_work" ? ["WORK"] : [];
}

function formattedName(c) {
    var n = c.name || {};
    var fn = [n.honorificPrefix, n.givenName, n.middleName, n.familyName, n.honorificSuffix]
        .filter(function (s) { return s && String(s).trim(); }).join(" ");
    if (fn) return fn;
    var org = (c.organizations || [])[0];
    if (org && org.name) return org.name;
    if (c.nickname) return c.nickname;
    var e = (c.emails || [])[0] || (c.phoneNumbers || [])[0];
    return e ? e.value : "";
}

function newUid() {
    var hex = "";
    for (var i = 0; i < 32; i++) hex += Math.floor(Math.random() * 16).toString(16);
    return hex.slice(0, 8) + "-" + hex.slice(8, 12) + "-4" + hex.slice(13, 16) + "-a" + hex.slice(17, 20) + "-" + hex.slice(20, 32);
}

function photoProps(v4, photo) {
    var v = photo.value || "";
    var m = /^data:([^;,]+)(?:;[^,]*)?;base64,(.*)$/i.exec(v);
    if (m) {
        if (v4) return [CL.prop("PHOTO", v)];
        var t = m[1].split("/")[1] || "jpeg";
        return [CL.prop("PHOTO", m[2], { ENCODING: ["b"], TYPE: [t.toUpperCase()] })];
    }
    if (/^(https?):/i.test(v)) return [CL.prop("PHOTO", v, v4 ? {} : { VALUE: ["uri"] })];
    return [];
}

function dateOut(v4, value, name) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");
    if (!m) return null;
    if (m[1] === "0000") {
        return v4 ? CL.prop(name, "--" + m[2] + m[3])
                  : CL.prop(name, "1604-" + m[2] + "-" + m[3], { "X-APPLE-OMIT-YEAR": ["1604"] });
    }
    return CL.prop(name, v4 ? m[1] + m[2] + m[3] : value);
}

// options.uid: UID for a new card; options.version: "3.0" (default) or "4.0".
function fromContact(contact, base, options) {
    options = options || {};
    var card;
    if (base) card = CL.parse(base).filter(function (c) { return c.name === "VCARD"; })[0];
    if (!card) {
        card = { name: "VCARD", components: [], props: [
            CL.prop("VERSION", options.version || "3.0"),
            CL.prop("PRODID", PRODID),
            CL.prop("UID", options.uid || newUid())
        ] };
    }
    var v4 = (CL.first(card, "VERSION") || { value: "3.0" }).value.trim() === "4.0";

    // Drop the mapped properties, and Apple's labels grouped with them.
    var groups = {};
    card.props.forEach(function (p) { if (MAPPED.indexOf(p.name) >= 0 && p.group) groups[p.group] = true; });
    card.props = card.props.filter(function (p) {
        if (MAPPED.indexOf(p.name) >= 0) return false;
        return !(p.group && groups[p.group] && /^X-AB/.test(p.name));
    });

    var add = function (p) { if (p) card.props.push(p); };
    var esc = CL.escapeText;
    var c = contact || {};
    var n = c.name || {};
    add(CL.prop("N", [n.familyName, n.givenName, n.middleName, n.honorificPrefix, n.honorificSuffix].map(esc).join(";")));
    add(CL.prop("FN", esc(formattedName(c))));
    if (c.nickname) add(CL.prop("NICKNAME", esc(c.nickname)));
    var pref = function (params, e) {
        if (e.primary) { if (v4) params.PREF = ["1"]; else params.TYPE = (params.TYPE || []).concat(["PREF"]); }
        return params;
    };
    (c.phoneNumbers || []).forEach(function (e) {
        if (e.value) add(CL.prop("TEL", esc(e.value), pref({ TYPE: typeParam(v4, phoneOut(e.type)) }, e)));
    });
    (c.emails || []).forEach(function (e) {
        var t = hwOut(e.type);
        if (e.value) add(CL.prop("EMAIL", esc(e.value), pref({ TYPE: typeParam(v4, v4 ? t : ["INTERNET"].concat(t)) }, e)));
    });
    (c.addresses || []).forEach(function (a) {
        var t = hwOut(a.type);
        add(CL.prop("ADR", ["", "", a.streetAddress, a.locality, a.region, a.postalCode, a.country].map(esc).join(";"),
                    pref(t.length ? { TYPE: typeParam(v4, t) } : {}, a)));
    });
    var org = (c.organizations || [])[0];
    if (org && (org.name || org.department)) add(CL.prop("ORG", [esc(org.name || "")].concat(org.department ? [esc(org.department)] : []).join(";")));
    if (org && org.title) add(CL.prop("TITLE", esc(org.title)));
    (c.urls || []).forEach(function (u) {
        var t = hwOut(u.type);
        if (u.value) add(CL.prop("URL", u.value, t.length ? { TYPE: typeParam(v4, t) } : {}));
    });
    (c.ims || []).forEach(function (im) {
        if (!im.value) return;
        var out = IM_OUT[im.type] || ["x-apple", ""];
        var params = out[1] ? { "X-SERVICE-TYPE": [out[1]] } : {};
        add(CL.prop("IMPP", out[0] + ":" + encodeURI(im.value), params));
    });
    add(dateOut(v4, c.birthday, "BDAY"));
    add(dateOut(v4, c.anniversary, v4 ? "ANNIVERSARY" : "X-ANNIVERSARY"));
    if (c.note) add(CL.prop("NOTE", esc(c.note)));
    var photo = (c.photos || []).filter(function (p) { return p.type === "type_big"; })[0] || (c.photos || [])[0];
    if (photo) photoProps(v4, photo).forEach(add);
    if (!CL.first(card, "UID")) add(CL.prop("UID", options.uid || newUid()));
    return CL.serialize(card);
}

function uidOf(text) {
    var card = CL.parse(text).filter(function (c) { return c.name === "VCARD"; })[0];
    var p = card && CL.first(card, "UID");
    return p ? CL.textOf(p).trim().replace(/^urn:uuid:/i, "") : "";
}

module.exports = { toContact: toContact, fromContact: fromContact, formattedName: formattedName, newUid: newUid, uidOf: uidOf };
