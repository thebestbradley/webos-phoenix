// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The system's own keys, seen before any app: Home, Power and the screen
// capture keys go to the shell whatever has the keyboard focus, as
// LunaSysMgr's WindowServer took them before routing the rest to the
// focused window (WindowServer.cpp:629-697). Without it a web app with the
// focus (QtWebEngine takes every key) swallowed Home + Power and Print
// Screen.
//
// SystemKeys watches the application's key events and, for the keys it is
// given, emits pressed / released and stops the event there.

#pragma once

#include <QObject>
#include <QVariantList>
#include <QtQml/qqmlregistration.h>

class SystemKeys : public QObject
{
    Q_OBJECT
    QML_ELEMENT

    // Qt key codes taken whatever has the focus, with any modifiers.
    Q_PROPERTY(QVariantList keys READ keys WRITE setKeys NOTIFY keysChanged)
    // Key combinations taken the same way, as [{key, modifiers}] (Qt key
    // codes and modifier masks): chord(index) when one is pressed.
    Q_PROPERTY(QVariantList chords READ chords WRITE setChords NOTIFY chordsChanged)
    Q_PROPERTY(bool enabled READ enabled WRITE setEnabled NOTIFY enabledChanged)

public:
    explicit SystemKeys(QObject *parent = nullptr);
    ~SystemKeys() override;

    QVariantList keys() const { return m_keys; }
    void setKeys(const QVariantList &keys);
    QVariantList chords() const { return m_chords; }
    void setChords(const QVariantList &chords);
    bool enabled() const { return m_enabled; }
    void setEnabled(bool enabled);

signals:
    void pressed(int key, bool autoRepeat);
    void released(int key, bool autoRepeat);
    // One of the chords, pressed (not on auto-repeat).
    void chord(int index);
    void keysChanged();
    void chordsChanged();
    void enabledChanged();

protected:
    bool eventFilter(QObject *watched, QEvent *event) override;

private:
    QVariantList m_keys;
    QVariantList m_chords;
    bool m_enabled = true;
};
