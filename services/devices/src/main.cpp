// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// phoenix-devices: com.palm.display, com.palm.keys, com.palm.vibrate and
// com.palm.ambientLightSensor on the bus (service.h), over the device's
// backlight, input devices, vibrator and light sensor (hardware.h).
//
// PHOENIX_DEVICE_CONFIG names device.json (default /etc/phoenix/device.json);
// PHOENIX_DEVICES_ROOT puts /sys and /dev under another directory (testing
// in QEMU against a fake tree); PHOENIX_DEVICES_SHELL lists the service
// names that may call com.palm.display/phoenix (comma-separated; default
// com.webos.surfacemanager).

#include "service.h"

#include <glib-unix.h>

#include <csignal>
#include <cstdio>
#include <cstdlib>
#include <sstream>

using namespace phoenix::devices;

static GMainLoop *loop = nullptr;

static gboolean quit(gpointer)
{
    g_main_loop_quit(loop);
    return G_SOURCE_REMOVE;
}

struct Watch
{
    DeviceService *service;
    InputDevices *input;
};

static gboolean inputReady(gint fd, GIOCondition cond, gpointer data)
{
    auto *w = static_cast<Watch *>(data);
    if (cond & (G_IO_HUP | G_IO_ERR))
        return G_SOURCE_REMOVE;     // the device went (a USB headset unplugged)
    for (const auto &e : w->input->readFrom(fd))
        w->service->inputEvent(e);
    return G_SOURCE_CONTINUE;
}

static const char *env(const char *name, const char *fallback)
{
    const char *v = std::getenv(name);
    return v && *v ? v : fallback;
}

int main()
{
    std::signal(SIGPIPE, SIG_IGN);
    loop = g_main_loop_new(nullptr, FALSE);

    const std::string root = env("PHOENIX_DEVICES_ROOT", "");
    const DeviceConfig config = DeviceConfig::load(env("PHOENIX_DEVICE_CONFIG", "/etc/phoenix/device.json"));
    Backlight backlight(root, config.backlight);
    Vibrator vibrator(root);
    LightSensor lightSensor(root, config.lightSensor);
    InputDevices input(root, config);
    std::fprintf(stderr, "phoenix-devices: backlight %s, vibrator %d, light sensor %s, %zu input devices\n",
                 backlight.available() ? backlight.dir().c_str() : "none", static_cast<int>(vibrator.kind()),
                 lightSensor.available() ? "yes" : "none", input.fds().size());

    LSError err;
    LSErrorInit(&err);
    DeviceService::Handles h;
    const struct { const char *name; LSHandle **slot; } names[] = {
        { "com.palm.display", &h.display }, { "com.palm.keys", &h.keys },
        { "com.palm.vibrate", &h.vibrate }, { "com.palm.ambientLightSensor", &h.als },
    };
    for (const auto &n : names) {
        if (!LSRegister(n.name, n.slot, &err)) {
            LSErrorPrint(&err, stderr);
            LSErrorFree(&err);
            return 1;
        }
    }
    DeviceService::Hardware hw;
    hw.backlight = &backlight;
    hw.vibrator = &vibrator;
    hw.lightSensor = &lightSensor;
    hw.input = &input;
    DeviceService service(h, hw, config);
    std::vector<std::string> shells;
    std::stringstream list(env("PHOENIX_DEVICES_SHELL", "com.webos.surfacemanager"));
    for (std::string s; std::getline(list, s, ',');)
        if (!s.empty())
            shells.push_back(s);
    service.setShellNames(shells);
    if (!service.attach(&err)) {
        LSErrorPrint(&err, stderr);
        LSErrorFree(&err);
        return 1;
    }
    for (const auto &n : names) {
        if (!LSGmainAttach(*n.slot, loop, &err)) {
            LSErrorPrint(&err, stderr);
            LSErrorFree(&err);
            return 1;
        }
    }
    Watch watch{ &service, &input };
    for (int fd : input.fds())
        g_unix_fd_add(fd, static_cast<GIOCondition>(G_IO_IN | G_IO_HUP | G_IO_ERR), inputReady, &watch);

    g_unix_signal_add(SIGTERM, quit, nullptr);
    g_unix_signal_add(SIGINT, quit, nullptr);
    g_main_loop_run(loop);

    for (const auto &n : names)
        LSUnregister(*n.slot, &err);
    g_main_loop_unref(loop);
    return 0;
}
