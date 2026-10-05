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

#include <cstdio>
#include <fstream>
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

    put(root + "/device.json", "{\"backlight\":\"panel0\",\"ringerSwitch\":{\"type\":\"EV_SW\",\"code\":14,\"silentValue\":1}}");
    const DeviceConfig c = DeviceConfig::load(root + "/device.json");
    CHECK(c.backlight == "panel0" && c.ringerType == EV_SW && c.ringerCode == SW_MUTE_DEVICE && c.ringerSilentValue == 1,
          "device.json: the backlight and the ringer switch");
    CHECK(DeviceConfig::load(root + "/missing.json").ringerCode == -1, "device.json: missing, no ringer switch");

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
    CHECK(join(replyField(headset, "state")) == "down,up,single_click,down,up,down",
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

int main()
{
    testDisplayEvents();
    testHeadsetButton();
    testLightRegions();
    testHardware();
    testService();
    std::printf("%d checks, %d failed\n", checks, failures);
    return failures ? 1 : 0;
}
