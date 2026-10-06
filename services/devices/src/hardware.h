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
//                 code) and the keys (keyForCode). What each device can do
//                 comes from sysfs (/sys/class/input/eventN/device/
//                 capabilities/*, name, id/bustype), else from the device
//                 itself (EVIOCGBIT)
//
// Nothing is baked in per device: all of it is found by looking, at
// start-up and again whenever the hardware changes (DeviceProbe::rescan,
// on HotplugMonitor's events: inotify on /dev/input and the kernel's
// uevents), so a USB or Bluetooth headset, a USB keyboard or a dock that
// comes and goes is picked up. device.json is only for what cannot be
// found (docs/HARDWARE.md).
//
// Every path starts at a root ("/" on a device) so tests can build a fake
// sysfs in a temporary directory.

#pragma once

#include <linux/input.h>

#include <functional>
#include <map>
#include <memory>
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
    // The one thing here that cannot be found by looking: Linux has no
    // code for a ringer switch (SW_MUTE_DEVICE means "device disabled", and
    // a laptop's microphone or camera switch sends it too), so --probe
    // only points at the candidates.
    int ringerType = -1;            // EV_SW or EV_KEY
    int ringerCode = -1;
    int ringerSilentValue = 1;
    bool loaded = false;            // the file was there and read
    static DeviceConfig load(const std::string &path);
};

class Backlight
{
public:
    // The one named, else the first by the kernel's preference
    // (Documentation/ABI/stable/sysfs-class-backlight "type": firmware,
    // then platform, then raw) with a max_brightness. Reads only.
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
    // Which one the device has, without touching it (for --probe and to
    // see whether it changed): the kind and its event device or directory.
    struct Found
    {
        Kind kind = None;
        std::string path;
        bool operator==(const Found &o) const { return kind == o.kind && path == o.path; }
    };
    static Found find(const std::string &root);
    static const char *kindName(Kind k);
    // Takes it: opens the force-feedback device, or sets the LED's trigger.
    explicit Vibrator(const std::string &root);
    ~Vibrator();
    Kind kind() const { return m_kind; }
    const std::string &path() const { return m_path; }
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
    // The file it reads (in_illuminance_input or _raw), "" with none.
    const std::string &source() const { return m_input.empty() ? m_raw : m_input; }

private:
    std::string m_input;    // in_illuminance_input (lux)
    std::string m_raw;      // in_illuminance_raw
    double m_scale = 1;
    double m_offset = 0;
};

// A kernel bitmap of codes (EVIOCGBIT, or sysfs's capabilities files).
using Bits = std::vector<unsigned long>;
bool testBit(const Bits &bits, int bit);
// sysfs's form: hex words, the highest first, separated by spaces, each a
// kernel long (drivers/input/input.c input_print_bitmap).
Bits parseBitmap(const std::string &text);
std::string formatBitmap(const Bits &bits);     // the same form (tests' fake sysfs)

// What one event device is and can do.
struct InputInfo
{
    std::string node;       // "event3"
    std::string path;       // root + "/dev/input/event3"
    std::string name;       // the driver's name for it ("gpio-keys", "Jabra EVOLVE 20")
    int bus = 0;            // BUS_USB, BUS_BLUETOOTH, BUS_HOST, ... (0: unknown)
    Bits ev, key, sw, abs, rel, ff;
    bool fromSysfs = false; // the capabilities came from sysfs (else ioctl)
    std::string error;      // why it could not be opened ("" if it could)

    bool has(int type, int code) const;
    // Something phoenix-devices reports: a headset or microphone jack, the
    // ringer, or one of keyForCode's keys.
    bool wanted(const DeviceConfig &config) const;
    // What it is, for the log: "keys volume_up, volume_down; switches headset".
    std::string summary(const DeviceConfig &config) const;
    // "usb", "bluetooth", "host", ... or the number.
    std::string busName() const;
};

// Read what an event device is: from sysfs if it has it, else from the
// open device fd (-1: none; then only the name and path are known).
InputInfo probeInput(const std::string &root, const std::string &node, int fd);
// Every event device there is now, sorted, each probed (opening it
// read-only when sysfs does not say).
std::vector<InputInfo> listInputs(const std::string &root);

// The input devices with keys or switches phoenix-devices reports, kept up
// to date: rescan() opens the ones that came and closes the ones that went.
// The service watches fds() and calls readFrom(fd) when one is readable.
class InputDevices
{
public:
    struct Event
    {
        int type;   // EV_KEY or EV_SW
        int code;
        int value;  // 1 down / switch on, 0 up / off, 2 repeat
    };
    // What changed in a rescan: every event device that came or went
    // (used or not, for the log); the used ones' fds came or went too.
    struct Change
    {
        std::vector<InputInfo> added;
        std::vector<InputInfo> removed;
        bool any() const { return !added.empty() || !removed.empty(); }
    };

    InputDevices(const std::string &root, const DeviceConfig &config);
    ~InputDevices();
    InputDevices(const InputDevices &) = delete;
    InputDevices &operator=(const InputDevices &) = delete;

    // Look again: open what is new, close what is gone (or was replaced:
    // the same eventN for another device).
    Change rescan();
    // A device's fd hung up or failed (it went): forget it; the next
    // rescan() finds it again if it is still there.
    void drop(int fd);

    std::vector<int> fds() const;
    std::vector<Event> readFrom(int fd);
    // A switch's state now (EVIOCGSW / EVIOCGKEY): -1 unknown.
    int switchState(int type, int code) const;
    // Whether any device in use has this switch or key.
    bool hasCode(int type, int code) const;
    // The devices in use, and every one seen (tests, the log).
    std::vector<std::string> opened() const;
    std::vector<InputInfo> used() const;
    std::vector<InputInfo> seen() const;
    // The path of the device behind an fd ("" if none).
    std::string pathOf(int fd) const;

private:
    struct Device
    {
        InputInfo info;
        int fd = -1;            // -1: seen but not used
        bool hungUp = false;    // drop()ped: gone, whatever is on the node now is new
        unsigned long long ino = 0, rdev = 0;   // the node, to tell a new device on the same eventN
    };
    std::string m_root;
    DeviceConfig m_config;
    std::map<std::string, Device> m_devices;    // by node ("event3")
};

// The interesting part of a read() from an event device: key and switch
// events, without the sync and autorepeat ones.
std::vector<InputDevices::Event> decodeInputEvents(const struct input_event *ev, size_t count);

// ---- All of it, found and kept up to date ----------------------------------------

// The device's hardware: what start-up finds, and rescan() after a
// hotplug event. Each part may be missing (nullptr).
class DeviceProbe
{
public:
    DeviceProbe(const std::string &root, const DeviceConfig &config);

    std::unique_ptr<Backlight> backlight;
    std::unique_ptr<Vibrator> vibrator;
    std::unique_ptr<LightSensor> lightSensor;
    std::unique_ptr<InputDevices> input;

    struct Changes
    {
        bool backlight = false, vibrator = false, lightSensor = false;
        InputDevices::Change input;
        std::vector<std::string> log;     // a line per change
        bool any() const { return backlight || vibrator || lightSensor || input.any(); }
    };
    // Look again; replace what changed (a part that is the same is kept,
    // with its state). What was there and is gone becomes nullptr.
    Changes rescan();
    // What there is now, a line each (the start-up log).
    std::vector<std::string> describe() const;

private:
    std::string m_root;
    DeviceConfig m_config;
};

// A kernel uevent (NETLINK_KOBJECT_UEVENT): "ACTION@DEVPATH\0KEY=VALUE\0...".
struct Uevent
{
    std::string action;     // add, remove, change, bind, ...
    std::string devpath;
    std::string subsystem;  // input, iio, backlight, leds, timed_output, ...
    std::string devname;    // "input/event3" for a device node
};
bool parseUevent(const char *buf, size_t len, Uevent *out);
// Whether it may change what phoenix-devices uses.
bool ueventMatters(const Uevent &e);

// Tells when the hardware may have changed, without libudev: inotify on
// /dev/input (event devices come and go there; devtmpfs makes and removes
// the nodes), and the kernel's uevents for what has no node (an IIO light
// sensor, a backlight, an LED or timed_output vibrator: sysfs gives no
// inotify events). The service polls fds() and calls readFrom().
class HotplugMonitor
{
public:
    // uevents: listen to the kernel too (on a device; tests use inotify only).
    HotplugMonitor(const std::string &root, bool uevents);
    ~HotplugMonitor();
    HotplugMonitor(const HotplugMonitor &) = delete;
    HotplugMonitor &operator=(const HotplugMonitor &) = delete;

    std::vector<int> fds() const;
    // Read what fd has; true if the hardware may have changed. what gets a
    // line per event, for the log.
    bool readFrom(int fd, std::vector<std::string> *what);
    // "inotify on /dev/input; kernel uevents" (or why not).
    std::string describe() const;

private:
    void watchInput();
    std::string m_root;
    int m_inotify = -1;
    int m_inputWatch = -1;  // /dev/input
    int m_devWatch = -1;    // /dev, until /dev/input is there
    int m_netlink = -1;
    std::string m_netlinkError;
};

// phoenix-devices --probe: everything it finds and what it would do with
// it, for bringing up a new device. Touches nothing (no trigger set, no
// vibrator taken).
std::string probeReport(const std::string &root, const std::string &configPath);

} // namespace devices
} // namespace phoenix
