#!/usr/bin/env node
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Runs the web app tests listed in tools/web-tests.txt (headless Chromium
// through Playwright): all of them, CI's shard I of N, or the ones named,
// one after another, and says how long each took.
//
//   node tools/run-web-tests.cjs                  every test, in the list's order
//   node tools/run-web-tests.cjs --shard 2/4      the second of four shards (CI's "web" jobs)
//   node tools/run-web-tests.cjs settings media   the tests of those files (test-settings.cjs, ...)
//   node tools/run-web-tests.cjs --plan 4         which tests each of four shards runs; runs nothing
//   node tools/run-web-tests.cjs --dry-run ...    print each command it would run; runs nothing
//   --fail-fast   stop at the first failure (otherwise: run the rest, then name every failure)
//
// ./phoenix test --web [ARGS] is the same. Build the apps first (cd apps &&
// npm run build; the Enact and Flutter demos as their READMEs say) and
// install Playwright (./phoenix --tests). NODE_PATH, when it is not set, is
// npm's global modules (npm root -g), as the tests expect.
//
// The shards: each test has a weight, the seconds it took on CI; the
// heaviest test goes to the shard with the least weight so far, then the
// next heaviest (ties: the earlier test, the lower shard), so the shards
// come out about even and the same list always splits the same way.
// Within a shard the tests run in the list's order. tools/check-web-tests.cjs
// checks that the shards together run every test in the list once.
//
// Each test's output is passed through; then its result and time. At the
// end a summary: every test's time against its weight (copy a time into
// the list when its weight has drifted), and the failures. In GitHub
// Actions a failure is also an annotation (the command and the lines of
// its output that say what failed), and the summary goes to the job's
// summary page.

"use strict";
const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const LIST = path.join(REPO, "tools", "web-tests.txt");

function usage(message) {
    if (message) console.error("run-web-tests: " + message);
    const head = fs.readFileSync(__filename, "utf8").split("\n").slice(4, 15);
    console.error(head.map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
    process.exit(2);
}

// ---- The list ------------------------------------------------------------------------

// [{weight, command, argv, name, index}], in the file's order. A line is
// "WEIGHT COMMAND"; # starts a comment. A command is plain words, run
// without a shell: no quotes, variables or redirections.
function readList(file) {
    const tests = [];
    const seen = new Set();
    const errors = [];
    fs.readFileSync(file, "utf8").split("\n").forEach((raw, i) => {
        const line = raw.replace(/#.*/, "").trim();
        if (!line) return;
        const where = path.relative(REPO, file) + ":" + (i + 1);
        const m = /^(\d+)\s+(\S.*)$/.exec(line);
        if (!m || Number(m[1]) < 1) {
            errors.push(where + ": not \"SECONDS COMMAND\" (a whole number of seconds, at least 1): " + line);
            return;
        }
        const command = m[2].replace(/\s+/g, " ");
        if (/['"`$&|;<>(){}*?\\]/.test(command)) {
            errors.push(where + ": the command is run without a shell; plain words only: " + command);
            return;
        }
        const argv = command.split(" ");
        const script = argv.find((a) => /^tools\/test-[\w-]+\.cjs$/.test(a));
        if (argv[0] !== "node" || !script) {
            errors.push(where + ": not \"node tools/test-NAME.cjs [ARGS]\": " + command);
            return;
        }
        if (seen.has(command)) {
            errors.push(where + ": listed twice: " + command);
            return;
        }
        seen.add(command);
        tests.push({ weight: Number(m[1]), command, argv, name: script.slice("tools/test-".length, -".cjs".length), index: tests.length });
    });
    if (errors.length) {
        for (const e of errors) console.error("run-web-tests: " + e);
        process.exit(2);
    }
    return tests;
}

// The tests of each of n shards (see the top of this file).
function plan(tests, n) {
    const order = tests.slice().sort((a, b) => b.weight - a.weight || a.index - b.index);
    const shards = Array.from({ length: n }, () => ({ tests: [], weight: 0 }));
    for (const t of order) {
        let s = 0;
        for (let k = 1; k < n; k++) if (shards[k].weight < shards[s].weight) s = k;
        shards[s].tests.push(t);
        shards[s].weight += t.weight;
    }
    for (const s of shards) s.tests.sort((a, b) => a.index - b.index);
    return shards;
}

const minutes = (seconds) => {
    const s = Math.round(seconds);
    return (s >= 60 ? Math.floor(s / 60) + " min " : "") + (s % 60) + " s";
};

// ---- Arguments -----------------------------------------------------------------------

const args = process.argv.slice(2);
let shard = null;     // {i, n}
let planN = 0;
let dryRun = false;
let failFast = false;
const names = [];
for (let k = 0; k < args.length; k++) {
    const a = args[k];
    if (a === "-h" || a === "--help") usage();
    else if (a === "--dry-run") dryRun = true;
    else if (a === "--fail-fast") failFast = true;
    else if (a === "--shard" || a.startsWith("--shard=")) {
        const v = a === "--shard" ? args[++k] : a.slice("--shard=".length);
        const m = /^(\d+)\/(\d+)$/.exec(v || "");
        if (!m || Number(m[1]) < 1 || Number(m[1]) > Number(m[2])) usage("--shard takes I/N, 1 <= I <= N (--shard 2/4)");
        shard = { i: Number(m[1]), n: Number(m[2]) };
    } else if (a === "--plan") {
        planN = Number(args[++k]);
        if (!(planN >= 1)) usage("--plan takes the number of shards (--plan 4)");
    } else if (a.startsWith("-")) usage("unknown option " + a);
    else names.push(a.replace(/^(tools\/)?test-/, "").replace(/\.cjs$/, ""));
}
if (shard && names.length) usage("--shard or test names, not both");

const tests = readList(LIST);

if (planN) {
    plan(tests, planN).forEach((s, k) => {
        console.log(`shard ${k + 1}/${planN}: ${s.tests.length} tests, ${minutes(s.weight)} by their weights`);
        for (const t of s.tests) console.log(`  ${String(t.weight).padStart(4)}  ${t.command}`);
    });
    process.exit(0);
}

let selected = tests;
let label = "every web test";
if (shard) {
    selected = plan(tests, shard.n)[shard.i - 1].tests;
    label = `shard ${shard.i}/${shard.n}`;
} else if (names.length) {
    const unknown = names.filter((n) => !tests.some((t) => t.name === n));
    if (unknown.length) usage("not in tools/web-tests.txt: " + unknown.map((n) => "test-" + n + ".cjs").join(", "));
    selected = tests.filter((t) => names.includes(t.name));
    label = names.join(", ");
}

// ---- Running -------------------------------------------------------------------------

const GITHUB = process.env.GITHUB_ACTIONS === "true";
const env = { ...process.env };
if (!env.NODE_PATH && !dryRun) {
    const npm = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["root", "-g"], { encoding: "utf8" });
    if (npm.status === 0) env.NODE_PATH = npm.stdout.trim();
}

// Each test runs in a process group of its own: when it exits, whatever
// it started and left running (a server it did not stop) goes with it, and
// cannot hold a port or the output open for the tests after it.
let child = null;
const killGroup = (pid, signal) => {
    try { process.kill(-pid, signal); } catch (e) { /* the group is gone */ }
};
for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
        if (child) killGroup(child.pid, signal);
        process.exit(130);
    });
}

// Runs one test, its output passed through; resolves to {ok, seconds, lines}.
function run(test) {
    return new Promise((resolve) => {
        const start = process.hrtime.bigint();
        const lines = [];
        let partial = "";
        const keep = (chunk) => {
            process.stdout.write(chunk);
            const parts = (partial + chunk.toString()).split("\n");
            partial = parts.pop();
            for (const l of parts) lines.push(l);
            if (lines.length > 4000) lines.splice(0, lines.length - 4000);
        };
        child = spawn(test.argv[0], test.argv.slice(1), { cwd: REPO, env, stdio: ["ignore", "pipe", "pipe"], detached: true });
        const pid = child.pid;
        child.stdout.on("data", keep);
        child.stderr.on("data", keep);
        child.on("exit", () => { if (pid) killGroup(pid, "SIGKILL"); });
        const done = (ok, extra) => {
            child = null;
            if (partial) lines.push(partial);
            if (extra) { lines.push(extra); console.log(extra); }
            resolve({ ok, seconds: Number(process.hrtime.bigint() - start) / 1e9, lines });
        };
        child.on("error", (e) => done(false, "run-web-tests: " + e.message));
        child.on("close", (code, signal) => done(code === 0, code === 0 ? "" : `(exit ${signal || code})`));
    });
}

// What failed, as annotations: the command, then its lines starting FAIL,
// "not ok" or Error and its last four lines (nine at most).
function annotate(test, lines) {
    const esc = (s) => s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
    console.log(`::error title=Web test failed::${esc(test.command)}`);
    const said = lines.filter((l) => /^(FAIL|not ok|Error)/.test(l)).concat(lines.slice(-4)).slice(0, 9);
    for (const l of said) console.log(`::error title=Web test output::${esc(l)}`);
}

async function main() {
    const total = selected.reduce((s, t) => s + t.weight, 0);
    console.log(`run-web-tests: ${label}: ${selected.length} tests, about ${minutes(total)} by their weights`);
    if (!selected.length) return 0;
    const results = [];
    const started = Date.now();
    for (const [k, t] of selected.entries()) {
        if (dryRun) {
            console.log("would run: " + t.command);
            continue;
        }
        console.log(`\n=== [${k + 1}/${selected.length}] ${t.command}`);
        const r = await run(t);
        results.push({ test: t, ...r });
        console.log(`--- ${r.ok ? "ok    " : "FAILED"} ${r.seconds.toFixed(1)} s (weight ${t.weight})  ${t.command}`);
        if (!r.ok && GITHUB) annotate(t, r.lines);
        if (!r.ok && failFast) break;
    }
    if (dryRun) return 0;

    const failed = results.filter((r) => !r.ok);
    const notRun = selected.length - results.length;
    const elapsed = (Date.now() - started) / 1000;
    const out = [`\nrun-web-tests: ${label}: ${results.length - failed.length} passed, ${failed.length} failed` +
                 (notRun ? `, ${notRun} not run (--fail-fast)` : "") + ` in ${minutes(elapsed)} (weights: ${minutes(total)})`,
                 "   time  weight  result  command"];
    for (const r of results)
        out.push(`${r.seconds.toFixed(1).padStart(7)}  ${String(r.test.weight).padStart(6)}  ${r.ok ? "ok    " : "FAILED"}  ${r.test.command}`);
    if (failed.length) out.push("Failed:", ...failed.map((r) => "  " + r.test.command));
    console.log(out.join("\n"));

    if (GITHUB && process.env.GITHUB_STEP_SUMMARY) {
        const md = [`### Web tests: ${label}`, "",
                    `${results.length - failed.length} passed, ${failed.length} failed${notRun ? `, ${notRun} not run` : ""}, in ${minutes(elapsed)} (weights: ${minutes(total)}).`, "",
                    "| Time (s) | Weight (s) | Result | Command |", "| ---: | ---: | --- | --- |",
                    ...results.map((r) => `| ${r.seconds.toFixed(1)} | ${r.test.weight} | ${r.ok ? "ok" : "**FAILED**"} | \`${r.test.command}\` |`), ""];
        fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md.join("\n") + "\n");
    }
    return failed.length || notRun ? 1 : 0;
}

main().then((code) => process.exit(code), (e) => { console.error(e); process.exit(2); });
