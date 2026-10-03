// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

#include "systemkeys.h"

#include <QCoreApplication>
#include <QKeyEvent>
#include <QVariantMap>
#include <QWindow>

SystemKeys::SystemKeys(QObject *parent)
    : QObject(parent)
{
    if (QCoreApplication::instance())
        QCoreApplication::instance()->installEventFilter(this);
}

SystemKeys::~SystemKeys()
{
    if (QCoreApplication::instance())
        QCoreApplication::instance()->removeEventFilter(this);
}

void SystemKeys::setKeys(const QVariantList &keys)
{
    if (keys == m_keys)
        return;
    m_keys = keys;
    emit keysChanged();
}

void SystemKeys::setChords(const QVariantList &chords)
{
    if (chords == m_chords)
        return;
    m_chords = chords;
    emit chordsChanged();
}

void SystemKeys::setSoloKeys(const QVariantList &keys)
{
    if (keys == m_soloKeys)
        return;
    m_soloKeys = keys;
    emit soloKeysChanged();
}

void SystemKeys::setWatchKeys(const QVariantList &keys)
{
    if (keys == m_watchKeys)
        return;
    m_watchKeys = keys;
    if (m_held && !m_watchKeys.contains(m_held)) {
        const int k = m_held;
        m_held = 0;
        emit holding(k, false);
    }
    emit watchKeysChanged();
}

void SystemKeys::setEnabled(bool enabled)
{
    if (enabled == m_enabled)
        return;
    m_enabled = enabled;
    emit enabledChanged();
}

bool SystemKeys::eventFilter(QObject *watched, QEvent *event)
{
    const QEvent::Type type = event->type();
    if (!m_enabled || (type != QEvent::KeyPress && type != QEvent::KeyRelease && type != QEvent::ShortcutOverride))
        return false;
    // Each key event reaches the window first and then the item with the
    // focus; take it once, at the window.
    if (!qobject_cast<QWindow *>(watched))
        return false;
    auto *key = static_cast<QKeyEvent *>(event);
    const Qt::KeyboardModifiers mods = key->modifiers() & (Qt::ShiftModifier | Qt::ControlModifier | Qt::AltModifier | Qt::MetaModifier);
    if (!key->isAutoRepeat() && type != QEvent::ShortcutOverride) {
        if (m_watchKeys.contains(key->key())) {
            if (type == QEvent::KeyPress && !m_held) {
                m_held = key->key();
                emit holding(m_held, true);
            } else if (type == QEvent::KeyRelease && m_held == key->key()) {
                m_held = 0;
                emit holding(key->key(), false);
            }
        } else if (type == QEvent::KeyPress && m_held) {
            const int k = m_held;
            m_held = 0;
            emit holding(k, false);
        }
    }
    if (m_soloKeys.contains(key->key())) {
        if (type == QEvent::KeyPress && !key->isAutoRepeat())
            m_lastPressed = key->key();
        else if (type == QEvent::KeyRelease && !key->isAutoRepeat() && m_lastPressed == key->key()) {
            m_lastPressed = 0;
            emit tapped(key->key());
        }
        return false;
    }
    if (type == QEvent::KeyPress)
        m_lastPressed = key->key();

    for (int i = 0; i < m_chords.size(); ++i) {
        const QVariantMap c = m_chords.at(i).toMap();
        if (key->key() != c.value(QStringLiteral("key")).toInt() || int(mods) != c.value(QStringLiteral("modifiers")).toInt())
            continue;
        if (type == QEvent::ShortcutOverride) {
            event->accept();
            return true;
        }
        if (type == QEvent::KeyPress && !key->isAutoRepeat())
            emit chord(i);
        return true;
    }
    if (!m_keys.contains(key->key()))
        return false;
    if (type == QEvent::ShortcutOverride) {
        event->accept();
        return true;
    }
    if (type == QEvent::KeyPress)
        emit pressed(key->key(), key->isAutoRepeat());
    else
        emit released(key->key(), key->isAutoRepeat());
    return true;
}
