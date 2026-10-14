// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// phoenix-sim's window: the device's screen (the QQuickView running sim.qml)
// under a menu bar (macOS: the one at the top of the screen, made without a
// window: see the constructor) and beside a toolbar. Every menu
// item, toolbar button and line of Help > Keyboard Shortcuts is made from
// sim.qml's simActions, the list its keyboard shortcuts come from too, so
// they cannot drift apart. An item runs the entry (simTrigger) or, for the
// keys the shell handles itself (Power, Home, the volume, the chords),
// presses and lets go of them in the screen's window, as the keyboard would.
// The Window menu also lists the device's open cards (sim.qml simWindows,
// SimWindowMenu.qml), live, and shows the one chosen (simShowWindow); and
// the simulators running on this computer (SimInstances, --instance), the
// one chosen brought to the front.
//
// The screen stays the size it was without the window: the menus and the
// toolbar are around it (resizeScreen), and --screenshot grabs the screen
// alone.

#pragma once

#include <QHash>
#include <QIcon>
#include <QList>
#include <QMainWindow>
#include <QPointer>
#include <QStringList>
#include <QVariantList>

#include "siminstances.h"

class QAction;
class QDialog;
class QMenu;
class QMenuBar;
class QQuickView;
class QTimer;
class QToolBar;

class SimChrome : public QMainWindow
{
    Q_OBJECT
public:
    // The program's name as people see it (the window, the menu bar).
    static QString displayName();

    SimChrome(QQuickView *view, bool toolbar);
    ~SimChrome() override;

    // Once sim.qml has loaded: the menus and the toolbar from its list.
    void build();
    // Shows the window around a screen of this size.
    void showWithScreen(const QSize &screen);
    // The window resized around a screen of this size (sim.qml, as the
    // device turns on its side).
    Q_INVOKABLE void resizeScreen(int width, int height);
    // What the screen is ("393x852, phone (adaptive)"), after the name in
    // the window's title (sim.qml, as the window is resized).
    Q_INVOKABLE void setScreenInfo(const QString &info);
    // A problem to tell (sim.qml: the catalog service failed to start from
    // the Services menu): a warning with the details, and a Show Log button
    // when there is a log to open.
    Q_INVOKABLE void alert(const QString &text, const QString &details, const QString &logFile);
    // A line of text asked for (sim.qml: Simulate > Location > Custom...);
    // "" when cancelled.
    Q_INVOKABLE QString askText(const QString &title, const QString &label, const QString &text);

    // Window > Simulators: the simulators running for this user, this one
    // among them, listed (start) unless list is false (a run that only
    // takes a screenshot or checks the menu bar, then quits). base: what
    // the others show of it beyond sim.qml's simInstanceInfo (checkout).
    void setInstances(SimInstances *instances, const QVariantMap &base, bool list);
    // Next Simulator (sim.qml): the next one after this, in the menu's
    // order, to the front; whether there is another.
    Q_INVOKABLE void showNextInstance();
    Q_INVOKABLE bool hasOtherInstances() const { return m_otherInstances > 0; }
    // What the menu says of one: "v2: phone 320x480 (adaptive), Ember
    // Glass, phoenix-ember-glass-ui".
    static QString instanceLabel(const SimInstances::Instance &instance);

    // --check-chrome: whether the menu bar has its menus with the keyboard
    // focus on the device's screen, as people use it (on a Mac: the menu
    // bar at the top of the screen, and the app a foreground one), and
    // whether the focus comes back to the screen when this window takes
    // it; printed; false if not.
    bool checkChrome();

    // How a key sequence reads on this computer: Qt's portable text ("Ctrl+F5")
    // in the platform's way ("⌘F5"), and on a Mac F1 to F12 with fn.
    static QString keyLabel(const QString &portable);

protected:
    void closeEvent(QCloseEvent *event) override;
    bool eventFilter(QObject *watched, QEvent *event) override;
    void changeEvent(QEvent *event) override;

private:
    struct Entry {
        QString id, menu, submenu, text, tip, keyText, radio, icon;
        QStringList keys;
        QList<int> press;
        bool separator = false, hold = false, run = false, checkable = false;
        // Its text or whether it can be chosen changes (sim.qml: label, enabled).
        bool dynamic = false;
    };

    void trigger(const Entry &entry, bool checked);
    void sendKey(int key, bool press);
    void refreshChecks();
    void setToolbarShown(bool shown);
    void updateIcons();
    QIcon icon(const QString &name) const;
    QString menuKeys(const Entry &entry) const;
    QString allKeys(const Entry &entry) const;
    QMenu *menuFor(const QString &menu, const QString &submenu);
    void showShortcuts();
    void showAbout();
    // Window: the cards after the menu's own items, from simWindows.
    void refreshWindows();
    QIcon cardIcon(const QString &url);
    // Window > Simulators: the list, before Next Simulator.
    void refreshInstances();
    // sim.qml's simInstanceInfo, in this one's entry.
    void updateInstanceInfo();
    void showInstance(const SimInstances::Instance &instance);
    // Asked by another simulator: this window in front, with the focus.
    void bringToFront();

    QQuickView *m_view;
    QWidget *m_container;
    QMenuBar *m_menuBar;
    // The menu bar has no window (macOS): this deletes it.
    bool m_ownsMenuBar = false;
    QToolBar *m_toolbar;
    QAction *m_toolbarAction = nullptr;
    QTimer *m_refresh;
    QList<Entry> m_entries;
    QHash<QString, QAction *> m_actions;
    QHash<QString, QMenu *> m_menus;
    QList<int> m_held;
    QPointer<QDialog> m_shortcuts;
    // The Window menu, its cards' items (or the one saying there are none)
    // and the list they were made from; rebuilt once the list changes.
    QMenu *m_windowMenu = nullptr;
    QList<QAction *> m_windowActions;
    QVariantList m_windowList;
    QTimer *m_windowsLater;
    QHash<QString, QIcon> m_cardIcons;
    // The simulators: the registry, what this one adds to its entry, the
    // items made and the list they show; the item they go before (Next
    // Simulator); polled while the menu is open, for one that crashed.
    SimInstances *m_instances = nullptr;
    QVariantMap m_instanceBase;
    QList<QAction *> m_instanceActions;
    QList<SimInstances::Instance> m_instanceList;
    QStringList m_instanceLabels;
    QAction *m_instancesBefore = nullptr;
    QTimer *m_instancesPoll;
    QTimer *m_instancesLater;
    QTimer *m_instanceInfoLater;
    int m_otherInstances = 0;
};
