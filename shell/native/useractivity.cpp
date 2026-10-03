// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

#include "useractivity.h"

#include <QCoreApplication>
#include <QKeyEvent>
#include <QMouseEvent>
#include <QTouchEvent>
#include <QLineF>
#include <QWindow>

UserActivity::UserActivity(QObject *parent)
    : QObject(parent)
{
    if (QCoreApplication::instance())
        QCoreApplication::instance()->installEventFilter(this);
}

UserActivity::~UserActivity()
{
    if (QCoreApplication::instance())
        QCoreApplication::instance()->removeEventFilter(this);
}

void UserActivity::setAsleep(bool asleep)
{
    if (asleep == m_asleep)
        return;
    m_asleep = asleep;
    emit asleepChanged();
}

void UserActivity::setPassKeys(const QVariantList &keys)
{
    if (keys == m_passKeys)
        return;
    m_passKeys = keys;
    emit passKeysChanged();
}

void UserActivity::setTapToWake(bool on)
{
    if (on == m_tapToWake)
        return;
    m_tapToWake = on;
    emit tapToWakeChanged();
}

void UserActivity::setTapRadius(qreal r)
{
    if (qFuzzyCompare(r, m_tapRadius))
        return;
    m_tapRadius = r;
    emit tapRadiusChanged();
}

void UserActivity::trackTap(QEvent *event)
{
    const auto type = event->type();
    const bool touch = type == QEvent::TouchBegin || type == QEvent::TouchUpdate || type == QEvent::TouchEnd
        || type == QEvent::TouchCancel;
    if (!touch && m_touching)
        return;
    QPointF pos;
    int points = 1;
    if (touch) {
        const auto *te = static_cast<QTouchEvent *>(event);
        points = te->points().size();
        if (points > 0)
            pos = te->points().first().position();
    } else {
        pos = static_cast<QMouseEvent *>(event)->position();
    }
    switch (type) {
    case QEvent::TouchBegin:
        m_touching = true;
        Q_FALLTHROUGH();
    case QEvent::MouseButtonPress:
        m_pressed = true;
        m_tapMoved = points > 1;
        m_pressPos = pos;
        break;
    case QEvent::TouchUpdate:
    case QEvent::MouseMove:
        if (m_pressed && (points > 1 || QLineF(pos, m_pressPos).length() > m_tapRadius))
            m_tapMoved = true;
        break;
    case QEvent::TouchEnd:
    case QEvent::MouseButtonRelease:
        if (m_pressed && !m_tapMoved && QLineF(pos, m_pressPos).length() <= m_tapRadius)
            emit tapped(pos);
        m_pressed = false;
        if (type == QEvent::TouchEnd)
            m_touching = false;
        break;
    case QEvent::TouchCancel:
        m_pressed = false;
        m_touching = false;
        break;
    default:
        break;
    }
}

bool UserActivity::eventFilter(QObject *watched, QEvent *event)
{
    // Each input event reaches the window first, then the item: count it
    // once, at the window.
    if (!qobject_cast<QWindow *>(watched))
        return false;
    bool move = false;
    switch (event->type()) {
    case QEvent::KeyPress:
    case QEvent::KeyRelease:
    case QEvent::ShortcutOverride:
        if (m_asleep)
            return !m_passKeys.contains(static_cast<QKeyEvent *>(event)->key());
        if (event->type() != QEvent::KeyPress)
            return false;
        break;
    case QEvent::MouseMove:
        // A desktop pointer passing over the window is not a touch.
        if (static_cast<QMouseEvent *>(event)->buttons() == Qt::NoButton)
            return false;
        move = true;
        break;
    case QEvent::TouchUpdate:
    case QEvent::TabletMove:
        move = true;
        break;
    case QEvent::MouseButtonPress:
    case QEvent::MouseButtonRelease:
    case QEvent::MouseButtonDblClick:
    case QEvent::TouchBegin:
    case QEvent::TouchEnd:
    case QEvent::TouchCancel:
    case QEvent::TabletPress:
    case QEvent::TabletRelease:
    case QEvent::Wheel:
    case QEvent::NativeGesture:
        break;
    default:
        return false;
    }
    if (m_asleep) {
        // The press itself is eaten either way; it only wakes the screen.
        if (m_tapToWake && (event->type() == QEvent::MouseButtonPress || event->type() == QEvent::TouchBegin))
            emit wakeRequested();
        return true;
    }
    switch (event->type()) {
    case QEvent::MouseButtonPress: case QEvent::MouseButtonRelease: case QEvent::MouseMove:
    case QEvent::TouchBegin: case QEvent::TouchUpdate: case QEvent::TouchEnd: case QEvent::TouchCancel:
        trackTap(event);
        break;
    default:
        break;
    }
    if (move && m_lastMove.isValid() && m_lastMove.elapsed() < 250)
        return false;
    if (move)
        m_lastMove.start();
    emit activity();
    return false;
}
