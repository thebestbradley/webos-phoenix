// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// luna-surfacemanager's WebOSServices Service, for the device shell's tests:
// call(service, method, payload) -> token, response(method, payload, token).

import QtQuick

QtObject {
    property string appId: ""
    signal response(string method, string payload, int token)
    function call(service, method, payload) {
        return FakeBus.register(this, service, method, payload);
    }
}
