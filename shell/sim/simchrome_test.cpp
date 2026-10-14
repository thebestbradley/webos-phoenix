// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// simchrome-test: phoenix-sim's menu bar (SimChrome) around a stand-in for
// sim.qml. The Window menu: its own items from the list, then the device's
// open cards (simWindows), "No Open Cards" without any, a check mark on the
// card in front, the cards' titles and icons, the menu made again as cards
// open and close, and the card chosen handed to simShowWindow. With the
// device's screen off, the menu bar and its menus still take the pointer:
// only the screen itself is dark (UserActivity). The list itself:
// shell/tests/tst_simwindowmenu.qml.
//
//   QT_QPA_PLATFORM=offscreen build/simchrome-test

#include "simchrome.h"

#include <QAction>
#include <QApplication>
#include <QFile>
#include <QJSValue>
#include <QMenu>
#include <QMenuBar>
#include <QQmlEngine>
#include <QQuickItem>
#include <QQuickView>
#include <QScopeGuard>
#include <QTemporaryDir>
#include <QTest>
#include <QUrl>

#include <cstdio>

#ifndef PHOENIX_QML_BUILD_DIR
#define PHOENIX_QML_BUILD_DIR ""
#endif
#ifndef PHOENIX_REPO_DIR
#define PHOENIX_REPO_DIR ""
#endif

static int failures = 0;
static void check(bool ok, const QString &what)
{
    std::printf("%s %s\n", ok ? "ok  " : "FAIL", qPrintable(what));
    std::fflush(stdout);
    if (!ok)
        ++failures;
}

// sim.qml's side of the contract (simActionList, simWindows, simShowWindow,
// simTrigger), and the shell's UserActivity, asleep while the screen is off.
static const char kRoot[] = R"(
import QtQuick
import Phoenix.Native

Item {
    id: root
    width: 320
    height: 480
    property var simWindows: []
    property var shown: []
    property var triggered: []
    readonly property var simToolbar: []
    property int wakes: 0
    property alias asleep: activity.asleep
    UserActivity {
        id: activity
        tapToWake: true
        onWakeRequested: root.wakes++
    }
    function simActionList() {
        return [
            { id: "windowCardView", menu: "window", text: "Card View", run: true, dynamic: true },
            { separator: true, menu: "window" },
            { id: "nextCard", menu: "window", text: "Next Card", keys: ["Ctrl+Shift+]"], run: true, dynamic: true }
        ];
    }
    function simActionChecked(id) { return false; }
    function simActionState(id) { return { enabled: true }; }
    function simTrigger(id) { triggered = triggered.concat([id]); }
    function simShowWindow(uid) { shown = shown.concat([uid]); return true; }
}
)";

static QVariantMap card(const QString &uid, const QString &title, const QString &icon, bool checked, bool child)
{
    return { { QStringLiteral("uid"), uid }, { QStringLiteral("appId"), QStringLiteral("app.") + uid },
             { QStringLiteral("title"), title }, { QStringLiteral("icon"), icon },
             { QStringLiteral("checked"), checked }, { QStringLiteral("child"), child } };
}

// The menu's items after its last separator: the cards (or "No Open Cards").
static QList<QAction *> cardItems(QMenu *menu)
{
    QList<QAction *> out;
    for (QAction *a : menu->actions()) {
        if (a->isSeparator())
            out.clear();
        else
            out << a;
    }
    return out;
}

static QStringList texts(const QList<QAction *> &actions)
{
    QStringList out;
    for (QAction *a : actions)
        out << a->text();
    return out;
}

static QString checks(const QList<QAction *> &actions)
{
    QString out;
    for (QAction *a : actions)
        out += a->isChecked() ? QLatin1Char('x') : QLatin1Char('-');
    return out;
}

// A QML list property's strings (a var: a JS array).
static QStringList strings(QQuickItem *root, const char *name)
{
    QVariant v = root->property(name);
    if (v.metaType() == QMetaType::fromType<QJSValue>())
        v = v.value<QJSValue>().toVariant();
    return v.toStringList();
}

int main(int argc, char **argv)
{
    if (qEnvironmentVariableIsEmpty("QT_QPA_PLATFORM"))
        qputenv("QT_QPA_PLATFORM", "offscreen");
    QApplication app(argc, argv);

    QTemporaryDir dir;
    QFile file(dir.filePath(QStringLiteral("root.qml")));
    if (!file.open(QIODevice::WriteOnly) || file.write(kRoot) < 0)
        return 1;
    file.close();
    QQuickView view;
    view.engine()->addImportPath(QStringLiteral(PHOENIX_QML_BUILD_DIR));
    view.setResizeMode(QQuickView::SizeRootObjectToView);
    view.setSource(QUrl::fromLocalFile(file.fileName()));
    check(view.status() == QQuickView::Ready, QStringLiteral("the stand-in for sim.qml loads (Phoenix.Native from the build)"));
    if (view.status() != QQuickView::Ready)
        return 1;
    QQuickItem *root = view.rootObject();

    SimChrome chrome(&view, false);
    // The chrome's window container owns the view: given back before the
    // chrome goes, as phoenix-sim does (main.cpp), or both delete it.
    const auto giveBack = qScopeGuard([&view]() { view.setParent(static_cast<QWindow *>(nullptr)); });
    chrome.build();
    chrome.showWithScreen(QSize(320, 480));
    QCoreApplication::processEvents();

    // The window's, or on a Mac the application's (made without a window).
    QMenuBar *bar = nullptr;
    for (QWidget *w : QApplication::allWidgets()) {
        auto *b = qobject_cast<QMenuBar *>(w);
        if (b && !b->actions().isEmpty())
            bar = b;
    }
    check(bar != nullptr, QStringLiteral("a menu bar"));
    if (!bar)
        return 1;
    QStringList titles;
    QMenu *window = nullptr;
    QAction *windowTitle = nullptr;
    for (QAction *a : bar->actions()) {
        titles << a->text();
        if (a->text() == QLatin1String("Window")) {
            window = a->menu();
            windowTitle = a;
        }
    }
    check(titles == QStringList({ QStringLiteral("Device"), QStringLiteral("Simulate"), QStringLiteral("View"),
                                  QStringLiteral("Services"), QStringLiteral("Window"), QStringLiteral("Help") }),
          QStringLiteral("the menu bar: Device, Simulate, View, Services, Window, Help (") + titles.join(QStringLiteral(", ")) + QLatin1Char(')'));
    if (!window)
        return 1;

    QStringList own;
    for (QAction *a : window->actions())
        if (!a->isSeparator())
            own << a->text();
#ifdef Q_OS_MACOS
    const QString next = QStringLiteral("Next Card  (%1)").arg(SimChrome::keyLabel(QStringLiteral("Ctrl+Shift+]")));
#else
    const QString next = QStringLiteral("Next Card\tCtrl+Shift+]");
#endif
    check(own.mid(0, 2) == QStringList({ QStringLiteral("Card View"), next }),
          QStringLiteral("its own items first, keys in the shortcut column (") + own.join(QStringLiteral(" | ")) + QLatin1Char(')'));

    QList<QAction *> items = cardItems(window);
    check(texts(items) == QStringList({ QStringLiteral("No Open Cards") }) && !items.first()->isEnabled(),
          QStringLiteral("no cards: \"No Open Cards\", greyed"));

    // Three cards open, the second stacked on the first and in front.
    const QString icon = QUrl::fromLocalFile(QStringLiteral(PHOENIX_REPO_DIR "/shell/assets/openwebos/launcher3/launcher-bg64.png")).toString();
    root->setProperty("simWindows", QVariantList({ card(QStringLiteral("w1"), QStringLiteral("Email"), icon, false, false),
                                                   card(QStringLiteral("w2"), QStringLiteral("Drafts & Sent"), QString(), true, true),
                                                   card(QStringLiteral("w3"), QStringLiteral("Calendar"), QString(), false, false) }));
    QTest::qWait(0);
    items = cardItems(window);
    check(texts(items) == QStringList({ QStringLiteral("Email"), QStringLiteral("  Drafts && Sent"), QStringLiteral("Calendar") }),
          QStringLiteral("the cards as they open, in order, a stacked card indented, \"&\" shown as itself (") + texts(items).join(QStringLiteral(" | ")) + QLatin1Char(')'));
    check(checks(items) == QLatin1String("-x-"), QStringLiteral("a check mark on the card in front (") + checks(items) + QLatin1Char(')'));
    check(items.size() == 3 && items.at(0)->isCheckable() && items.at(0)->isEnabled() && !items.at(0)->icon().isNull()
              && items.at(2)->icon().isNull(),
          QStringLiteral("each can be chosen, with its app's icon where it has one"));
    // A native menu (a Mac's) shows both.
    const bool native = bar->isNativeMenuBar();
    check(items.size() == 3 && items.at(0)->isIconVisibleInMenu() && items.at(1)->isIconVisibleInMenu() == native,
          QStringLiteral("in a menu the style draws the card in front shows its check mark where its icon was"));

    // The card in front changes: the same items, the check mark moved.
    const QList<QAction *> before = items;
    root->setProperty("simWindows", QVariantList({ card(QStringLiteral("w1"), QStringLiteral("Email"), icon, true, false),
                                                   card(QStringLiteral("w2"), QStringLiteral("Drafts & Sent"), QString(), false, true),
                                                   card(QStringLiteral("w3"), QStringLiteral("Calendar"), QString(), false, false) }));
    QTest::qWait(0);
    items = cardItems(window);
    check(items == before && checks(items) == QLatin1String("x--"),
          QStringLiteral("another card in front: the check mark moves, the items stay (") + checks(items) + QLatin1Char(')'));

    // Choosing one: simShowWindow with its card; the menu's own: simTrigger.
    items.at(2)->trigger();
    check(strings(root, "shown") == QStringList({ QStringLiteral("w3") }), QStringLiteral("choosing Calendar shows its card (simShowWindow w3)"));
    for (QAction *a : window->actions())
        if (a->text() == QLatin1String("Card View"))
            a->trigger();
    check(strings(root, "triggered") == QStringList({ QStringLiteral("windowCardView") }), QStringLiteral("Card View runs its entry"));

    // A card closes.
    root->setProperty("simWindows", QVariantList({ card(QStringLiteral("w1"), QStringLiteral("Email"), icon, true, false) }));
    QTest::qWait(0);
    check(texts(cardItems(window)) == QStringList({ QStringLiteral("Email") }), QStringLiteral("closed cards leave the menu"));

    // The screen off: a click on the menu bar opens the menu, and one in the
    // menu chooses the card, without waking the screen; a click on the
    // screen still only wakes it.
    root->setProperty("asleep", true);
    if (native) {
        std::printf("skip a native menu bar takes no synthesized clicks\n");
        std::printf("%s\n", failures ? "simchrome-test FAILED" : "simchrome-test passed");
        return failures ? 1 : 0;
    }
    const QPoint title = bar->mapTo(&chrome, bar->actionGeometry(windowTitle).center());
    QTest::mouseClick(chrome.windowHandle(), Qt::LeftButton, Qt::NoModifier, title);
    QTest::qWait(50);
    check(window->isVisible(), QStringLiteral("screen off: the menu bar still opens the Window menu"));
    check(root->property("wakes").toInt() == 0, QStringLiteral("and does not wake the screen"));
    if (window->isVisible() && window->windowHandle()) {
        QAction *email = cardItems(window).value(0);
        QTest::mouseClick(window->windowHandle(), Qt::LeftButton, Qt::NoModifier, window->actionGeometry(email).center());
        QTest::qWait(50);
    }
    check(strings(root, "shown") == QStringList({ QStringLiteral("w3"), QStringLiteral("w1") }),
          QStringLiteral("screen off: a card chosen in the menu is shown (") + strings(root, "shown").join(QStringLiteral(", ")) + QLatin1Char(')'));
    window->hide();
    QTest::mouseClick(&view, Qt::LeftButton, Qt::NoModifier, QPoint(100, 100));
    check(root->property("wakes").toInt() == 1, QStringLiteral("a click on the dark screen wakes it"));

    root->setProperty("simWindows", QVariantList());
    QTest::qWait(0);
    check(texts(cardItems(window)) == QStringList({ QStringLiteral("No Open Cards") }), QStringLiteral("all closed: \"No Open Cards\" again"));

    std::printf("%s\n", failures ? "simchrome-test FAILED" : "simchrome-test passed");
    return failures ? 1 : 0;
}
