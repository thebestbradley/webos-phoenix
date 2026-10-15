#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Checks that CI runs every web app test in tools/web-tests.txt, once:
//
//   - the list itself: each line "SECONDS COMMAND", its test file there,
//     no command twice (read here on its own, not with the runner's code);
//   - .github/workflows/ci.yml's "web" job: a shard for each of 1..N, and
//     the runner called with --shard I/N of that N;
//   - tools/run-web-tests.cjs, asked to run each shard (its --dry-run, which
//     goes through the loop a real run does and prints each command instead
//     of starting it): for CI's N and for every N from 1 to 8, the shards
//     together run exactly the list, each command once, each shard in the
//     list's order; and with no shard it runs the whole list in order.
//
//   node tools/check-web-tests.cjs      (tools/ci-checks.sh runs it)

"use strict";
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const LIST = path.join(REPO, "tools", "web-tests.txt");
const WORKFLOW = path.join(REPO, ".github", "workflows", "ci.yml");
const RUNNER = path.join(REPO, "tools", "run-web-tests.cjs");

const problems = [];
const problem = (s) => problems.push(s);

// ---- The list, read on its own -------------------------------------------------------
const list = [];
fs.readFileSync(LIST, "utf8").split("\n").forEach((raw, i) => {
    const line = raw.replace(/#.*/, "").trim();
    if (!line) return;
    const m = /^(\d+)\s+(node\s+(tools\/test-[\w-]+\.cjs)(\s.*)?)$/.exec(line);
    if (!m) return problem(`tools/web-tests.txt:${i + 1}: not "SECONDS node tools/test-NAME.cjs [ARGS]": ${line}`);
    const command = m[2].replace(/\s+/g, " ");
    if (!fs.existsSync(path.join(REPO, m[3]))) problem(`tools/web-tests.txt:${i + 1}: ${m[3]} does not exist`);
    if (list.includes(command)) problem(`tools/web-tests.txt:${i + 1}: listed twice: ${command}`);
    list.push(command);
});
if (!list.length) problem("tools/web-tests.txt lists no tests");

// ---- CI's shards ---------------------------------------------------------------------
const workflow = fs.readFileSync(WORKFLOW, "utf8");
const job = /^  web:\n([\s\S]*?)(?=^  [\w-]+:\n|(?![\s\S]))/m.exec(workflow);
let ciN = 0;
if (!job) {
    problem(".github/workflows/ci.yml has no \"web\" job");
} else {
    const matrix = /^\s+shard:\s*\[([\d,\s]+)\]\s*$/m.exec(job[1]);
    const call = [...job[1].matchAll(/run-web-tests\.cjs --shard \$\{\{ matrix\.shard \}\}\/(\d+)/g)];
    // Every "${{ matrix.shard }}/N" in the job (its name too) names the same N.
    const ns = new Set([...job[1].matchAll(/\$\{\{ matrix\.shard \}\}\/(\d+)/g)].map((m) => m[1]));
    if (!matrix) problem("ci.yml's web job: no `shard: [1, 2, ...]` matrix");
    if (call.length !== 1) problem("ci.yml's web job: run tools/run-web-tests.cjs --shard ${{ matrix.shard }}/N once (found " + call.length + ")");
    if (ns.size > 1) problem("ci.yml's web job: ${{ matrix.shard }}/N with different Ns: " + [...ns].join(", "));
    if (matrix && call.length === 1) {
        ciN = Number(call[0][1]);
        const shards = matrix[1].split(",").map((s) => Number(s.trim()));
        const want = Array.from({ length: ciN }, (_, k) => k + 1);
        if (shards.join() !== want.join())
            problem(`ci.yml's web job: the matrix's shards are ${shards.join(", ")}; with --shard I/${ciN} they must be ${want.join(", ")}`);
    }
}

// ---- What the runner runs ------------------------------------------------------------
function runs(args) {
    const r = spawnSync(process.execPath, [RUNNER, "--dry-run", ...args], { cwd: REPO, encoding: "utf8" });
    if (r.status !== 0) {
        problem(`run-web-tests.cjs --dry-run ${args.join(" ")}: exit ${r.status}: ${(r.stderr || "").trim()}`);
        return [];
    }
    return r.stdout.split("\n").filter((l) => l.startsWith("would run: ")).map((l) => l.slice("would run: ".length));
}
const inOrder = (cmds) => cmds.every((c, k) => k === 0 || list.indexOf(cmds[k - 1]) < list.indexOf(c));

const all = runs([]);
if (all.join("\n") !== list.join("\n")) problem("run-web-tests.cjs with no shard does not run the list, in its order");

const counts = new Set([ciN, 1, 2, 3, 4, 5, 6, 7, 8].filter(Boolean));
for (const n of counts) {
    const seen = new Map();
    for (let i = 1; i <= n; i++) {
        const cmds = runs(["--shard", `${i}/${n}`]);
        if (!inOrder(cmds)) problem(`shard ${i}/${n} does not run its tests in the list's order`);
        for (const c of cmds) seen.set(c, (seen.get(c) || []).concat(i));
    }
    for (const c of list) if (!seen.has(c)) problem(`with ${n} shards, no shard runs: ${c}`);
    for (const [c, shards] of seen) {
        if (!list.includes(c)) problem(`with ${n} shards, shard ${shards.join(", ")} runs what the list does not have: ${c}`);
        else if (shards.length > 1) problem(`with ${n} shards, shards ${shards.join(", ")} each run: ${c}`);
    }
}

if (problems.length) {
    for (const p of problems) console.error("check-web-tests: " + p);
    process.exit(1);
}
console.log(`check-web-tests: ${list.length} web tests; CI's ${ciN} shards and 1 to 8 shards each run every one exactly once`);
