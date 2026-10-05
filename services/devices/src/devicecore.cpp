// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

#include "devicecore.h"

#include "json.h"

#include <linux/input-event-codes.h>

#include <algorithm>
#include <climits>

namespace phoenix {
namespace devices {

static const char *boolStr(bool b) { return b ? "true" : "false"; }

std::string holdsJson(const Holds &h)
{
    return "{\"requestBlock\":" + std::to_string(h.requestBlock) + ",\"powerKeyBlock\":" + std::to_string(h.powerKeyBlock)
        + ",\"proximity\":" + std::to_string(h.proximity) + ",\"alsDisabled\":" + std::to_string(h.alsDisabled) + "}";
}

std::vector<DisplayEvent> displayEvents(const DisplayReport &before, const DisplayReport &after)
{
    std::vector<DisplayEvent> out;
    auto event = [&](const std::string &name, const std::string &extra, bool isPublic) {
        out.push_back({ "{\"returnValue\":true,\"event\":\"" + name + "\"" + extra + "}", isPublic });
    };
    if (after.state != before.state || (after.state == "on" && after.dockMode != before.dockMode)) {
        if (after.state == "on")
            event("displayOn", after.dockMode ? ",\"dockMode\":true" : "", true);
        else
            event(after.state == "dimmed" ? "displayDimmed" : "displayOff", "", true);
    }
    if (after.timeout != before.timeout)
        event("changedTimeout", ",\"timeout\":" + std::to_string(after.timeout), false);
    if (after.blockDisplay != before.blockDisplay)
        event(after.blockDisplay ? "blockedDisplay" : "unblockedDisplay", "", false);
    if (after.active != before.active)
        event(after.active ? "displayActive" : "displayInactive", "", false);
    return out;
}

std::string displayStatusJson(const DisplayReport &d, bool isPublic, bool subscribed)
{
    if (isPublic)
        return "{\"returnValue\":true,\"event\":\"request\",\"state\":" + jsonQuote(d.state) + ",\"subscribed\":"
            + boolStr(subscribed) + "}";
    return "{\"returnValue\":true,\"event\":\"request\",\"state\":" + jsonQuote(d.state) + ",\"timeout\":"
        + std::to_string(d.timeout) + ",\"blockDisplay\":\"" + boolStr(d.blockDisplay) + "\",\"active\":"
        + boolStr(d.active) + ",\"subscribed\":" + boolStr(subscribed) + "}";
}

bool isDisplayStateRequest(const std::string &s)
{
    return s == "on" || s == "dimmed" || s == "off" || s == "unlock" || s == "dock" || s == "undock";
}

bool keyForCode(int code, KeyName *out)
{
    switch (code) {
    case KEY_VOLUMEUP: *out = { "/audio", "volume_up" }; return true;
    case KEY_VOLUMEDOWN: *out = { "/audio", "volume_down" }; return true;
    case KEY_POWER: *out = { "/switches", "power" }; return true;
    case KEY_PLAYCD: *out = { "/media", "play" }; return true;
    case KEY_PAUSECD: *out = { "/media", "pause" }; return true;
    case KEY_PLAYPAUSE: *out = { "/media", "togglePausePlay" }; return true;
    case KEY_STOPCD: *out = { "/media", "stop" }; return true;
    case KEY_NEXTSONG: *out = { "/media", "next" }; return true;
    case KEY_PREVIOUSSONG: *out = { "/media", "prev" }; return true;
    // A wired headset's one button: Linux's jack drivers (and Android's
    // headset convention) report it as KEY_MEDIA.
    case KEY_MEDIA: *out = { "/headset", "headset_button" }; return true;
    default: return false;
    }
}

std::string keyJson(const std::string &key, const std::string &state)
{
    return "{\"key\":" + jsonQuote(key) + ",\"state\":" + jsonQuote(state) + "}";
}

std::vector<std::string> HeadsetButton::press(bool down)
{
    std::vector<std::string> out;
    switch (m_state) {
    case Start:
        // An up here is ignored: held at start-up.
        if (down) {
            m_state = SinglePressOrHold;
            m_timer = PressAndHoldMs;
        }
        break;
    case SinglePressOrHold:
        if (!down) {
            out.push_back("single_click");
            m_state = PotentialDoublePress;
            m_timer = DoublePressMs;
        }
        break;
    case Hold:
        if (!down) {
            m_timer = 0;
            m_state = Start;
        }
        break;
    case PotentialDoublePress:
        if (down) {
            m_state = DoublePressOrHold;
            m_timer = PressAndHoldMs;
        }
        break;
    case DoublePressOrHold:
        if (!down) {
            m_timer = 0;
            out.push_back("double_click");
            m_state = Start;
        }
        break;
    }
    return out;
}

std::vector<std::string> HeadsetButton::timeout()
{
    std::vector<std::string> out;
    m_timer = 0;
    if (m_state == PotentialDoublePress) {
        m_state = Start;
    } else if (m_state == SinglePressOrHold || m_state == DoublePressOrHold) {
        out.push_back("hold");
        m_state = Hold;
    }
    return out;
}

bool effectLength(const std::string &name, int *ms)
{
    static const struct { const char *name; int ms; } effects[] = {
        { "ringtone", 1500 }, { "alert", 800 }, { "notification", 300 }, { "tapdown", 40 }, { "tapup", 40 },
    };
    for (const auto &e : effects)
        if (name == e.name) {
            *ms = e.ms;
            return true;
        }
    return false;
}

void LightRegions::start()
{
    m_samples.clear();
    m_sum = 0;
    m_count = 0;
    m_region = 3;   // ALS_REGION_INDOOR
}

bool LightRegions::update(int lux, bool disabled)
{
    static const int border[] = { -1, 6, 100, 1000, INT_MAX };
    static const int margin[] = { 0, 4, 10, 100, 0 };
    const int before = m_region;
    m_current = lux;
    if (disabled) {
        m_region = 0;
        return m_region != before;
    }
    if (lux < 0)
        return false;
    if (m_region < 1 || m_region > 4)
        m_region = 3;
    m_samples.push_back(lux);
    m_sum += lux;
    if (static_cast<int>(m_samples.size()) > SampleSize) {
        m_sum -= m_samples.front();
        m_samples.erase(m_samples.begin());
    }
    m_count = static_cast<int>(m_samples.size());
    // The region is estimated once there are enough readings.
    if (m_count == SampleSize) {
        const int avg = m_sum / SampleSize;
        while (m_region > 1 && avg < border[m_region - 1] - margin[m_region - 1])
            --m_region;
        while (m_region < 4 && avg > border[m_region] + margin[m_region])
            ++m_region;
    }
    return m_region != before;
}

int backlightRaw(int percent, int maxRaw)
{
    if (maxRaw <= 0)
        return 0;
    percent = std::max(0, std::min(100, percent));
    if (percent == 0)
        return 0;
    return std::max(1, (percent * maxRaw + 50) / 100);
}

} // namespace devices
} // namespace phoenix
