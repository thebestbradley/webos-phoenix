// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Which popup alert shows first: luna-sysmgr's notification policy
// (conf/notificationPolicy.conf, read by NotificationPolicy.cpp) and its
// queue (DashboardWindowManager::addAlertWindowBasedOnPriority). A lower
// number is more urgent; alerts not listed are 1000 and queue in order.
// Pure functions, so both window sources and tests can use them.

.pragma library

// notificationPolicy.conf "popupalert", in order: [appId, window name].
// An empty name matches any window of the app.
var POPUP_ALERT = [
    ["com.palm.app.phone", "incoming-phoneapp"],
    ["com.palm.app.phone", "incoming-known"],
    ["com.palm.app.phone", "incoming-unknown"],
    ["com.palm.app.phone", "emergencymode"],
    ["com.palm.app.phone", "dropped"],
    ["com.palm.app.phone", "fail"],
    ["com.palm.app.clock", "ring"],
    ["com.palm.app.phone", "missed"],
    ["com.palm.app.phone", "provisioning"],
    ["com.palm.systemui", "SysUpdateFinalInstallAlert"],
    ["com.palm.systemui", "CriticalResourceAlert"],
    ["com.palm.systemui", "AccountServiceAlert"],
    ["com.palm.systemui", "PowerOffAlert"],
    ["com.palm.systemui", "TimezoneErrorAlert"],
    ["com.palm.app.calendar", ""],
    ["com.palm.app.messaging", "messaging-class0Alert-stage"]
];

var DEFAULT_PRIORITY = 1000;     // NotificationPolicy.h:45

// Phoenix's Phone app stands in for com.palm.app.phone, and the Enyo Clock
// names its alarm windows "com.palm.app.clock.alarm.<key>" where the Mojo
// Clock the policy was written for used "ring".
function _canonical(appId, name) {
    if (appId === "org.webosphoenix.phone")
        appId = "com.palm.app.phone";
    if (appId === "com.palm.app.clock" && /^com\.palm\.app\.clock\.alarm\./.test(name))
        name = "ring";
    return [appId, name];
}

// NotificationPolicy::getPriority: the exact window, else the app's "".
function popupAlertPriority(appId, name) {
    var c = _canonical(appId, name || "");
    var i;
    for (i = 0; i < POPUP_ALERT.length; ++i)
        if (POPUP_ALERT[i][0] === c[0] && POPUP_ALERT[i][1] === c[1])
            return i;
    for (i = 0; i < POPUP_ALERT.length; ++i)
        if (POPUP_ALERT[i][0] === c[0] && POPUP_ALERT[i][1] === "")
            return i;
    return DEFAULT_PRIORITY;
}

// AlertWindow::isIncomingCallAlert: the phone's windows named "incoming...".
function isIncomingCall(appId, name) {
    var c = _canonical(appId, name || "");
    return c[0] === "com.palm.app.phone" && c[1].indexOf("incoming") === 0;
}

// Where a new alert goes in the queue (index 0 shows):
// addAlertWindowBasedOnPriority. `queued` is [{appId, name}], in order.
function insertIndex(queued, appId, name) {
    var p = popupAlertPriority(appId, name);
    if (queued.length === 0 || p === DEFAULT_PRIORITY)
        return queued.length;
    // More urgent than the one showing: in front of it.
    if (p < popupAlertPriority(queued[0].appId, queued[0].name))
        return 0;
    for (var i = 0; i < queued.length; ++i)
        if (p < popupAlertPriority(queued[i].appId, queued[i].name))
            return i;
    return queued.length;
}

// Where a new ongoing activity goes in the notification list: after the
// ones already there, which are all at the top (Phoenix: live activities
// are pinned above the notifications, which keep the original's newest-
// at-the-bottom order). `ongoing` is the list's ongoing flags, in order.
function ongoingInsertIndex(ongoing) {
    var i = 0;
    while (i < ongoing.length && ongoing[i])
        ++i;
    return i;
}
