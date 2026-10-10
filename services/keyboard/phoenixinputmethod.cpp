// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

#include "phoenixinputmethod.h"

#include "keytext.h"

#include <maliit/plugins/abstractinputmethodhost.h>

#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QKeyEvent>
#include <QQmlEngine>
#include <QQuickItem>
#include <QQuickView>
#include <QRegion>
#include <QSaveFile>
#include <QScreen>
#include <QVariantMap>

#ifndef PHOENIX_KEYBOARD_QML_DIR
#define PHOENIX_KEYBOARD_QML_DIR "/usr/share/phoenix/qml"
#endif
#ifndef PHOENIX_KEYBOARD_STATE_DIR
#define PHOENIX_KEYBOARD_STATE_DIR "/var/lib/phoenix/keyboard"
#endif

static QString fromEnv(const char *name, const char *fallback)
{
    const QString v = qEnvironmentVariable(name);
    return v.isEmpty() ? QString::fromUtf8(fallback) : v;
}

PhoenixInputMethod::PhoenixInputMethod(MAbstractInputMethodHost *host)
    : MAbstractInputMethod(host)
    , m_view(new QQuickView)
{
    // A panel over the app: transparent where the keyboard draws nothing
    // (keyboard.cpp:51-56 asks for an alpha channel too).
    QSurfaceFormat f = m_view->format();
    f.setAlphaBufferSize(8);
    m_view->setFormat(f);
    m_view->setColor(Qt::transparent);
    m_view->setFlags(m_view->flags() | Qt::FramelessWindowHint);
    m_view->setResizeMode(QQuickView::SizeRootObjectToView);

    // The shell's QML: Phoenix.Shell (the keyboard itself) and
    // Phoenix.Keyboard (this plugin's side). Phoenix.Native is with Qt's
    // own modules (phoenix-shell's recipe installs it there).
    const QString qmlDir = fromEnv("PHOENIX_KEYBOARD_QML_DIR", PHOENIX_KEYBOARD_QML_DIR);
    m_view->engine()->addImportPath(qmlDir);
    m_view->setInitialProperties({ { QStringLiteral("maliit"), QVariant::fromValue<QObject *>(this) } });
    m_view->setSource(QUrl::fromLocalFile(qmlDir + QStringLiteral("/Phoenix/Keyboard/MaliitKeyboard.qml")));
    const auto errors = m_view->errors();
    for (const QQmlError &e : errors)
        m_loadErrors += e.toString() + QLatin1Char('\n');
    if (!m_loadErrors.isEmpty())
        qWarning("phoenix-keyboard: %s", qPrintable(m_loadErrors));

    // Its size before the server makes it the input panel (keyboard.cpp:
    // 65-66, then registerWindow at :110): the screen's width and the
    // keyboard's height, which the QML has set by now (setPanelHeight).
    setPanelHeight(m_panelHeight);
    host->registerWindow(m_view, Maliit::PositionCenterBottom);
    m_registered = true;
    setPanelHeight(m_panelHeight);
    readField();
}

PhoenixInputMethod::~PhoenixInputMethod()
{
    delete m_view;
}

int PhoenixInputMethod::screenWidth() const
{
    return m_view && m_view->screen() ? m_view->screen()->size().width() : 0;
}

int PhoenixInputMethod::screenHeight() const
{
    return m_view && m_view->screen() ? m_view->screen()->size().height() : 0;
}

QString PhoenixInputMethod::serviceName() const
{
    return inputMethodHost()->serviceName();
}

// The field's state, as the server has it (inputmethod.cpp:419-437 reads it
// on show; :654-702 as it changes).
void PhoenixInputMethod::readField()
{
    MAbstractInputMethodHost *host = inputMethodHost();
    bool valid = false;
    int contentType = host->contentType(valid);
    if (!valid)
        contentType = Maliit::FreeTextContentType;
    int enterKeyType = host->enterKeyType(valid);
    if (!valid)
        enterKeyType = Maliit::DefaultEnterKeyType;
    bool hidden = host->hiddenText(valid);
    if (!valid)
        hidden = false;
    bool autoCap = host->autoCapitalizationEnabled(valid);
    if (!valid)
        autoCap = false;
    bool prediction = host->predictionEnabled(valid);
    if (!valid)
        prediction = true;
    if (contentType != m_contentType || enterKeyType != m_enterKeyType || hidden != m_hiddenText
            || autoCap != m_autoCapitalization || prediction != m_predictionEnabled) {
        m_contentType = contentType;
        m_enterKeyType = enterKeyType;
        m_hiddenText = hidden;
        m_autoCapitalization = autoCap;
        m_predictionEnabled = prediction;
        Q_EMIT fieldChanged();
    }
    QString text;
    int cursor = -1;
    if (!host->surroundingText(text, cursor)) {
        text.clear();
        cursor = -1;
    }
    if (text != m_text || cursor != m_cursor) {
        m_text = text;
        m_cursor = cursor;
        Q_EMIT cursorMoved();
    }
}

void PhoenixInputMethod::show()
{
    readField();
    if (!m_active) {
        m_active = true;
        Q_EMIT activeChanged();
    }
    m_view->show();
}

void PhoenixInputMethod::hide()
{
    if (m_active) {
        m_active = false;
        Q_EMIT activeChanged();
    }
    m_view->hide();
}

void PhoenixInputMethod::update()
{
    readField();
}

void PhoenixInputMethod::reset()
{
    readField();
}

void PhoenixInputMethod::handleFocusChange(bool focusIn)
{
    Q_UNUSED(focusIn);
    readField();
    Q_EMIT clientChanged();
}

void PhoenixInputMethod::handleClientChange()
{
    readField();
    Q_EMIT clientChanged();
}

void PhoenixInputMethod::handleAppOrientationChanged(int angle)
{
    if (angle != m_angle) {
        m_angle = angle;
        Q_EMIT screenChanged();
    }
}

// One subview, as OSE's keyboard (inputmethod.cpp:458-478): the
// keyboard's own layouts and languages are its settings (V7), not Maliit's.
QList<MAbstractInputMethod::MInputMethodSubView> PhoenixInputMethod::subViews(Maliit::HandlerState) const
{
    MInputMethodSubView v;
    return { v };
}

QString PhoenixInputMethod::activeSubView(Maliit::HandlerState) const
{
    return QString();
}

void PhoenixInputMethod::sendKey(int key, int modifiers)
{
    const auto mods = Qt::KeyboardModifiers(modifiers);
    if (PhoenixKeyText::isCharacter(key, mods)) {
        inputMethodHost()->sendCommitString(PhoenixKeyText::keyText(key, mods));
        return;
    }
    const QString text = PhoenixKeyText::keyText(key, mods);
    inputMethodHost()->sendKeyEvent(QKeyEvent(QEvent::KeyPress, key, mods, text));
    inputMethodHost()->sendKeyEvent(QKeyEvent(QEvent::KeyRelease, key, mods, text));
}

void PhoenixInputMethod::commitText(const QString &text)
{
    if (!text.isEmpty())
        inputMethodHost()->sendCommitString(text);
}

void PhoenixInputMethod::setPreedit(const QString &text)
{
    QList<Maliit::PreeditTextFormat> formats;
    if (!text.isEmpty())
        formats.append(Maliit::PreeditTextFormat(0, int(text.size()), Maliit::PreeditDefault));
    inputMethodHost()->sendPreeditString(text, formats);
}

void PhoenixInputMethod::hideKeyboard()
{
    hide();
    inputMethodHost()->notifyImInitiatedHiding();
}

void PhoenixInputMethod::setPanelHeight(int height)
{
    height = qMax(1, height);
    const int width = qMax(1, screenWidth());
    const int screenH = screenHeight();
    if (m_view->width() != width || m_view->height() != height)
        m_view->setGeometry(0, qMax(0, screenH - height), width, height);
    // All of the window is the keyboard: the area the apps make room for.
    // (luna-surfacemanager takes the panel's height from its surface,
    // KeyboardView.qml:58-65; the whole surface takes touches, so no
    // setScreenRegion, as OSE's keyboard sets none.) Only once the server
    // has the window: before, it has no surface for it.
    if (m_registered)
        inputMethodHost()->setInputMethodArea(QRegion(0, 0, width, height), m_view);
    if (height != m_panelHeight) {
        m_panelHeight = height;
        Q_EMIT panelHeightChanged();
    }
}

QVariant PhoenixInputMethod::surroundingText() const
{
    QString text;
    int cursor = -1;
    if (!inputMethodHost()->surroundingText(text, cursor) || cursor < 0)
        return QVariant();
    return QVariantMap{ { QStringLiteral("text"), text }, { QStringLiteral("cursor"), cursor } };
}

void PhoenixInputMethod::switchKeyboard(const QString &pluginFile)
{
    if (!pluginFile.isEmpty() && pluginFile != pluginFileName())
        inputMethodHost()->switchPlugin(pluginFile);
}

QString PhoenixInputMethod::statePath(const QString &name) const
{
    // A plain name only: "words", "emoji".
    for (const QChar c : name)
        if (!c.isLetterOrNumber() && c != QLatin1Char('-') && c != QLatin1Char('_'))
            return QString();
    if (name.isEmpty())
        return QString();
    return fromEnv("PHOENIX_KEYBOARD_STATE_DIR", PHOENIX_KEYBOARD_STATE_DIR) + QLatin1Char('/') + name + QStringLiteral(".json");
}

QString PhoenixInputMethod::readState(const QString &name) const
{
    const QString path = statePath(name);
    QFile f(path);
    if (path.isEmpty() || !f.open(QIODevice::ReadOnly))
        return QString();
    return QString::fromUtf8(f.readAll());
}

bool PhoenixInputMethod::writeState(const QString &name, const QString &text)
{
    const QString path = statePath(name);
    if (path.isEmpty() || !QDir().mkpath(QFileInfo(path).absolutePath()))
        return false;
    QSaveFile f(path);
    if (!f.open(QIODevice::WriteOnly))
        return false;
    f.setPermissions(QFileDevice::ReadOwner | QFileDevice::WriteOwner);
    f.write(text.toUtf8());
    return f.commit();
}
