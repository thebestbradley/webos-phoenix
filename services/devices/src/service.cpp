// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

#include "service.h"

#include "json.h"

#include <algorithm>
#include <cstdio>

namespace phoenix {
namespace devices {

static const char *boolStr(bool b) { return b ? "true" : "false"; }

DeviceService::DeviceService(const Handles &handles, const Hardware &hardware, const DeviceConfig &config)
    : m_h(handles), m_hw(hardware), m_config(config)
{
}

DeviceService::~DeviceService()
{
    if (m_headsetTimer)
        g_source_remove(m_headsetTimer);
    if (m_lightTimer)
        g_source_remove(m_lightTimer);
    for (auto &s : m_subs) {
        if (s->timer)
            g_source_remove(s->timer);
        LSMessageUnref(s->msg);
    }
    if (m_hw.vibrator)
        m_hw.vibrator->stop();
}

bool DeviceService::attach(LSError *error)
{
    static LSMethod displayPublic[] = {
        { "status", &DeviceService::onDisplayStatus, LUNA_METHOD_FLAGS_NONE },
        {},
    };
    static LSMethod displayControl[] = {
        { "status", &DeviceService::onControlStatus, LUNA_METHOD_FLAGS_NONE },
        { "setState", &DeviceService::onSetState, LUNA_METHOD_FLAGS_NONE },
        { "getProperty", &DeviceService::onGetProperty, LUNA_METHOD_FLAGS_NONE },
        { "setProperty", &DeviceService::onSetProperty, LUNA_METHOD_FLAGS_NONE },
        {},
    };
    static LSMethod displayShell[] = {
        { "report", &DeviceService::onShellReport, LUNA_METHOD_FLAGS_NONE },
        { "requests", &DeviceService::onShellRequests, LUNA_METHOD_FLAGS_NONE },
        {},
    };
    static LSMethod audio[] = { { "status", &DeviceService::onAudioStatus, LUNA_METHOD_FLAGS_NONE }, {} };
    static LSMethod media[] = { { "status", &DeviceService::onMediaStatus, LUNA_METHOD_FLAGS_NONE }, {} };
    static LSMethod headset[] = { { "status", &DeviceService::onHeadsetStatus, LUNA_METHOD_FLAGS_NONE }, {} };
    static LSMethod switches[] = { { "status", &DeviceService::onSwitchesStatus, LUNA_METHOD_FLAGS_NONE }, {} };
    static LSMethod vibrate[] = {
        { "vibrate", &DeviceService::onVibrate, LUNA_METHOD_FLAGS_NONE },
        { "vibrateNamedEffect", &DeviceService::onVibrateNamedEffect, LUNA_METHOD_FLAGS_NONE },
        {},
    };
    static LSMethod als[] = { { "status", &DeviceService::onAlsStatus, LUNA_METHOD_FLAGS_NONE }, {} };

    struct Category { LSHandle *h; const char *name; LSMethod *methods; };
    const Category categories[] = {
        { m_h.display, "/", displayPublic }, { m_h.display, "/control", displayControl }, { m_h.display, "/phoenix", displayShell },
        { m_h.keys, "/audio", audio }, { m_h.keys, "/media", media }, { m_h.keys, "/headset", headset }, { m_h.keys, "/switches", switches },
        { m_h.vibrate, "/", vibrate }, { m_h.als, "/control", als },
    };
    for (const auto &c : categories) {
        if (!LSRegisterCategory(c.h, c.name, c.methods, nullptr, nullptr, error) || !LSCategorySetData(c.h, c.name, this, error))
            return false;
    }
    for (LSHandle *h : { m_h.display, m_h.keys, m_h.vibrate, m_h.als })
        if (!LSSubscriptionSetCancelFunction(h, &DeviceService::onCancel, this, error))
            return false;
    readSwitches();
    alsFollowDisplay();
    return true;
}

// ---- Plumbing ----------------------------------------------------------------------

void DeviceService::reply(LSHandle *sh, LSMessage *msg, const std::string &json)
{
    LSError err;
    LSErrorInit(&err);
    if (!LSMessageReply(sh, msg, json.c_str(), &err)) {
        LSErrorPrint(&err, stderr);
        LSErrorFree(&err);
    }
}

void DeviceService::addSub(Sub s)
{
    LSMessageRef(s.msg);
    s.token = LSMessageGetUniqueToken(s.msg) ? LSMessageGetUniqueToken(s.msg) : "";
    LSError err;
    LSErrorInit(&err);
    // Ours to keep and answer; luna-service2 calls onCancel when the caller goes.
    if (!LSSubscriptionAdd(s.handle, "phoenix-devices", s.msg, &err))
        LSErrorFree(&err);
    m_subs.push_back(std::unique_ptr<Sub>(new Sub(s)));
}

// To every subscription of a kind (a display event to /control/status, and
// to /status when publicToo; a key to its category's).
void DeviceService::post(Kind kind, const std::string &json, const std::string &category, bool publicToo)
{
    for (auto &s : m_subs) {
        if (s->kind != kind)
            continue;
        if (kind == DisplayStatus && s->isPublic && !publicToo)
            continue;
        if (kind == KeyStatus && s->category != category)
            continue;
        reply(s->handle, s->msg, json);
    }
}

void DeviceService::toShell(const std::string &json)
{
    post(ShellRequests, json);
}

bool DeviceService::fromShell(LSMessage *msg) const
{
    const char *name = LSMessageGetSenderServiceName(msg);
    return name && std::find(m_shellNames.begin(), m_shellNames.end(), std::string(name)) != m_shellNames.end();
}

void DeviceService::sumHolds()
{
    Holds sum;
    for (auto &s : m_subs) {
        if (s->kind == Hold) {
            sum.requestBlock += s->holds.requestBlock;
            sum.powerKeyBlock += s->holds.powerKeyBlock;
            sum.proximity += s->holds.proximity;
        } else if (s->kind == AlsStatus && s->alsDisable) {
            ++sum.alsDisabled;
        }
    }
    if (sum == m_holds)
        return;
    const bool alsChanged = sum.alsDisabled != m_holds.alsDisabled;
    m_holds = sum;
    toShell("{\"returnValue\":true,\"holds\":" + holdsJson(m_holds) + "}");
    if (alsChanged)
        lightReading(m_light.current());
}

bool DeviceService::onCancel(LSHandle *, LSMessage *msg, void *ctx)
{
    auto *self = static_cast<DeviceService *>(ctx);
    const std::string token = LSMessageGetUniqueToken(msg) ? LSMessageGetUniqueToken(msg) : "";
    bool vibration = false;
    for (auto it = self->m_subs.begin(); it != self->m_subs.end(); ++it) {
        if ((*it)->token != token)
            continue;
        vibration = (*it)->kind == Vibration;
        if ((*it)->timer)
            g_source_remove((*it)->timer);
        LSMessageUnref((*it)->msg);
        self->m_subs.erase(it);
        break;
    }
    self->sumHolds();
    if (vibration)
        self->stopVibrationIfIdle();
    return true;
}

// ---- com.palm.display ------------------------------------------------------------------

bool DeviceService::onDisplayStatus(LSHandle *sh, LSMessage *msg, void *ctx)
{
    auto *self = static_cast<DeviceService *>(ctx);
    const bool subscribed = LSMessageIsSubscription(msg);
    self->reply(sh, msg, displayStatusJson(self->m_display, true, subscribed));
    if (subscribed) {
        Sub s{ DisplayStatus, sh, msg };
        s.isPublic = true;
        self->addSub(s);
    }
    return true;
}

bool DeviceService::onControlStatus(LSHandle *sh, LSMessage *msg, void *ctx)
{
    auto *self = static_cast<DeviceService *>(ctx);
    const bool subscribed = LSMessageIsSubscription(msg);
    self->reply(sh, msg, displayStatusJson(self->m_display, false, subscribed));
    if (subscribed)
        self->addSub(Sub{ DisplayStatus, sh, msg });
    return true;
}

// controlSetState (:1225-1308): the shell's display does it.
bool DeviceService::onSetState(LSHandle *sh, LSMessage *msg, void *ctx)
{
    auto *self = static_cast<DeviceService *>(ctx);
    const std::string state = Json::parse(LSMessageGetPayload(msg))["state"].str();
    if (!isDisplayStateRequest(state)) {
        self->reply(sh, msg, "{\"returnValue\":false,\"errorText\":\"call failed\"}");
        return true;
    }
    self->toShell("{\"returnValue\":true,\"setState\":" + jsonQuote(state) + "}");
    self->reply(sh, msg, "{\"returnValue\":true}");
    return true;
}

// controlGetProperty (:1633-1712).
bool DeviceService::onGetProperty(LSHandle *sh, LSMessage *msg, void *ctx)
{
    auto *self = static_cast<DeviceService *>(ctx);
    const Json p = Json::parse(LSMessageGetPayload(msg));
    std::string out = "{\"returnValue\":true";
    bool any = false;
    for (const Json &item : p["properties"].items()) {
        const std::string name = item.str();
        std::string v;
        if (name == "requestBlock") v = boolStr(self->m_display.blockDisplay);
        else if (name == "powerKeyBlock") v = boolStr(self->m_holds.powerKeyBlock > 0);
        else if (name == "timeout") v = std::to_string(self->m_display.timeout);
        else if (name == "maximumBrightness") v = std::to_string(self->m_maximumBrightness);
        else if (name == "onWhenConnected") v = boolStr(self->m_onWhenConnected);
        else if (name == "proximityEnabled") v = boolStr(self->m_holds.proximity > 0);
        else continue;
        out += ",\"" + name + "\":" + v;
        any = true;
    }
    self->reply(sh, msg, any ? out + "}" : "{\"returnValue\":false,\"errorCode\":1,\"errorText\":\"failed to get property\"}");
    return true;
}

// controlSetProperty (:1796-1990), in its order: an error stops there.
bool DeviceService::onSetProperty(LSHandle *sh, LSMessage *msg, void *ctx)
{
    auto *self = static_cast<DeviceService *>(ctx);
    const Json p = Json::parse(LSMessageGetPayload(msg));
    const bool hasClient = !p["client"].str().empty();
    auto needsClient = [&](const char *key) {
        self->reply(sh, msg, std::string("{\"returnValue\":false,\"errorCode\":22,\"errorText\":\"'") + key + "' needs 'client' string\"}");
        return true;
    };
    Sub hold{ Hold, sh, msg };
    if (p["requestBlock"].boolean()) {
        if (!hasClient)
            return needsClient("requestBlock");
        hold.holds.requestBlock = 1;
    }
    if (p["powerKeyBlock"].boolean()) {
        if (!hasClient) {
            if (hold.holds.requestBlock)
                self->addSub(hold), self->sumHolds();
            return needsClient("powerKeyBlock");
        }
        hold.holds.powerKeyBlock = 1;
    }
    std::string props;
    if (p["timeout"].isNumber() && p["timeout"].num() != -1) {
        // DisplayManager::setTimeout (:1550-1563): 0 or less is 120 s.
        const int t = static_cast<int>(p["timeout"].num());
        props += ",\"timeout\":" + std::to_string(t > 0 ? t : 120);
    }
    if (p["onWhenConnected"].isBool()) {
        self->m_onWhenConnected = p["onWhenConnected"].boolean();
        props += std::string(",\"onWhenConnected\":") + boolStr(self->m_onWhenConnected);
    }
    if (p["maximumBrightness"].isNumber()) {
        const int b = std::max(1, std::min(100, static_cast<int>(p["maximumBrightness"].num())));
        props += ",\"maximumBrightness\":" + std::to_string(b);
    }
    if (!props.empty())
        self->toShell("{\"returnValue\":true,\"setProperty\":{" + props.substr(1) + "}}");
    if (p["proximityEnabled"].boolean()) {
        if (!hasClient) {
            if (hold.holds.requestBlock || hold.holds.powerKeyBlock)
                self->addSub(hold), self->sumHolds();
            return needsClient("proximityEnabled");
        }
        hold.holds.proximity = 1;
    }
    if (hold.holds.requestBlock || hold.holds.powerKeyBlock || hold.holds.proximity) {
        self->addSub(hold);
        self->sumHolds();
    }
    self->reply(sh, msg, "{\"returnValue\":true}");
    return true;
}

bool DeviceService::onShellReport(LSHandle *sh, LSMessage *msg, void *ctx)
{
    auto *self = static_cast<DeviceService *>(ctx);
    if (!self->fromShell(msg)) {
        self->reply(sh, msg, "{\"returnValue\":false,\"errorCode\":-1,\"errorText\":\"Only the shell reports the display\"}");
        return true;
    }
    const Json p = Json::parse(LSMessageGetPayload(msg));
    DisplayReport next = self->m_display;
    const std::string state = p["state"].str();
    if (state == "on" || state == "off")
        next.state = state;
    else if (state == "dim" || state == "dimmed")
        next.state = "dimmed";
    if (p["timeout"].isNumber())
        next.timeout = static_cast<int>(p["timeout"].num());
    if (p["blockDisplay"].isBool())
        next.blockDisplay = p["blockDisplay"].boolean();
    if (p["active"].isBool())
        next.active = p["active"].boolean();
    if (p["dockMode"].isBool())
        next.dockMode = p["dockMode"].boolean();
    if (p["brightness"].isNumber())
        next.brightness = std::max(0, std::min(100, static_cast<int>(p["brightness"].num())));
    if (p["maximumBrightness"].isNumber())
        self->m_maximumBrightness = static_cast<int>(p["maximumBrightness"].num());
    if (p["onWhenConnected"].isBool())
        self->m_onWhenConnected = p["onWhenConnected"].boolean();
    const DisplayReport before = self->m_display;
    self->m_display = next;
    for (const auto &e : displayEvents(before, next))
        self->post(DisplayStatus, e.json, std::string(), e.isPublic);
    if (self->m_hw.backlight && (next.brightness != before.brightness || next.state != before.state))
        self->m_hw.backlight->setPercent(next.state == "off" ? 0 : next.brightness);
    if (next.state != before.state)
        self->alsFollowDisplay();
    // The Power key while an app blocks it (DisplayManager :2463-2476).
    if (p["powerKey"].str() == "released") {
        for (auto &s : self->m_subs)
            if (s->kind == Hold && s->holds.powerKeyBlock)
                self->reply(s->handle, s->msg, "{\"powerKey\":\"released\"}");
    }
    self->reply(sh, msg, "{\"returnValue\":true}");
    return true;
}

bool DeviceService::onShellRequests(LSHandle *sh, LSMessage *msg, void *ctx)
{
    auto *self = static_cast<DeviceService *>(ctx);
    if (!self->fromShell(msg)) {
        self->reply(sh, msg, "{\"returnValue\":false,\"errorCode\":-1,\"errorText\":\"Only the shell takes the display's requests\"}");
        return true;
    }
    const bool subscribed = LSMessageIsSubscription(msg);
    self->reply(sh, msg, "{\"returnValue\":true,\"subscribed\":" + std::string(boolStr(subscribed)) + ",\"holds\":"
                + holdsJson(self->m_holds) + "}");
    if (subscribed)
        self->addSub(Sub{ ShellRequests, sh, msg });
    return true;
}

// ---- com.palm.keys ----------------------------------------------------------------------

// processSubscription (:333-370): /audio, /media and /headset only take
// subscriptions (so does /switches, besides {get}).
bool DeviceService::onAudioStatus(LSHandle *sh, LSMessage *msg, void *ctx)
{
    auto *self = static_cast<DeviceService *>(ctx);
    if (!LSMessageIsSubscription(msg)) {
        self->reply(sh, msg, "{\"errorCode\":-1,\"errorText\":\"We were expecting a subscribe type message, but we did not recieve one.\","
                             "\"returnValue\":false,\"subscribed\":false}");
        return true;
    }
    self->reply(sh, msg, "{\"returnValue\":true,\"subscribed\":true}");
    Sub s{ KeyStatus, sh, msg };
    s.category = LSMessageGetCategory(msg) ? LSMessageGetCategory(msg) : "/audio";
    self->addSub(s);
    return true;
}

bool DeviceService::onMediaStatus(LSHandle *sh, LSMessage *msg, void *ctx) { return onAudioStatus(sh, msg, ctx); }
bool DeviceService::onHeadsetStatus(LSHandle *sh, LSMessage *msg, void *ctx) { return onAudioStatus(sh, msg, ctx); }

// switchesStatusCallback (:640-650): a subscription, or {get: name}
// (processKeyState, :371-428).
bool DeviceService::onSwitchesStatus(LSHandle *sh, LSMessage *msg, void *ctx)
{
    auto *self = static_cast<DeviceService *>(ctx);
    if (LSMessageIsSubscription(msg))
        return onAudioStatus(sh, msg, ctx);
    const Json p = Json::parse(LSMessageGetPayload(msg));
    if (!p["get"].isString()) {
        self->reply(sh, msg, "{\"returnValue\":false}");
        return true;
    }
    const std::string key = p["get"].str();
    self->reply(sh, msg, "{\"key\":" + jsonQuote(key) + ",\"state\":" + jsonQuote(self->switchState(key)) + ",\"returnValue\":true}");
    return true;
}

std::string DeviceService::switchState(const std::string &name) const
{
    if (name == "ringer") return m_ringer;
    // No slider: closed, as the emulator reported (InputManager.cpp:779-781).
    if (name == "slider") return "down";
    if (name == "headset") return m_headsetJack;
    if (name == "headset-mic") return m_headsetMic;
    if (name == "power") return m_power;
    return "unknown";
}

void DeviceService::setSwitch(const std::string &name, const std::string &state, const std::string &category)
{
    std::string *slot = name == "ringer" ? &m_ringer : name == "headset" ? &m_headsetJack
                      : name == "headset-mic" ? &m_headsetMic : name == "power" ? &m_power : nullptr;
    if (slot && *slot == state && name != "power")
        return;
    if (slot)
        *slot = state;
    post(KeyStatus, keyJson(name, state), category);
}

void DeviceService::readSwitches()
{
    if (!m_hw.input)
        return;
    const int hp = m_hw.input->switchState(EV_SW, SW_HEADPHONE_INSERT);
    const int mic = m_hw.input->switchState(EV_SW, SW_MICROPHONE_INSERT);
    m_headphoneIn = hp == 1;
    m_micIn = mic == 1;
    m_headsetMic = m_headphoneIn && m_micIn ? "down" : "up";
    m_headsetJack = m_headphoneIn && !m_micIn ? "down" : "up";
    if (m_config.ringerCode >= 0) {
        const int v = m_hw.input->switchState(m_config.ringerType, m_config.ringerCode);
        if (v >= 0)
            m_ringer = v == m_config.ringerSilentValue ? "down" : "up";
    }
}

void DeviceService::inputEvent(const InputDevices::Event &e)
{
    // The ringer switch, wherever the device has it (device.json).
    if (m_config.ringerCode >= 0 && e.type == m_config.ringerType && e.code == m_config.ringerCode) {
        setSwitch("ringer", e.value == m_config.ringerSilentValue ? "down" : "up", "/switches");
        return;
    }
    if (e.type == EV_SW && (e.code == SW_HEADPHONE_INSERT || e.code == SW_MICROPHONE_INSERT)) {
        // A headset in is Key_Headset or Key_HeadsetMic down (:784-795), on /headset.
        const std::string was = m_headsetMic == "down" ? "headset-mic" : m_headsetJack == "down" ? "headset" : "";
        if (e.code == SW_HEADPHONE_INSERT)
            m_headphoneIn = e.value != 0;
        else
            m_micIn = e.value != 0;
        const std::string now = !m_headphoneIn ? "" : m_micIn ? "headset-mic" : "headset";
        if (now == was)
            return;
        if (!was.empty())
            setSwitch(was, "up", "/headset");
        if (!now.empty())
            setSwitch(now, "down", "/headset");
        return;
    }
    if (e.type != EV_KEY)
        return;
    KeyName k;
    if (!keyForCode(e.code, &k))
        return;
    const std::string state = e.value ? "down" : "up";
    if (k.category == "/switches") {
        setSwitch(k.name, state, k.category);
        return;
    }
    post(KeyStatus, keyJson(k.name, state), k.category);
    if (k.name == "headset_button") {
        for (const auto &extra : m_headset.press(e.value != 0))
            post(KeyStatus, keyJson(k.name, extra), k.category);
        startHeadsetTimer();
    }
}

void DeviceService::startHeadsetTimer()
{
    if (m_headsetTimer) {
        g_source_remove(m_headsetTimer);
        m_headsetTimer = 0;
    }
    if (m_headset.timerMs() > 0)
        m_headsetTimer = g_timeout_add(static_cast<guint>(m_headset.timerMs()), &DeviceService::headsetTimerFired, this);
}

gboolean DeviceService::headsetTimerFired(gpointer self)
{
    auto *s = static_cast<DeviceService *>(self);
    s->m_headsetTimer = 0;
    s->headsetTimeout();
    return G_SOURCE_REMOVE;
}

void DeviceService::headsetTimeout()
{
    for (const auto &extra : m_headset.timeout())
        post(KeyStatus, keyJson("headset_button", extra), "/headset");
    startHeadsetTimer();
}

// ---- com.palm.vibrate --------------------------------------------------------------------------

static const char *UnableToVibrate = "{\"returnValue\":false,\"errorText\":\"Unable to vibrate\"}";
static const char *InvalidArguments = "{\"returnValue\":false,\"errorText\":\"Invalid arguments\"}";

// cbVibrate (:117-181): a period is needed; no duration, until cancelled.
bool DeviceService::onVibrate(LSHandle *sh, LSMessage *msg, void *ctx)
{
    auto *self = static_cast<DeviceService *>(ctx);
    const Json p = Json::parse(LSMessageGetPayload(msg));
    if (!p["period"].isNumber()) {
        self->reply(sh, msg, InvalidArguments);
        return true;
    }
    const int period = static_cast<int>(p["period"].num());
    const int duration = static_cast<int>(p["duration"].num(0));
    if (!self->m_hw.vibrator || !self->m_hw.vibrator->run(duration)) {
        self->reply(sh, msg, UnableToVibrate);
        return true;
    }
    if (duration == 0)
        self->addSub(Sub{ Vibration, sh, msg });
    self->toShell("{\"returnValue\":true,\"vibrated\":{\"period\":" + std::to_string(period) + ",\"duration\":"
                  + std::to_string(duration) + "}}");
    self->reply(sh, msg, "{\"returnValue\":true}");
    return true;
}

// cbVibrateNamedEffect (:236-307): continous, again until cancelled.
bool DeviceService::onVibrateNamedEffect(LSHandle *sh, LSMessage *msg, void *ctx)
{
    auto *self = static_cast<DeviceService *>(ctx);
    const Json p = Json::parse(LSMessageGetPayload(msg));
    if (!p["name"].isString()) {
        self->reply(sh, msg, InvalidArguments);
        return true;
    }
    int ms = 0;
    if (!effectLength(p["name"].str(), &ms) || !self->m_hw.vibrator || !self->m_hw.vibrator->run(ms)) {
        self->reply(sh, msg, UnableToVibrate);
        return true;
    }
    if (p["continous"].boolean()) {
        Sub s{ Vibration, sh, msg };
        s.effectMs = ms;
        self->addSub(s);
        Sub *added = self->m_subs.back().get();
        struct Ctx { DeviceService *self; Sub *sub; };
        added->timer = g_timeout_add(static_cast<guint>(ms * 2), &DeviceService::vibrationRepeat, new Ctx{ self, added });
    }
    self->toShell("{\"returnValue\":true,\"vibrated\":{\"name\":" + jsonQuote(p["name"].str()) + "}}");
    self->reply(sh, msg, "{\"returnValue\":true}");
    return true;
}

gboolean DeviceService::vibrationRepeat(gpointer data)
{
    struct Ctx { DeviceService *self; Sub *sub; };
    auto *c = static_cast<Ctx *>(data);
    for (auto &s : c->self->m_subs) {
        if (s.get() == c->sub) {
            if (c->self->m_hw.vibrator)
                c->self->m_hw.vibrator->run(s->effectMs);
            return G_SOURCE_CONTINUE;
        }
    }
    delete c;
    return G_SOURCE_REMOVE;
}

void DeviceService::stopVibrationIfIdle()
{
    for (auto &s : m_subs)
        if (s->kind == Vibration)
            return;
    if (m_hw.vibrator)
        m_hw.vibrator->stop();
}

// ---- com.palm.ambientLightSensor -------------------------------------------------------------------

// controlStatus (:518-570): the reading; subscribed, every reading after it;
// disableALS holds the region at undefined while the subscription lasts.
bool DeviceService::onAlsStatus(LSHandle *sh, LSMessage *msg, void *ctx)
{
    auto *self = static_cast<DeviceService *>(ctx);
    const Json p = Json::parse(LSMessageGetPayload(msg));
    const bool subscribed = LSMessageIsSubscription(msg);
    Sub s{ AlsStatus, sh, msg };
    s.alsDisable = subscribed && p["disableALS"].boolean();
    if (subscribed) {
        self->addSub(s);
        self->sumHolds();
        self->alsFollowDisplay();
    }
    self->reply(sh, msg, "{\"returnValue\":true,\"current\":" + std::to_string(self->m_light.current()) + ",\"average\":"
                + std::to_string(self->m_light.average()) + ",\"disabled\":" + boolStr(self->m_holds.alsDisabled > 0)
                + ",\"subscribed\":" + boolStr(subscribed) + "}");
    return true;
}

void DeviceService::lightReading(int lux)
{
    m_light.update(lux, m_holds.alsDisabled > 0);
    post(AlsStatus, "{\"returnValue\":true,\"current\":" + std::to_string(m_light.current()) + ",\"region\":"
                    + std::to_string(m_light.region()) + "}");
}

// The sensor reads while the display is on (AmbientLightSensor::start /
// stop from displayOn / displayDim / displayOff, DisplayManager :3516-3575).
void DeviceService::alsFollowDisplay()
{
    const bool on = m_hw.lightSensor && m_hw.lightSensor->available() && m_display.state == "on";
    if (on == m_alsOn)
        return;
    m_alsOn = on;
    if (on) {
        m_light.start();
        m_lightTimer = g_timeout_add(500, &DeviceService::lightTimerFired, this);
    } else if (m_lightTimer) {
        g_source_remove(m_lightTimer);
        m_lightTimer = 0;
    }
}

gboolean DeviceService::lightTimerFired(gpointer self)
{
    auto *s = static_cast<DeviceService *>(self);
    if (!s->m_hw.lightSensor)
        return G_SOURCE_REMOVE;
    const int lux = s->m_hw.lightSensor->read();
    if (lux >= 0)
        s->lightReading(lux);
    return G_SOURCE_CONTINUE;
}

} // namespace devices
} // namespace phoenix
