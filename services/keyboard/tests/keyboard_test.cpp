// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// keyboard-test: the Phoenix keyboard's Maliit input method (GAPS V5) over a
// fake maliit-server host (the stand-in API, maliit-stub), loading the
// shell's own QML (Phoenix/Keyboard/MaliitKeyboard.qml and the keyboard)
// with the device's bus modules faked (shell/tests-device/fakes):
//
//   QT_QPA_PLATFORM=offscreen build/keyboard/keyboard-test
//
// What a device's maliit-server would see: the window it is given, the
// text committed, the keys sent, the panel's height, show and hide; and
// what the keyboard reads from it: the field's type, its text around the
// cursor.

#include "phoenixinputmethod.h"
#include "phoenixkeyboardplugin.h"

#include <maliit/plugins/abstractinputmethodhost.h>

#include <QGuiApplication>
#include <QPluginLoader>
#include <QQmlEngine>
#include <QQuickItem>
#include <QQuickView>
#include <QTemporaryDir>
#include <QTest>

namespace {

// maliit-server's side, written down (MInputMethodHost's methods the plugin
// calls) with a field the test sets.
class FakeHost : public MAbstractInputMethodHost
{
    Q_OBJECT
public:
    int type = Maliit::FreeTextContentType;
    int enterKey = Maliit::DefaultEnterKeyType;
    bool hidden = false;
    bool autoCap = false;
    QString text;
    int cursor = -1;

    QWindow *window = nullptr;
    QStringList commits;
    QList<QPair<int, int>> keys;          // (QEvent type, Qt key)
    QStringList keyTexts;
    QStringList preedits;
    int hidings = 0;
    QRegion area;
    QString switchedTo;

    int contentType(bool &valid) override { valid = true; return type; }
    int enterKeyType(bool &valid) override { valid = true; return enterKey; }
    bool correctionEnabled(bool &valid) override { valid = true; return true; }
    bool predictionEnabled(bool &valid) override { valid = true; return true; }
    bool autoCapitalizationEnabled(bool &valid) override { valid = true; return autoCap; }
    bool surroundingText(QString &t, int &c) override
    {
        if (cursor < 0)
            return false;
        t = text;
        c = cursor;
        return true;
    }
    bool hasSelection(bool &valid) override { valid = true; return false; }
    bool hiddenText(bool &valid) override { valid = true; return hidden; }
    void registerWindow(QWindow *w, Maliit::Position) override { window = w; }
    void sendPreeditString(const QString &s, const QList<Maliit::PreeditTextFormat> &, int, int, int) override
    {
        preedits << s;
    }
    void sendCommitString(const QString &s, int, int, int) override
    {
        commits << s;
        // The field takes it, as an app's would.
        if (cursor >= 0) {
            text.insert(cursor, s);
            cursor += int(s.size());
        }
    }
    void sendKeyEvent(const QKeyEvent &e, Maliit::EventRequestType) override
    {
        keys << qMakePair(int(e.type()), e.key());
        keyTexts << e.text();
        if (e.type() == QEvent::KeyPress && e.key() == Qt::Key_Backspace && cursor > 0) {
            text.remove(cursor - 1, 1);
            --cursor;
        }
    }
    void notifyImInitiatedHiding() override { ++hidings; }
    void switchPlugin(const QString &name) override { switchedTo = name; }
    void setInputMethodArea(const QRegion &r, QWindow *) override { area = r; }
    QString serviceName() const override { return QStringLiteral("com.webos.service.ime"); }
};

} // namespace

class KeyboardTest : public QObject
{
    Q_OBJECT

private:
    QTemporaryDir m_state;
    FakeHost *m_host = nullptr;
    PhoenixInputMethod *m_im = nullptr;

    QQuickItem *keyboard() const
    {
        return m_im->view()->rootObject()->findChild<QQuickItem *>(QStringLiteral("virtualKeyboard"));
    }
    QVariant kbProperty(const char *name) const { return keyboard()->property(name); }
    // Taps the key labelled `label` in the panel's window.
    bool tap(const QString &label)
    {
        // Its keys are laid out once it is shown.
        QRectF rect;
        for (int i = 0; i < 50 && rect.isEmpty(); ++i) {
            QVariant r;
            QMetaObject::invokeMethod(keyboard(), "keyRect", Q_RETURN_ARG(QVariant, r), Q_ARG(QVariant, label));
            rect = r.toRectF();
            if (rect.isEmpty())
                QTest::qWait(20);
        }
        if (rect.isEmpty())
            return false;
        const QPointF p = keyboard()->mapToScene(rect.center());
        QTest::mouseClick(m_im->view(), Qt::LeftButton, Qt::NoModifier, p.toPoint());
        QTest::qWait(30);
        return true;
    }
    int editorType() const { return kbProperty("editorState").toMap().value(QStringLiteral("type")).toInt(); }

private Q_SLOTS:
    void initTestCase()
    {
        QVERIFY(m_state.isValid());
        qputenv("PHOENIX_KEYBOARD_STATE_DIR", m_state.path().toUtf8());
        qputenv("QML_IMPORT_PATH", PHOENIX_TEST_IMPORTS);
        m_host = new FakeHost;
        m_im = new PhoenixInputMethod(m_host);
        QCOMPARE(m_im->loadErrors(), QString());
        QVERIFY(m_im->view()->rootObject());
        QVERIFY(keyboard());
    }

    void cleanupTestCase()
    {
        delete m_im;
        delete m_host;
    }

    void init()
    {
        m_host->commits.clear();
        m_host->keys.clear();
        m_host->keyTexts.clear();
        m_host->preedits.clear();
        m_host->type = Maliit::FreeTextContentType;
        m_host->hidden = false;
        m_host->autoCap = false;
        m_host->enterKey = Maliit::DefaultEnterKeyType;
        m_host->text = QString();
        m_host->cursor = 0;
        m_im->update();
    }

    // maliit-server loads it as OSE's keyboard: a Qt plugin with Maliit's
    // interface, for the on-screen state (and hardware keys).
    void plugin()
    {
        QPluginLoader loader(QStringLiteral(PHOENIX_KEYBOARD_PLUGIN));
        QObject *instance = loader.instance();
        QVERIFY2(instance, qPrintable(loader.errorString()));
        auto *p = qobject_cast<Maliit::Plugins::InputMethodPlugin *>(instance);
        QVERIFY(p);
        QCOMPARE(p->name(), QStringLiteral("PhoenixKeyboard"));
        QVERIFY(p->supportedStates().contains(Maliit::OnScreen));
        QCOMPARE(QFileInfo(loader.fileName()).fileName(), PhoenixInputMethod::pluginFileName());
    }

    // The window is the server's input panel, the keyboard's height, and
    // all of it the input method's area.
    void panel()
    {
        QCOMPARE(m_host->window, static_cast<QWindow *>(m_im->view()));
        m_im->show();
        QTRY_VERIFY(m_im->view()->isVisible());
        QVERIFY(kbProperty("shown").toBool());
        const int h = qCeil(kbProperty("keyboardHeight").toReal());
        QVERIFY(h > 100);
        QTRY_COMPARE(m_im->view()->height(), h);
        QCOMPARE(m_host->area.boundingRect().height(), h);
        QCOMPARE(m_im->view()->width(), m_im->screenWidth());
        QCOMPARE(m_im->view()->y(), m_im->screenHeight() - h);
    }

    // Letters are commits; Backspace and Return are key presses and
    // releases, as OSE's keyboard sends them (inputmethod.cpp:1104-1105).
    void typing()
    {
        m_im->show();
        QVERIFY(tap(QStringLiteral("h")));
        QVERIFY(tap(QStringLiteral("i")));
        QCOMPARE(m_host->commits, QStringList({ QStringLiteral("h"), QStringLiteral("i") }));
        QCOMPARE(m_host->text, QStringLiteral("hi"));
        QVERIFY(tap(QStringLiteral("Backspace")));
        QCOMPARE(m_host->keys.size(), 2);
        QCOMPARE(m_host->keys.at(0), qMakePair(int(QEvent::KeyPress), int(Qt::Key_Backspace)));
        QCOMPARE(m_host->keys.at(1), qMakePair(int(QEvent::KeyRelease), int(Qt::Key_Backspace)));
        QCOMPARE(m_host->text, QStringLiteral("h"));
        QVERIFY(tap(QStringLiteral("Space")));
        QCOMPARE(m_host->commits.last(), QStringLiteral(" "));
        m_host->keys.clear();
        m_host->keyTexts.clear();
        QVERIFY(tap(QStringLiteral("Enter")));
        QCOMPARE(m_host->keys.size(), 2);
        QCOMPARE(m_host->keys.at(0).second, int(Qt::Key_Return));
        QCOMPARE(m_host->keyTexts.at(0), QStringLiteral("\r"));
    }

    // The key mapping (keytext.h), straight.
    void keys()
    {
        m_im->sendKey(Qt::Key_A, Qt::ShiftModifier);
        m_im->sendKey(0xe9, 0);                    // é
        m_im->sendKey(Qt::Key_Left, Qt::ShiftModifier);
        m_im->sendKey(Qt::Key_A, Qt::ControlModifier);
        QCOMPARE(m_host->commits, QStringList({ QStringLiteral("A"), QStringLiteral("é") }));
        QCOMPARE(m_host->keys.size(), 4);
        QCOMPARE(m_host->keys.at(0).second, int(Qt::Key_Left));
        QCOMPARE(m_host->keys.at(2).second, int(Qt::Key_A));     // Ctrl+A: a shortcut, a key
    }

    // A candidate (a prediction) is committed; a preedit goes as one.
    void predictionAndPreedit()
    {
        m_im->show();
        QVERIFY(tap(QStringLiteral("t")));
        QVERIFY(tap(QStringLiteral("h")));
        QTRY_VERIFY(!kbProperty("candidates").toList().isEmpty());
        m_host->commits.clear();
        m_host->keys.clear();
        QMetaObject::invokeMethod(keyboard(), "pickCandidate", Q_ARG(QVariant, 0));
        // The word typed goes (two backspaces) and the candidate with a
        // space comes in its place.
        QVERIFY(!m_host->commits.isEmpty());
        QVERIFY2(m_host->text.endsWith(QLatin1Char(' ')), qPrintable(m_host->text));
        QVERIFY2(m_host->text.startsWith(QStringLiteral("th")), qPrintable(m_host->text));
        m_im->setPreedit(QStringLiteral("wor"));
        m_im->setPreedit(QString());
        QCOMPARE(m_host->preedits, QStringList({ QStringLiteral("wor"), QString() }));
    }

    // The field's type, from Maliit's content type and hidden text.
    void contentTypes()
    {
        const struct { int type; bool hidden; int field; bool words; } cases[] = {
            { Maliit::FreeTextContentType, false, 0, true },
            { Maliit::NumberContentType, false, 5, false },
            { Maliit::PhoneNumberContentType, false, 6, false },
            { Maliit::EmailContentType, false, 4, false },
            { Maliit::UrlContentType, false, 7, false },
            { Maliit::FreeTextContentType, true, 1, false },
        };
        for (const auto &c : cases) {
            m_host->type = c.type;
            m_host->hidden = c.hidden;
            m_im->update();
            QCOMPARE(editorType(), c.field);
            // Prediction only where words are typed.
            QCOMPARE(kbProperty("assistField").toBool(), c.words);
        }
        m_host->type = Maliit::FreeTextContentType;
        m_host->hidden = false;
        m_host->enterKey = Maliit::SendEnterKeyType;
        m_im->update();
        QCOMPARE(kbProperty("editorState").toMap().value(QStringLiteral("enterKeyLabel")).toString(), QStringLiteral("Send"));
    }

    // The text around the cursor (V3) and a sentence's capital (V1).
    void surroundingText()
    {
        // A move right after the keyboard's own typing is its own (the
        // keyboard knows what it typed): a while after, it reads the field.
        QTest::qWait(350);
        m_host->autoCap = true;
        m_host->text = QStringLiteral("Hello. Good wor");
        m_host->cursor = int(m_host->text.size());
        m_im->update();
        m_im->show();
        QTRY_COMPARE(kbProperty("_word").toString(), QStringLiteral("wor"));
        QCOMPARE(kbProperty("_prevWord").toString(), QStringLiteral("Good"));
        // A sentence starts after ". ": the next letter is a capital.
        m_host->text = QStringLiteral("Hello. ");
        m_host->cursor = int(m_host->text.size());
        m_im->handleClientChange();
        QTRY_VERIFY(kbProperty("_sentenceStart").toBool());
        m_host->commits.clear();
        QTRY_VERIFY(tap(QStringLiteral("a")) && !m_host->commits.isEmpty());
        QCOMPARE(m_host->commits.first(), QStringLiteral("A"));
    }

    // The hide key: the panel goes and the server is told; the server's
    // hide hides it too.
    void showHide()
    {
        m_im->show();
        QTRY_VERIFY(m_im->view()->isVisible());
        const int before = m_host->hidings;
        QMetaObject::invokeMethod(keyboard(), "hideRequested");
        QCOMPARE(m_host->hidings, before + 1);
        QVERIFY(!m_im->view()->isVisible());
        QVERIFY(!kbProperty("shown").toBool());
        m_im->show();
        QVERIFY(kbProperty("shown").toBool());
        m_im->hide();
        QVERIFY(!m_im->view()->isVisible());
        QVERIFY(!kbProperty("shown").toBool());
    }

    // The globe key's "webOS OSE" is OSE's own plugin (V7).
    void otherKeyboards()
    {
        QMetaObject::invokeMethod(keyboard(), "keyboardChosen", Q_ARG(QString, QStringLiteral("ose")));
        QCOMPARE(m_host->switchedTo, PhoenixInputMethod::oseKeyboardFileName());
    }

    // What it keeps between runs, in its own files.
    void state()
    {
        QVERIFY(m_im->writeState(QStringLiteral("words"), QStringLiteral("{\"a\":1}")));
        QCOMPARE(m_im->readState(QStringLiteral("words")), QStringLiteral("{\"a\":1}"));
        QFileInfo f(m_state.path() + QStringLiteral("/words.json"));
        QVERIFY(f.exists());
        QCOMPARE(f.permissions() & (QFileDevice::ReadOther | QFileDevice::ReadGroup), QFileDevice::Permissions());
        QVERIFY(!m_im->writeState(QStringLiteral("../x"), QStringLiteral("no")));
        QCOMPARE(m_im->readState(QStringLiteral("missing")), QString());
    }
};

QTEST_MAIN(KeyboardTest)
#include "keyboard_test.moc"
