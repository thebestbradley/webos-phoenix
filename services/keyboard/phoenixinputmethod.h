// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Phoenix keyboard as the device's input method (GAPS V5): a Maliit
// input method whose panel is the shell's own keyboard, VirtualKeyboard.qml,
// in a window of maliit-server's (docs/HARDWARE.md, "The keyboard as the
// input method").
//
// It shows Phoenix/Keyboard/MaliitKeyboard.qml (from the shell's QML, the
// same files the shell loads) in a QQuickView registered with the server
// as its input panel, and is that QML's `maliit`: the field's state, read
// from the server's host, as properties, and what the keyboard does, as
// methods, each a call on MAbstractInputMethodHost. As OSE's own keyboard
// does (ime-manager maliit-plugin-global/plugin/inputmethod.cpp, keyboard.cpp):
//
//   field -> keyboard   show(), hide(), update() (the host's contentType,
//                       enterKeyType, hiddenText, autoCapitalizationEnabled,
//                       predictionEnabled, surroundingText; inputmethod.cpp:
//                       401-446, 641-705), handleFocusChange / Client change
//   keyboard -> field   sendKey: a character is a commit (sendCommitString,
//                       as inputmethod.cpp:1157-1169 onTextKeyPressed), any
//                       other key a press and a release (sendKeyEvent,
//                       inputmethod.cpp:1104-1105); commitText; setPreedit
//                       (sendPreeditString); hideKeyboard (the window hides,
//                       keyboard.cpp:134-141, and the host is told);
//                       setPanelHeight: the window is the keyboard's height
//                       (keyboard.cpp:247-251 setPanelHeight), its input
//                       method area all of it.
//
// Where the files are: PHOENIX_KEYBOARD_QML_DIR (the shell's QML, default
// the device's /usr/share/phoenix/qml) and PHOENIX_KEYBOARD_STATE_DIR (what
// the keyboard keeps: the words it learned, recent emoji; default
// /var/lib/phoenix/keyboard), from the environment, else the build's.
//
// STATUS: written against maliit-framework-webos's and ime-manager's
// sources, tested over a fake host (keyboard-test); not yet run on a device.

#pragma once

#include <maliit/plugins/abstractinputmethod.h>

#include <QPointer>
#include <QString>
#include <QVariant>

class QQuickView;

class PhoenixInputMethod : public MAbstractInputMethod
{
    Q_OBJECT
    // The focused field (Maliit's values: Maliit::TextContentType,
    // Maliit::EnterKeyType), as the host last said.
    Q_PROPERTY(int contentType READ contentType NOTIFY fieldChanged)
    Q_PROPERTY(int enterKeyType READ enterKeyType NOTIFY fieldChanged)
    Q_PROPERTY(bool hiddenText READ hiddenText NOTIFY fieldChanged)
    Q_PROPERTY(bool autoCapitalization READ autoCapitalization NOTIFY fieldChanged)
    Q_PROPERTY(bool predictionEnabled READ predictionEnabled NOTIFY fieldChanged)
    // The server asked for the keyboard (show) and has not hidden it.
    Q_PROPERTY(bool active READ active NOTIFY activeChanged)
    // The screen the panel is at the bottom of, and how the app is turned.
    Q_PROPERTY(int screenWidth READ screenWidth NOTIFY screenChanged)
    Q_PROPERTY(int screenHeight READ screenHeight NOTIFY screenChanged)
    Q_PROPERTY(int orientationAngle READ orientationAngle NOTIFY screenChanged)
    // The panel's height, as the keyboard last set it.
    Q_PROPERTY(int panelHeight READ panelHeight NOTIFY panelHeightChanged)
    // maliit-server's bus name (com.webos.service.ime, or with a display's
    // number), for the QML's own calls on the bus.
    Q_PROPERTY(QString serviceName READ serviceName CONSTANT)

public:
    explicit PhoenixInputMethod(MAbstractInputMethodHost *host);
    ~PhoenixInputMethod() override;

    // The maliit-server's file name for this plugin (its settings name it:
    // onscreen/active, onscreen/enabled), and OSE's own keyboard's.
    static QString pluginFileName() { return QStringLiteral("libphoenix-keyboard.so"); }
    static QString oseKeyboardFileName() { return QStringLiteral("libplugin-global.so"); }

    void show() override;
    void hide() override;
    void update() override;
    void reset() override;
    void handleFocusChange(bool focusIn) override;
    void handleClientChange() override;
    void handleAppOrientationChanged(int angle) override;
    QList<MInputMethodSubView> subViews(Maliit::HandlerState state = Maliit::OnScreen) const override;
    QString activeSubView(Maliit::HandlerState state = Maliit::OnScreen) const override;

    int contentType() const { return m_contentType; }
    int enterKeyType() const { return m_enterKeyType; }
    bool hiddenText() const { return m_hiddenText; }
    bool autoCapitalization() const { return m_autoCapitalization; }
    bool predictionEnabled() const { return m_predictionEnabled; }
    bool active() const { return m_active; }
    int screenWidth() const;
    int screenHeight() const;
    int orientationAngle() const { return m_angle; }
    int panelHeight() const { return m_panelHeight; }
    QString serviceName() const;

    // KeyboardHost, for MaliitKeyboard.qml.
    Q_INVOKABLE void sendKey(int key, int modifiers);
    Q_INVOKABLE void commitText(const QString &text);
    Q_INVOKABLE void setPreedit(const QString &text);
    Q_INVOKABLE void hideKeyboard();
    Q_INVOKABLE void setPanelHeight(int height);
    // {text, cursor}, or null when the field does not say.
    Q_INVOKABLE QVariant surroundingText() const;
    // Another keyboard: Maliit plugin file name (GAPS V7's "webOS OSE" is
    // OSE's own, oseKeyboardFileName()).
    Q_INVOKABLE void switchKeyboard(const QString &pluginFile);
    // What the keyboard keeps between runs, by name ("words", "emoji").
    Q_INVOKABLE QString readState(const QString &name) const;
    Q_INVOKABLE bool writeState(const QString &name, const QString &text);

    QQuickView *view() const { return m_view; }
    // The QML's own errors (the plugin's tests check there are none).
    QString loadErrors() const { return m_loadErrors; }

Q_SIGNALS:
    void fieldChanged();
    void activeChanged();
    // Another field (or none) has the keyboard: it reads the field afresh.
    void clientChanged();
    // The field's text or cursor moved (surroundingText).
    void cursorMoved();
    void screenChanged();
    void panelHeightChanged();

private:
    void readField();
    QString statePath(const QString &name) const;

    QQuickView *m_view = nullptr;
    bool m_registered = false;
    QString m_loadErrors;
    int m_contentType = 0;
    int m_enterKeyType = 0;
    bool m_hiddenText = false;
    bool m_autoCapitalization = false;
    bool m_predictionEnabled = true;
    bool m_active = false;
    int m_angle = 0;
    int m_panelHeight = 0;
    QString m_text;
    int m_cursor = -1;
};
