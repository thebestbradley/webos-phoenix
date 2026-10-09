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
#include <QSet>
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
    // Keys that also serve as modifiers (a keyboard's Super / Meta key):
    // they count only pressed and let go with no other key between, and
    // then emit tapped(key) on the release; otherwise they pass through.
    Q_PROPERTY(QVariantList soloKeys READ soloKeys WRITE setSoloKeys NOTIFY soloKeysChanged)
    // Keys watched without taking them (the modifier a shortcut sheet
    // appears for while it is held): holding(key, true) when one goes down,
    // holding(key, false) when it is let go or another key is pressed.
    Q_PROPERTY(QVariantList watchKeys READ watchKeys WRITE setWatchKeys NOTIFY watchKeysChanged)
    // Combinations of one of the keys with modifiers that are not taken, as
    // [{key, modifiers}]: they go on to the program's own shortcuts
    // (phoenix-sim's Shift+F3, Hold Power Button, beside F3, Power).
    Q_PROPERTY(QVariantList passChords READ passChords WRITE setPassChords NOTIFY passChordsChanged)

public:
    explicit SystemKeys(QObject *parent = nullptr);
    ~SystemKeys() override;

    QVariantList keys() const { return m_keys; }
    void setKeys(const QVariantList &keys);
    QVariantList chords() const { return m_chords; }
    void setChords(const QVariantList &chords);
    bool enabled() const { return m_enabled; }
    void setEnabled(bool enabled);
    QVariantList soloKeys() const { return m_soloKeys; }
    void setSoloKeys(const QVariantList &keys);
    QVariantList watchKeys() const { return m_watchKeys; }
    void setWatchKeys(const QVariantList &keys);
    QVariantList passChords() const { return m_passChords; }
    void setPassChords(const QVariantList &chords);

signals:
    void pressed(int key, bool autoRepeat);
    void released(int key, bool autoRepeat);
    // One of the chords, pressed (not on auto-repeat).
    void chord(int index);
    // A solo key pressed and let go on its own.
    void tapped(int key);
    void holding(int key, bool down);
    void watchKeysChanged();
    void passChordsChanged();
    void keysChanged();
    void soloKeysChanged();
    void chordsChanged();
    void enabledChanged();

protected:
    bool eventFilter(QObject *watched, QEvent *event) override;

private:
    QVariantList m_keys;
    QVariantList m_chords;
    QVariantList m_soloKeys;
    QVariantList m_watchKeys;
    QVariantList m_passChords;
    QSet<int> m_down;           // keys whose press was taken, until let go
    int m_held = 0;
    bool m_enabled = true;
    int m_lastPressed = 0;
};
