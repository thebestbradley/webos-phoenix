// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The device under phoenix-devices, through the kernel's own interfaces
// (webOS OSE has no service for any of them; docs/HARDWARE.md):
//
//   Backlight     /sys/class/backlight/<name>/{brightness,max_brightness,bl_power}
//   Vibrator      a force-feedback input device (EV_FF, FF_RUMBLE: the
//                 mainline vibrators, e.g. drivers/input/misc/*-vibra*), else
//                 the LED class's vibrator with the transient trigger
//                 (/sys/class/leds/vibrator, Documentation/leds/
//                 ledtrig-transient.rst), else Android's timed_output
//                 (/sys/class/timed_output/vibrator/enable)
//   LightSensor   IIO: /sys/bus/iio/devices/iio:deviceN/in_illuminance_input
//                 (lux), or in_illuminance_raw times in_illuminance_scale
//   InputDevices  evdev: /dev/input/event* with the switches (EV_SW:
//                 SW_HEADPHONE_INSERT, SW_MICROPHONE_INSERT, the ringer's
//                 code from device.json) and the keys (keyForCode)
//
// Every path starts at a root ("/" on a device) so tests can build a fake
// sysfs in a temporary directory.

#pragma once

#include <linux/input.h>

#include <functional>
#include <string>
#include <vector>

namespace phoenix {
namespace devices {

// /etc/phoenix/device.json, the keys phoenix-devices reads (docs/HARDWARE.md,
// "Device configuration"); missing: found by looking.
struct DeviceConfig
{
    std::string backlight;          // a name under /sys/class/backlight
    std::string lightSensor;        // an IIO device's directory name ("iio:device0")
    // The ringer switch: an EV_SW or EV_KEY code, and its value when the
    // ringer is silent. -1: the device has none (the ringer is always on).
    int ringerType = -1;            // EV_SW or EV_KEY
    int ringerCode = -1;
    int ringerSilentValue = 1;
    static DeviceConfig load(const std::string &path);
};

class Backlight
{
public:
    explicit Backlight(const std::string &root, const std::string &name = std::string());
    bool available() const { return !m_dir.empty(); }
    const std::string &dir() const { return m_dir; }
    int maxBrightness() const { return m_max; }
    // 0-100; 0 also powers the panel's backlight down (bl_power 4,
    // FB_BLANK_POWERDOWN), anything else up (0).
    bool setPercent(int percent);

private:
    std::string m_dir;
    int m_max = 0;
    int m_lastPower = -1;
};

class Vibrator
{
public:
    enum Kind { None, ForceFeedback, LedTransient, TimedOutput };
    explicit Vibrator(const std::string &root);
    ~Vibrator();
    Kind kind() const { return m_kind; }
    // Run for ms (0: until stop(), as long as the driver allows).
    bool run(int ms);
    void stop();

private:
    Kind m_kind = None;
    std::string m_path;     // the event device, or the sysfs directory
    int m_fd = -1;
    int m_effect = -1;
};

class LightSensor
{
public:
    LightSensor(const std::string &root, const std::string &name = std::string());
    bool available() const { return !m_input.empty() || !m_raw.empty(); }
    // Lux now; -1 when it cannot be read.
    int read() const;

private:
    std::string m_input;    // in_illuminance_input (lux)
    std::string m_raw;      // in_illuminance_raw
    double m_scale = 1;
    double m_offset = 0;
};

// The input devices with keys or switches phoenix-devices reports. The
// service watches fds() and calls readFrom(fd) when one is readable.
class InputDevices
{
public:
    struct Event
    {
        int type;   // EV_KEY or EV_SW
        int code;
        int value;  // 1 down / switch on, 0 up / off, 2 repeat
    };
    InputDevices(const std::string &root, const DeviceConfig &config);
    ~InputDevices();
    const std::vector<int> &fds() const { return m_fds; }
    std::vector<Event> readFrom(int fd);
    // A switch's state now (EVIOCGSW / EVIOCGKEY): -1 unknown.
    int switchState(int type, int code) const;
    // Whether a device reports this code (tests: what was opened).
    std::vector<std::string> opened() const { return m_paths; }

private:
    std::vector<int> m_fds;
    std::vector<std::string> m_paths;
};

// The interesting part of a read() from an event device: key and switch
// events, without the sync and autorepeat ones.
std::vector<InputDevices::Event> decodeInputEvents(const struct input_event *ev, size_t count);

} // namespace devices
} // namespace phoenix
