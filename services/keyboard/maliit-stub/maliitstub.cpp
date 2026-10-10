// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The stand-in Maliit API's base class (maliit-stub/maliit/namespace.h says
// why): what maliit-framework-webos's abstractinputmethod.cpp does by
// default, for the plugin's tests. On a device libmaliit-plugins has it.

#include <maliit/plugins/abstractinputmethod.h>
#include <maliit/plugins/abstractinputmethodhost.h>

#include <QKeyEvent>

MAbstractInputMethod::MAbstractInputMethod(MAbstractInputMethodHost *host) : m_host(host) {}

MAbstractInputMethod::~MAbstractInputMethod() {}

MAbstractInputMethodHost *MAbstractInputMethod::inputMethodHost() const { return m_host; }

void MAbstractInputMethod::show() {}
void MAbstractInputMethod::hide() {}
void MAbstractInputMethod::update() {}
void MAbstractInputMethod::reset() {}
void MAbstractInputMethod::handleFocusChange(bool) {}
void MAbstractInputMethod::handleAppOrientationChanged(int) {}
void MAbstractInputMethod::handleClientChange() {}
QString MAbstractInputMethod::activeSubView(Maliit::HandlerState) const { return QString(); }

QList<MAbstractInputMethod::MInputMethodSubView> MAbstractInputMethod::subViews(Maliit::HandlerState) const
{
    return QList<MInputMethodSubView>();
}

// abstractinputmethod.cpp:123-136: a key the input method does not take is
// sent back to the field.
void MAbstractInputMethod::processKeyEvent(QEvent::Type keyType, Qt::Key keyCode,
                                           Qt::KeyboardModifiers modifiers, const QString &text,
                                           bool autoRepeat, int count, quint32, quint32, unsigned long)
{
    m_host->sendKeyEvent(QKeyEvent(keyType, keyCode, modifiers, text, autoRepeat, count));
}
