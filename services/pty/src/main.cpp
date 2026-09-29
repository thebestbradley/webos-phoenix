// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// phoenix-pty: the org.webosphoenix.pty Luna service (see service.h).
// systemd starts it as the device's unprivileged user (phoenix-pty.service);
// it refuses to run as root, so it can never hand out a root shell.

#include <glib.h>
#include <glib-unix.h>
#include <luna-service2/lunaservice.h>

#include <csignal>
#include <cstdio>
#include <cstdlib>
#include <unistd.h>

#include "service.h"

static GMainLoop *loop = nullptr;

static gboolean quit(gpointer)
{
    g_main_loop_quit(loop);
    return G_SOURCE_REMOVE;
}

int main()
{
    if (::getuid() == 0 && !::getenv("PHOENIX_PTY_ALLOW_ROOT")) {
        std::fprintf(stderr, "phoenix-pty: not starting as root; run it as the device user (docs/TERMINAL.md)\n");
        return 1;
    }
    std::signal(SIGPIPE, SIG_IGN);
    loop = g_main_loop_new(nullptr, FALSE);

    LSError err;
    LSErrorInit(&err);
    LSHandle *handle = nullptr;
    if (!LSRegister("org.webosphoenix.pty", &handle, &err)) {
        LSErrorPrint(&err, stderr);
        LSErrorFree(&err);
        return 1;
    }
    phoenix::pty::PtyService service(handle);
    if (!service.attach(&err) || !LSGmainAttach(handle, loop, &err)) {
        LSErrorPrint(&err, stderr);
        LSErrorFree(&err);
        return 1;
    }
    g_unix_signal_add(SIGTERM, quit, nullptr);
    g_unix_signal_add(SIGINT, quit, nullptr);
    g_main_loop_run(loop);

    LSUnregister(handle, &err);
    g_main_loop_unref(loop);
    return 0;
}
