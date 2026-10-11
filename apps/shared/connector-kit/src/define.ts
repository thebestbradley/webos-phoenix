// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// defineConnector(definition): checks a connector's definition and returns
// it, so that a mistake shows when the service loads, not on the first
// sync (docs/SYNERGY-SDK.md, "The definition").

import { shareProblems } from "./share";
import { signUpProblems } from "./signup";
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
        if (!c.pull && !c.sync) problems.push("capabilities." + id + ": pull (a set of objects) or sync (anything else)");
        if (c.watch && !(def.methods && def.methods[c.watch.method])) problems.push("capabilities." + id + ".watch.method: one of the definition's methods");
    });
    if (def.schedule && def.schedule.every !== undefined) {
        const m = /^(\d+)([smhd])$/.exec(def.schedule.every);
        const s = m ? Number(m[1]) * ({ s: 1, m: 60, h: 3600, d: 86400 } as Record<string, number>)[m[2]] : NaN;
        if (!(s >= 900)) problems.push("schedule.every: 15m or more (docs/SYNERGY-CONNECTORS.md 3.2 rule 6)");
    }
    Object.keys(def.methods || {}).forEach((name) => {
        if (["checkCredentials", "onCreate", "onEnabled", "onCredentialsChanged", "onDelete", "sync"].indexOf(name) >= 0 ||
            (def.connection && ["connect", "disconnect"].indexOf(name) >= 0))
            problems.push("methods." + name + ": the kit makes this one from the definition");
    });
    if (def.connection !== undefined && (!def.connection || typeof def.connection.open !== "function"))
        problems.push("connection.open: a function (ctx) -> the open connection, with close()");
    (["settings", "helpers"] as const).forEach((k) => {
        const v = def[k];
        if (v !== undefined && (!Array.isArray(v) || v.some((x) => typeof x !== "string" || !/^[A-Za-z0-9._-]+$/.test(x))))
            problems.push(k + ": names (letters, digits, . _ -)");
    });
    problems.push(...shareProblems(def));
    problems.push(...signUpProblems(def.signUp));
    if (problems.length) throw new Error("defineConnector " + (def.service || "") + ":\n  " + problems.join("\n  "));
    return def;
}
