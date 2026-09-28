// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

#include "keyinjector.h"

#include <QCoreApplication>
#include <QInputMethodEvent>
#include <QKeyEvent>
#include <QQuickWindow>

bool KeyInjector::sendKey(QQuickItem *item, int key, quint32 nativeScanCode)
{
    if (!item || !item->window())
        return false;
    item->forceActiveFocus(Qt::OtherFocusReason);

    QKeyEvent press(QEvent::KeyPress, key, Qt::NoModifier, nativeScanCode, 0, 0);
    QCoreApplication::sendEvent(item, &press);
    const bool accepted = press.isAccepted();
    QKeyEvent release(QEvent::KeyRelease, key, Qt::NoModifier, nativeScanCode, 0, 0);
    QCoreApplication::sendEvent(item, &release);
    return accepted;
}

static QQuickItem *focusTarget(QQuickItem *client)
{
    if (!client || !client->window())
        return nullptr;
    if (!client->hasActiveFocus())
        client->forceActiveFocus(Qt::OtherFocusReason);
    return client->window()->activeFocusItem();
}

bool KeyInjector::sendImeKey(QQuickItem *client, int key, int modifiers)
{
    QQuickItem *target = focusTarget(client);
    if (!target)
        return false;
    // SysmgrIMEDataInterface.cpp:171-187: the character the key types.
    QChar qchar;
    switch (key) {
    case Qt::Key_Return:
    case Qt::Key_Enter:
        qchar = QLatin1Char('\r');
        break;
    case Qt::Key_Tab:
        qchar = QLatin1Char('\t');
        break;
    case Qt::Key_Backspace:
        qchar = QLatin1Char('\b');
        break;
    default:
        qchar = QChar(char16_t(key));
    }
    const auto mods = Qt::KeyboardModifiers(modifiers);
    // Only lower case A to Z; other keys are characters with their case already.
    if (key >= Qt::Key_A && key <= Qt::Key_Z && !(mods & Qt::ShiftModifier))
        qchar = qchar.toLower();
    // Arrows and the like type nothing.
    const QString text = (key & Qt::KeyboardModifierMask) || (key >= Qt::Key_Escape && key != Qt::Key_Return
            && key != Qt::Key_Enter && key != Qt::Key_Tab && key != Qt::Key_Backspace) ? QString() : QString(qchar);

    QKeyEvent press(QEvent::KeyPress, key, mods, text);
    QCoreApplication::sendEvent(target, &press);
    const bool accepted = press.isAccepted();
    QKeyEvent release(QEvent::KeyRelease, key, mods, text);
    QCoreApplication::sendEvent(target, &release);
    return accepted;
}

bool KeyInjector::commitText(QQuickItem *client, const QString &text)
{
    QQuickItem *target = focusTarget(client);
    if (!target)
        return false;
    QInputMethodEvent event;
    event.setCommitString(text);
    QCoreApplication::sendEvent(target, &event);
    return event.isAccepted();
}
