// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

#include "ptycore.h"

#include <cerrno>
#include <csignal>
#include <cstdio>
#include <cstdlib>
#include <cstring>

#include <fcntl.h>
#include <poll.h>
#include <sys/ioctl.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <termios.h>
#include <unistd.h>

#if defined(__APPLE__)
#include <util.h>
#elif defined(__FreeBSD__)
#include <libutil.h>
#else
#include <pty.h>
#endif

extern char **environ;

namespace phoenix {
namespace pty {

// ---- Callers ---------------------------------------------------------------------

std::string appIdOf(const std::string &callerId)
{
    const size_t space = callerId.find(' ');
    return space == std::string::npos ? callerId : callerId.substr(0, space);
}

bool mayOpenShells(const std::string &callerId)
{
    return appIdOf(callerId) == kTerminalAppId;
}

// ---- Shells ----------------------------------------------------------------------

const std::vector<std::string> &shellNames()
{
    static const std::vector<std::string> names = { "bash", "zsh", "fish", "sh" };
    return names;
}

std::string findShell(const std::string &name)
{
    bool known = false;
    for (const auto &n : shellNames())
        known = known || n == name;
    if (!known)
        return {};
    static const char *dirs[] = { "/bin/", "/usr/bin/", "/usr/local/bin/", "/opt/homebrew/bin/" };
    for (const char *dir : dirs) {
        const std::string path = std::string(dir) + name;
        struct stat st;
        if (::stat(path.c_str(), &st) == 0 && S_ISREG(st.st_mode) && ::access(path.c_str(), X_OK) == 0)
            return path;
    }
    return {};
}

// ---- UTF-8 -------------------------------------------------------------------------

// Bytes in the sequence a lead byte starts, 0 if it cannot start one.
static int sequenceLength(unsigned char c)
{
    if (c < 0x80) return 1;
    if (c >= 0xC2 && c <= 0xDF) return 2;
    if (c >= 0xE0 && c <= 0xEF) return 3;
    if (c >= 0xF0 && c <= 0xF4) return 4;
    return 0;
}

// Is s[0, n) (n = sequenceLength) a well-formed sequence? (No overlongs,
// no surrogates, nothing above U+10FFFF.)
static bool wellFormed(const unsigned char *s, int n)
{
    for (int i = 1; i < n; ++i)
        if ((s[i] & 0xC0) != 0x80)
            return false;
    if (n == 3) {
        if (s[0] == 0xE0 && s[1] < 0xA0) return false;
        if (s[0] == 0xED && s[1] > 0x9F) return false;
    } else if (n == 4) {
        if (s[0] == 0xF0 && s[1] < 0x90) return false;
        if (s[0] == 0xF4 && s[1] > 0x8F) return false;
    }
    return true;
}

bool isValidUtf8(const char *buf, size_t len)
{
    const auto *s = reinterpret_cast<const unsigned char *>(buf);
    size_t i = 0;
    while (i < len) {
        const int n = sequenceLength(s[i]);
        if (n == 0 || i + n > len || !wellFormed(s + i, n))
            return false;
        i += n;
    }
    return true;
}

size_t utf8Boundary(const char *buf, size_t len, bool *valid)
{
    const auto *s = reinterpret_cast<const unsigned char *>(buf);
    size_t end = len;
    // Hold back a sequence the buffer ends inside of (at most 3 bytes).
    for (size_t back = 1; back <= 3 && back <= len; ++back) {
        const unsigned char c = s[len - back];
        if ((c & 0xC0) == 0x80)
            continue;               // a continuation byte: look further back
        const int n = sequenceLength(c);
        if (n > 1 && static_cast<size_t>(n) > back) {
            // Incomplete so far; only hold it if what is there could still
            // become a valid sequence.
            bool ok = true;
            for (size_t k = 1; k < back; ++k)
                ok = ok && (s[len - back + k] & 0xC0) == 0x80;
            if (ok)
                end = len - back;
        }
        break;
    }
    if (valid)
        *valid = isValidUtf8(buf, end);
    return end;
}

std::string latin1ToUtf8(const std::string &bytes)
{
    std::string out;
    out.reserve(bytes.size() * 2);
    for (unsigned char c : bytes) {
        if (c < 0x80) {
            out += static_cast<char>(c);
        } else {
            out += static_cast<char>(0xC0 | (c >> 6));
            out += static_cast<char>(0x80 | (c & 0x3F));
        }
    }
    return out;
}

// ---- Sessions ----------------------------------------------------------------------

Session::~Session()
{
    if (m_pid > 0 && !m_reaped) {
        hangup(SIGHUP);
        int code, sig;
        // Give it a moment to go, then make sure it does not linger as a zombie.
        for (int i = 0; i < 20 && !reap(&code, &sig); ++i)
            ::usleep(5000);
        if (!m_reaped) {
            hangup(SIGKILL);
            ::waitpid(m_pid, nullptr, 0);
        }
    }
    if (m_fd >= 0)
        ::close(m_fd);
}

static std::string envOr(const char *name, const std::string &fallback)
{
    const char *v = ::getenv(name);
    return v && *v ? std::string(v) : fallback;
}

bool Session::spawn(const SpawnOptions &opts, std::string *error)
{
    if (opts.shellPath.empty() || ::access(opts.shellPath.c_str(), X_OK) != 0) {
        if (error) *error = "shell not found: " + opts.shellPath;
        return false;
    }
    struct winsize ws;
    std::memset(&ws, 0, sizeof ws);
    ws.ws_col = static_cast<unsigned short>(opts.cols > 0 && opts.cols < 1000 ? opts.cols : 80);
    ws.ws_row = static_cast<unsigned short>(opts.rows > 0 && opts.rows < 1000 ? opts.rows : 24);

    // Everything the child needs is built before fork: after it only
    // async-signal-safe calls.
    const std::string home = envOr("HOME", "/");
    const std::string cwd = opts.cwd.empty() ? home : opts.cwd;
    const size_t slash = opts.shellPath.rfind('/');
    const std::string base = opts.shellPath.substr(slash == std::string::npos ? 0 : slash + 1);
    std::vector<std::string> argvStore;
    argvStore.push_back(opts.args.empty() ? "-" + base : base);   // "-bash": a login shell
    for (const auto &a : opts.args)
        argvStore.push_back(a);

    std::vector<std::pair<std::string, std::string>> env;
    auto set = [&env](const std::string &k, const std::string &v) {
        for (auto &e : env)
            if (e.first == k) { e.second = v; return; }
        env.emplace_back(k, v);
    };
    if (opts.inheritEnv) {
        for (char **e = environ; e && *e; ++e) {
            const char *eq = std::strchr(*e, '=');
            if (eq)
                set(std::string(*e, eq - *e), std::string(eq + 1));
        }
    } else {
        set("HOME", home);
        set("USER", envOr("USER", "user"));
        set("LOGNAME", envOr("LOGNAME", envOr("USER", "user")));
        set("PATH", envOr("PATH", "/usr/local/bin:/usr/bin:/bin"));
        set("LANG", envOr("LANG", "C.UTF-8"));
    }
    set("SHELL", opts.shellPath);
    set("TERM", "xterm-256color");
    set("COLORTERM", "truecolor");
    set("TERM_PROGRAM", "Phoenix Terminal");
    set("PHOENIX_TERMINAL", "1");
    for (const auto &e : opts.env)
        set(e.first, e.second);
    std::vector<std::string> envStore;
    for (const auto &e : env)
        envStore.push_back(e.first + "=" + e.second);

    std::vector<char *> argv, envp;
    for (auto &a : argvStore) argv.push_back(const_cast<char *>(a.c_str()));
    argv.push_back(nullptr);
    for (auto &e : envStore) envp.push_back(const_cast<char *>(e.c_str()));
    envp.push_back(nullptr);

    int master = -1;
    const pid_t pid = ::forkpty(&master, nullptr, nullptr, &ws);
    if (pid < 0) {
        if (error) *error = std::string("forkpty failed: ") + std::strerror(errno);
        return false;
    }
    if (pid == 0) {
        // The shell: a new session with the PTY as its controlling terminal.
        struct sigaction dfl;
        std::memset(&dfl, 0, sizeof dfl);
        dfl.sa_handler = SIG_DFL;
        for (int sig : { SIGPIPE, SIGCHLD, SIGINT, SIGQUIT, SIGTERM, SIGHUP, SIGTSTP, SIGTTIN, SIGTTOU })
            ::sigaction(sig, &dfl, nullptr);
        sigset_t none;
        sigemptyset(&none);
        ::sigprocmask(SIG_SETMASK, &none, nullptr);
        const long maxFd = ::sysconf(_SC_OPEN_MAX);
        for (int f = 3; f < (maxFd > 0 && maxFd < 65536 ? maxFd : 1024); ++f)
            ::close(f);
        if (::chdir(cwd.c_str()) != 0 && ::chdir(home.c_str()) != 0)
            (void)::chdir("/");
        ::execve(opts.shellPath.c_str(), argv.data(), envp.data());
        ::_exit(127);
    }

    ::fcntl(master, F_SETFL, ::fcntl(master, F_GETFL) | O_NONBLOCK);
    ::fcntl(master, F_SETFD, FD_CLOEXEC);
    m_fd = master;
    m_pid = pid;
    m_shell = opts.shellPath;
    return true;
}

bool Session::wantsRead() const
{
    return !m_eof && !m_paused && m_pending.size() < kMaxChunk;
}

bool Session::readAvailable()
{
    if (m_eof)
        return false;
    char buf[16384];
    // Read up to one chunk's worth per call so one busy shell cannot starve
    // the others.
    while (m_pending.size() < kMaxChunk) {
        const ssize_t n = ::read(m_fd, buf, sizeof buf);
        if (n > 0) {
            m_pending.append(buf, static_cast<size_t>(n));
            continue;
        }
        if (n < 0 && errno == EINTR)
            continue;
        if (n < 0 && (errno == EAGAIN || errno == EWOULDBLOCK))
            return true;
        // 0 or EIO: the slave side closed (Linux reports EIO).
        m_eof = true;
        return false;
    }
    return true;
}

bool Session::hasOutput() const
{
    return !m_pending.empty();
}

Chunk Session::takeChunk(size_t max)
{
    Chunk c;
    if (m_pending.empty())
        return c;
    size_t n = m_pending.size() < max ? m_pending.size() : max;
    bool valid = true;
    size_t end = utf8Boundary(m_pending.data(), n, &valid);
    if (end == 0) {
        // Only the start of a sequence so far: wait for the rest, unless
        // nothing more will come.
        if (!m_eof && n < max)
            return c;
        end = n;
        valid = false;
    }
    const std::string bytes = m_pending.substr(0, end);
    m_pending.erase(0, end);
    if (valid) {
        c.text = bytes;
    } else {
        c.text = latin1ToUtf8(bytes);
        c.latin1 = true;
    }
    c.bytes = end;
    m_unacked += end;
    if (m_unacked >= kHighWater)
        m_paused = true;
    return c;
}

bool Session::write(const std::string &data)
{
    if (m_fd < 0 || m_eof)
        return false;
    size_t off = 0;
    int waits = 0;
    while (off < data.size()) {
        const ssize_t n = ::write(m_fd, data.data() + off, data.size() - off);
        if (n > 0) {
            off += static_cast<size_t>(n);
            continue;
        }
        if (n < 0 && errno == EINTR)
            continue;
        if (n < 0 && (errno == EAGAIN || errno == EWOULDBLOCK) && waits++ < 50) {
            // A big paste into a busy program: wait a little for room.
            struct pollfd p = { m_fd, POLLOUT, 0 };
            ::poll(&p, 1, 20);
            continue;
        }
        return false;
    }
    return true;
}

bool Session::resize(int cols, int rows)
{
    if (m_fd < 0 || cols <= 0 || rows <= 0 || cols > 1000 || rows > 1000)
        return false;
    struct winsize ws;
    std::memset(&ws, 0, sizeof ws);
    ws.ws_col = static_cast<unsigned short>(cols);
    ws.ws_row = static_cast<unsigned short>(rows);
    return ::ioctl(m_fd, TIOCSWINSZ, &ws) == 0;
}

void Session::ack(size_t bytes)
{
    m_unacked = bytes >= m_unacked ? 0 : m_unacked - bytes;
    if (m_unacked < kLowWater)
        m_paused = false;
}

void Session::hangup(int sig)
{
    if (m_pid <= 0 || m_reaped)
        return;
    // The shell leads its own process group (forkpty's setsid).
    if (::kill(-m_pid, sig) != 0)
        ::kill(m_pid, sig);
}

bool Session::reap(int *exitCode, int *signal)
{
    if (m_reaped || m_pid <= 0)
        return m_reaped;
    int status = 0;
    const pid_t r = ::waitpid(m_pid, &status, WNOHANG);
    if (r != m_pid)
        return false;
    m_reaped = true;
    if (exitCode) *exitCode = WIFEXITED(status) ? WEXITSTATUS(status) : -1;
    if (signal) *signal = WIFSIGNALED(status) ? WTERMSIG(status) : 0;
    return true;
}

} // namespace pty
} // namespace phoenix
