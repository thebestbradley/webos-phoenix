// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// phoenix-devices' logic, without a bus or a device: what LunaSysMgr's
// DisplayManager, InputManager, HapticsController and AmbientLightSensor
// answered and sent (openwebos/luna-sysmgr Src/base/, cited per function),
// so it can be tested anywhere. service.cpp puts it on the bus and
// hardware.cpp drives the device.

#pragma once

#include <string>
#include <vector>

namespace phoenix {
namespace devices {

// ---- com.palm.display ----------------------------------------------------------

// The display as the shell reports it (Phoenix.Shell Display.qml, through
// LsmWindowSource): state "on", "dimmed" or "off"; timeout in seconds;
// something keeping it on; the inactivity timer running; dock mode; the
// backlight's level 0-100.
struct DisplayReport
{
    std::string state = "on";
    int timeout = 120;
    bool blockDisplay = false;
    bool active = true;
    bool dockMode = false;
    int brightness = 100;
};

// What the apps hold, summed over every subscription (DisplayManager's
// m_dnast, m_blockedPowerKey, m_proximityCount; AmbientLightSensor's
// m_alsDisabled).
struct Holds
{
    int requestBlock = 0;
    int powerKeyBlock = 0;
    int proximity = 0;
    int alsDisabled = 0;
    bool operator==(const Holds &o) const
    {
        return requestBlock == o.requestBlock && powerKeyBlock == o.powerKeyBlock && proximity == o.proximity
            && alsDisabled == o.alsDisabled;
    }
};
std::string holdsJson(const Holds &h);

// One event for the subscribers: the public bus gets only the display's
// own (DisplayManager::notifySubscribers, :1453-1534).
struct DisplayEvent
{
    std::string json;
    bool isPublic;
};
// The events from one report to the next, in luna-sysmgr's words.
std::vector<DisplayEvent> displayEvents(const DisplayReport &before, const DisplayReport &after);
// control/status and /status (controlStatus, :2296-2357).
std::string displayStatusJson(const DisplayReport &d, bool isPublic, bool subscribed);
// A setState state luna-sysmgr knew (:1259-1295).
bool isDisplayStateRequest(const std::string &state);

// ---- com.palm.keys ---------------------------------------------------------------

// A key or switch's category and name (InputManager.cpp:43-70, keyToString
// :876-955), from its Linux input event code: EV_KEY codes for the
// volume, power and media keys and the headset's button.
struct KeyName
{
    std::string category;   // "/audio", "/media", "/switches", "/headset"
    std::string name;       // "volume_up", "togglePausePlay", "power", "headset_button", ...
};
bool keyForCode(int code, KeyName *out);
std::string keyJson(const std::string &key, const std::string &state);

// The headset's button (InputManager::headsetStateMachine, :225-330):
// down / up go out as they are; from them single_click, double_click or
// hold. press() and timeout() return the extra states to post; timerMs()
// is how long until timeout() is due (0: no timer).
class HeadsetButton
{
public:
    static const int PressAndHoldMs = 2000;   // PRESS_AND_HOLD_TIME_MS
    static const int DoublePressMs = 1000;    // DOUBLE_PRESS_TIME_MS

    std::vector<std::string> press(bool down);
    std::vector<std::string> timeout();
    int timerMs() const { return m_timer; }

private:
    enum State { Start, SinglePressOrHold, Hold, PotentialDoublePress, DoublePressOrHold };
    State m_state = Start;
    int m_timer = 0;
};

// ---- com.palm.vibrate ---------------------------------------------------------------

// HapticsControllerCastle's named effects (:85-97) and how long Phoenix
// runs each (the Castle's were its haptics driver's).
bool effectLength(const std::string &name, int *ms);

// ---- com.palm.ambientLightSensor --------------------------------------------------------

// The light's region from the sensor's readings (AmbientLightSensor::
// updateAls, :290-415): the average of the last 10 readings, borders at 6,
// 100 and 1000 lux with margins of 4, 10 and 100 (:113-129), starting
// indoor when the sensor comes on (:195). Regions: 0 undefined, 1 dark,
// 2 dim, 3 indoor, 4 outdoor.
class LightRegions
{
public:
    static const int SampleSize = 10;    // ALS_SAMPLE_SIZE
    void start();                        // the sensor came on
    // A reading; returns whether the region changed. disabled: an app
    // holds the sensor off (disableALS), the region is undefined.
    bool update(int lux, bool disabled);
    int region() const { return m_region; }
    int current() const { return m_current; }
    int average() const { return m_count ? m_sum / m_count : 0; }

private:
    int m_region = 0;
    int m_current = 0;
    int m_sum = 0;
    int m_count = 0;
    std::vector<int> m_samples;
};

// ---- The orientation sensor ----------------------------------------------------------------

// How the device is held, from the accelerometer: what LunaSysMgr got from
// nyx's orientation sensor (NYXOrientationSensorConnector, luna-sysmgr-common
// Src/base/hosts/HostArm.cpp:755-791) as OrientationEvent's Orientation:
// "up", "down", "left" (turned counter-clockwise: its right edge up),
// "right", "faceup", "facedown". nyx's own rules (the Pre's sensor module)
// were not released, so these are Phoenix's: the reading in the device's
// axes (IIO's: x to the right, y up, z out of the screen; held upright, y
// reads +g), a reading far from 1 g (shaken, falling) is ignored; lying
// within ~30 degrees of flat (|z| over 0.87 g) is face up or down; else
// the edge most up, changing only once the tilt is 15 degrees past the
// diagonal between two edges, so it does not flicker there. The shell
// waits for it to settle before turning (UiRotation, 200 ms).
class OrientationFilter
{
public:
    // A reading in m/s^2 (any unit works: only the ratios count, with g
    // taken as 9.80665). Returns whether the orientation changed.
    bool update(double x, double y, double z);
    const std::string &orientation() const { return m_orientation; }
    void reset() { m_orientation.clear(); }

private:
    std::string m_orientation;     // "" until the first good reading
};
std::string orientationJson(const std::string &orientation, bool subscribed);

// ---- The backlight ----------------------------------------------------------------------

// The sysfs brightness for a level 0-100 on a panel of maxRaw steps: at
// least 1 while on (MINIMUM_ON_BRIGHTNESS, DisplayManager.cpp:98).
int backlightRaw(int percent, int maxRaw);

} // namespace devices
} // namespace phoenix
