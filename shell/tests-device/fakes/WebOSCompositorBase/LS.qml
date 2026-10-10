// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// luna-surfacemanager's LS singleton (base/qml/WebOSCompositorBase/global/LS.qml),
// for the device shell's tests: the shell's app id and its ad hoc service.

pragma Singleton
import QtQuick
import WebOSServices 1.0

QtObject {
    property string appId: "com.webos.surfacemanager"
    property var adhoc: Service { appId: "com.webos.surfacemanager" }
}
