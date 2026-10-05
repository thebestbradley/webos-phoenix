// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The PTY core of the Terminal: one shell on a pseudo-terminal per session
// (forkpty), its output cut into UTF-8 chunks for a JSON bus, and the flow
// control xterm.js recommends (the page acknowledges what it has drawn; above
// a high-water mark the host stops reading the PTY until it catches up).
//
// No event loop and no bus here: the Luna service (services/pty/src/
// service.cpp, GLib) and phoenix-sim (shell/sim/simpty.cpp, Qt) watch fd()
// and call readAvailable(), takeChunk(), write(), resize(), ack() and reap().
// docs/TERMINAL.md describes the protocol both speak.

#pragma once

#include <sys/types.h>

#include <cstddef>
#include <string>
#include <utility>
#include <vector>

#include "json.h"

namespace phoenix {
namespace pty {

// Flow control and batching (docs/TERMINAL.md, "Recommendation: B2").
constexpr size_t kMaxChunk = 64 * 1024;      // bytes per output reply
constexpr size_t kHighWater = 256 * 1024;    // unacknowledged: stop reading
constexpr size_t kLowWater = 64 * 1024;      // ...and read again below this
constexpr int kFlushIntervalMs = 16;         // at most one reply per session per frame
constexpr int kMaxSessionsPerApp = 16;

// Error codes on the bus (PTY_ERRORS in apps/shared/luna/src/pty.ts).
enum ErrorCode {
    BadParams = -1,
    NotAllowed = 1,       // the caller is not the Terminal app
    NoSession = 2,        // no such session (or not the caller's)
    SpawnFailed = 3,
    NoShell = 4,          // that shell is not installed
    TooMany = 5,
    DevModeRequired = 6,  // exec: needs Developer Mode (not built yet)
};

// The only app that may open shells.
constexpr const char *kTerminalAppId = "org.webosphoenix.terminal";

// "org.webosphoenix.terminal 1000" (legacy webOS ids carry the process) or
// "org.webosphoenix.terminal" -> the app id.
std::string appIdOf(const std::string &callerId);
bool mayOpenShells(const std::string &callerId);

// ---- Shells ------------------------------------------------------------------

// The shells a session may ask for by name. Anything else is refused: the
// page names a shell, it never passes a program path.
const std::vector<std::string> &shellNames();   // bash, zsh, fish, sh
constexpr const char *kDefaultShell = "bash";

// The executable for a shell name in the usual places (/bin, /usr/bin,
// /usr/local/bin, /opt/homebrew/bin), or "" when it is not installed.
std::string findShell(const std::string &name);

// ---- UTF-8 -------------------------------------------------------------------

// Length of the longest prefix of buf[0, len) that does not end inside a
// multi-byte sequence (at most 3 bytes are held back). *valid is false when
// that prefix is not well-formed UTF-8.
size_t utf8Boundary(const char *buf, size_t len, bool *valid);
bool isValidUtf8(const char *buf, size_t len);
// Every byte as the code point of the same value (ISO 8859-1), in UTF-8.
std::string latin1ToUtf8(const std::string &bytes);

// ---- JSON: services/common/json.h ---------------------------------------------

using phoenix::Json;
using phoenix::jsonQuote;

// ---- Sessions ----------------------------------------------------------------

struct SpawnOptions
{
    std::string shellPath;          // the program (from findShell)
    std::vector<std::string> args;  // after argv[0]; empty: a login shell
    std::string cwd;                // "" or missing: $HOME
    int cols = 80;
    int rows = 24;
    // Start from this process's environment (phoenix-sim: your own shell on
    // your machine) or from a clean one (the device service).
    bool inheritEnv = false;
    std::vector<std::pair<std::string, std::string>> env;   // added last
};

// One output reply's worth.
struct Chunk
{
    std::string text;     // UTF-8 (Latin-1 decoded when latin1)
    bool latin1 = false;  // the bytes were not UTF-8: text holds one code point per byte
    size_t bytes = 0;     // bytes of PTY output it carries (for ack)
};

class Session
{
public:
    Session() = default;
    ~Session();
    Session(const Session &) = delete;
    Session &operator=(const Session &) = delete;

    bool spawn(const SpawnOptions &opts, std::string *error);

    int fd() const { return m_fd; }
    pid_t pid() const { return m_pid; }
    const std::string &shellPath() const { return m_shell; }

    // Read what the PTY has, without blocking. False once the other side is
    // gone (the shell exited): no more output will come.
    bool readAvailable();
    // The host should read the PTY now: under the high-water mark, and not
    // already holding a lot it has not sent.
    bool wantsRead() const;
    bool hasOutput() const;
    bool eof() const { return m_eof; }

    // The next reply: up to max bytes, never ending inside a UTF-8 sequence
    // unless the shell is gone. Empty when there is nothing to send yet.
    Chunk takeChunk(size_t max = kMaxChunk);

    // Keystrokes and pastes. False when the shell is gone.
    bool write(const std::string &data);
    bool resize(int cols, int rows);
    // The page drew this many bytes.
    void ack(size_t bytes);
    size_t unacked() const { return m_unacked; }
    bool paused() const { return m_paused; }

    // Send a signal to the shell's process group (SIGHUP: the card went).
    void hangup(int sig);
    // Collect the exit status once the shell has exited (non-blocking).
    bool reap(int *exitCode, int *signal);
    bool reaped() const { return m_reaped; }

private:
    int m_fd = -1;
    pid_t m_pid = -1;
    std::string m_shell;
    std::string m_pending;
    size_t m_unacked = 0;
    bool m_paused = false;     // over the high-water mark until acked below the low
    bool m_eof = false;
    bool m_reaped = false;
};

} // namespace pty
} // namespace phoenix
