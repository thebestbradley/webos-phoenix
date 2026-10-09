// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// A stand-in for the model providers, one local HTTP server speaking each
// API shape the assistant uses (lib/providers.js): Anthropic's Messages,
// OpenAI's Responses, Gemini's generateContent and Chat Completions (what
// OpenAI-compatible servers and llama.cpp's llama-server speak). For the
// unit tests and tools/test-assistant.cjs; no real keys, no network.
//
// What it answers, from the last user message:
//   - with tools offered and "flashlight" in it: a call of the toggle tool
//     (flashlight on); "text <name> <words>": a call of the text tool
//   - "force a tool": a toggle call even when no tools were offered (a
//     provider misbehaving: the permission gate must refuse it)
//   - asked for a command's name in a JSON schema (the on-device model's
//     first step): {"command": "toggle" | "text" | "alarm" | "none"} by the
//     same words
//   - otherwise words: "<shape> says: <the message>"
// Keys: Anthropic "test-anthropic", OpenAI "test-openai", Gemini
// "test-gemini"; Chat Completions takes any key or none. Every request is
// kept in `requests` ({shape, path, headers, body}).
//
//   const mock = await start(); mock.url; mock.requests; await mock.close();
//   node mock-providers.cjs [port]   (runs until killed; prints its URL)
//
// It also stands in for llama.cpp's llama-server (the on-device model):
//   mock-providers.cjs -m <model.gguf> --port N [--host 127.0.0.1 ...]
// checks the model file exists, then serves /health and Chat Completions.

"use strict";

const http = require("http");

const KEYS = { anthropic: "test-anthropic", openai: "test-openai", gemini: "test-gemini" };

function lastUser(shape, body) {
    let list = [];
    if (shape === "anthropic") list = (body.messages || []).filter((m) => m.role === "user").map((m) => m.content);
    else if (shape === "openai") list = (body.input || []).filter((m) => m.role === "user").map((m) => m.content);
    else if (shape === "gemini") list = (body.contents || []).filter((m) => m.role === "user").map((m) => m.parts.map((p) => p.text).join(""));
    else list = (body.messages || []).filter((m) => m.role === "user").map((m) => m.content);
    const last = list[list.length - 1];
    return typeof last === "string" ? last : JSON.stringify(last || "");
}

function hasTools(shape, body) {
    if (shape === "gemini") return !!(body.tools && body.tools[0] && body.tools[0].functionDeclarations && body.tools[0].functionDeclarations.length);
    return Array.isArray(body.tools) && body.tools.length > 0;
}

// What to say: {text} or {tool: {name, args}}.
function decide(shape, body) {
    const said = lastUser(shape, body);
    // The on-device model's first step (assistant.js pickCommand): a
    // command's name, held to a JSON schema; the same rules as the calls.
    const schema = body.response_format && body.response_format.json_schema && body.response_format.json_schema.schema;
    if (schema && schema.properties && schema.properties.command) {
        const pick = /force a tool|flashlight|torch/i.test(said) ? "toggle" : /^text \w+ /i.test(said) ? "text" : /wake me/i.test(said) ? "alarm" : "none";
        return { text: JSON.stringify({ command: pick }) };
    }
    const tools = hasTools(shape, body);
    if (/force a tool/i.test(said)) return { tool: { name: "toggle", args: { setting: "flashlight", state: "on" } } };
    if (tools && /flashlight|torch/i.test(said)) return { tool: { name: "toggle", args: { setting: "flashlight", state: "on" } } };
    const t = /^text (\w+) (.+)$/i.exec(said);
    if (tools && t) return { tool: { name: "text", args: { who: t[1], message: t[2] } } };
    if (tools && /wake me/i.test(said)) return { tool: { name: "alarm", args: { time: "tomorrow at 6:30 am" } } };
    return { text: `${shape} says: ${said}` };
}

function reply(shape, model, d) {
    switch (shape) {
    case "anthropic":
        return { id: "msg_mock", type: "message", role: "assistant", model, stop_reason: d.tool ? "tool_use" : "end_turn",
                 content: d.tool ? [{ type: "text", text: "Sure." }, { type: "tool_use", id: "toolu_mock", name: d.tool.name, input: d.tool.args }]
                                 : [{ type: "text", text: d.text }],
                 usage: { input_tokens: 10, output_tokens: 5 } };
    case "openai":
        return { id: "resp_mock", object: "response", model,
                 output: d.tool ? [{ type: "function_call", call_id: "call_mock", name: d.tool.name, arguments: JSON.stringify(d.tool.args) }]
                                : [{ type: "message", role: "assistant", content: [{ type: "output_text", text: d.text }] }] };
    case "gemini":
        return { candidates: [{ content: { role: "model", parts: d.tool ? [{ functionCall: { name: d.tool.name, args: d.tool.args } }] : [{ text: d.text }] },
                                finishReason: "STOP" }] };
    default:
        return { id: "chatcmpl-mock", object: "chat.completion", model,
                 choices: [{ index: 0, finish_reason: d.tool ? "tool_calls" : "stop",
                             message: d.tool ? { role: "assistant", content: null, tool_calls: [{ id: "call_mock", type: "function",
                                 function: { name: d.tool.name, arguments: JSON.stringify(d.tool.args) } }] }
                                             : { role: "assistant", content: d.text } }] };
    }
}

function start(port = 0) {
    const requests = [];
    const server = http.createServer((req, res) => {
        const chunks = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", () => {
            const raw = Buffer.concat(chunks).toString("utf8");
            let body = {};
            try { body = raw ? JSON.parse(raw) : {}; } catch { body = {}; }
            const url = new URL(req.url, "http://mock");
            const send = (status, o) => {
                res.writeHead(status, { "Content-Type": "application/json" });
                res.end(JSON.stringify(o));
            };
            let shape = "";
            if (req.method === "POST" && url.pathname === "/v1/messages") shape = "anthropic";
            else if (req.method === "POST" && url.pathname === "/v1/responses") shape = "openai";
            else if (req.method === "POST" && /^\/v1beta\/models\/[^/]+:generateContent$/.test(url.pathname)) shape = "gemini";
            else if (req.method === "POST" && /\/chat\/completions$/.test(url.pathname)) shape = "chat";
            requests.push({ shape, method: req.method, path: url.pathname, headers: req.headers, body });
            if (req.method === "GET" && url.pathname === "/health") return send(200, { status: "ok" });
            if (req.method === "GET" && /\/models$/.test(url.pathname)) {
                if (url.pathname === "/v1beta/models") {
                    if (req.headers["x-goog-api-key"] !== KEYS.gemini) return send(400, { error: { message: "API key not valid" } });
                    return send(200, { models: [{ name: "models/gemini-mock", supportedGenerationMethods: ["generateContent"] }] });
                }
                if (url.pathname === "/v1/models" && req.headers["anthropic-version"]) {
                    if (req.headers["x-api-key"] !== KEYS.anthropic) return send(401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } });
                    return send(200, { data: [{ id: "claude-sonnet-5-5" }, { id: "claude-opus-5-5" }] });
                }
                return send(200, { object: "list", data: [{ id: "mock-model" }, { id: "mock-model-large" }] });
            }
            if (!shape) return send(404, { error: { message: "no such endpoint: " + req.method + " " + url.pathname } });
            if (shape === "anthropic") {
                if (req.headers["x-api-key"] !== KEYS.anthropic) return send(401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } });
                if (req.headers["anthropic-version"] !== "2023-06-01") return send(400, { type: "error", error: { message: "anthropic-version missing" } });
                if (!body.max_tokens || !Array.isArray(body.messages) || body.messages[0]?.role !== "user")
                    return send(400, { type: "error", error: { message: "bad request" } });
            }
            if (shape === "openai" && req.headers.authorization !== "Bearer " + KEYS.openai)
                return send(401, { error: { message: "Incorrect API key provided" } });
            if (shape === "gemini" && req.headers["x-goog-api-key"] !== KEYS.gemini)
                return send(400, { error: { code: 400, message: "API key not valid. Please pass a valid API key." } });
            const model = shape === "gemini" ? decodeURIComponent(url.pathname.split("/").pop().split(":")[0]) : body.model;
            send(200, reply(shape, model, decide(shape, body)));
        });
    });
    return new Promise((resolve) => {
        server.listen(port, "127.0.0.1", () => {
            const addr = server.address();
            resolve({ url: `http://127.0.0.1:${addr.port}`, port: addr.port, requests,
                      close: () => new Promise((r) => server.close(() => r())) });
        });
    });
}

module.exports = { start, KEYS };

if (require.main === module) {
    const argv = process.argv.slice(2);
    const opt = (names) => { const i = argv.findIndex((a) => names.includes(a)); return i >= 0 ? argv[i + 1] : undefined; };
    const model = opt(["-m", "--model"]);
    if (model !== undefined && !require("fs").existsSync(model)) {
        console.error("error: failed to load model '" + model + "'");
        process.exit(1);
    }
    const port = Number(opt(["--port"]) ?? (model === undefined ? argv[0] : 0)) || 0;
    start(port).then((m) => console.log((model ? "main: server is listening on " : "") + m.url));
}
