// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Maliit input method plugin maliit-server loads from
// /usr/lib/maliit/plugins (libphoenix-keyboard.so): the Phoenix keyboard
// (PhoenixInputMethod). As OSE's own keyboard's plugin
// (ime-manager maliit-plugin-global/plugin/plugin.h, plugin.cpp:64-82): the
// on-screen state, and hardware keyboards' keys, which it hands back to the
// field as they are (MAbstractInputMethod::processKeyEvent).

#pragma once

#include <maliit/plugins/inputmethodplugin.h>

#include <QObject>

class PhoenixKeyboardPlugin : public QObject, public Maliit::Plugins::InputMethodPlugin
{
    Q_OBJECT
    Q_INTERFACES(Maliit::Plugins::InputMethodPlugin)
    Q_PLUGIN_METADATA(IID "org.webosphoenix.keyboard" FILE "plugin.json")

public:
    QString name() const override { return QStringLiteral("PhoenixKeyboard"); }
    MAbstractInputMethod *createInputMethod(MAbstractInputMethodHost *host) override;
    QSet<Maliit::HandlerState> supportedStates() const override;
};
