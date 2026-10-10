// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// phoenix-devices: LunaSysMgr's device services on webOS OSE's bus, which
// has none of them (docs/HARDWARE.md), for the apps of webOS 1-3 and
// Phoenix's (apps/shared/luna/src/device.ts):
//
//   com.palm.display    /status; /control/status, setState, getProperty,
//                       setProperty (DisplayManager.cpp)
//   com.palm.keys       /audio/status, /media/status, /headset/status,
//                       /switches/status (InputManager.cpp)
//   com.palm.vibrate    /vibrate, /vibrateNamedEffect (HapticsController.cpp)
//   com.palm.ambientLightSensor  /control/status (AmbientLightSensor.cpp)
//   com.palm.power      /com/palm/power/batteryStatusQuery, chargerStatusQuery
//                       and their signals batteryStatus, USBDockStatus;
//                       /shutdown/machineOff, machineReboot (powerd's, which
//                       OSE does not have: the battery from the kernel's
//                       power supply class, hardware.h PowerSupplies)
//
// with the replies and events luna-sysmgr sent (devicecore.h). The display
// itself is the shell's (Phoenix.Shell Display.qml): it reports its state
// to com.palm.display/phoenix/report and hears what the apps ask on
// com.palm.display/phoenix/requests {subscribe: true}:
//
//   report {state, timeout, blockDisplay, active, dockMode, brightness,
//           maximumBrightness, onWhenConnected}     (any of them)
//   report {powerKey: "released"}                   Power while an app blocks it
//   report {mediaKey: "play" | "pause" | ...}        a media key the system presses (the Assistant)
//   orientation {subscribe} -> {orientation: "up" | "down" | "left" | "right" |
//               "faceup" | "facedown"}   the accelerometer's, while the display is on
//   requests -> {holds: {requestBlock, powerKeyBlock, proximity, alsDisabled}}
//            -> {setState: "on" | "dimmed" | "off" | "unlock" | "dock" | "undock"}
//            -> {setProperty: {timeout?, maximumBrightness?, onWhenConnected?}}
//            -> {vibrated: {name? | period, duration}}   (for the shell's count)
//
// Only the shell (its service name, com.webos.surfacemanager by default)
// may call /phoenix. The service sets the backlight from the reports and
// reads the keys, switches, motor and light sensor itself (hardware.h),
// following them as they come and go (attachProbe: a headset, keyboard or
// dock plugged in or out, a sensor's driver loaded late).

#pragma once

#include <glib.h>
#include <luna-service2/lunaservice.h>

#include <functional>

#include <map>
#include <memory>
#include <string>
#include <vector>

#include "devicecore.h"
#include "hardware.h"

namespace phoenix {
namespace devices {

class DeviceService
{
public:
    struct Handles
    {
        LSHandle *display = nullptr;
        LSHandle *keys = nullptr;
        LSHandle *vibrate = nullptr;
        LSHandle *als = nullptr;
        LSHandle *power = nullptr;      // com.palm.power (optional)
    };
    // The hardware may be missing (nullptr), as in the tests.
    struct Hardware
    {
        Backlight *backlight = nullptr;
        Vibrator *vibrator = nullptr;
        LightSensor *lightSensor = nullptr;
        Accelerometer *accelerometer = nullptr;
        InputDevices *input = nullptr;
        PowerSupplies *power = nullptr;
        // Turns the device off or restarts it ("off", "reboot"); main.cpp's
        // runs systemctl. Called after the shell had its moment.
        std::function<bool(const std::string &)> machine;
    };

    DeviceService(const Handles &handles, const Hardware &hardware, const DeviceConfig &config);
    ~DeviceService();

    bool attach(LSError *error);

    // Who may call com.palm.display/phoenix (service names).
    void setShellNames(const std::vector<std::string> &names) { m_shellNames = names; }

    // From the hardware (the input watches; the tests call them too). One
    // read's events go together: a headset plugged in reports its jack and
    // its microphone at once, and that is one "headset-mic" down, as
    // luna-sysmgr's single Key_HeadsetMic event was.
    void inputEvent(const InputDevices::Event &e);
    void inputEvents(const std::vector<InputDevices::Event> &events);
    void headsetTimeout();
    void lightReading(int lux);
    // A reading of the accelerometer (m/s^2): the orientation to the shell
    // when it changes.
    void accelReading(double x, double y, double z);
    // Read the switches' states now (at start, and after the input devices
    // changed): what changed goes to the subscribers. A switch no device
    // has any more is off (a USB headset's jack unplugged with it).
    void readSwitches();

    // Keep to the hardware as it comes and goes (main.cpp): watch the
    // probe's input devices and the hotplug monitor on the GLib main
    // context; on a hotplug event, rescan() (once per burst, when idle).
    void attachProbe(DeviceProbe *probe, HotplugMonitor *monitor);
    // The battery and chargers read again: when they changed, powerd's
    // signals (batteryStatus, USBDockStatus) go out. main.cpp calls it every
    // 15 s and on a power supply's uevent; true when something changed.
    bool readPower();
    const PowerSupplies::Status &power() const { return m_supply; }
    // The delay between telling the shell of a shutdown and doing it.
    void setShutdownDelayMs(int ms) { m_shutdownDelayMs = ms; }

    // Re-probe now: log what changed, follow it (watches, switches, the
    // backlight's level, the light sensor), and return it.
    DeviceProbe::Changes rescan();
    // A line to the log (stderr; tests read it).
    std::vector<std::string> &log() { return m_log; }

    // State, for the tests.
    const DisplayReport &display() const { return m_display; }
    const Holds &holds() const { return m_holds; }
    int lightRegion() const { return m_light.region(); }
    bool lightSensorOn() const { return m_alsOn; }
    bool accelerometerOn() const { return m_accelOn; }
    const std::string &orientation() const { return m_orientation.orientation(); }
    std::string switchState(const std::string &name) const;
    int headsetTimerMs() const { return m_headset.timerMs(); }

    static bool onDisplayStatus(LSHandle *sh, LSMessage *msg, void *ctx);
    static bool onControlStatus(LSHandle *sh, LSMessage *msg, void *ctx);
    static bool onSetState(LSHandle *sh, LSMessage *msg, void *ctx);
    static bool onGetProperty(LSHandle *sh, LSMessage *msg, void *ctx);
    static bool onSetProperty(LSHandle *sh, LSMessage *msg, void *ctx);
    static bool onShellReport(LSHandle *sh, LSMessage *msg, void *ctx);
    static bool onShellRequests(LSHandle *sh, LSMessage *msg, void *ctx);
    static bool onShellOrientation(LSHandle *sh, LSMessage *msg, void *ctx);
    static bool onAudioStatus(LSHandle *sh, LSMessage *msg, void *ctx);
    static bool onMediaStatus(LSHandle *sh, LSMessage *msg, void *ctx);
    static bool onHeadsetStatus(LSHandle *sh, LSMessage *msg, void *ctx);
    static bool onSwitchesStatus(LSHandle *sh, LSMessage *msg, void *ctx);
    static bool onVibrate(LSHandle *sh, LSMessage *msg, void *ctx);
    static bool onVibrateNamedEffect(LSHandle *sh, LSMessage *msg, void *ctx);
    static bool onAlsStatus(LSHandle *sh, LSMessage *msg, void *ctx);
    static bool onBatteryStatusQuery(LSHandle *sh, LSMessage *msg, void *ctx);
    static bool onChargerStatusQuery(LSHandle *sh, LSMessage *msg, void *ctx);
    static bool onPowerActivity(LSHandle *sh, LSMessage *msg, void *ctx);
    static bool onMachineOff(LSHandle *sh, LSMessage *msg, void *ctx);
    static bool onMachineReboot(LSHandle *sh, LSMessage *msg, void *ctx);
    static bool onPowerTimeout(LSHandle *sh, LSMessage *msg, void *ctx);
    static bool onCancel(LSHandle *sh, LSMessage *msg, void *ctx);

private:
    enum Kind { DisplayStatus, ShellRequests, Hold, KeyStatus, Vibration, AlsStatus, Orientation };
    struct Sub
    {
        Kind kind;
        LSHandle *handle;
        LSMessage *msg;
        std::string token;
        bool isPublic = false;            // DisplayStatus: /status, not /control/status
        std::string category;             // KeyStatus: "/audio", ...
        Holds holds;                      // Hold: what this call holds
        bool alsDisable = false;          // AlsStatus with disableALS
        int effectMs = 0;                 // Vibration: a continuous named effect's length
        guint timer = 0;                  // Vibration: its repeat
    };

    void reply(LSHandle *sh, LSMessage *msg, const std::string &json);
    void addSub(Sub s);
    void post(Kind kind, const std::string &json, const std::string &category = std::string(), bool publicToo = true);
    void toShell(const std::string &json);
    void sumHolds();
    bool fromShell(LSMessage *msg) const;
    void setSwitch(const std::string &name, const std::string &state, const std::string &category);
    // "headset-mic", "headset" or "" from the jack's switches.
    std::string headsetNow() const;
    // Post the headset's change since was (headsetNow() before it).
    void postHeadset(const std::string &was);
    void say(const std::string &line);
    void watchInputs();
    static gboolean inputReady(gint fd, GIOCondition cond, gpointer self);
    static gboolean hotplugReady(gint fd, GIOCondition cond, gpointer self);
    static gboolean rescanIdle(gpointer self);
    void alsFollowDisplay();
    void startHeadsetTimer();
    static gboolean headsetTimerFired(gpointer self);
    static gboolean lightTimerFired(gpointer self);
    void accelFollowDisplay();
    static gboolean accelTimerFired(gpointer self);
    static gboolean vibrationRepeat(gpointer data);
    void stopVibrationIfIdle();
    std::string batteryJson() const;
    std::string chargerJson() const;
    void signal(const char *uri, const std::string &json);
    void shutdown(LSHandle *sh, LSMessage *msg, const char *action);
    static gboolean shutdownNow(gpointer self);

    Handles m_h;
    Hardware m_hw;
    DeviceConfig m_config;
    std::vector<std::string> m_shellNames{ "com.webos.surfacemanager" };
    std::vector<std::unique_ptr<Sub>> m_subs;
    DisplayReport m_display;
    int m_maximumBrightness = 100;
    bool m_onWhenConnected = false;
    Holds m_holds;
    HeadsetButton m_headset;
    guint m_headsetTimer = 0;
    LightRegions m_light;
    bool m_alsOn = false;
    guint m_lightTimer = 0;
    OrientationFilter m_orientation;
    bool m_accelOn = false;
    guint m_accelTimer = 0;
    std::string m_ringer = "up", m_headsetJack = "up", m_headsetMic = "up", m_power = "up";
    bool m_headphoneIn = false, m_micIn = false;

    DeviceProbe *m_probe = nullptr;
    HotplugMonitor *m_monitor = nullptr;
    std::map<int, guint> m_inputWatches;      // fd -> source
    std::vector<guint> m_hotplugWatches;
    guint m_rescanIdle = 0;
    std::vector<std::string> m_log;
    PowerSupplies::Status m_supply;
    std::string m_pendingMachine;
    guint m_shutdownTimer = 0;
    int m_shutdownDelayMs = 4500;   // the shutdown sound (sim.qml offDelay: 4.2 s)
};

} // namespace devices
} // namespace phoenix
