// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Tests of the Terminal's PTY core (UTF-8 chunks, JSON, sessions, flow
// control) and of the org.webosphoenix.pty service's methods over the
// luna-service2 stand-in (services/common/ls2stub): who may open a shell, a session's
// life from open to exited, and hanging up when the page cancels.
//
// Shells here are /bin/sh with fixed commands, so the output is the same on
// every machine.

#include <csignal>
#include <cstdio>
#include <string>
#include <vector>

#include <glib.h>

#include "ptycore.h"
#include "service.h"

using namespace phoenix::pty;

static int failures = 0;
static int checks = 0;

#define CHECK(cond, what)                                                            \
    do {                                                                             \
        ++checks;                                                                    \
        if (cond) {                                                                  \
            std::printf("ok   %s\n", what);                                          \
        } else {                                                                     \
            std::printf("FAIL %s (%s:%d)\n", what, __FILE__, __LINE__);              \
            ++failures;                                                              \
        }                                                                            \
    } while (0)

// All output of a session until the shell is gone (or ms pass).
static std::string drain(Session &s, int ms = 5000, bool ackAll = true, bool *sawLatin1 = nullptr)
{
    std::string out;
    const gint64 until = g_get_monotonic_time() + ms * 1000;
    while (g_get_monotonic_time() < until) {
        if (s.wantsRead())
            s.readAvailable();
        Chunk c = s.takeChunk();
        if (c.bytes) {
            out += c.text;
            if (c.latin1 && sawLatin1)
                *sawLatin1 = true;
            if (ackAll)
                s.ack(c.bytes);
            continue;
        }
        if (s.eof() && !s.hasOutput())
            break;
        g_usleep(2000);
    }
    return out;
}

static void testUtf8()
{
    bool valid = false;
    const std::string cafe = "caf\xC3\xA9";
    CHECK(utf8Boundary(cafe.data(), cafe.size(), &valid) == 5 && valid, "utf8: a whole string is sent whole");
    CHECK(utf8Boundary(cafe.data(), 4, &valid) == 3 && valid, "utf8: the start of a 2-byte sequence is held back");
    const std::string euro = "\xE2\x82\xAC";
    CHECK(utf8Boundary(euro.data(), 2, &valid) == 0, "utf8: two bytes of three are held back");
    const std::string bad = "a\xFF" "b";
    CHECK(utf8Boundary(bad.data(), bad.size(), &valid) == 3 && !valid, "utf8: a stray byte marks the chunk invalid");
    CHECK(!isValidUtf8("\xED\xA0\x80", 3), "utf8: surrogates are not UTF-8");
    CHECK(latin1ToUtf8("\xFF" "A") == "\xC3\xBF" "A", "utf8: Latin-1 bytes become their code points");
}

static void testJson()
{
    bool ok = false;
    const Json j = Json::parse("{\"a\":\"x\\\"\\u00e9\\ud83d\\ude00\",\"n\":-3.5,\"b\":true,\"z\":null,\"l\":[1,{\"k\":2}]}", &ok);
    CHECK(ok && j.isObject(), "json: parses an object");
    CHECK(j["a"].str() == "x\"\xC3\xA9\xF0\x9F\x98\x80", "json: escapes and surrogate pairs");
    CHECK(j["n"].num() == -3.5 && j["b"].boolean() && j["z"].isNull() && j["missing"].isNull(), "json: numbers, booleans, null, missing");
    CHECK(j["l"].items().size() == 2 && j["l"].items()[1]["k"].num() == 2, "json: arrays");
    Json::parse("{\"a\":", &ok);
    CHECK(!ok, "json: refuses truncated input");
    CHECK(jsonQuote("a\"\\\n\x1b") == "\"a\\\"\\\\\\n\\u001b\"", "json: quotes control characters");
    const Json back = Json::parse(jsonQuote("tab\there \xE2\x82\xAC"), &ok);
    CHECK(ok && back.str() == "tab\there \xE2\x82\xAC", "json: quote and parse round trip");
}

static void testCallers()
{
    CHECK(appIdOf("org.webosphoenix.terminal 1000") == "org.webosphoenix.terminal", "caller: legacy ids carry the process");
    CHECK(mayOpenShells("org.webosphoenix.terminal"), "caller: the Terminal may open shells");
    CHECK(!mayOpenShells("org.webosphoenix.terminal.evil") && !mayOpenShells("com.palm.app.browser"), "caller: no other app may");
    CHECK(!findShell("sh").empty(), "shells: sh is found");
    CHECK(findShell("/bin/sh").empty() && findShell("python3").empty(), "shells: only names from the list, never paths");
}

static SpawnOptions sh(const std::vector<std::string> &args, int cols = 80, int rows = 24)
{
    SpawnOptions o;
    o.shellPath = findShell("sh");
    o.args = args;
    o.cols = cols;
    o.rows = rows;
    return o;
}

static void testSessions()
{
    {
        Session s;
        std::string err;
        CHECK(s.spawn(sh({ "-c", "printf 'caf\\303\\251 '; stty size; echo $TERM" }, 100, 30), &err), "session: spawns a shell");
        const std::string out = drain(s);
        CHECK(out.find("caf\xC3\xA9 30 100") != std::string::npos, "session: UTF-8 output, and the size it was opened with");
        CHECK(out.find("xterm-256color") != std::string::npos, "session: TERM is xterm-256color");
        int code = -1, sig = -1;
        for (int i = 0; i < 100 && !s.reap(&code, &sig); ++i) g_usleep(10000);
        CHECK(s.reaped() && code == 0 && sig == 0, "session: exit status collected");
    }
    {
        Session s;
        std::string err;
        s.spawn(sh({ "-c", "printf '\\377\\n'" }), &err);
        bool latin1 = false;
        const std::string out = drain(s, 5000, true, &latin1);
        CHECK(latin1 && out.find("\xC3\xBF") != std::string::npos, "session: bytes that are not UTF-8 come as Latin-1");
    }
    {
        Session s;
        std::string err;
        s.spawn(sh({ "-c", "read x; stty size; echo got:$x" }), &err);
        g_usleep(100000);
        CHECK(s.resize(120, 40), "session: resize");
        CHECK(s.write("hello\r"), "session: write");
        const std::string out = drain(s);
        CHECK(out.find("got:hello") != std::string::npos, "session: the shell reads what was written");
        CHECK(out.find("40 120") != std::string::npos, "session: and sees the new size");
    }
    {
        // Flow control: 600 KB of output, nothing acknowledged.
        Session s;
        std::string err;
        s.spawn(sh({ "-c", "head -c 600000 /dev/zero | tr '\\000' a" }), &err);
        size_t got = 0;
        const gint64 until = g_get_monotonic_time() + 5 * G_USEC_PER_SEC;
        while (g_get_monotonic_time() < until && !s.paused()) {
            if (s.wantsRead()) s.readAvailable();
            got += s.takeChunk().bytes;
            g_usleep(1000);
        }
        CHECK(s.paused() && !s.wantsRead() && got >= kHighWater && got < kHighWater + kMaxChunk,
              "flow control: reading stops above the high-water mark");
        s.ack(got - kLowWater);
        CHECK(s.paused(), "flow control: still paused at the low-water mark");
        s.ack(1);
        CHECK(!s.paused() && s.wantsRead(), "flow control: reads again below it");
        const std::string rest = drain(s);
        CHECK(got + rest.size() == 600000, "flow control: nothing is lost");
    }
    {
        Session s;
        std::string err;
        s.spawn(sh({ "-c", "sleep 30" }), &err);
        g_usleep(50000);
        s.hangup(SIGHUP);
        int code = 0, sig = 0;
        for (int i = 0; i < 200 && !s.reap(&code, &sig); ++i) g_usleep(10000);
        CHECK(s.reaped() && sig == SIGHUP, "session: SIGHUP ends the shell (the card went)");
    }
}

// ---- The Luna service ------------------------------------------------------------

static const char *TERMINAL = "org.webosphoenix.terminal 1002";

static void pump(int ms)
{
    const gint64 until = g_get_monotonic_time() + ms * 1000;
    while (g_get_monotonic_time() < until) {
        while (g_main_context_iteration(nullptr, FALSE)) {}
        g_usleep(2000);
    }
}

static Json lastReply(LSMessage *m)
{
    const auto &r = ls2stub::replies(m);
    return r.empty() ? Json() : Json::parse(r.back());
}

static std::string outputOf(LSMessage *m)
{
    std::string out;
    for (const auto &r : ls2stub::replies(m)) {
        const Json j = Json::parse(r);
        out += j["output"].str();
    }
    return out;
}

static bool waitFor(LSMessage *m, const std::string &text, int ms = 5000)
{
    const gint64 until = g_get_monotonic_time() + ms * 1000;
    while (g_get_monotonic_time() < until) {
        pump(10);
        if (outputOf(m).find(text) != std::string::npos)
            return true;
    }
    return false;
}

static void testService()
{
    LSError err;
    LSErrorInit(&err);
    LSHandle *h = nullptr;
    LSRegister("org.webosphoenix.pty", &h, &err);
    {
        PtyService svc(h);
        CHECK(svc.attach(&err), "service: registers its methods");

        LSMessage *m = ls2stub::call(h, "open", "{\"cols\":80,\"rows\":24,\"shell\":\"sh\",\"subscribe\":true}", "com.palm.app.browser 1003");
        CHECK(lastReply(m)["errorCode"].num() == NotAllowed, "service: another app may not open a shell");
        ls2stub::release(m);
        m = ls2stub::call(h, "open", "{\"shell\":\"sh\",\"subscribe\":true}", "", "com.example.native");
        CHECK(lastReply(m)["errorCode"].num() == NotAllowed, "service: nor may a native service");
        ls2stub::release(m);
        m = ls2stub::call(h, "open", "{\"shell\":\"sh\"}", TERMINAL);
        CHECK(lastReply(m)["errorCode"].num() == BadParams, "service: open needs a subscription");
        ls2stub::release(m);
        m = ls2stub::call(h, "open", "{\"shell\":\"/usr/bin/python3\",\"subscribe\":true}", TERMINAL);
        CHECK(lastReply(m)["errorCode"].num() == NoShell, "service: a program path is not a shell");
        ls2stub::release(m);

        LSMessage *open = ls2stub::call(h, "open", "{\"cols\":90,\"rows\":20,\"shell\":\"sh\",\"subscribe\":true}", TERMINAL);
        const Json first = lastReply(open);
        const std::string id = first["sessionId"].str();
        CHECK(first["subscribed"].boolean() && !id.empty() && first["pid"].num() > 0 && first["shell"].str() == "sh",
              "service: the Terminal opens a shell");
        CHECK(svc.sessionCount() == 1, "service: one session");

        const std::string sid = "\"sessionId\":" + jsonQuote(id);
        m = ls2stub::call(h, "write", "{" + sid + ",\"data\":\"echo phoenix-$((6*7)); stty size\\r\"}", TERMINAL);
        CHECK(lastReply(m)["returnValue"].boolean(), "service: write");
        ls2stub::release(m);
        CHECK(waitFor(open, "phoenix-42"), "service: output comes as replies on the subscription");
        CHECK(waitFor(open, "20 90"), "service: the shell has the size the page asked for");

        m = ls2stub::call(h, "write", "{" + sid + ",\"data\":\"x\"}", "com.palm.app.browser");
        CHECK(lastReply(m)["errorCode"].num() == NoSession, "service: another app cannot type into it");
        ls2stub::release(m);
        m = ls2stub::call(h, "list", "{}", "com.palm.app.browser");
        CHECK(lastReply(m)["returnValue"].boolean() && outputOf(m).empty()
              && ls2stub::replies(m).back().find(id) == std::string::npos, "service: nor see it");
        ls2stub::release(m);
        m = ls2stub::call(h, "list", "{}", TERMINAL);
        CHECK(ls2stub::replies(m).back().find(id) != std::string::npos, "service: list shows the caller's sessions");
        ls2stub::release(m);
        m = ls2stub::call(h, "resize", "{" + sid + ",\"cols\":0,\"rows\":5}", TERMINAL);
        CHECK(lastReply(m)["errorCode"].num() == BadParams, "service: resize checks the size");
        ls2stub::release(m);
        m = ls2stub::call(h, "ack", "{" + sid + ",\"bytes\":100}", TERMINAL);
        CHECK(lastReply(m)["returnValue"].boolean(), "service: ack");
        ls2stub::release(m);
        m = ls2stub::call(h, "getShells", "{}", TERMINAL);
        const Json shells = lastReply(m);
        bool shInstalled = false;
        for (const auto &s : shells["shells"].items())
            shInstalled = shInstalled || (s["name"].str() == "sh" && s["installed"].boolean());
        CHECK(shells["default"].str() == "bash" && shInstalled, "service: getShells (bash by default)");
        ls2stub::release(m);
        m = ls2stub::call(h, "exec", "{\"command\":\"id\"}", TERMINAL);
        CHECK(lastReply(m)["errorCode"].num() == DevModeRequired, "service: exec waits for Developer Mode");
        ls2stub::release(m);

        m = ls2stub::call(h, "write", "{" + sid + ",\"data\":\"exit 3\\r\"}", TERMINAL);
        ls2stub::release(m);
        const gint64 until = g_get_monotonic_time() + 5 * G_USEC_PER_SEC;
        while (g_get_monotonic_time() < until && !lastReply(open)["exited"].boolean())
            pump(10);
        CHECK(lastReply(open)["exited"].boolean() && lastReply(open)["exitCode"].num() == 3,
              "service: the last reply says the shell exited, with its status");
        CHECK(svc.sessionCount() == 0, "service: and the session is gone");
        ls2stub::release(open);

        // The page goes away: cancelling the subscription hangs up.
        open = ls2stub::call(h, "open", "{\"shell\":\"sh\",\"subscribe\":true}", TERMINAL);
        const int pid = static_cast<int>(lastReply(open)["pid"].num());
        pump(50);
        ls2stub::cancel(h, open);
        CHECK(svc.sessionCount() == 0 && ::kill(pid, 0) != 0, "service: cancelling the subscription ends the shell");
        ls2stub::release(open);
    }
    LSUnregister(h, &err);
}

int main()
{
    std::signal(SIGPIPE, SIG_IGN);
    testUtf8();
    testJson();
    testCallers();
    testSessions();
    testService();
    std::printf("%d checks, %d failed\n", checks, failures);
    return failures ? 1 : 0;
}
