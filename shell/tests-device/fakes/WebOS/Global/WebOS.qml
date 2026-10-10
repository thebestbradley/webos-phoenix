// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The WebOS.Global key enum, for the device shell's tests (Qt's webOS keys:
// Key_webOS_Back is 0x01200001, qtbase's webOS patches; an enum, since QML
// property names cannot begin with a capital).

pragma Singleton
import QtQuick

QtObject {
    enum Keys { Key_webOS_Back = 18874369 }
}
