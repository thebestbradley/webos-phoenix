// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Stand-in for maliit-framework-webos's
// src/maliit/plugins/abstractinputmethod.h: the input method base class's
// methods the Phoenix keyboard plugin reimplements, and processKeyEvent,
// whose default (a hardware key goes back to the field) it keeps
// (maliit-stub/maliit/namespace.h says why and how it is checked). Their
// default behaviour is the real one's (abstractinputmethod.cpp), written
// here in maliitstub.cpp.

#pragma once

#include <QEvent>
#include <QList>
#include <QObject>
#include <QSet>
#include <QString>

#include <maliit/namespace.h>

class MAbstractInputMethodHost;

class MAbstractInputMethod : public QObject
{
    Q_OBJECT

public:
    // abstractinputmethod.h:56-59
    struct MInputMethodSubView {
        QString subViewId;
        QString subViewTitle;
    };

    explicit MAbstractInputMethod(MAbstractInputMethodHost *host);
    ~MAbstractInputMethod() override;

    MAbstractInputMethodHost *inputMethodHost() const;

    // abstractinputmethod.h:78-219
    virtual void show();
    virtual void hide();
    virtual void update();
    virtual void reset();
    virtual void handleFocusChange(bool focusIn);
    virtual void handleAppOrientationChanged(int angle);
    virtual void processKeyEvent(QEvent::Type keyType, Qt::Key keyCode,
                                 Qt::KeyboardModifiers modifiers, const QString &text,
                                 bool autoRepeat, int count, quint32 nativeScanCode,
                                 quint32 nativeModifiers, unsigned long time);
    virtual void handleClientChange();
    virtual QList<MInputMethodSubView> subViews(Maliit::HandlerState state = Maliit::OnScreen) const;
    virtual QString activeSubView(Maliit::HandlerState state = Maliit::OnScreen) const;

private:
    MAbstractInputMethodHost *const m_host;
};
