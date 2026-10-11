// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// A stand-in for LinkedIn's APIs the LinkedIn account uses
// (apps/connectors/linkedin), under /linkedin: OpenID Connect's
// GET /v2/userinfo, and POST /rest/posts (the Posts API: its
// LinkedIn-Version and X-Restli-Protocol-Version headers required, the
// author the signed-in member, 201 with the post's URN in x-restli-id);
// LinkedIn's OAuth on /oauth/linkedin/ (its token exchange wants the client
// secret). fake.linkedin: {me, posts, csv}

"use strict";

function addLinkedin(base) {
    const send = base.send;
    const li = base.linkedin = {
        me: { sub: "782bbtaQ", name: "Anna Lee", given_name: "Anna", family_name: "Lee", email: "anna@example.com", email_verified: true,
              picture: "https://media.licdn.example/anna.jpg", locale: { country: "US", language: "en" } },
        posts: [], secret: "linkedin-test-secret",
        // The export's own layout: notes, a blank line, then the header.
        csv: "Notes:\r\n\"When exporting your connection data, you may notice that some of the email addresses are missing. You will only see email addresses for connections who have allowed their connections to see or download their email address.\"\r\n\r\n" +
             "First Name,Last Name,URL,Email Address,Company,Position,Connected On\r\n" +
             "Sofia,Lindqvist,https://www.linkedin.com/in/sofia-lindqvist,sofia.lindqvist@example.edu,\"Uppsala University\",\"Researcher, HCI\",05 Oct 2024\r\n" +
             "Daniel,Okafor,https://www.linkedin.com/in/dokafor,,Northwind Labs,Engineering Manager,12 Mar 2021\r\n" +
             "Mei,Tanaka,https://www.linkedin.com/in/meitanaka,,,,01 Jan 2020\r\n"
    };
    base.oauthProvider("linkedin", { pkce: false, secret: li.secret, scope: "openid profile email w_member_social" });
    base.route("*", /^\/linkedin\//, (req, res) => (base.bearer(req, "linkedin") ? false
        : send(res, 401, { status: 401, serviceErrorCode: 65600, code: "INVALID_ACCESS_TOKEN", message: "Invalid access token" })));
    base.route("GET", /^\/linkedin\/v2\/userinfo$/, (req, res) => send(res, 200, li.me));
    base.route("POST", /^\/linkedin\/rest\/posts$/, (req, res, c) => {
        if (!/^\d{6}$/.test(req.headers["linkedin-version"] || "") || req.headers["x-restli-protocol-version"] !== "2.0.0")
            return send(res, 400, { status: 400, message: "LinkedIn-Version and X-Restli-Protocol-Version are required" });
        const b = c.json() || {};
        if (b.author !== "urn:li:person:" + li.me.sub) return send(res, 403, { status: 403, message: "Not enough permissions to post as " + b.author });
        if (b.lifecycleState !== "PUBLISHED" || !b.distribution) return send(res, 422, { status: 422, message: "bad post" });
        const id = "urn:li:share:" + (7100000000000000000 + li.posts.length);
        li.posts.push(Object.assign({ id }, b));
        return send(res, 201, "", { "x-restli-id": id });
    });
    li.clients = (withClient) => ({ linkedin: withClient === false ? { api: base.origin + "/linkedin" } : base.clientOf("linkedin", { api: base.origin + "/linkedin" }) });
    return li;
}

module.exports = { addLinkedin };
