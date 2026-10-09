// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Language model providers, one adapter per API shape (docs/AI-AND-MCP.md
// Part 3 "Providers"). No SDKs: one HTTP request each, through the
// service's request() (on a device Node's https; in the simulator the
// host's proxy, as browsers refuse cross-origin calls to these APIs).
//
//   anthropic   Messages API: POST {base}/v1/messages, x-api-key,
//               anthropic-version: 2023-06-01; tools as {name, description,
//               input_schema}; the answer's content blocks (text, tool_use)
//   openai      Responses API: POST {base}/v1/responses, Bearer key;
//               instructions + input; tools {type: "function", name,
//               description, parameters}; output items (message,
//               function_call)
//   gemini      generateContent: POST {base}/v1beta/models/{model}:generateContent,
//               x-goog-api-key; systemInstruction, contents (user/model),
//               tools [{functionDeclarations}]; candidates[0].content.parts
//               (text, functionCall)
//   compatible  Chat Completions: POST {base}/chat/completions, Bearer key if
//               any; what Ollama, LM Studio, OpenRouter, vLLM and llama.cpp's
//               llama-server share; choices[0].message (content, tool_calls)
//   local       the on-device model: llama-server's Chat Completions on
//               127.0.0.1 (lib/models.js), like "compatible" without a key
//
//   chatRequest(provider, {system, messages: [{role: "user"|"assistant", text}], tools}, key)
//       -> {method, url, headers, body}
//   parseChat(type, status, body) -> {text, toolCalls: [{name, args}]} or throws (message: why)
//   modelsRequest(provider, key) / parseModels(type, body) -> [model ids]
//
// Model ids are only defaults: every provider's model is the user's to
// type or pick from its list (Settings > Assistant).

"use strict";

var TYPES = {
    anthropic: { label: "Anthropic", base: "https://api.anthropic.com", needsKey: true,
                 model: "claude-sonnet-5-5", models: ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-4-5-20251001"] },
    openai: { label: "OpenAI", base: "https://api.openai.com", needsKey: true,
              model: "gpt-5-mini", models: ["gpt-5-mini", "gpt-5", "gpt-5-nano"] },
    gemini: { label: "Google Gemini", base: "https://generativelanguage.googleapis.com", needsKey: true,
              model: "gemini-2.5-flash", models: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.5-flash-lite"] },
    compatible: { label: "OpenAI-compatible", base: "http://localhost:11434/v1", needsKey: false,
                  model: "", models: [] },
    local: { label: "On device", base: "", needsKey: false, model: "", models: [] }
};

function trimSlash(s) { return String(s || "").replace(/\/+$/, ""); }
function baseOf(p) { return trimSlash(p.baseUrl || (TYPES[p.type] || {}).base); }

// Turns alternate user/assistant and start with the user (Anthropic and
// Gemini insist); neighbours with the same role are joined. keepSystem
// (the on-device model: assistant.js localPrefix): system messages among
// them stay as they are, where they are.
function alternate(messages, keepSystem) {
    var out = [];
    (messages || []).forEach(function (m) {
        var role = m.role === "assistant" ? "assistant" : keepSystem && m.role === "system" ? "system" : "user";
        var text = String(m.text || "").trim();
        if (!text) return;
        if (role !== "system" && out.length && out[out.length - 1].role === role) out[out.length - 1].text += "\n\n" + text;
        else out.push({ role: role, text: text });
    });
    var first = out.filter(function (m) { return m.role !== "system"; })[0];
    while (first && first.role !== "user") { out.splice(out.indexOf(first), 1); first = out.filter(function (m) { return m.role !== "system"; })[0]; }
    return out;
}

// JSON Schema as Gemini's function declarations take it (an OpenAPI subset:
// no empty enum values).
function geminiSchema(s) {
    if (!s || typeof s !== "object") return s;
    var o = {};
    Object.keys(s).forEach(function (k) {
        if (k === "enum") { var e = s.enum.filter(function (v) { return v !== ""; }); if (e.length) o.enum = e; }
        else if (k === "properties") {
            o.properties = {};
            Object.keys(s.properties).forEach(function (p) { o.properties[p] = geminiSchema(s.properties[p]); });
        } else if (k !== "minimum" && k !== "additionalProperties") o[k] = s[k];
    });
    return o;
}

function chatRequest(p, req, key) {
    var msgs = alternate(req.messages, p.type === "local"), tools = req.tools || [], system = req.system || "";
    var headers = { "Content-Type": "application/json" };
    var body, url;
    switch (p.type) {
    case "anthropic":
        url = baseOf(p) + "/v1/messages";
        headers["x-api-key"] = key || "";
        headers["anthropic-version"] = "2023-06-01";
        body = { model: p.model || TYPES.anthropic.model, max_tokens: 1024, system: system,
                 messages: msgs.map(function (m) { return { role: m.role, content: m.text }; }) };
        if (tools.length) body.tools = tools.map(function (t) { return { name: t.name, description: t.description, input_schema: t.parameters }; });
        break;
    case "openai":
        url = baseOf(p) + "/v1/responses";
        headers.Authorization = "Bearer " + (key || "");
        body = { model: p.model || TYPES.openai.model, instructions: system,
                 input: msgs.map(function (m) { return { role: m.role, content: m.text }; }) };
        if (tools.length) body.tools = tools.map(function (t) { return { type: "function", name: t.name, description: t.description, parameters: t.parameters }; });
        break;
    case "gemini":
        url = baseOf(p) + "/v1beta/models/" + encodeURIComponent(p.model || TYPES.gemini.model) + ":generateContent";
        headers["x-goog-api-key"] = key || "";
        body = { contents: msgs.map(function (m) { return { role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.text }] }; }) };
        if (system) body.systemInstruction = { parts: [{ text: system }] };
        if (tools.length) body.tools = [{ functionDeclarations: tools.map(function (t) { return { name: t.name, description: t.description, parameters: geminiSchema(t.parameters) }; }) }];
        break;
    case "compatible":
    case "local":
        url = baseOf(p) + "/chat/completions";
        if (key) headers.Authorization = "Bearer " + key;
        body = { model: p.model || "default",
                 messages: [{ role: "system", content: system }].concat(msgs.map(function (m) { return { role: m.role, content: m.text }; })) };
        if (tools.length) body.tools = tools.map(function (t) { return { type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }; });
        // Qwen3's template thinks aloud unless told not to (llama-server passes this to it).
        // The prompt kept in its one slot (-np 1): what a request shares with
        // the one before is not read again (assistant.js localPrefix). No
        // id_slot: with it, requests from two clients at once came back
        // with each other's words in them (seen with this llama.cpp while
        // measuring; the one slot is fixed anyway).
        if (p.type === "local") { body.chat_template_kwargs = { enable_thinking: false }; body.max_tokens = req.maxTokens || 512; body.cache_prompt = true; }
        // The on-device model's two steps (assistant.js askLocal): a tool
        // call it must make ("required": llama-server constrains the output
        // to a call), and an answer in a JSON schema (its grammar).
        if (req.toolChoice) body.tool_choice = req.toolChoice;
        if (req.schema) body.response_format = { type: "json_schema", json_schema: { name: "answer", schema: req.schema } };
        if (req.temperature !== undefined) body.temperature = req.temperature;
        break;
    default:
        throw new Error("unknown provider type: " + p.type);
    }
    return { method: "POST", url: url, headers: headers, body: JSON.stringify(body) };
}

function parseArgs(a) {
    if (a && typeof a === "object") return a;
    try { var o = JSON.parse(String(a || "{}")); return o && typeof o === "object" ? o : {}; } catch (e) { return {}; }
}
function stripThinking(text) {
    return String(text || "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}
function errorOf(status, body) {
    var why = "HTTP " + status;
    try {
        var j = JSON.parse(body), e = j && (j.error || j);
        var msg = e && (e.message || (typeof e === "string" ? e : "")) || j.detail || "";
        if (msg) why += ": " + msg;
    } catch (x) { if (body && body.length < 200) why += ": " + body; }
    if (status === 401 || status === 403) why += " (check the key)";
    return new Error(why);
}

function parseChat(type, status, body) {
    if (status < 200 || status >= 300) throw errorOf(status, body);
    var j;
    try { j = JSON.parse(body); } catch (e) { throw new Error("not JSON: " + String(body).slice(0, 80)); }
    var text = "", calls = [];
    switch (type) {
    case "anthropic":
        if (j.stop_reason === "refusal") throw new Error("the model declined to answer");
        (j.content || []).forEach(function (b) {
            if (b.type === "text") text += b.text;
            else if (b.type === "tool_use") calls.push({ name: b.name, args: parseArgs(b.input) });
        });
        break;
    case "openai":
        if (typeof j.output_text === "string") text = j.output_text;
        (j.output || []).forEach(function (o) {
            if (o.type === "message" && !j.output_text)
                (o.content || []).forEach(function (c) { if (c.type === "output_text") text += c.text; });
            else if (o.type === "function_call") calls.push({ name: o.name, args: parseArgs(o.arguments) });
        });
        break;
    case "gemini": {
        var cand = (j.candidates || [])[0];
        if (!cand) throw new Error((j.promptFeedback && j.promptFeedback.blockReason) ? "blocked: " + j.promptFeedback.blockReason : "no answer");
        ((cand.content && cand.content.parts) || []).forEach(function (part) {
            if (typeof part.text === "string" && !part.thought) text += part.text;
            else if (part.functionCall) calls.push({ name: part.functionCall.name, args: parseArgs(part.functionCall.args) });
        });
        break;
    }
    default: {
        var msg = j.choices && j.choices[0] && j.choices[0].message;
        if (!msg) throw new Error("no answer");
        text = typeof msg.content === "string" ? msg.content : "";
        (msg.tool_calls || []).forEach(function (c) {
            if (c.function) calls.push({ name: c.function.name, args: parseArgs(c.function.arguments) });
        });
    }
    }
    return { text: stripThinking(text), toolCalls: calls };
}

function modelsRequest(p, key) {
    var headers = { Accept: "application/json" };
    switch (p.type) {
    case "anthropic":
        headers["x-api-key"] = key || "";
        headers["anthropic-version"] = "2023-06-01";
        return { method: "GET", url: baseOf(p) + "/v1/models?limit=100", headers: headers };
    case "openai":
        headers.Authorization = "Bearer " + (key || "");
        return { method: "GET", url: baseOf(p) + "/v1/models", headers: headers };
    case "gemini":
        headers["x-goog-api-key"] = key || "";
        return { method: "GET", url: baseOf(p) + "/v1beta/models?pageSize=200", headers: headers };
    default:
        if (key) headers.Authorization = "Bearer " + key;
        return { method: "GET", url: baseOf(p) + "/models", headers: headers };
    }
}
function parseModels(type, status, body) {
    if (status < 200 || status >= 300) throw errorOf(status, body);
    var j = JSON.parse(body);
    if (type === "gemini")
        return (j.models || []).filter(function (m) { return (m.supportedGenerationMethods || ["generateContent"]).indexOf("generateContent") >= 0; })
            .map(function (m) { return String(m.name).replace(/^models\//, ""); });
    return (j.data || j.models || []).map(function (m) { return m.id || m.name; }).filter(Boolean);
}

// What a provider is called in the conversation: "Anthropic (claude-sonnet-5-5)".
function displayName(p) {
    var t = TYPES[p.type] || { label: p.type };
    var name = p.name || t.label;
    return p.model ? name + " (" + p.model + ")" : name;
}

module.exports = { TYPES: TYPES, chatRequest: chatRequest, parseChat: parseChat, modelsRequest: modelsRequest,
                   parseModels: parseModels, displayName: displayName, alternate: alternate };
