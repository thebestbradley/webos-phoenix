// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// phoenix-pdeath SIGNAL -- PROGRAM [ARGS...]
//
// Runs PROGRAM so that the kernel sends it SIGNAL when the process that
// started it dies, however that one dies (killed with SIGKILL, crashed):
// prctl(PR_SET_PDEATHSIG), then exec. The Assistant service starts
// llama-server through it (apps/assistant/service/lib/node-device.js), so a
// service that dies does not leave the model running; phoenix-sim's shell
// does the same itself (shell/native/localmodels.cpp). util-linux's
// setpriv --pdeathsig does this too, but is GPL-2.0, which the image leaves
// out (docs/LEGAL.md). Linux only.
//
// SIGNAL: a number or a name, with or without SIG (TERM, SIGKILL, 15).
// Exit status: PROGRAM's (it replaces this one); 2 for bad arguments, 127
// when PROGRAM cannot be run; 128 + SIGNAL when the parent was already gone.

#include <errno.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <sys/prctl.h>
#include <unistd.h>

static int signalOf(const char *s)
{
    static const struct { const char *name; int sig; } names[] = {
        { "TERM", SIGTERM }, { "KILL", SIGKILL }, { "INT", SIGINT }, { "HUP", SIGHUP },
        { "QUIT", SIGQUIT }, { "USR1", SIGUSR1 }, { "USR2", SIGUSR2 },
    };
    char *end = NULL;
    long n = strtol(s, &end, 10);
    if (end && end != s && *end == '\0')
        return n > 0 && n < NSIG ? (int)n : -1;
    if (strncasecmp(s, "SIG", 3) == 0)
        s += 3;
    for (size_t i = 0; i < sizeof names / sizeof names[0]; ++i)
        if (strcasecmp(s, names[i].name) == 0)
            return names[i].sig;
    return -1;
}

int main(int argc, char **argv)
{
    if (argc < 4 || strcmp(argv[2], "--") != 0) {
        fprintf(stderr, "usage: phoenix-pdeath SIGNAL -- PROGRAM [ARGS...]\n");
        return 2;
    }
    const int sig = signalOf(argv[1]);
    if (sig < 0) {
        fprintf(stderr, "phoenix-pdeath: no such signal: %s\n", argv[1]);
        return 2;
    }
    // The parent as it is now; if it dies before prctl takes effect, no
    // signal would ever come, so look again after it (the race prctl(2)
    // describes). Parent 1: it is already gone (re-parented to init).
    const pid_t parent = getppid();
    if (parent == 1)
        return 128 + sig;
    if (prctl(PR_SET_PDEATHSIG, sig) != 0) {
        perror("phoenix-pdeath: prctl");
        return 127;
    }
    if (getppid() != parent)
        return 128 + sig;
    execvp(argv[3], argv + 3);
    fprintf(stderr, "phoenix-pdeath: %s: %s\n", argv[3], strerror(errno));
    return 127;
}
