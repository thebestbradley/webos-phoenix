// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// What a key of the virtual keyboard types (VirtualKeyboard.qml's keyTyped:
// a character's code, or a Qt key for Backspace, Return, the arrows...),
// as LunaSysMgr's IME made the key event (SysmgrIMEModel::sendKeyEvent,
// SysmgrIMEDataInterface.cpp:167-190). One definition for both of the
// keyboard's hosts (KeyboardHost.qml): the simulator's, which sends the key
// event to the field (KeyInjector::sendImeKey), and the device's Maliit
// input method (services/keyboard), which commits the character to the
// app's field or sends the key as a key event.
//
// Header only: Phoenix.Native and the Maliit plugin each compile it.

#pragma once

#include <QChar>
#include <QString>
#include <Qt>

namespace PhoenixKeyText {

// The character the key types ("" for keys that type none: the arrows,
// Escape, function keys, a modifier). Return and Enter type "\r", Tab
// "\t", Backspace "\b" (the key event's text, SysmgrIMEDataInterface.cpp:
// 171-187); a letter A to Z is lower case without Shift, other characters
// come with their case already.
inline QString keyText(int key, Qt::KeyboardModifiers modifiers)
{
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
    if (key >= Qt::Key_A && key <= Qt::Key_Z && !(modifiers & Qt::ShiftModifier))
        qchar = qchar.toLower();
    if ((key & Qt::KeyboardModifierMask) || (key >= Qt::Key_Escape && key != Qt::Key_Return
            && key != Qt::Key_Enter && key != Qt::Key_Tab && key != Qt::Key_Backspace))
        return QString();
    return QString(qchar);
}

// A key that is a character to put in the field (not Backspace, Return,
// Tab, an arrow or another control key), and so, through an input method,
// a commit rather than a key event: a printable character with no Control,
// Alt or Meta held (with those it is a shortcut, Ctrl+A, and goes as a
// key). Space is a character.
inline bool isCharacter(int key, Qt::KeyboardModifiers modifiers)
{
    if (modifiers & (Qt::ControlModifier | Qt::AltModifier | Qt::MetaModifier))
        return false;
    const QString text = keyText(key, modifiers);
    return text.size() == 1 && text.at(0).isPrint();
}

} // namespace PhoenixKeyText
