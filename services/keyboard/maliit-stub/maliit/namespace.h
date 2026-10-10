// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// A stand-in for the part of Maliit's plugin API the Phoenix keyboard plugin
// uses (services/keyboard), so it builds and its tests run where
// maliit-framework-webos is not installed (the simulator's computers, CI).
// The device's build uses the real headers, which OSE's maliit-framework-webos
// recipe installs (/usr/include/maliit, maliit-framework-webos.bb do_install);
// services/keyboard/CMakeLists.txt picks them when it finds them.
//
// Written for Phoenix from what webosose/maliit-framework-webos declares
// (common/maliit/namespace.h, LGPL-2.1, not copied): the same names and
// values, and only those the plugin names. The build checks it against the
// real headers when it has them (PHOENIX_MALIIT_SOURCE_DIR: the plugin is
// compiled against those too, with `override` on every method it
// reimplements, so a signature that differs fails to compile).

#pragma once

#include <QList>
#include <QMetaType>

namespace Maliit {

// common/maliit/namespace.h:29-34
enum Position {
    PositionOverlay,
    PositionCenterBottom,
    PositionLeftBottom,
    PositionRightBottom
};

// :44-62
enum TextContentType {
    FreeTextContentType,
    NumberContentType,
    PhoneNumberContentType,
    EmailContentType,
    UrlContentType,
    CustomContentType
};

// :71-95
enum EnterKeyType {
    DefaultEnterKeyType,
    ReturnEnterKeyType,
    DoneEnterKeyType,
    GoEnterKeyType,
    SendEnterKeyType,
    SearchEnterKeyType,
    NextEnterKeyType,
    PreviousEnterKeyType
};

// :114-118
enum SwitchDirection {
    SwitchUndefined,
    SwitchForward,
    SwitchBackward
};

// :120-126
enum PreeditFace {
    PreeditDefault,
    PreeditNoCandidates,
    PreeditKeyPress,
    PreeditUnconvertible,
    PreeditActive
};

// :128-132
enum HandlerState {
    OnScreen,
    Hardware,
    Accessory
};

// :135-139
enum EventRequestType {
    EventRequestBoth,
    EventRequestSignalOnly,
    EventRequestEventOnly
};

// :147-159
struct PreeditTextFormat {
    int start;
    int length;
    PreeditFace preeditFace;

    PreeditTextFormat() : start(0), length(0), preeditFace(PreeditDefault) {}
    PreeditTextFormat(int s, int l, const PreeditFace &face) : start(s), length(l), preeditFace(face) {}
};

} // namespace Maliit

Q_DECLARE_METATYPE(Maliit::PreeditTextFormat)
