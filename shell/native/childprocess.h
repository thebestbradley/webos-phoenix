// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// A helper program the shell runs ends with the shell, however the shell
// ends, and gets none of the shell's own descriptors.
//
// The shell's helpers (dictation's transcriber, its partial transcriptions,
// the wake-word spotter) are its children. When phoenix-sim or the device's
// shell is killed (a test's timeout, xvfb-run gone, a crash), nothing runs
// their clean-up, and they ran on, reparented to init: six whisper-cli were
// found 52 minutes later, about 100 s of CPU each, holding 84 of the shell's
// descriptors (GAPS V9). So:
//   - on Linux the kernel kills the child when its parent dies
//     (PR_SET_PDEATHSIG); a parent already gone before that is set is
//     caught by the child's parent pid having changed;
//   - the child keeps only stdin, stdout and stderr
//     (QProcess::UnixProcessFlag::CloseFileDescriptors), not the shell's
//     sockets, files and pipes. Qt 6.8 closes its own pipe for exec's error
//     with the rest, so a program that cannot be started then finishes
//     with exit code 255 instead of failing to start (errorOccurred
//     FailedToStart, which dictation reports as "not installed"): the
//     descriptors are closed only for a program that is there to start.
// llama-server (localmodels.cpp) and the Marketplace's PHP server
// (simmarketplace.cpp) set the same signal for the same reason.

#pragma once

#include <QFileInfo>
#include <QProcess>
#include <QStandardPaths>

#if defined(Q_OS_LINUX)
#include <csignal>
#include <sys/prctl.h>
#include <unistd.h>
#endif

inline void endWithShell(QProcess *proc, const QString &program)
{
#if defined(Q_OS_UNIX)
    const bool there = program.contains(QLatin1Char('/')) ? QFileInfo(program).isExecutable()
                                                          : !QStandardPaths::findExecutable(program).isEmpty();
    if (there)
        proc->setUnixProcessParameters(QProcess::UnixProcessFlag::CloseFileDescriptors);
#else
    Q_UNUSED(program);
#endif
#if defined(Q_OS_LINUX)
    const pid_t shell = ::getpid();
    proc->setChildProcessModifier([shell]() {
        ::prctl(PR_SET_PDEATHSIG, SIGKILL);
        if (::getppid() != shell)
            ::_exit(127);
    });
#endif
}
