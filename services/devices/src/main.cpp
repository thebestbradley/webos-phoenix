// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// phoenix-devices: com.palm.display, com.palm.keys, com.palm.vibrate and
// com.palm.ambientLightSensor on the bus (service.h), over the device's
// backlight, input devices, vibrator and light sensor (hardware.h), found
// at start-up and followed as they come and go (DeviceProbe,
// HotplugMonitor: inotify on /dev/input and the kernel's uevents). What it
// finds, and each change, goes to stderr (the journal).
//
//   phoenix-devices            the service
//   phoenix-devices --probe    print what it finds and what it would use,
//                              then exit (bringing up a new device)
//
// PHOENIX_DEVICE_CONFIG names device.json (default /etc/phoenix/device.json);
// PHOENIX_DEVICES_ROOT puts /sys and /dev under another directory (testing
// in QEMU against a fake tree; only inotify then, no kernel uevents);
// PHOENIX_DEVICES_SHELL lists the service names that may call
// com.palm.display/phoenix (comma-separated; default com.webos.surfacemanager).

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

static const char *env(const char *name, const char *fallback)
{
    const char *v = std::getenv(name);
    return v && *v ? v : fallback;
}

int main(int argc, char **argv)
{
    const std::string root = env("PHOENIX_DEVICES_ROOT", "");
    const std::string configPath = env("PHOENIX_DEVICE_CONFIG", "/etc/phoenix/device.json");
    for (int i = 1; i < argc; ++i) {
        const std::string arg = argv[i];
        if (arg == "--probe") {
            std::fputs(probeReport(root, configPath).c_str(), stdout);
            return 0;
        }
        std::fprintf(stderr, "usage: %s [--probe]\n", argv[0]);
        return arg == "--help" || arg == "-h" ? 0 : 2;
    }

    std::signal(SIGPIPE, SIG_IGN);
    loop = g_main_loop_new(nullptr, FALSE);

    const DeviceConfig config = DeviceConfig::load(configPath);
    std::fprintf(stderr, "phoenix-devices: device.json %s: %s\n", configPath.c_str(), config.loaded ? "read" : "none");
    DeviceProbe probe(root, config);
    // The kernel's uevents on a device; under a fake root, inotify only.
    HotplugMonitor hotplug(root, root.empty());

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
    hw.backlight = probe.backlight.get();
    hw.vibrator = probe.vibrator.get();
    hw.lightSensor = probe.lightSensor.get();
    hw.input = probe.input.get();
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
    // Log what there is, watch the input devices and the hotplug events.
    service.attachProbe(&probe, &hotplug);

    g_unix_signal_add(SIGTERM, quit, nullptr);
    g_unix_signal_add(SIGINT, quit, nullptr);
    g_main_loop_run(loop);

    for (const auto &n : names)
        LSUnregister(*n.slot, &err);
    g_main_loop_unref(loop);
    return 0;
}
