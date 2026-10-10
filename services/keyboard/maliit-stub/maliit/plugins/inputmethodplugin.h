// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Stand-in for maliit-framework-webos's src/maliit/plugins/inputmethodplugin.h
// (the subset the Phoenix keyboard uses; maliit-stub/maliit/namespace.h says
// why and how it is checked).

#pragma once

#include <QSet>
#include <QString>
#include <QtPlugin>

#include <maliit/namespace.h>

class MAbstractInputMethod;
class MAbstractInputMethodHost;

namespace Maliit {
namespace Plugins {

// inputmethodplugin.h:43-57
class InputMethodPlugin
{
public:
    virtual ~InputMethodPlugin() {}
    virtual QString name() const = 0;
    virtual MAbstractInputMethod *createInputMethod(MAbstractInputMethodHost *host) = 0;
    virtual QSet<Maliit::HandlerState> supportedStates() const = 0;
};

} // namespace Plugins
} // namespace Maliit

// inputmethodplugin.h:63-64: the interface id maliit-server's plugin
// loader casts to (mimpluginmanager.cpp:173, qobject_cast).
Q_DECLARE_INTERFACE(Maliit::Plugins::InputMethodPlugin,
                    "org.maliit.plugins.InputMethodPlugin/1.1")
