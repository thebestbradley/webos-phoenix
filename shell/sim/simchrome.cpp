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
#include <QFile>
#include <QHeaderView>
#include <QImageReader>
#include <QJSValue>
#include <QKeyEvent>
#include <QKeySequence>
#include <QLabel>
#include <QLayout>
#include <QMenu>
#include <QMenuBar>
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

#include <memory>

namespace {

// A QML value (a JS array or object) as a QVariant of lists and maps.
QVariant plain(const QVariant &v)
{
    if (v.metaType() == QMetaType::fromType<QJSValue>())
        return v.value<QJSValue>().toVariant();
    return v;
}

const char *const kToolbarSetting = "simulator/toolbar";

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
    , m_toolbar(new QToolBar(tr("Simulator"), this))
    , m_refresh(new QTimer(this))
{
    setWindowTitle(displayName());
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
    m_toolbarAction = new QAction(tr("Show Toolbar"), this);
    m_toolbarAction->setCheckable(true);
    m_toolbarAction->setChecked(m_toolbar->isVisibleTo(this));
    connect(m_toolbarAction, &QAction::triggered, this, [this](bool on) {
        setToolbarShown(on);
        QSettings().setValue(QLatin1String(kToolbarSetting), on);
    });

    // What the check boxes show changes with the keys too.
    m_refresh->setInterval(500);
    connect(m_refresh, &QTimer::timeout, this, &SimChrome::refreshChecks);
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
    QHash<QString, QActionGroup *> groups;
    for (const Entry &e : std::as_const(m_entries)) {
        if (e.menu.isEmpty())
            continue;
        QMenu *menu = menuFor(e.menu, e.separator ? QString() : e.submenu);
        if (e.separator) {
            menu->addSeparator();
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

    QMenu *help = menuBar()->addMenu(tr("Help"));
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
                            : menu == QLatin1String("services") ? tr("Services") : menu;
        m = menuBar()->addMenu(title);
    } else {
        m = menuFor(menu, QString())->addMenu(submenu);
    }
    connect(m, &QMenu::aboutToShow, this, &SimChrome::refreshChecks);
    m_menus.insert(key, m);
    return m;
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
            // {text, enabled, tip}: what the item says now.
            QVariant v;
            QMetaObject::invokeMethod(root, "simActionState", Q_RETURN_ARG(QVariant, v), Q_ARG(QVariant, e.id));
            const QVariantMap st = plain(v).toMap();
            const QString text = st.value(QStringLiteral("text"), e.text).toString();
            const QString keys = menuKeys(e);
            a->setText(keys.isEmpty() ? text : kMac ? QStringLiteral("%1  (%2)").arg(text, keys) : text + QLatin1Char('\t') + keys);
            a->setEnabled(st.value(QStringLiteral("enabled"), true).toBool());
            const QString tip = st.value(QStringLiteral("tip")).toString();
            a->setStatusTip(tip.isEmpty() ? e.tip : tip);
            a->setToolTip(tip.isEmpty() ? text : tip);
        }
    }
}

void SimChrome::showWithScreen(const QSize &screen)
{
    // A first guess from the bars' sizes, then exact once laid out.
    const int bar = menuBar()->isNativeMenuBar() ? 0 : menuBar()->sizeHint().height();
    const QSize tools = m_toolbar->isVisibleTo(this) ? m_toolbar->sizeHint() : QSize(0, 0);
    if (screen.height() >= screen.width())
        resize(screen.width() + tools.width(), screen.height() + bar);
    else
        resize(screen.width(), screen.height() + bar + tools.height());
    show();
    // Keys this window gets go on to the screen (eventFilter).
    if (QWindow *window = windowHandle())
        window->installEventFilter(this);
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
    m_toolbarAction->setChecked(shown);
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
        const QIcon i = icon(e.icon);
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
                      "Each is in the Device or Simulate menu as well.");
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
                                : section == QLatin1String("view") ? tr("View") : tr("The shell");
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
