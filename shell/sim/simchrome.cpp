// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

#include "simchrome.h"

#include <QAction>
#include <QActionGroup>
#include <QApplication>
#include <QBuffer>
#include <QCloseEvent>
#include <QDialog>
#include <QDesktopServices>
#include <QDialogButtonBox>
#include <QElapsedTimer>
#include <QFile>
#include <QFileInfo>
#include <QGuiApplication>
#include <QHeaderView>
#include <QImageReader>
#include <QJSValue>
#include <QKeyEvent>
#include <QKeySequence>
#include <QLabel>
#include <QLayout>
#include <QMenu>
#include <QMenuBar>
#include <QInputDialog>
#include <QLineEdit>
#include <QMessageBox>
#include <QPixmap>
#include <QPushButton>
#include <QQuickItem>
#include <QQuickView>
#include <QSettings>
#include <QTimer>
#include <QToolBar>
#include <QTreeWidget>
#include <QUrl>
#include <QVBoxLayout>
#include <QWindow>

#include <algorithm>
#include <cstdio>
#include <memory>

#ifdef Q_OS_MACOS
#include "simmac.h"
#endif
#ifdef PHOENIX_HAVE_XCB
#include <QtGui/qguiapplication_platform.h>
#include <xcb/xcb.h>
#include <cstdlib>
#endif

namespace {

// A QML value (a JS array or object) as a QVariant of lists and maps.
QVariant plain(const QVariant &v)
{
    if (v.metaType() == QMetaType::fromType<QJSValue>())
        return v.value<QJSValue>().toVariant();
    return v;
}

const char *const kToolbarSetting = "simulator/toolbar";

#ifdef PHOENIX_HAVE_XCB
// X11: the window manager asked to bring another simulator's window
// forward, as a taskbar or pager asks (_NET_ACTIVE_WINDOW from source 2,
// EWMH "Source indication in requests"). A window manager keeps a program
// from taking the focus by itself (focus stealing prevention), but does
// what a pager asks for the user. Without one (Xvfb) nothing hears it, and
// the simulator asked raises itself (SimChrome::bringToFront).
void askWindowManagerToActivate(quint32 window)
{
    auto *x11 = qGuiApp->nativeInterface<QNativeInterface::QX11Application>();
    if (!x11 || !x11->connection() || !window)
        return;
    xcb_connection_t *c = x11->connection();
    static const char name[] = "_NET_ACTIVE_WINDOW";
    xcb_intern_atom_reply_t *reply = xcb_intern_atom_reply(c, xcb_intern_atom(c, 0, sizeof(name) - 1, name), nullptr);
    if (!reply)
        return;
    const xcb_atom_t atom = reply->atom;
    std::free(reply);
    const xcb_screen_t *screen = xcb_setup_roots_iterator(xcb_get_setup(c)).data;
    if (!screen)
        return;
    xcb_client_message_event_t event = {};
    event.response_type = XCB_CLIENT_MESSAGE;
    event.format = 32;
    event.window = window;
    event.type = atom;
    event.data.data32[0] = 2;                   // a pager: the user's choice
    event.data.data32[1] = XCB_CURRENT_TIME;
    xcb_send_event(c, 0, screen->root, XCB_EVENT_MASK_SUBSTRUCTURE_NOTIFY | XCB_EVENT_MASK_SUBSTRUCTURE_REDIRECT,
                   reinterpret_cast<const char *>(&event));
    xcb_flush(c);
}
#endif

#ifdef Q_OS_MACOS
constexpr bool kMac = true;
#else
constexpr bool kMac = false;
#endif

} // namespace

QString SimChrome::displayName()
{
    return QStringLiteral("Phoenix WebOS Simulator");
}

SimChrome::SimChrome(QQuickView *view, bool toolbar)
    : m_view(view)
    , m_container(QWidget::createWindowContainer(view, this))
    , m_menuBar(nullptr)
    , m_toolbar(new QToolBar(tr("Simulator"), this))
    , m_refresh(new QTimer(this))
    , m_windowsLater(new QTimer(this))
    , m_instancesPoll(new QTimer(this))
    , m_instancesLater(new QTimer(this))
    , m_instanceInfoLater(new QTimer(this))
{
    setWindowTitle(displayName());
#ifdef Q_OS_MACOS
    // The menu bar at the top of the screen shows a window's own menu bar
    // only while that window is Qt's focus window, else the one made
    // without a window, if any (QCocoaMenuBar::updateMenuBarImmediately,
    // on every focus window change: qcocoanativeinterface.mm
    // onAppFocusWindowChanged). The focus window is nearly always the
    // device's screen, the QQuickView inside this window (a child window
    // with no menu bar: QNSView's topLevelWindow climbs to the top only
    // from a widget's window), so QMainWindow's own menu bar showed only
    // in the moments this window itself had the focus, and otherwise the
    // menu bar kept just the application menu. Made without a window, the
    // menu bar is the application's: there whichever window has the focus
    // (Qt's QMenuBar documentation, "QMenuBar as a Global Menu Bar").
    m_menuBar = new QMenuBar(nullptr);
    m_ownsMenuBar = m_menuBar->isNativeMenuBar();
    if (!m_ownsMenuBar)
        setMenuBar(m_menuBar);   // Qt::AA_DontUseNativeMenuBar: in the window
#else
    m_menuBar = menuBar();
#endif
    // The screen takes the keyboard: clicked, and from the start.
    m_container->setFocusPolicy(Qt::StrongFocus);
    m_container->setMinimumSize(64, 64);
    setCentralWidget(m_container);
    // No menu to hide the toolbar with: hidden, the screen would grow.
    setContextMenuPolicy(Qt::NoContextMenu);

    // Beside the screen where it has the room (resizeScreen).
    m_toolbar->setObjectName(QStringLiteral("simToolbar"));
    m_toolbar->setMovable(false);
    m_toolbar->setFloatable(false);
    m_toolbar->setIconSize(QSize(20, 20));
    m_toolbar->setContextMenuPolicy(Qt::NoContextMenu);
    addToolBar(Qt::RightToolBarArea, m_toolbar);
    m_toolbar->setVisible(toolbar && QSettings().value(QLatin1String(kToolbarSetting), true).toBool());
    // Says what it will do, as a Mac's View > Hide Toolbar.
    m_toolbarAction = new QAction(this);
    m_toolbarAction->setText(m_toolbar->isVisibleTo(this) ? tr("Hide Toolbar") : tr("Show Toolbar"));
    connect(m_toolbarAction, &QAction::triggered, this, [this]() {
        const bool on = !m_toolbar->isVisibleTo(this);
        setToolbarShown(on);
        QSettings().setValue(QLatin1String(kToolbarSetting), on);
    });

    // What the check boxes show changes with the keys too.
    m_refresh->setInterval(500);
    connect(m_refresh, &QTimer::timeout, this, &SimChrome::refreshChecks);
    // The Window menu's cards once the event that changed them is done (an
    // item's own trigger among them: its action is not deleted under it).
    m_windowsLater->setSingleShot(true);
    m_windowsLater->setInterval(0);
    connect(m_windowsLater, &QTimer::timeout, this, &SimChrome::refreshWindows);
    // The simulators: once a burst of changes to their folder is over, and
    // every second while the menu is open (one that crashed leaves its
    // entry behind; SimInstances::instances drops it).
    m_instancesLater->setSingleShot(true);
    m_instancesLater->setInterval(100);
    connect(m_instancesLater, &QTimer::timeout, this, &SimChrome::refreshInstances);
    m_instancesPoll->setInterval(1000);
    connect(m_instancesPoll, &QTimer::timeout, this, &SimChrome::refreshInstances);
    m_instanceInfoLater->setSingleShot(true);
    m_instanceInfoLater->setInterval(250);
    connect(m_instanceInfoLater, &QTimer::timeout, this, &SimChrome::updateInstanceInfo);
}

SimChrome::~SimChrome()
{
    if (m_ownsMenuBar)
        delete m_menuBar;
}

void SimChrome::build()
{
    QQuickItem *root = m_view->rootObject();
    if (!root)
        return;
    QVariant list;
    QMetaObject::invokeMethod(root, "simActionList", Q_RETURN_ARG(QVariant, list));
    for (const QVariant &v : plain(list).toList()) {
        const QVariantMap m = v.toMap();
        Entry e;
        e.id = m.value(QStringLiteral("id")).toString();
        e.menu = m.value(QStringLiteral("menu")).toString();
        e.submenu = m.value(QStringLiteral("submenu")).toString();
        e.text = m.value(QStringLiteral("text")).toString();
        e.tip = m.value(QStringLiteral("tip")).toString();
        e.keyText = m.value(QStringLiteral("keyText")).toString();
        e.radio = m.value(QStringLiteral("radio")).toString();
        e.icon = m.value(QStringLiteral("icon")).toString();
        e.keys = m.value(QStringLiteral("keys")).toStringList();
        for (const QVariant &k : m.value(QStringLiteral("press")).toList())
            e.press << k.toInt();
        e.separator = m.value(QStringLiteral("separator")).toBool();
        e.hold = m.value(QStringLiteral("hold")).toBool();
        e.run = m.value(QStringLiteral("run")).toBool();
        e.checkable = m.value(QStringLiteral("checkable")).toBool();
        e.dynamic = m.value(QStringLiteral("dynamic")).toBool();
        m_entries << e;
    }

    // The menus, in the menu bar's order (no mnemonics: Alt and a letter
    // belong to the device).
    menuFor(QStringLiteral("device"), QString());
    menuFor(QStringLiteral("simulate"), QString());
    menuFor(QStringLiteral("view"), QString());
    menuFor(QStringLiteral("services"), QString());
    menuFor(QStringLiteral("window"), QString());
    QHash<QString, QActionGroup *> groups;
    for (const Entry &e : std::as_const(m_entries)) {
        if (e.menu.isEmpty())
            continue;
        QMenu *menu = menuFor(e.menu, e.separator ? QString() : e.submenu);
        if (e.separator) {
            // With a name: a section's title (Window's Simulators, Cards).
            if (e.text.isEmpty())
                menu->addSeparator();
            else
                menu->addSection(e.text);
            continue;
        }
        const QString keys = menuKeys(e);
        // Linux shows the keys in the menu's shortcut column. A Mac's menu
        // would make them the item's own key equivalent, which then takes
        // the key from the device: there they go in brackets.
        QString text = e.text;
        if (!keys.isEmpty())
            text += kMac ? QStringLiteral("  (%1)").arg(keys) : QLatin1Char('\t') + keys;
        auto *action = menu->addAction(text);
        action->setIconText(e.text);
        action->setToolTip(keys.isEmpty() ? e.text : QStringLiteral("%1 (%2)").arg(e.text, keys));
        action->setStatusTip(e.tip);
        action->setCheckable(e.checkable || e.hold);
        // A check box in the menu says more than the icon would there.
        action->setIconVisibleInMenu(!action->isCheckable());
        // Not moved into the Mac's application menu by its name.
        action->setMenuRole(QAction::NoRole);
        if (!e.radio.isEmpty()) {
            QActionGroup *&group = groups[e.radio];
            if (!group)
                group = new QActionGroup(this);
            group->addAction(action);
        }
        connect(action, &QAction::triggered, this, [this, e](bool checked) { trigger(e, checked); });
        m_actions.insert(e.id, action);
    }
    QMenu *view = menuFor(QStringLiteral("view"), QString());
    view->addSeparator();
    view->addAction(m_toolbarAction);

    // Window: after its own items, the device's open cards, as they open,
    // close and come to the front (sim.qml simWindows; refreshWindows).
    m_windowMenu = menuFor(QStringLiteral("window"), QString());
    m_windowMenu->addSeparator();
    connect(m_windowMenu, &QMenu::aboutToShow, this, &SimChrome::refreshWindows);
    if (root->metaObject()->indexOfSignal("simWindowsChanged()") >= 0)
        connect(root, SIGNAL(simWindowsChanged()), m_windowsLater, SLOT(start()));
    refreshWindows();
    // Its simulators go before Next Simulator (setInstances).
    m_instancesBefore = m_actions.value(QStringLiteral("nextInstance"));
    connect(m_windowMenu, &QMenu::aboutToShow, this, [this]() {
        refreshInstances();
        m_instancesPoll->start();
    });
    connect(m_windowMenu, &QMenu::aboutToHide, m_instancesPoll, &QTimer::stop);

    QMenu *help = m_menuBar->addMenu(tr("Help"));
    QAction *sheet = help->addAction(tr("Keyboard Shortcuts…"));
    connect(sheet, &QAction::triggered, this, &SimChrome::showShortcuts);
    QAction *about = help->addAction(tr("About %1").arg(displayName()));
    about->setMenuRole(QAction::AboutRole);
    connect(about, &QAction::triggered, this, &SimChrome::showAbout);
    QMenu *device = menuFor(QStringLiteral("device"), QString());
    device->addSeparator();
    QAction *quit = device->addAction(tr("Quit"));
    quit->setMenuRole(QAction::QuitRole);
    connect(quit, &QAction::triggered, this, &QWidget::close);

    // The toolbar: sim.qml's simToolbar, "|" between groups.
    for (const QVariant &v : plain(root->property("simToolbar")).toList()) {
        const QString id = v.toString();
        if (id == QLatin1String("|"))
            m_toolbar->addSeparator();
        else if (QAction *a = m_actions.value(id))
            m_toolbar->addAction(a);
    }
    updateIcons();
    refreshChecks();
    m_refresh->start();
}

QMenu *SimChrome::menuFor(const QString &menu, const QString &submenu)
{
    const QString key = menu + QLatin1Char('/') + submenu;
    if (QMenu *m = m_menus.value(key))
        return m;
    QMenu *m;
    if (submenu.isEmpty()) {
        const QString title = menu == QLatin1String("device") ? tr("Device")
                            : menu == QLatin1String("simulate") ? tr("Simulate")
                            : menu == QLatin1String("view") ? tr("View")
                            : menu == QLatin1String("services") ? tr("Services")
                            : menu == QLatin1String("window") ? tr("Window") : menu;
        m = m_menuBar->addMenu(title);
    } else {
        m = menuFor(menu, QString())->addMenu(submenu);
    }
    connect(m, &QMenu::aboutToShow, this, &SimChrome::refreshChecks);
    m_menus.insert(key, m);
    return m;
}

bool SimChrome::checkChrome()
{
    // The keyboard focus on the screen, as after a start or a click on it.
    m_view->requestActivate();
    m_container->setFocus();
    QCoreApplication::processEvents();
    const QStringList expected = { tr("Device"), tr("Simulate"), tr("View"), tr("Services"), tr("Window"), tr("Help") };
    QWindow *focus = QGuiApplication::focusWindow();
    const QString focusName = !focus ? QStringLiteral("none")
                            : focus == m_view ? QStringLiteral("the device's screen")
                            : focus == windowHandle() ? QStringLiteral("the simulator's window")
                            : QString::fromLatin1(focus->metaObject()->className());
    std::printf("phoenix-sim: focus window: %s\n", qPrintable(focusName));
    std::printf("phoenix-sim: native menu bar: %s\n", m_menuBar->isNativeMenuBar() ? "yes" : "no");
    std::printf("phoenix-sim: menu bar without a window (the application's): %s\n", m_ownsMenuBar ? "yes" : "no");
    bool ok = true;
    QStringList shown;
#ifdef Q_OS_MACOS
    shown = SimMac::mainMenuTitles();
    const bool foreground = SimMac::isForegroundApp();
    std::printf("phoenix-sim: foreground app (Dock icon, own menu bar): %s\n", foreground ? "yes" : "no");
    std::printf("phoenix-sim: active app: %s\n", SimMac::isActive() ? "yes" : "no (another app has the menu bar until the simulator's window is clicked)");
    ok = foreground && m_menuBar->isNativeMenuBar() && m_ownsMenuBar;
#else
    for (QAction *a : m_menuBar->actions())
        if (a->isVisible())
            shown << a->text();
    ok = m_menuBar->isNativeMenuBar() || m_menuBar->isVisible();
#endif
    std::printf("phoenix-sim: menu bar: %s\n", qPrintable(shown.join(QStringLiteral(", "))));
    for (const QString &title : expected) {
        if (!shown.contains(title)) {
            std::printf("phoenix-sim: the menu bar has no %s menu\n", qPrintable(title));
            ok = false;
        }
    }

    // The keyboard focus taken by this window (a click on the toolbar)
    // goes back to the screen (showWithScreen).
    bool outer = false, back = false;
    const QMetaObject::Connection watch = connect(qApp, &QGuiApplication::focusWindowChanged, this, [this, &outer](QWindow *w) {
        outer = outer || w == windowHandle();
    });
    windowHandle()->requestActivate();
    QElapsedTimer clock;
    clock.start();
    while (clock.elapsed() < 3000 && !back) {
        QCoreApplication::processEvents(QEventLoop::AllEvents, 50);
        back = outer && QGuiApplication::focusWindow() == m_view;
    }
    disconnect(watch);
    std::printf("phoenix-sim: the simulator's window took the focus: %s; back on the screen: %s\n",
                outer ? "yes" : "no", back ? "yes" : "no");
    // Without the window system's say (an inactive app) there is nothing to check.
    if (outer && !back)
        ok = false;
    std::printf("phoenix-sim: chrome check %s\n", ok ? "passed" : "FAILED");
    std::fflush(stdout);
    return ok;
}

QString SimChrome::keyLabel(const QString &portable)
{
    const QKeySequence seq(portable, QKeySequence::PortableText);
    if (seq.isEmpty())
        return portable;
    QString text = seq.toString(QKeySequence::NativeText);
    // macOS keeps F1 to F12 for itself: with fn they are the keys.
    const int key = seq[0].key();
    if (kMac && key >= Qt::Key_F1 && key <= Qt::Key_F35)
        text = QStringLiteral("fn ") + text;
    return text;
}

QString SimChrome::menuKeys(const Entry &e) const
{
    return e.keys.isEmpty() ? e.keyText : keyLabel(e.keys.first());
}

QString SimChrome::allKeys(const Entry &e) const
{
    QStringList parts;
    for (const QString &k : e.keys)
        parts << keyLabel(k);
    if (!e.keyText.isEmpty())
        parts << e.keyText;
    return parts.join(QStringLiteral(", "));
}

void SimChrome::trigger(const Entry &e, bool checked)
{
    // The screen's window has the focus back first: a toolbar button or a
    // menu took it, and what the entry does may focus a field in it (the
    // keyboard button opens Just Type), which needs the window focused.
    m_container->setFocus();
    if (e.run) {
        QMetaObject::invokeMethod(m_view->rootObject(), "simTrigger", Q_ARG(QVariant, e.id));
    } else if (e.hold && checked) {
        // Pressed in order; the last let go of at once, the rest held until
        // the item is unchecked (Power and Volume Up, then Home).
        for (int key : e.press)
            sendKey(key, true);
        if (!e.press.isEmpty())
            sendKey(e.press.last(), false);
        m_held = e.press.mid(0, e.press.size() - 1);
    } else if (e.hold) {
        for (int i = m_held.size() - 1; i >= 0; --i)
            sendKey(m_held.at(i), false);
        m_held.clear();
    } else {
        for (int key : e.press)
            sendKey(key, true);
        for (int i = e.press.size() - 1; i >= 0; --i)
            sendKey(e.press.at(i), false);
    }
    refreshChecks();
    m_container->setFocus();
}

// A key pressed or let go of in the screen's window: what the keyboard's
// would do (the shell's SystemKeys takes it there, Shell.qml).
void SimChrome::sendKey(int key, bool press)
{
    QKeyEvent event(press ? QEvent::KeyPress : QEvent::KeyRelease, key, Qt::NoModifier);
    QCoreApplication::sendEvent(m_view, &event);
}

void SimChrome::refreshChecks()
{
    QQuickItem *root = m_view->rootObject();
    if (!root)
        return;
    for (const Entry &e : std::as_const(m_entries)) {
        if (!e.checkable && !e.dynamic)
            continue;
        QAction *a = m_actions.value(e.id);
        if (!a)
            continue;
        if (e.checkable) {
            QVariant on;
            QMetaObject::invokeMethod(root, "simActionChecked", Q_RETURN_ARG(QVariant, on), Q_ARG(QVariant, e.id));
            a->setChecked(on.toBool());
        }
        if (e.dynamic) {
            // {text, enabled, tip, icon}: what the item says now.
            QVariant v;
            QMetaObject::invokeMethod(root, "simActionState", Q_RETURN_ARG(QVariant, v), Q_ARG(QVariant, e.id));
            const QVariantMap st = plain(v).toMap();
            const QString text = st.value(QStringLiteral("text"), e.text).toString();
            const QString keys = menuKeys(e);
            a->setText(keys.isEmpty() ? text : kMac ? QStringLiteral("%1  (%2)").arg(text, keys) : text + QLatin1Char('\t') + keys);
            a->setIconText(text);
            a->setEnabled(st.value(QStringLiteral("enabled"), true).toBool());
            const QString tip = st.value(QStringLiteral("tip")).toString();
            a->setStatusTip(tip.isEmpty() ? e.tip : tip);
            // The toolbar button's tip: what it does now, and its keys.
            a->setToolTip(!tip.isEmpty() ? tip : keys.isEmpty() ? text : QStringLiteral("%1 (%2)").arg(text, keys));
            const QString iconName = st.value(QStringLiteral("icon"), e.icon).toString();
            if (!iconName.isEmpty() && a->property("simIcon").toString() != iconName) {
                a->setProperty("simIcon", iconName);
                a->setIcon(icon(iconName));
            }
        }
    }
}

// The Window menu's cards: sim.qml's simWindows ({uid, title, icon, checked,
// child}, card view's order; SimWindowMenu.qml), after the menu's own
// items. Made again when a card opens, closes, moves or is renamed; the
// check mark (the card in front, maximized) follows without that, so the
// item under the pointer stays while the menu is open.
void SimChrome::refreshWindows()
{
    QQuickItem *root = m_view->rootObject();
    if (!root || !m_windowMenu)
        return;
    const QVariantList list = plain(root->property("simWindows")).toList();
    const auto withoutChecks = [](const QVariantList &l) {
        QVariantList out;
        for (const QVariant &v : l) {
            QVariantMap m = v.toMap();
            m.remove(QStringLiteral("checked"));
            out << m;
        }
        return out;
    };
    if (m_windowActions.isEmpty() || withoutChecks(list) != withoutChecks(m_windowList)) {
        for (QAction *a : std::as_const(m_windowActions)) {
            m_windowMenu->removeAction(a);
            a->deleteLater();
        }
        m_windowActions.clear();
        if (list.isEmpty()) {
            QAction *none = m_windowMenu->addAction(tr("No Open Cards"));
            none->setEnabled(false);
            none->setMenuRole(QAction::NoRole);
            m_windowActions << none;
        }
        for (const QVariant &v : list) {
            const QVariantMap card = v.toMap();
            const QString uid = card.value(QStringLiteral("uid")).toString();
            // "&" is the item's own (a mnemonic) in a menu's text.
            QString text = card.value(QStringLiteral("title")).toString();
            text.replace(QLatin1Char('&'), QStringLiteral("&&"));
            // A card stacked on another: under it, indented, as in its stack.
            if (card.value(QStringLiteral("child")).toBool())
                text = QStringLiteral("\u2003\u2003") + text;
            QAction *a = m_windowMenu->addAction(cardIcon(card.value(QStringLiteral("icon")).toString()), text);
            a->setCheckable(true);
            a->setIconVisibleInMenu(true);
            a->setMenuRole(QAction::NoRole);
            a->setData(uid);
            connect(a, &QAction::triggered, this, [this, uid]() {
                // The screen's window takes the keyboard again first (trigger()).
                m_container->setFocus();
                if (QQuickItem *r = m_view->rootObject())
                    QMetaObject::invokeMethod(r, "simShowWindow", Q_ARG(QVariant, uid));
                m_container->setFocus();
                // Its check mark as the card comes forward (a click toggled it).
                m_windowsLater->start();
            });
            m_windowActions << a;
        }
    }
    m_windowList = list;
    for (int i = 0; i < list.size() && i < m_windowActions.size(); ++i) {
        QAction *a = m_windowActions.at(i);
        const bool front = list.at(i).toMap().value(QStringLiteral("checked")).toBool();
        a->setChecked(front);
        // A menu the style draws (Fusion: not the Mac's, nor a desktop's
        // global menu bar) has one column for the check mark and the icon,
        // where a checked item's icon is only drawn sunken: the card in
        // front shows its check mark there instead.
        if (!m_menuBar->isNativeMenuBar())
            a->setIconVisibleInMenu(!front);
    }
}

void SimChrome::setInstances(SimInstances *instances, const QVariantMap &base, bool list)
{
    m_instances = instances;
    m_instanceBase = base;
    if (!m_instances)
        return;
    QQuickItem *root = m_view->rootObject();
    // As it changes; once a resize of the window is over, not at every step.
    if (root && root->metaObject()->indexOfSignal("simInstanceInfoChanged()") >= 0)
        connect(root, SIGNAL(simInstanceInfoChanged()), m_instanceInfoLater, SLOT(start()));
    updateInstanceInfo();
    // Its name another's (the simulator this restarts, quitting) is waited for.
    if (list && !m_instances->start(m_instances->info()) && !m_instances->waiting())
        std::fprintf(stderr, "phoenix-sim: not listed in the other simulators' Window menu (%s cannot be written)\n",
                     qPrintable(m_instances->dir()));
    connect(m_instances, &SimInstances::raiseRequested, this, &SimChrome::bringToFront);
    connect(m_instances, &SimInstances::changed, m_instancesLater, QOverload<>::of(&QTimer::start));
    refreshInstances();
}

// What this simulator is now (sim.qml simInstanceInfo: its layout, size,
// look) and where it came from (base), in its entry.
void SimChrome::updateInstanceInfo()
{
    if (!m_instances)
        return;
    QVariantMap info = m_instanceBase;
    if (QQuickItem *root = m_view->rootObject()) {
        const QVariantMap qml = plain(root->property("simInstanceInfo")).toMap();
        for (auto it = qml.cbegin(); it != qml.cend(); ++it)
            info.insert(it.key(), it.value());
    }
    // X11: the window a pager would bring forward (askWindowManagerToActivate).
    if (QGuiApplication::platformName() == QLatin1String("xcb") && windowHandle())
        info.insert(QStringLiteral("x11Window"), static_cast<qulonglong>(winId()));
    m_instances->setInfo(info);
    refreshInstances();
}

QString SimChrome::instanceLabel(const SimInstances::Instance &instance)
{
    const QVariantMap &info = instance.info;
    QStringList parts;
    parts << info.value(QStringLiteral("device")).toString();
    const QString mode = info.value(QStringLiteral("mode")).toString();
    QString screen = mode == QLatin1String("tablet") ? tr("tablet") : mode == QLatin1String("phone") ? tr("phone") : mode;
    const int width = info.value(QStringLiteral("width")).toInt(), height = info.value(QStringLiteral("height")).toInt();
    if (width > 0 && height > 0)
        screen += QStringLiteral(" %1x%2").arg(width).arg(height);
    if (info.value(QStringLiteral("adaptive")).toBool())
        screen += tr(" (adaptive)");
    parts << screen.trimmed();
    const QString look = info.value(QStringLiteral("look")).toString();
    parts << (look == QLatin1String("classic") ? tr("Classic") : look == QLatin1String("ember-glass") ? tr("Ember Glass") : look);
    parts << info.value(QStringLiteral("checkout")).toString();
    parts.removeAll(QString());
    const QString name = instance.name.isEmpty() ? tr("Default") : instance.name;
    QString text = parts.isEmpty() ? name : tr("%1: %2").arg(name, parts.join(QStringLiteral(", ")));
    // "&" is the item's own (a mnemonic) in a menu's text.
    return text.replace(QLatin1Char('&'), QStringLiteral("&&"));
}

// Window > Simulators: one item each, in SimInstances' order, a check
// mark on this one; made again when one comes, goes or changes.
void SimChrome::refreshInstances()
{
    if (!m_instances || !m_windowMenu)
        return;
    const QList<SimInstances::Instance> list = m_instances->instances();
    QStringList labels;
    for (const SimInstances::Instance &i : list)
        labels << i.key + QLatin1Char('\n') + instanceLabel(i) + (i.self ? QStringLiteral("\n*") : QString());
    m_instanceList = list;
    m_otherInstances = int(std::count_if(list.cbegin(), list.cend(), [](const SimInstances::Instance &i) { return !i.self; }));
    if (labels == m_instanceLabels && !m_instanceActions.isEmpty()) {
        for (QAction *a : std::as_const(m_instanceActions))
            a->setChecked(a->data().toBool());
        return;
    }
    m_instanceLabels = labels;
    for (QAction *a : std::as_const(m_instanceActions)) {
        m_windowMenu->removeAction(a);
        a->deleteLater();
    }
    m_instanceActions.clear();
    for (const SimInstances::Instance &i : list) {
        auto *a = new QAction(instanceLabel(i), m_windowMenu);
        a->setCheckable(true);
        a->setChecked(i.self);
        a->setData(i.self);
        a->setMenuRole(QAction::NoRole);
        const QString where = i.info.value(QStringLiteral("checkoutPath")).toString();
        a->setStatusTip(where.isEmpty() ? QString() : tr("From %1").arg(where));
        const QString key = i.key;
        connect(a, &QAction::triggered, this, [this, a, key]() {
            // This one: nothing to do (the click unchecked it).
            a->setChecked(a->data().toBool());
            for (const SimInstances::Instance &other : std::as_const(m_instanceList)) {
                if (other.key == key && !other.self) {
                    // Once this window has had the focus back from its
                    // menu (the screen's, focusWindowChanged's): handed
                    // over before that, X11 gave it straight back here.
                    QMetaObject::invokeMethod(this, [this, other]() { showInstance(other); }, Qt::QueuedConnection);
                    break;
                }
            }
        });
        m_windowMenu->insertAction(m_instancesBefore, a);
        m_instanceActions << a;
    }
}

void SimChrome::showInstance(const SimInstances::Instance &instance)
{
    if (!m_instances || instance.self)
        return;
#ifdef Q_OS_MACOS
    // Another app: this one, active, hands it the activation.
    SimMac::activateProcess(instance.pid);
#endif
#ifdef PHOENIX_HAVE_XCB
    if (QGuiApplication::platformName() == QLatin1String("xcb"))
        askWindowManagerToActivate(instance.info.value(QStringLiteral("x11Window")).toUInt());
#endif
    // And it brings itself forward (bringToFront); gone meanwhile, it
    // leaves the menu.
    if (!m_instances->raise(instance.key))
        refreshInstances();
}

void SimChrome::showNextInstance()
{
    if (!m_instances)
        return;
    refreshInstances();
    const int n = int(m_instanceList.size());
    for (int i = 0; i < n; ++i) {
        if (!m_instanceList.at(i).self)
            continue;
        if (n > 1)
            showInstance(m_instanceList.at((i + 1) % n));
        return;
    }
}

void SimChrome::bringToFront()
{
    if (isMinimized())
        showNormal();
    show();
    raise();
    activateWindow();
#ifdef Q_OS_MACOS
    SimMac::activateSelf();
#endif
    // The keyboard on the screen, as after a click on it.
    m_view->requestActivate();
    m_container->setFocus();
}

// An app's icon (a file: or qrc: URL, as the launcher's), or none.
QIcon SimChrome::cardIcon(const QString &url)
{
    if (url.isEmpty())
        return QIcon();
    const auto cached = m_cardIcons.constFind(url);
    if (cached != m_cardIcons.constEnd())
        return cached.value();
    const QUrl u(url);
    const QString path = u.isLocalFile() ? u.toLocalFile()
                       : u.scheme() == QLatin1String("qrc") ? QLatin1Char(':') + u.path()
                       : u.scheme().isEmpty() ? url : QString();
    // Not there yet (an app still installing): looked for again next time.
    if (path.isEmpty() || !QFile::exists(path))
        return QIcon();
    const QIcon icon(path);
    m_cardIcons.insert(url, icon);
    return icon;
}

void SimChrome::showWithScreen(const QSize &screen)
{
    // A first guess from the bars' sizes, then exact once laid out.
    const int bar = m_menuBar->isNativeMenuBar() ? 0 : m_menuBar->sizeHint().height();
    const QSize tools = m_toolbar->isVisibleTo(this) ? m_toolbar->sizeHint() : QSize(0, 0);
    if (screen.height() >= screen.width())
        resize(screen.width() + tools.width(), screen.height() + bar);
    else
        resize(screen.width(), screen.height() + bar + tools.height());
    show();
    // Keys this window gets go on to the screen (eventFilter).
    if (QWindow *window = windowHandle())
        window->installEventFilter(this);
    // A click on the toolbar or the menu bar makes this window, around the
    // screen's, the focus window (the window system's focus moves to it;
    // the toolbar's buttons take no focus themselves). The screen's window
    // then has none: its items cannot take the active focus (Qt Quick gives
    // it only in the focus window), so a field an item focuses, Just Type's
    // after the Show Virtual Keyboard button, got no keyboard. The focus
    // goes straight back to the screen, once the window system is done.
    connect(qApp, &QGuiApplication::focusWindowChanged, this, [this](QWindow *focus) {
        // Still so, once the window system is done: a focus this window
        // had only for a moment is not taken back. Its menu closing gives
        // it the focus a moment (X11), after another simulator was brought
        // forward from it (Window > Simulators), which then lost it again.
        if (focus && focus == windowHandle() && QGuiApplication::focusWindow() == windowHandle())
            m_view->requestActivate();
    }, Qt::QueuedConnection);
    resizeScreen(screen.width(), screen.height());
    m_container->setFocus();
}

void SimChrome::resizeScreen(int width, int height)
{
    // Down the right of an upright screen, as an emulator's side panel, and
    // along the top of one on its side: where all its buttons fit.
    const Qt::ToolBarArea area = height >= width ? Qt::RightToolBarArea : Qt::TopToolBarArea;
    if (toolBarArea(m_toolbar) != area) {
        const bool shown = m_toolbar->isVisibleTo(this);
        addToolBar(area, m_toolbar);
        m_toolbar->setVisible(shown);
    }
    if (QLayout *l = layout())
        l->activate();
    const QSize delta = QSize(width, height) - m_container->size();
    if (!delta.isNull())
        resize(size() + delta);
}

void SimChrome::setScreenInfo(const QString &info)
{
    setWindowTitle(info.isEmpty() ? displayName() : displayName() + QStringLiteral(" \u2014 ") + info);
}

void SimChrome::setToolbarShown(bool shown)
{
    const QSize screen = m_container->size();
    m_toolbar->setVisible(shown);
    m_toolbarAction->setText(shown ? tr("Hide Toolbar") : tr("Show Toolbar"));
    resizeScreen(screen.width(), screen.height());
}

// An icon in the window's text colour, sharp at the screen's density
// (the SVG's currentColor; without Qt's SVG image plugin, none).
QIcon SimChrome::icon(const QString &name) const
{
    QFile file(QStringLiteral(":/sim/icons/%1.svg").arg(name));
    if (name.isEmpty() || !file.open(QIODevice::ReadOnly))
        return QIcon();
    QByteArray svg = file.readAll();
    svg.replace("currentColor", palette().color(QPalette::ButtonText).name().toLatin1());
    QIcon icon;
    const QSize size = m_toolbar->iconSize();
    for (int scale = 1; scale <= 3; ++scale) {
        QBuffer buffer(&svg);
        QImageReader reader(&buffer, "svg");
        reader.setScaledSize(size * scale);
        const QImage image = reader.read();
        if (image.isNull())
            return QIcon();
        QPixmap pixmap = QPixmap::fromImage(image);
        pixmap.setDevicePixelRatio(scale);
        icon.addPixmap(pixmap);
    }
    return icon;
}

void SimChrome::updateIcons()
{
    bool all = true;
    for (const Entry &e : std::as_const(m_entries)) {
        QAction *a = m_actions.value(e.id);
        if (!a || e.icon.isEmpty())
            continue;
        const QString name = a->property("simIcon").toString();
        const QIcon i = icon(name.isEmpty() ? e.icon : name);
        all = all && !i.isNull();
        a->setIcon(i);
    }
    // Without the SVG plugin the toolbar says what its buttons are.
    m_toolbar->setToolButtonStyle(all ? Qt::ToolButtonIconOnly : Qt::ToolButtonTextOnly);
}

void SimChrome::changeEvent(QEvent *event)
{
    QMainWindow::changeEvent(event);
    // Dark or light: the icons in the new text colour.
    if (event->type() == QEvent::PaletteChange && !m_entries.isEmpty())
        updateIcons();
}

// Keys that reach this window rather than the screen's window inside it
// (the window has the keyboard: just activated, or with the pointer over
// the menu bar or toolbar where the window system lets the pointer decide):
// on to the screen, where the shell and the apps take them, as if it had
// had the keyboard.
bool SimChrome::eventFilter(QObject *watched, QEvent *event)
{
    if (watched == windowHandle() && (event->type() == QEvent::KeyPress || event->type() == QEvent::KeyRelease)) {
        // The screen's window is then not the focus window, and Qt Quick
        // gives a key only to the item with the active focus, which only
        // the focus window has (QQuickWindow::focusOutEvent takes it away,
        // QQuickDeliveryAgent's deliverKeyEvent needs it): the key reaches
        // the shell's window-wide filters there (the system keys; the lock
        // screen's keys, which wake the screen and open the passcode's
        // entry), but typed into a field it went nowhere, and so did every
        // key after it. The hand-back when this window took the focus
        // (showWithScreen) can come too early: X11 refuses a focus change
        // older than the last (xdotool's windowfocus, a window manager's).
        // So the screen asks for the keyboard again with this key's time,
        // and the next key reaches its focused item.
        if (event->type() == QEvent::KeyPress && QGuiApplication::focusWindow() != m_view)
            m_view->requestActivate();
        std::unique_ptr<QEvent> copy(event->clone());
        QCoreApplication::sendEvent(m_view, copy.get());
        return true;
    }
    return QMainWindow::eventFilter(watched, event);
}

void SimChrome::closeEvent(QCloseEvent *event)
{
    // As closing the screen's own window: the device turns off first, the
    // shutdown sound playing (sim.qml), and quits after.
    QCloseEvent close;
    QCoreApplication::sendEvent(m_view, &close);
    if (!close.isAccepted()) {
        event->ignore();
        return;
    }
    if (m_shortcuts)
        m_shortcuts->close();
    event->accept();
}

// Help > Keyboard Shortcuts: every key of the list, by menu.
void SimChrome::showShortcuts()
{
    if (m_shortcuts) {
        m_shortcuts->show();
        m_shortcuts->raise();
        m_shortcuts->activateWindow();
        return;
    }
    auto *dialog = new QDialog(this);
    dialog->setAttribute(Qt::WA_DeleteOnClose);
    dialog->setObjectName(QStringLiteral("simShortcuts"));
    dialog->setWindowTitle(tr("Keyboard Shortcuts"));
    auto *layout = new QVBoxLayout(dialog);
    QString note = tr("The keys work wherever the keyboard focus is on the device's screen, in an app too. "
                      "Each is in the Device, Simulate or Window menu as well.");
    if (kMac)
        note += QLatin1Char(' ')
              + tr("On a Mac, F1 to F12 need fn (macOS keeps them for itself), Home is fn+Left Arrow, "
                   "and Ctrl is Command (⌘).");
    auto *label = new QLabel(note, dialog);
    label->setWordWrap(true);
    layout->addWidget(label);

    auto *tree = new QTreeWidget(dialog);
    tree->setObjectName(QStringLiteral("simShortcutList"));
    tree->setColumnCount(3);
    tree->setHeaderLabels({ tr("Keys"), tr("Function"), tr("What it does") });
    tree->setRootIsDecorated(false);
    tree->setSelectionMode(QAbstractItemView::NoSelection);
    tree->setFocusPolicy(Qt::NoFocus);
    tree->setWordWrap(true);
    tree->setUniformRowHeights(false);
    QString section;
    QTreeWidgetItem *group = nullptr;
    for (const Entry &e : std::as_const(m_entries)) {
        if (e.separator || (e.keys.isEmpty() && e.keyText.isEmpty()))
            continue;
        if (!group || e.menu != section) {
            section = e.menu;
            const QString title = section == QLatin1String("device") ? tr("Device")
                                : section == QLatin1String("simulate") ? tr("Simulate")
                                : section == QLatin1String("view") ? tr("View")
                                : section == QLatin1String("window") ? tr("Window") : tr("The shell");
            group = new QTreeWidgetItem(tree, { title });
            group->setFirstColumnSpanned(true);
            QFont bold = group->font(0);
            bold.setBold(true);
            group->setFont(0, bold);
        }
        auto *item = new QTreeWidgetItem(group, { allKeys(e), e.text, e.tip });
        item->setToolTip(2, e.tip);
    }
    tree->expandAll();
    tree->header()->setSectionResizeMode(0, QHeaderView::ResizeToContents);
    tree->header()->setSectionResizeMode(1, QHeaderView::ResizeToContents);
    tree->header()->setStretchLastSection(true);
    layout->addWidget(tree);

    auto *buttons = new QDialogButtonBox(QDialogButtonBox::Close, dialog);
    connect(buttons, &QDialogButtonBox::rejected, dialog, &QDialog::close);
    layout->addWidget(buttons);
    dialog->resize(900, 700);
    m_shortcuts = dialog;
    dialog->show();
}

void SimChrome::alert(const QString &text, const QString &details, const QString &logFile)
{
    auto *box = new QMessageBox(QMessageBox::Warning, displayName(), text, QMessageBox::Close, this);
    box->setAttribute(Qt::WA_DeleteOnClose);
    box->setInformativeText(details);
    if (!logFile.isEmpty() && QFile::exists(logFile)) {
        QPushButton *log = box->addButton(tr("Show Log"), QMessageBox::ActionRole);
        // Opens it, and the box stays.
        log->disconnect();
        connect(log, &QPushButton::clicked, this, [logFile]() { QDesktopServices::openUrl(QUrl::fromLocalFile(logFile)); });
    }
    box->open();
}

QString SimChrome::askText(const QString &title, const QString &label, const QString &text)
{
    bool ok = false;
    const QString answer = QInputDialog::getText(this, title, label, QLineEdit::Normal, text, &ok);
    return ok ? answer : QString();
}

void SimChrome::showAbout()
{
    QMessageBox::about(this, tr("About %1").arg(displayName()),
        tr("<h3>%1</h3>"
           "<p>The webOS Phoenix shell on your desktop: the webOS 1.x to 3.x experience "
           "(cards, gestures, Just Type, notifications, Synergy) and its apps, with the "
           "device simulated around them.</p>"
           "<p>Help &gt; Keyboard Shortcuts lists its keys.</p>"
           "<p>Apache License 2.0. Qt %2.</p>")
            .arg(displayName(), QString::fromLatin1(qVersion())));
}
