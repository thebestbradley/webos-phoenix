// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

#include "phoenixkeyboardplugin.h"

#include "phoenixinputmethod.h"

MAbstractInputMethod *PhoenixKeyboardPlugin::createInputMethod(MAbstractInputMethodHost *host)
{
    return new PhoenixInputMethod(host);
}

QSet<Maliit::HandlerState> PhoenixKeyboardPlugin::supportedStates() const
{
    return { Maliit::OnScreen, Maliit::Hardware };
}
