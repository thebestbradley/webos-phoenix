// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Tests of phoenix-devices: its logic against luna-sysmgr's (the display's
// events, the headset button's clicks, the light's regions), the hardware
// against a fake sysfs in a temporary directory (backlight, LED vibrator,
// timed_output, IIO light sensor, device.json), and the service's methods
// over the luna-service2 stand-in (services/common/ls2stub): what apps and
// the shell send and get.

#include <glib.h>
#include <glib/gstdio.h>
#include <linux/input-event-codes.h>
#include <sys/stat.h>

#include <fcntl.h>
#include <unistd.h>

#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <functional>
#include <sstream>
#include <string>
#include <vector>

#include "devicecore.h"
#include "hardware.h"
#include "json.h"
#include "service.h"

using namespace phoenix;
using namespace phoenix::devices;

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

static std::string join(const std::vector<std::string> &v)
{
    std::string out;
    for (const auto &s : v)
        out += (out.empty() ? "" : ",") + s;
    return out;
}

// ---- Logic ----------------------------------------------------------------------

static void testDisplayEvents()
{
    DisplayReport a, b;
    b.state = "dimmed";
    auto ev = displayEvents(a, b);
    CHECK(ev.size() == 1 && ev[0].json == "{\"returnValue\":true,\"event\":\"displayDimmed\"}" && ev[0].isPublic,
          "display: dimmed is displayDimmed, on the public bus too");
    a = b;
    b.state = "on";
    b.dockMode = true;
    b.timeout = 30;
    b.blockDisplay = true;
    b.active = false;
    ev = displayEvents(a, b);
    std::vector<std::string> names;
    for (const auto &e : ev)
        names.push_back(Json::parse(e.json)["event"].str());
    CHECK(join(names) == "displayOn,changedTimeout,blockedDisplay,displayInactive", "display: the events in luna-sysmgr's order");
    CHECK(Json::parse(ev[0].json)["dockMode"].boolean() && ev[0].isPublic && !ev[1].isPublic,
          "display: displayOn in dock mode says so; changedTimeout is private");
    CHECK(Json::parse(ev[1].json)["timeout"].num() == 30, "display: changedTimeout has the timeout");
    CHECK(displayStatusJson(b, true, true) == "{\"returnValue\":true,\"event\":\"request\",\"state\":\"on\",\"subscribed\":true}",
          "display: /status has less");
    CHECK(displayStatusJson(b, false, false) == "{\"returnValue\":true,\"event\":\"request\",\"state\":\"on\",\"timeout\":30,"
                                                "\"blockDisplay\":\"true\",\"active\":false,\"subscribed\":false}",
          "display: /control/status as controlStatus wrote it (blockDisplay a string)");
    CHECK(isDisplayStateRequest("unlock") && isDisplayStateRequest("undock") && !isDisplayStateRequest("bright"),
          "display: the states setState knows");
    CHECK(backlightRaw(50, 255) == 128 && backlightRaw(1, 1000) == 10 && backlightRaw(1, 20) == 1 && backlightRaw(0, 255) == 0,
          "backlight: percent to the panel's steps, at least 1 while on");
}

static void testHeadsetButton()
{
    HeadsetButton b;
    std::vector<std::string> out;
    auto feed = [&](const std::vector<std::string> &v) { out.insert(out.end(), v.begin(), v.end()); };
    feed(b.press(true));
    CHECK(b.timerMs() == HeadsetButton::PressAndHoldMs, "headset: a press waits for a hold");
    feed(b.press(false));
    CHECK(join(out) == "single_click" && b.timerMs() == HeadsetButton::DoublePressMs, "headset: let go: single_click, then waits for a second");
    feed(b.press(true));
    feed(b.press(false));
    CHECK(join(out) == "single_click,double_click", "headset: again within a second: double_click");
    out.clear();
    feed(b.press(true));
    feed(b.timeout());
    feed(b.press(false));
    CHECK(join(out) == "hold" && b.timerMs() == 0, "headset: held two seconds: hold");
    out.clear();
    feed(b.press(false));
    CHECK(out.empty(), "headset: an up with nothing down is nothing");
}

static void testLightRegions()
{
    LightRegions l;
    l.start();
    CHECK(l.region() == 3, "light: starts indoor");
    bool changed = false;
    for (int i = 0; i < 9; ++i)
        changed = l.update(1, false) || changed;
    CHECK(!changed && l.region() == 3, "light: no region before ten readings");
    CHECK(l.update(1, false) && l.region() == 1, "light: ten dark readings: dark");
    for (int i = 0; i < 10; ++i)
        l.update(95, false);
    CHECK(l.region() == 2, "light: 95 lux from dark is dim (up only past 110)");
    for (int i = 0; i < 10; ++i)
        l.update(20000, false);
    CHECK(l.region() == 4, "light: outdoor");
    CHECK(l.update(20000, true) && l.region() == 0, "light: held off: undefined");
    int ms = 0;
    CHECK(effectLength("notification", &ms) && ms == 300 && !effectLength("purr", &ms), "vibrate: the Castle's named effects");
}

static void testOrientation()
{
    const double G = 9.80665;
    OrientationFilter o;
    CHECK(o.orientation().empty(), "orientation: nothing before a reading");
    CHECK(o.update(0, G, 0) && o.orientation() == "up", "orientation: held upright is up");
    CHECK(o.update(G, 0, 0) && o.orientation() == "left", "orientation: right edge up (turned counter-clockwise) is left");
    CHECK(o.update(-G, 0, 0) && o.orientation() == "right", "orientation: left edge up is right");
    CHECK(o.update(0, -G, 0) && o.orientation() == "down", "orientation: upside down is down");
    CHECK(o.update(0, 0, G) && o.orientation() == "faceup", "orientation: flat on its back is faceup");
    CHECK(o.update(0, 0, -G) && o.orientation() == "facedown", "orientation: on its face is facedown");
    // Hysteresis: up stays up past the diagonal until 60 degrees.
    o.update(0, G, 0);
    const double r = M_PI / 180.0;
    CHECK(!o.update(G * std::sin(50 * r), G * std::cos(50 * r), 0) && o.orientation() == "up",
          "orientation: tilted 50 degrees, still up");
    CHECK(o.update(G * std::sin(65 * r), G * std::cos(65 * r), 0) && o.orientation() == "left",
          "orientation: 65 degrees, left");
    CHECK(!o.update(G * std::sin(40 * r), G * std::cos(40 * r), 0) && o.orientation() == "left",
          "orientation: back to 40 degrees, still left");
    CHECK(o.update(G * std::sin(25 * r), G * std::cos(25 * r), 0) && o.orientation() == "up", "orientation: 25 degrees, up again");
    // Tilted back 20 degrees from upright is still up (not face up).
    CHECK(!o.update(0, G * std::cos(20 * r), G * std::sin(20 * r)) && o.orientation() == "up",
          "orientation: leaning back, still up");
    CHECK(!o.update(0, 3 * G, 0) && !o.update(0, 0.2 * G, 0), "orientation: shaken or falling readings are ignored");
    CHECK(orientationJson("left", true) == "{\"returnValue\":true,\"subscribed\":true,\"orientation\":\"left\"}"
              && orientationJson("", false) == "{\"returnValue\":true}",
          "orientation: its reply");
}

// ---- Hardware against a fake sysfs ---------------------------------------------------------

static void mkdirs(const std::string &path) { g_mkdir_with_parents(path.c_str(), 0755); }
static void put(const std::string &path, const std::string &text) { std::ofstream(path) << text; }
static std::string get(const std::string &path)
{
    std::ifstream f(path);
    std::stringstream s;
    s << f.rdbuf();
    return s.str();
}

static std::string fakeRoot()
{
    char tmpl[] = "/tmp/phoenix-devices-XXXXXX";
    const char *dir = g_mkdtemp(tmpl);
    return dir ? dir : "/tmp/phoenix-devices";
}

static void testHardware()
{
    const std::string root = fakeRoot();
    CHECK(!Backlight(root).available() && Vibrator(root).kind() == Vibrator::None && !LightSensor(root).available(),
          "hardware: nothing found where there is nothing");

    const std::string bl = root + "/sys/class/backlight/panel0";
    mkdirs(bl);
    put(bl + "/max_brightness", "1023\n");
    put(bl + "/brightness", "0");
    put(bl + "/bl_power", "4");
    Backlight b(root);
    CHECK(b.available() && b.maxBrightness() == 1023, "backlight: found under /sys/class/backlight");
    b.setPercent(50);
    CHECK(get(bl + "/brightness") == "512" && get(bl + "/bl_power") == "0", "backlight: 50% and powered up");
    b.setPercent(0);
    CHECK(get(bl + "/brightness") == "0" && get(bl + "/bl_power") == "4", "backlight: off powers it down");

    const std::string led = root + "/sys/class/leds/vibrator";
    mkdirs(led);
    put(led + "/trigger", "none");
    put(led + "/activate", "0");
    put(led + "/duration", "0");
    put(led + "/state", "0");
    Vibrator v(root);
    CHECK(v.kind() == Vibrator::LedTransient && get(led + "/trigger") == "transient", "vibrator: the LED class's, on the transient trigger");
    CHECK(v.run(300) && get(led + "/duration") == "300" && get(led + "/state") == "1" && get(led + "/activate") == "1",
          "vibrator: runs for 300 ms");
    v.stop();
    CHECK(get(led + "/activate") == "0", "vibrator: stops");

    const std::string root2 = fakeRoot();
    const std::string timed = root2 + "/sys/class/timed_output/vibrator";
    mkdirs(timed);
    put(timed + "/enable", "0");
    Vibrator t(root2);
    CHECK(t.kind() == Vibrator::TimedOutput && t.run(40) && get(timed + "/enable") == "40", "vibrator: Android's timed_output");

    const std::string iio = root + "/sys/bus/iio/devices/iio:device0";
    mkdirs(iio);
    put(iio + "/in_illuminance_raw", "200\n");
    put(iio + "/in_illuminance_scale", "1.5\n");
    LightSensor l(root);
    CHECK(l.available() && l.read() == 300, "light sensor: IIO raw times scale, in lux");
    put(iio + "/in_illuminance_input", "42\n");
    CHECK(LightSensor(root).read() == 42, "light sensor: in_illuminance_input when there is one");

    // An accelerometer beside it (iio:device1), raw counts times the shared
    // scale, through its mount matrix (a panel mounted turned a quarter).
    const std::string acc = root + "/sys/bus/iio/devices/iio:device1";
    mkdirs(acc);
    put(acc + "/in_accel_x_raw", "0\n");
    put(acc + "/in_accel_y_raw", "1000\n");
    put(acc + "/in_accel_z_raw", "0\n");
    put(acc + "/in_accel_scale", "0.009806650\n");
    double ax = 0, ay = 0, az = 0;
    Accelerometer a(root);
    CHECK(a.available() && a.dir() == acc + "/" && a.read(&ax, &ay, &az) && std::fabs(ay - 9.80665) < 1e-6 && ax == 0,
          "accelerometer: IIO raw times in_accel_scale, the light sensor's device skipped");
    put(acc + "/in_accel_mount_matrix", "0, 1, 0; -1, 0, 0; 0, 0, 1\n");
    CHECK(Accelerometer(root).read(&ax, &ay, &az) && std::fabs(ax - 9.80665) < 1e-6 && std::fabs(ay) < 1e-9,
          "accelerometer: the driver's mount matrix turns it into the device's axes");
    put(acc + "/in_accel_y_scale", "0.0049033\n");
    CHECK(Accelerometer(root).read(&ax, &ay, &az) && std::fabs(ax - 4.9033) < 1e-6, "accelerometer: an axis's own scale");
    put(acc + "/in_accel_z_raw", "");
    CHECK(!Accelerometer(root).read(&ax, &ay, &az), "accelerometer: an axis it cannot read: no reading");
    put(acc + "/in_accel_z_raw", "0\n");
    CHECK(!Accelerometer(root, "iio:device0").available(), "accelerometer: device.json's device, when it is not one: none");

    put(root + "/device.json", "{\"backlight\":\"panel0\",\"ringerSwitch\":{\"type\":\"EV_SW\",\"code\":14,\"silentValue\":1}}");
    const DeviceConfig c = DeviceConfig::load(root + "/device.json");
    CHECK(c.backlight == "panel0" && c.ringerType == EV_SW && c.ringerCode == SW_MUTE_DEVICE && c.ringerSilentValue == 1,
          "device.json: the backlight and the ringer switch");
    const DeviceConfig none = DeviceConfig::load(root + "/missing.json");
    CHECK(!none.loaded && none.ringerCode == -1, "device.json: missing, no ringer switch (it cannot be found by looking)");

    struct input_event raw[4] = {};
    raw[0].type = EV_KEY; raw[0].code = KEY_VOLUMEUP; raw[0].value = 1;
    raw[1].type = EV_SYN;
    raw[2].type = EV_KEY; raw[2].code = KEY_VOLUMEUP; raw[2].value = 2;
    raw[3].type = EV_SW; raw[3].code = SW_HEADPHONE_INSERT; raw[3].value = 1;
    const auto ev = decodeInputEvents(raw, 4);
    CHECK(ev.size() == 2 && ev[0].code == KEY_VOLUMEUP && ev[1].type == EV_SW, "input: keys and switches, not syncs or repeats");
}

// ---- The service over the stand-in ----------------------------------------------------------------

static Json lastReply(LSMessage *m)
{
    const auto &r = ls2stub::replies(m);
    return r.empty() ? Json() : Json::parse(r.back());
}
static std::vector<std::string> replyField(LSMessage *m, const std::string &key)
{
    std::vector<std::string> out;
    for (const auto &r : ls2stub::replies(m)) {
        const Json j = Json::parse(r);
        if (j.has(key))
            out.push_back(j[key].isString() ? j[key].str() : r);
    }
    return out;
}

static const char *SHELL = "com.webos.surfacemanager";

static void testService()
{
    LSError err;
    LSErrorInit(&err);
    DeviceService::Handles h;
    LSRegister("com.palm.display", &h.display, &err);
    LSRegister("com.palm.keys", &h.keys, &err);
    LSRegister("com.palm.vibrate", &h.vibrate, &err);
    LSRegister("com.palm.ambientLightSensor", &h.als, &err);

    const std::string root = fakeRoot();
    const std::string bl = root + "/sys/class/backlight/panel0";
    mkdirs(bl);
    put(bl + "/max_brightness", "100");
    put(bl + "/brightness", "100");
    const std::string led = root + "/sys/class/leds/vibrator";
    mkdirs(led);
    for (const char *f : { "trigger", "activate", "duration", "state" })
        put(led + "/" + f, "0");
    Backlight backlight(root);
    Vibrator vibrator(root);
    DeviceService::Hardware hw;
    hw.backlight = &backlight;
    hw.vibrator = &vibrator;
    DeviceConfig config;
    config.ringerType = EV_SW;
    config.ringerCode = SW_MUTE_DEVICE;
    DeviceService svc(h, hw, config);
    CHECK(svc.attach(&err), "service: registers its categories");

    // The shell subscribes to the apps' requests and reports the display.
    LSMessage *shell = ls2stub::call(h.display, "/phoenix/requests", "{\"subscribe\":true}", "", SHELL);
    CHECK(lastReply(shell)["subscribed"].boolean(), "service: the shell hears the apps' requests");
    LSMessage *intruder = ls2stub::call(h.display, "/phoenix/report", "{\"state\":\"off\"}", "com.example.app");
    CHECK(!lastReply(intruder)["returnValue"].boolean(), "service: only the shell reports the display");
    ls2stub::release(intruder);

    LSMessage *pub = ls2stub::call(h.display, "status", "{\"subscribe\":true}", "com.palm.app.clock");
    LSMessage *priv = ls2stub::call(h.display, "/control/status", "{\"subscribe\":true}", "com.palm.app.clock");
    CHECK(lastReply(priv)["event"].str() == "request" && lastReply(priv)["blockDisplay"].str() == "false",
          "display: control/status answers at once");
    LSMessage *r = ls2stub::call(h.display, "/phoenix/report",
                                 "{\"state\":\"dim\",\"timeout\":30,\"brightness\":7,\"maximumBrightness\":70}", "", SHELL);
    ls2stub::release(r);
    CHECK(join(replyField(pub, "event")) == "request,displayDimmed", "display: /status hears displayDimmed");
    CHECK(join(replyField(priv, "event")) == "request,displayDimmed,changedTimeout", "display: /control/status hears changedTimeout too");
    CHECK(get(bl + "/brightness") == "7", "display: the shell's level goes to the backlight");
    r = ls2stub::call(h.display, "/phoenix/report", "{\"state\":\"off\"}", "", SHELL);
    ls2stub::release(r);
    CHECK(get(bl + "/brightness") == "0", "display: off is 0");

    // setState goes to the shell.
    r = ls2stub::call(h.display, "/control/setState", "{\"state\":\"on\"}", "com.palm.app.clock");
    CHECK(lastReply(r)["returnValue"].boolean() && lastReply(shell)["setState"].str() == "on", "display: setState goes to the shell");
    ls2stub::release(r);
    r = ls2stub::call(h.display, "/control/setState", "{\"state\":\"bright\"}", "com.palm.app.clock");
    CHECK(lastReply(r)["errorText"].str() == "call failed", "display: an unknown state fails");
    ls2stub::release(r);

    // requestBlock holds until cancelled.
    r = ls2stub::call(h.display, "/control/setProperty", "{\"requestBlock\":true}", "com.palm.app.clock");
    CHECK(lastReply(r)["errorCode"].num() == 22, "display: requestBlock needs a client");
    ls2stub::release(r);
    LSMessage *block = ls2stub::call(h.display, "/control/setProperty", "{\"requestBlock\":true,\"client\":\"clock\",\"subscribe\":true}",
                                     "com.palm.app.clock");
    CHECK(svc.holds().requestBlock == 1 && lastReply(shell)["holds"]["requestBlock"].num() == 1, "display: the shell hears the hold");
    ls2stub::cancel(h.display, block);
    CHECK(svc.holds().requestBlock == 0 && lastReply(shell)["holds"]["requestBlock"].num() == 0, "display: cancelled, let go");
    ls2stub::release(block);

    // Properties: what the shell owns goes to it; getProperty from its reports.
    r = ls2stub::call(h.display, "/control/setProperty", "{\"timeout\":0,\"maximumBrightness\":150}", "com.palm.app.settings");
    CHECK(lastReply(shell)["setProperty"]["timeout"].num() == 120 && lastReply(shell)["setProperty"]["maximumBrightness"].num() == 100,
          "display: timeout 0 is 120 s; brightness at most 100; for the shell to keep");
    ls2stub::release(r);
    r = ls2stub::call(h.display, "/control/getProperty", "{\"properties\":[\"timeout\",\"maximumBrightness\",\"requestBlock\"]}", "com.palm.app.settings");
    CHECK(lastReply(r)["timeout"].num() == 30 && lastReply(r)["maximumBrightness"].num() == 70 && !lastReply(r)["requestBlock"].boolean(),
          "display: getProperty");
    ls2stub::release(r);
    r = ls2stub::call(h.display, "/control/getProperty", "{\"properties\":[\"colour\"]}", "com.palm.app.settings");
    CHECK(lastReply(r)["errorText"].str() == "failed to get property", "display: no known property fails");
    ls2stub::release(r);

    // Power while blocked.
    LSMessage *pk = ls2stub::call(h.display, "/control/setProperty", "{\"powerKeyBlock\":true,\"client\":\"phone\",\"subscribe\":true}",
                                  "com.palm.app.phone");
    r = ls2stub::call(h.display, "/phoenix/report", "{\"powerKey\":\"released\"}", "", SHELL);
    ls2stub::release(r);
    CHECK(join(replyField(pk, "powerKey")) == "released", "display: Power goes to the app that blocks it");
    ls2stub::cancel(h.display, pk);
    ls2stub::release(pk);

    // Keys.
    r = ls2stub::call(h.keys, "/audio/status", "{}", "com.palm.app.clock");
    CHECK(lastReply(r)["errorCode"].num() == -1 && !lastReply(r)["subscribed"].boolean(), "keys: audio takes only subscriptions");
    ls2stub::release(r);
    LSMessage *audio = ls2stub::call(h.keys, "/audio/status", "{\"subscribe\":true}", "com.palm.app.clock");
    LSMessage *headset = ls2stub::call(h.keys, "/headset/status", "{\"subscribe\":true}", "com.palm.app.music");
    LSMessage *switches = ls2stub::call(h.keys, "/switches/status", "{\"subscribe\":true}", "com.palm.app.clock");
    svc.inputEvent({ EV_KEY, KEY_VOLUMEDOWN, 1 });
    svc.inputEvent({ EV_KEY, KEY_VOLUMEDOWN, 0 });
    svc.inputEvent({ EV_KEY, KEY_MEDIA, 1 });
    svc.inputEvent({ EV_KEY, KEY_MEDIA, 0 });
    svc.inputEvent({ EV_SW, SW_HEADPHONE_INSERT, 1 });
    svc.inputEvent({ EV_SW, SW_MICROPHONE_INSERT, 1 });
    svc.inputEvent({ EV_SW, SW_MUTE_DEVICE, 1 });
    svc.inputEvent({ EV_KEY, KEY_POWER, 1 });
    CHECK(join(replyField(audio, "state")) == "down,up", "keys: volume_down down and up on /audio");
    // The click before the "up" that made it (InputManager.cpp:1145, :1173).
    CHECK(join(replyField(headset, "state")) == "down,single_click,up,down,up,down",
          "keys: the headset button's click, then the headset in and with its microphone on /headset");
    CHECK(join(replyField(switches, "key")) == "ringer,power" && svc.switchState("ringer") == "down",
          "keys: the ringer switch (silent) and Power on /switches");
    CHECK(svc.headsetTimerMs() == HeadsetButton::DoublePressMs, "keys: waiting for a double click");
    svc.headsetTimeout();
    r = ls2stub::call(h.keys, "/switches/status", "{\"get\":\"headset-mic\"}", "com.palm.app.music");
    CHECK(lastReply(r)["state"].str() == "down" && lastReply(r)["key"].str() == "headset-mic", "keys: switches/status {get}");
    ls2stub::release(r);
    for (LSMessage *m : { audio, headset, switches }) {
        ls2stub::cancel(h.keys, m);
        ls2stub::release(m);
    }

    // Vibrate.
    r = ls2stub::call(h.vibrate, "vibrate", "{\"duration\":100}", "com.palm.app.clock");
    CHECK(lastReply(r)["errorText"].str() == "Invalid arguments", "vibrate: a period is needed");
    ls2stub::release(r);
    r = ls2stub::call(h.vibrate, "vibrateNamedEffect", "{\"name\":\"alert\"}", "com.palm.app.clock");
    CHECK(lastReply(r)["returnValue"].boolean() && get(led + "/duration") == "800" && get(led + "/activate") == "1",
          "vibrate: the alert effect on the motor");
    CHECK(lastReply(shell)["vibrated"]["name"].str() == "alert", "vibrate: the shell counts it");
    ls2stub::release(r);
    r = ls2stub::call(h.vibrate, "vibrateNamedEffect", "{\"name\":\"purr\"}", "com.palm.app.clock");
    CHECK(lastReply(r)["errorText"].str() == "Unable to vibrate", "vibrate: an unknown effect");
    ls2stub::release(r);
    LSMessage *endless = ls2stub::call(h.vibrate, "vibrate", "{\"period\":200,\"subscribe\":true}", "com.palm.app.phone");
    CHECK(get(led + "/duration") == "60000", "vibrate: no duration, until cancelled");
    ls2stub::cancel(h.vibrate, endless);
    CHECK(get(led + "/activate") == "0", "vibrate: cancelled, it stops");
    ls2stub::release(endless);

    // The light sensor.
    LSMessage *als = ls2stub::call(h.als, "/control/status", "{\"subscribe\":true,\"disableALS\":true}", "com.palm.app.camera");
    CHECK(lastReply(als)["disabled"].boolean() && svc.holds().alsDisabled == 1, "light: disableALS holds the sensor off");
    svc.lightReading(150);
    CHECK(lastReply(als)["current"].num() == 150 && lastReply(als)["region"].num() == 0, "light: readings go on, region undefined");
    ls2stub::cancel(h.als, als);
    CHECK(svc.holds().alsDisabled == 0, "light: let go");
    ls2stub::release(als);

    ls2stub::cancel(h.display, pub);
    ls2stub::cancel(h.display, priv);
    ls2stub::cancel(h.display, shell);
    for (LSMessage *m : { pub, priv, shell })
        ls2stub::release(m);
}

// ---- Finding the hardware, and following it as it comes and goes ---------------------------

// A fake event device: its sysfs entry (name, bus, capabilities, as the
// kernel writes them) and a FIFO for its node, so the test can write
// input_events into it and phoenix-devices reads them as from evdev.
struct FakeInput
{
    std::string name;
    int bus = BUS_HOST;
    std::vector<int> keys, sws, abs, rel, ff;
};

static std::string bitsOf(const std::vector<int> &codes)
{
    Bits b(16, 0);
    const int w = static_cast<int>(sizeof(unsigned long) * 8);
    for (int c : codes) {
        if (static_cast<size_t>(c / w) >= b.size())
            b.resize(static_cast<size_t>(c / w) + 1, 0);
        b[static_cast<size_t>(c / w)] |= 1UL << (c % w);
    }
    return formatBitmap(b);
}

static void addInput(const std::string &root, const std::string &node, const FakeInput &f)
{
    const std::string dev = root + "/sys/class/input/" + node + "/device/";
    mkdirs(dev + "capabilities");
    mkdirs(dev + "id");
    put(dev + "name", f.name + "\n");
    char bus[8];
    std::snprintf(bus, sizeof bus, "%04x", f.bus);
    put(dev + "id/bustype", std::string(bus) + "\n");
    std::vector<int> ev = { EV_SYN };
    if (!f.keys.empty()) ev.push_back(EV_KEY);
    if (!f.sws.empty()) ev.push_back(EV_SW);
    if (!f.abs.empty()) ev.push_back(EV_ABS);
    if (!f.rel.empty()) ev.push_back(EV_REL);
    if (!f.ff.empty()) ev.push_back(EV_FF);
    put(dev + "capabilities/ev", bitsOf(ev) + "\n");
    put(dev + "capabilities/key", bitsOf(f.keys) + "\n");
    put(dev + "capabilities/sw", bitsOf(f.sws) + "\n");
    put(dev + "capabilities/abs", bitsOf(f.abs) + "\n");
    put(dev + "capabilities/rel", bitsOf(f.rel) + "\n");
    put(dev + "capabilities/ff", bitsOf(f.ff) + "\n");
    mkdirs(root + "/dev/input");
    ::mkfifo((root + "/dev/input/" + node).c_str(), 0600);
}

static void removeInput(const std::string &root, const std::string &node)
{
    ::unlink((root + "/dev/input/" + node).c_str());
    const std::string cmd = "rm -rf '" + root + "/sys/class/input/" + node + "'";
    if (std::system(cmd.c_str()) != 0)
        std::printf("note: could not remove %s's sysfs\n", node.c_str());
}

// Run the main loop until done() or two seconds pass.
static bool pump(const std::function<bool()> &done)
{
    const gint64 until = g_get_monotonic_time() + 2 * G_USEC_PER_SEC;
    while (g_get_monotonic_time() < until) {
        while (g_main_context_iteration(nullptr, FALSE)) {
        }
        if (done())
            return true;
        g_usleep(2000);
    }
    return done();
}

static bool logHas(DeviceService &svc, const std::string &text)
{
    for (const auto &l : svc.log())
        if (l.find(text) != std::string::npos)
            return true;
    return false;
}

static void writeEvents(int fd, const std::vector<InputDevices::Event> &events)
{
    std::vector<struct input_event> raw;
    for (const auto &e : events) {
        struct input_event ev = {};
        ev.type = static_cast<__u16>(e.type);
        ev.code = static_cast<__u16>(e.code);
        ev.value = e.value;
        raw.push_back(ev);
    }
    struct input_event syn = {};
    syn.type = EV_SYN;
    raw.push_back(syn);
    if (::write(fd, raw.data(), raw.size() * sizeof raw[0]) < 0)
        std::printf("note: write to the fake device failed\n");
}

static const FakeInput GpioKeys{ "gpio-keys", BUS_HOST, { KEY_POWER, KEY_VOLUMEUP, KEY_VOLUMEDOWN }, { SW_MUTE_DEVICE }, {}, {}, {} };
static const FakeInput Touchscreen{ "Synaptics TM2", BUS_I2C, { BTN_TOUCH }, {}, { ABS_X, ABS_Y, ABS_MT_POSITION_X, ABS_MT_POSITION_Y }, {}, {} };
static const FakeInput Vibra{ "pm8xxx-vib", BUS_HOST, {}, {}, {}, {}, { FF_RUMBLE, FF_PERIODIC } };
static const FakeInput Jack{ "sdm845 Headset Jack", BUS_HOST, { KEY_MEDIA, KEY_VOLUMEUP }, { SW_HEADPHONE_INSERT, SW_MICROPHONE_INSERT }, {}, {}, {} };
static const FakeInput UsbHeadset{ "Jabra EVOLVE 20", BUS_USB, { KEY_PLAYPAUSE, KEY_NEXTSONG, KEY_PREVIOUSSONG, KEY_VOLUMEUP }, {}, {}, {}, {} };
static const FakeInput UsbKeyboard{ "Logitech USB Keyboard", BUS_USB,
                                   { KEY_A, KEY_Z, KEY_ENTER, KEY_VOLUMEUP, KEY_VOLUMEDOWN, KEY_PLAYPAUSE }, {}, {}, {}, {} };

static void testBitmapsAndUevents()
{
    Bits b = parseBitmap("1 0");
    CHECK(testBit(b, static_cast<int>(sizeof(unsigned long) * 8)) && !testBit(b, 0), "sysfs bitmap: words highest first");
    CHECK(formatBitmap(parseBitmap(bitsOf({ KEY_POWER, KEY_VOLUMEUP, KEY_PLAYPAUSE }))) == bitsOf({ KEY_POWER, KEY_VOLUMEUP, KEY_PLAYPAUSE })
          && testBit(parseBitmap(bitsOf({ KEY_PLAYPAUSE })), KEY_PLAYPAUSE) && !testBit(parseBitmap("0"), 5),
          "sysfs bitmap: read back as written");

    const char add[] = "add@/devices/platform/usb/1-1/input/input9/event9\0ACTION=add\0DEVPATH=/devices/platform/usb/1-1/input/input9/event9\0"
                       "SUBSYSTEM=input\0MAJOR=13\0MINOR=73\0DEVNAME=input/event9\0SEQNUM=2101";
    Uevent e;
    CHECK(parseUevent(add, sizeof add, &e) && e.action == "add" && e.subsystem == "input" && e.devname == "input/event9" && ueventMatters(e),
          "uevent: an input device added");
    const char iio[] = "add@/devices/i2c/iio:device1\0ACTION=add\0SUBSYSTEM=iio\0";
    CHECK(parseUevent(iio, sizeof iio, &e) && ueventMatters(e), "uevent: an IIO sensor matters (sysfs has no inotify)");
    const char net[] = "add@/devices/virtual/net/wlan0\0ACTION=add\0SUBSYSTEM=net\0";
    CHECK(parseUevent(net, sizeof net, &e) && !ueventMatters(e), "uevent: a network device does not");
    const char udev[] = "libudev\0\xfe\xed\xca\xfe";
    CHECK(!parseUevent(udev, sizeof udev, &e), "uevent: udev's own messages are not the kernel's");
}

static void testProbe()
{
    const std::string root = fakeRoot();
    addInput(root, "event0", GpioKeys);
    addInput(root, "event1", Touchscreen);
    addInput(root, "event2", Vibra);
    addInput(root, "event10", Jack);
    const DeviceConfig config = DeviceConfig::load(root + "/etc/phoenix/device.json");

    const auto inputs = listInputs(root);
    std::vector<std::string> nodes;
    for (const auto &i : inputs)
        nodes.push_back(i.node);
    CHECK(join(nodes) == "event0,event1,event2,event10", "probe: every event device, in the kernel's order");
    CHECK(inputs[0].fromSysfs && inputs[0].name == "gpio-keys" && inputs[0].busName() == "host" && inputs[1].busName() == "i2c",
          "probe: names and buses from sysfs");
    CHECK(inputs[0].wanted(config) && !inputs[1].wanted(config) && !inputs[2].wanted(config) && inputs[3].wanted(config),
          "probe: keys and switches used; the touchscreen and the motor are not input for it");
    CHECK(inputs[0].summary(config) == "keys volume_up, volume_down, power; switches mute (SW_MUTE_DEVICE; the ringer? see device.json)",
          "probe: a mute switch is pointed out, not taken for the ringer");
    DeviceConfig withRinger;
    withRinger.ringerType = EV_SW;
    withRinger.ringerCode = SW_MUTE_DEVICE;
    CHECK(inputs[0].summary(withRinger) == "keys volume_up, volume_down, power; switches ringer (EV_SW 14)",
          "probe: the ringer device.json names");
    CHECK(inputs[1].summary(config) == "touchscreen", "probe: a touchscreen says so");
    CHECK(inputs[3].summary(config) == "keys volume_up, headset_button; switches headphone jack, microphone jack",
          "probe: the headset jack and its button");
    CHECK(Vibrator::find(root).kind == Vibrator::ForceFeedback && Vibrator::find(root).path == root + "/dev/input/event2",
          "probe: the force-feedback vibrator by its capabilities");

    InputDevices in(root, config);
    CHECK(join(in.opened()) == root + "/dev/input/event0," + root + "/dev/input/event10", "input: opens only what it reads");
    CHECK(in.hasCode(EV_SW, SW_HEADPHONE_INSERT) && in.hasCode(EV_KEY, KEY_POWER) && !in.hasCode(EV_KEY, KEY_NEXTSONG),
          "input: knows what its devices have");

    // --probe, as the service's own main runs it.
    const std::string report = probeReport(root, root + "/etc/phoenix/device.json");
    CHECK(report.find("device.json " + root + "/etc/phoenix/device.json: none (everything found by looking)") != std::string::npos,
          "--probe: no device.json needed");
    CHECK(report.find("  " + root + "/dev/input/event0 \"gpio-keys\" (host): keys volume_up, volume_down, power; "
                      "switches mute (SW_MUTE_DEVICE; the ringer? see device.json) [used]\n") != std::string::npos,
          "--probe: the keys, with what it uses");
    CHECK(report.find("  " + root + "/dev/input/event1 \"Synaptics TM2\" (i2c): touchscreen [not used]\n") != std::string::npos,
          "--probe: and what it does not");
    CHECK(report.find("vibrator: force feedback (EV_FF, FF_RUMBLE) " + root + "/dev/input/event2\n") != std::string::npos
              && report.find("headset jack: yes, with its microphone\n") != std::string::npos
              && report.find("ringer switch: none in device.json; SW_MUTE_DEVICE on event0 may be it: \"ringerSwitch\": "
                             "{\"type\": \"EV_SW\", \"code\": 14, \"silentValue\": 1}\n") != std::string::npos
              && report.find("backlight: none\n") != std::string::npos
              && report.find("hotplug: inotify on " + root + "/dev/input; no kernel uevents") != std::string::npos,
          "--probe: the vibrator, the jack, a hint for the ringer, no backlight, how it hears changes");
    CHECK(get(root + "/sys/class/input/event2/device/name") == "pm8xxx-vib\n", "--probe: touches nothing");

#ifdef PHOENIX_DEVICES_STUB
    gchar *out = nullptr;
    gint status = -1;
    gchar *argv[] = { const_cast<gchar *>(PHOENIX_DEVICES_STUB), const_cast<gchar *>("--probe"), nullptr };
    gchar **envp = g_get_environ();
    envp = g_environ_setenv(envp, "PHOENIX_DEVICES_ROOT", root.c_str(), TRUE);
    envp = g_environ_setenv(envp, "PHOENIX_DEVICE_CONFIG", (root + "/etc/phoenix/device.json").c_str(), TRUE);
    const bool ran = g_spawn_sync(nullptr, argv, envp, G_SPAWN_DEFAULT, nullptr, nullptr, &out, nullptr, &status, nullptr);
    CHECK(ran && g_spawn_check_wait_status(status, nullptr) && out && report == out, "phoenix-devices --probe prints the report and exits");
    g_free(out);
    g_strfreev(envp);
#endif
}

static void testHotplug()
{
    LSError err;
    LSErrorInit(&err);
    DeviceService::Handles h;
    LSRegister("com.palm.display", &h.display, &err);
    LSRegister("com.palm.keys", &h.keys, &err);
    LSRegister("com.palm.vibrate", &h.vibrate, &err);
    LSRegister("com.palm.ambientLightSensor", &h.als, &err);

    const std::string root = fakeRoot();
    addInput(root, "event0", GpioKeys);
    mkdirs(root + "/etc/phoenix");
    put(root + "/etc/phoenix/device.json", "{\"ringerSwitch\":{\"type\":\"EV_SW\",\"code\":14,\"silentValue\":1}}");
    const DeviceConfig config = DeviceConfig::load(root + "/etc/phoenix/device.json");
    DeviceProbe probe(root, config);
    HotplugMonitor monitor(root, false);
    DeviceService::Hardware hw;
    hw.input = probe.input.get();
    DeviceService svc(h, hw, config);
    svc.attach(&err);
    svc.attachProbe(&probe, &monitor);
    CHECK(logHas(svc, "input " + root + "/dev/input/event0 \"gpio-keys\" (host): keys volume_up, volume_down, power; switches ringer (EV_SW 14) [used]")
              && logHas(svc, "backlight none") && logHas(svc, "hotplug: inotify on " + root + "/dev/input"),
          "hotplug: what it found at start-up is in the log");

    LSMessage *headset = ls2stub::call(h.keys, "/headset/status", "{\"subscribe\":true}", "com.palm.app.music");
    LSMessage *media = ls2stub::call(h.keys, "/media/status", "{\"subscribe\":true}", "com.palm.app.music");
    LSMessage *audio = ls2stub::call(h.keys, "/audio/status", "{\"subscribe\":true}", "com.palm.app.music");

    // A headset jack's driver comes up after start-up (event3).
    addInput(root, "event3", Jack);
    CHECK(pump([&] { return logHas(svc, "input added " + root + "/dev/input/event3"); }),
          "hotplug: a new event device is found (inotify on /dev/input)");
    CHECK(logHas(svc, "input added " + root + "/dev/input/event3 \"sdm845 Headset Jack\" (host): keys volume_up, headset_button; "
                      "switches headphone jack, microphone jack [used]"),
          "hotplug: and logged with what it can do");
    const int jack = ::open((root + "/dev/input/event3").c_str(), O_WRONLY | O_NONBLOCK);
    // Plugged in: the jack and the microphone in one report, one headset-mic.
    writeEvents(jack, { { EV_SW, SW_HEADPHONE_INSERT, 1 }, { EV_SW, SW_MICROPHONE_INSERT, 1 } });
    CHECK(pump([&] { return !replyField(headset, "key").empty(); }) && pump([&] { return false; }) == false
              && replyField(headset, "state").size() == 1 && lastReply(headset)["key"].str() == "headset-mic"
              && lastReply(headset)["state"].str() == "down",
          "hotplug: its headset in, with the microphone, is one headset-mic down");
    writeEvents(jack, { { EV_KEY, KEY_MEDIA, 1 } });
    writeEvents(jack, { { EV_KEY, KEY_MEDIA, 0 } });
    CHECK(pump([&] { return join(replyField(headset, "state")) == "down,down,single_click,up"; }),
          "hotplug: its button clicks");

    // A USB headset with play/pause, next and previous, and a keyboard.
    addInput(root, "event4", UsbHeadset);
    addInput(root, "event5", UsbKeyboard);
    CHECK(pump([&] { return logHas(svc, "input added " + root + "/dev/input/event5"); })
              && logHas(svc, "\"Jabra EVOLVE 20\" (usb): keys volume_up, togglePausePlay, next, prev [used]")
              && logHas(svc, "\"Logitech USB Keyboard\" (usb): keys volume_up, volume_down, togglePausePlay; keyboard [used]"),
          "hotplug: a USB headset and a USB keyboard, with their media keys");
    const int usb = ::open((root + "/dev/input/event4").c_str(), O_WRONLY | O_NONBLOCK);
    writeEvents(usb, { { EV_KEY, KEY_NEXTSONG, 1 } });
    writeEvents(usb, { { EV_KEY, KEY_NEXTSONG, 0 } });
    CHECK(pump([&] { return join(replyField(media, "key")) == "next,next"; }), "hotplug: the USB headset's next key on /media");

    // Unplugged: the devices go; the jack's switches with them.
    removeInput(root, "event3");
    CHECK(pump([&] { return logHas(svc, "input removed " + root + "/dev/input/event3"); }), "hotplug: a device that goes is let go");
    CHECK(lastReply(headset)["key"].str() == "headset-mic" && lastReply(headset)["state"].str() == "up",
          "hotplug: the jack gone, the headset is out");
    removeInput(root, "event4");
    CHECK(pump([&] { return logHas(svc, "input removed " + root + "/dev/input/event4"); })
              && probe.input->opened().size() == 2, "hotplug: the USB headset gone, the built-in keys and the keyboard stay");
    ::close(jack);
    ::close(usb);
    // The keyboard's volume key still reaches /audio.
    const int kb = ::open((root + "/dev/input/event5").c_str(), O_WRONLY | O_NONBLOCK);
    writeEvents(kb, { { EV_KEY, KEY_VOLUMEUP, 1 } });
    CHECK(pump([&] { return join(replyField(audio, "key")) == "volume_up"; }), "hotplug: the devices that stay still work");

    // The same node for another device (removed and added before the rescan).
    ::close(kb);
    removeInput(root, "event5");
    addInput(root, "event5", UsbHeadset);
    CHECK(pump([&] { return logHas(svc, "input added " + root + "/dev/input/event5 \"Jabra EVOLVE 20\""); })
              && logHas(svc, "input removed " + root + "/dev/input/event5 \"Logitech USB Keyboard\""),
          "hotplug: another device on the same node is a new device");

    // A sensor and a backlight whose drivers load late (kernel uevents on a
    // device; here the rescan they cause).
    const std::string iio = root + "/sys/bus/iio/devices/iio:device0";
    mkdirs(iio);
    put(iio + "/in_illuminance_input", "250\n");
    const std::string bl = root + "/sys/class/backlight/panel0";
    mkdirs(bl);
    put(bl + "/max_brightness", "200\n");
    put(bl + "/brightness", "0");
    LSMessage *r = ls2stub::call(h.display, "/phoenix/report", "{\"state\":\"on\",\"brightness\":40}", "", SHELL);
    ls2stub::release(r);
    const DeviceProbe::Changes c = svc.rescan();
    CHECK(c.lightSensor && c.backlight && svc.lightSensorOn() && logHas(svc, "light sensor " + iio + "/in_illuminance_input")
              && logHas(svc, "backlight " + bl),
          "hotplug: a light sensor and a backlight that appear are used");
    CHECK(get(bl + "/brightness") == "80", "hotplug: the new backlight gets the display's level");
    CHECK(!svc.rescan().any(), "hotplug: nothing changed, nothing to do");
    const std::string cmd = "rm -rf '" + iio + "'";
    if (std::system(cmd.c_str()) != 0)
        std::printf("note: could not remove the sensor\n");
    CHECK(svc.rescan().lightSensor && !svc.lightSensorOn(), "hotplug: the sensor gone, it stops reading");

    for (LSMessage *m : { headset, media, audio }) {
        ls2stub::cancel(h.keys, m);
        ls2stub::release(m);
    }
}

// com.palm.display/phoenix/orientation: the shell's, the sensor read while
// the display is on.
static void testOrientationService()
{
    LSError err;
    LSErrorInit(&err);
    DeviceService::Handles h;
    LSRegister("com.palm.display", &h.display, &err);
    LSRegister("com.palm.keys", &h.keys, &err);
    LSRegister("com.palm.vibrate", &h.vibrate, &err);
    LSRegister("com.palm.ambientLightSensor", &h.als, &err);
    const std::string root = fakeRoot();
    const std::string acc = root + "/sys/bus/iio/devices/iio:device0";
    mkdirs(acc);
    put(acc + "/in_accel_x_raw", "0");
    put(acc + "/in_accel_y_raw", "981");
    put(acc + "/in_accel_z_raw", "0");
    put(acc + "/in_accel_scale", "0.01");
    Accelerometer accel(root);
    DeviceService::Hardware hw;
    hw.accelerometer = &accel;
    DeviceService svc(h, hw, DeviceConfig());
    CHECK(svc.attach(&err), "orientation: the service registers");
    LSMessage *app = ls2stub::call(h.display, "/phoenix/orientation", "{\"subscribe\":true}", "com.example.app");
    CHECK(!lastReply(app)["returnValue"].boolean(), "orientation: only the shell");
    ls2stub::release(app);
    LSMessage *shell = ls2stub::call(h.display, "/phoenix/orientation", "{\"subscribe\":true}", "", SHELL);
    CHECK(lastReply(shell)["subscribed"].boolean() && !lastReply(shell).has("orientation"),
          "orientation: the shell subscribes; nothing read yet");
    CHECK(svc.accelerometerOn(), "orientation: the sensor reads with the display on");
    CHECK(pump([&] { return svc.orientation() == "up"; }) && lastReply(shell)["orientation"].str() == "up",
          "orientation: held upright, the shell hears up");
    const size_t heard = ls2stub::replies(shell).size();
    svc.accelReading(9.8, 0, 0);
    CHECK(lastReply(shell)["orientation"].str() == "left", "orientation: turned, the shell hears left");
    svc.accelReading(9.8, 0.1, 0);
    CHECK(ls2stub::replies(shell).size() == heard + 1, "orientation: only changes are posted");
    LSMessage *r = ls2stub::call(h.display, "/phoenix/report", "{\"state\":\"dim\"}", "", SHELL);
    ls2stub::release(r);
    CHECK(!svc.accelerometerOn(), "orientation: dimmed, the sensor stops (TurnOffAccelerometerWhenDimmed)");
    r = ls2stub::call(h.display, "/phoenix/report", "{\"state\":\"on\"}", "", SHELL);
    ls2stub::release(r);
    CHECK(svc.accelerometerOn(), "orientation: on again, it reads again");
    ls2stub::release(shell);
}

// ---- com.palm.power: the battery from the kernel's power supplies -------------------

static void testPower()
{
    LSError err;
    LSErrorInit(&err);
    DeviceService::Handles h;
    LSRegister("com.palm.display", &h.display, &err);
    LSRegister("com.palm.keys", &h.keys, &err);
    LSRegister("com.palm.vibrate", &h.vibrate, &err);
    LSRegister("com.palm.ambientLightSensor", &h.als, &err);
    LSRegister("com.palm.power", &h.power, &err);

    const std::string root = fakeRoot();
    const std::string bat = root + "/sys/class/power_supply/BAT0";
    const std::string usb = root + "/sys/class/power_supply/usb";
    mkdirs(bat);
    mkdirs(usb);
    put(bat + "/type", "Battery");
    put(bat + "/capacity", "76");
    put(bat + "/status", "Discharging");
    put(bat + "/temp", "312");
    put(bat + "/current_now", "-250000");
    put(bat + "/voltage_now", "3900000");
    put(bat + "/charge_full", "1150000");
    put(usb + "/type", "USB");
    put(usb + "/online", "0");
    put(usb + "/usb_type", "Unknown SDP [DCP] CDP");

    PowerSupplies supplies(root);
    const PowerSupplies::Status st = supplies.read();
    CHECK(st.present && st.percent == 76 && !st.charging && st.charger == "none" && st.temperatureC > 31.1 && st.temperatureC < 31.3
          && st.currentmA == -250 && st.voltagemV == 3900 && st.capacitymAh == 1150,
          "power: the battery from the power supply class");

    std::vector<std::string> machine;
    DeviceService::Hardware hw;
    hw.power = &supplies;
    hw.machine = [&machine](const std::string &a) { machine.push_back(a); return true; };
    DeviceService svc(h, hw, DeviceConfig());
    svc.setShutdownDelayMs(0);
    CHECK(svc.attach(&err), "power: com.palm.power registers its categories");

    LSMessage *q = ls2stub::call(h.power, "/com/palm/power/batteryStatusQuery", "{}", "com.palm.systemui");
    const Json b = lastReply(q);
    CHECK(b["returnValue"].boolean() && b["percent"].num() == 76 && b["percent_ui"].num() == 76 && b["temperature_C"].num() == 31
          && b["capacity_mAh"].num() == 1150, "power: batteryStatusQuery, powerd's payload");
    ls2stub::release(q);
    std::vector<std::string> &sig = ls2stub::signals(h.power);
    CHECK(!sig.empty() && sig.back().compare(0, 52, "luna://com.palm.power/com/palm/power/batteryStatus {") == 0,
          "power: and the batteryStatus signal luna-systemui listens to");
    q = ls2stub::call(h.power, "/com/palm/power/chargerStatusQuery", "{}", "com.palm.systemui");
    CHECK(!lastReply(q)["Connected"].boolean() && lastReply(q)["type"].str() == "none", "power: no charger");
    ls2stub::release(q);

    // A wall charger in: the charger's signal, then the battery's.
    sig.clear();
    put(usb + "/online", "1");
    put(bat + "/status", "Charging");
    CHECK(svc.readPower(), "power: a change is seen");
    CHECK(sig.size() == 2 && sig[0].find("/USBDockStatus") != std::string::npos
          && Json::parse(sig[0].substr(sig[0].find(' ') + 1))["type"].str() == "wall"
          && Json::parse(sig[0].substr(sig[0].find(' ') + 1))["Charging"].boolean(),
          "power: USBDockStatus says a wall charger");
    CHECK(!svc.readPower() && sig.size() == 2, "power: nothing new, no signal");
    put(usb + "/usb_type", "Unknown [SDP] DCP");
    svc.readPower();
    CHECK(Json::parse(sig.back().substr(sig.back().find(' ') + 1))["percent"].num() == 76
          && Json::parse(sig[2].substr(sig[2].find(' ') + 1))["type"].str() == "pc", "power: a computer's port is \"pc\"");

    // Off: the shell first, then the machine.
    LSMessage *shell = ls2stub::call(h.display, "/phoenix/requests", "{\"subscribe\":true}", "", SHELL);
    LSMessage *off = ls2stub::call(h.power, "/shutdown/machineOff", "{\"reason\":\"power menu\"}", "com.palm.systemui");
    CHECK(lastReply(off)["returnValue"].boolean(), "power: machineOff answers");
    CHECK(lastReply(shell)["shutdown"]["reason"].str() == "power menu", "power: the shell hears of the shutdown first");
    CHECK(machine.empty(), "power: the machine waits for the shell");
    g_main_context_iteration(nullptr, TRUE);
    CHECK(machine.size() == 1 && machine[0] == "off", "power: then it goes off");
    ls2stub::release(off);
    ls2stub::release(shell);
    LSMessage *t = ls2stub::call(h.power, "/timeout/set", "{\"key\":\"k\"}", "com.palm.app.clock");
    CHECK(!lastReply(t)["returnValue"].boolean(), "power: timeouts point to the activity manager");
    ls2stub::release(t);
}

int main()
{
    testDisplayEvents();
    testHeadsetButton();
    testLightRegions();
    testOrientation();
    testHardware();
    testService();
    testOrientationService();
    testBitmapsAndUevents();
    testProbe();
    testHotplug();
    testPower();
    std::printf("%d checks, %d failed\n", checks, failures);
    return failures ? 1 : 0;
}
