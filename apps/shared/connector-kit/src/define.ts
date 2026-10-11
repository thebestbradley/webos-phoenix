// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// defineConnector(definition): checks a connector's definition and returns
// it, so that a mistake shows when the service loads, not on the first
// sync (docs/SYNERGY-SDK.md, "The definition").

import { shareProblems } from "./share";
import { signUpProblems } from "./signup";
import { FILES_METHODS } from "./files";
import type { ConnectorDefinition } from "./types";

const ID = /^[A-Za-z0-9]+([._-][A-Za-z0-9]+)+$/;
const KIND = /^[A-Za-z0-9]+([._-][A-Za-z0-9]+)+:\d+$/;

export function defineConnector<T extends ConnectorDefinition>(def: T): T {
    const problems: string[] = [];
    if (!def || typeof def !== "object") throw new Error("defineConnector: a definition object is required");
    if (!ID.test(def.service || "")) problems.push("service: a Luna service name (org.example.service.foo)");
    if (!Array.isArray(def.templateIds) || !def.templateIds.length || def.templateIds.some((t) => !ID.test(t)))
        problems.push("templateIds: the account templates' ids");
    if (!def.kinds || !KIND.test(def.kinds.state || "")) problems.push("kinds.state: a db8 kind of the connector's own (org.example.foo.state:1)");
    if (def.kinds && def.kinds.item !== undefined && !KIND.test(def.kinds.item)) problems.push("kinds.item: a db8 kind (org.example.foo.item:1)");
    if (typeof def.validate !== "function") problems.push("validate: the template's validator, a function");
    const caps = def.capabilities || {};
    if (!Object.keys(caps).length) problems.push("capabilities: at least one, by capability provider id");
    Object.keys(caps).forEach((id) => {
        const c = caps[id];
        if (!ID.test(id)) problems.push("capabilities." + id + ": the key is the template's capabilityProviders[].id");
        if (!c || !/^[A-Z][A-Z0-9_.]*$/.test(c.capability || "")) problems.push("capabilities." + id + ".capability: CONTACTS, CALENDAR, ...");
        if (!c) return;
        if (c.pull && !c.kind) problems.push("capabilities." + id + ": pull writes to a kind; give its kind");
        if (c.kind && !KIND.test(c.kind)) problems.push("capabilities." + id + ".kind: a db8 kind id");
        if (c.kind && c.pull && !(def.kinds && def.kinds.item)) problems.push("capabilities." + id + ": a kind needs kinds.item (item records)");
        if (c.push && !c.pull) problems.push("capabilities." + id + ": push needs pull (two-way sync)");
        if (!c.pull && !c.sync && !c.files) problems.push("capabilities." + id + ": pull (a set of objects), files (a drive) or sync (anything else)");
        if (c.files && typeof c.files !== "function") problems.push("capabilities." + id + ".files: a function (ctx) -> the account's drive provider");
        if (c.files && c.capability !== "DOCUMENTS") problems.push("capabilities." + id + ": a drive (files) is the DOCUMENTS capability");
        if (c.files && (c.pull || c.kind)) problems.push("capabilities." + id + ": a drive (files) has no kind or pull: its files stay on the server");
        if (c.chunkSize !== undefined && !(c.chunkSize >= 64 * 1024)) problems.push("capabilities." + id + ".chunkSize: 64 KB or more");
        if (c.watch && !(def.methods && def.methods[c.watch.method])) problems.push("capabilities." + id + ".watch.method: one of the definition's methods");
    });
    if (def.schedule && def.schedule.every !== undefined) {
        const m = /^(\d+)([smhd])$/.exec(def.schedule.every);
        const s = m ? Number(m[1]) * ({ s: 1, m: 60, h: 3600, d: 86400 } as Record<string, number>)[m[2]] : NaN;
        if (!(s >= 900)) problems.push("schedule.every: 15m or more (docs/SYNERGY-CONNECTORS.md 3.2 rule 6)");
    }
    Object.keys(def.methods || {}).forEach((name) => {
        if (["checkCredentials", "onCreate", "onEnabled", "onCredentialsChanged", "onDelete", "sync"].concat(FILES_METHODS).indexOf(name) >= 0)
            problems.push("methods." + name + ": the kit makes this one from the definition");
    });
    problems.push(...shareProblems(def));
    problems.push(...signUpProblems(def.signUp));
    Object.keys(def.signUpByTemplate || {}).forEach((id) => {
        if ((def.templateIds || []).indexOf(id) < 0) problems.push("signUpByTemplate." + id + ": not one of templateIds");
        problems.push(...signUpProblems((def.signUpByTemplate as Record<string, unknown>)[id]).map((p) => id + " " + p));
    });
    if (problems.length) throw new Error("defineConnector " + (def.service || "") + ":\n  " + problems.join("\n  "));
    return def;
}
