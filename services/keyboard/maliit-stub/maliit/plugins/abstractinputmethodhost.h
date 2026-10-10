// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Stand-in for maliit-framework-webos's
// src/maliit/plugins/abstractinputmethodhost.h: the methods of the server's
// host the Phoenix keyboard plugin calls (maliit-stub/maliit/namespace.h
// says why and how it is checked). The real class has more, all of them
// abstract too; a host written against this stub (the plugin's tests' fake)
// implements only these.

#pragma once

#include <QKeyEvent>
#include <QList>
#include <QObject>
#include <QRegion>
#include <QString>
#include <QWindow>

#include <maliit/namespace.h>

class MAbstractInputMethodHost : public QObject
{
    Q_OBJECT

public:
    explicit MAbstractInputMethodHost(QObject *parent = nullptr) : QObject(parent) {}
    ~MAbstractInputMethodHost() override {}

    // abstractinputmethodhost.h:64-95: the focused field's state.
    virtual int contentType(bool &valid) = 0;
    virtual int enterKeyType(bool &valid) = 0;
    virtual bool correctionEnabled(bool &valid) = 0;
    virtual bool predictionEnabled(bool &valid) = 0;
    virtual bool autoCapitalizationEnabled(bool &valid) = 0;
    virtual bool surroundingText(QString &text, int &cursorPosition) = 0;
    virtual bool hasSelection(bool &valid) = 0;
    // :123, not abstract: the field hides its text (a password).
    virtual bool hiddenText(bool &valid) { valid = false; return false; }

    // :147-148
    virtual void registerWindow(QWindow *window, Maliit::Position position) = 0;

public Q_SLOTS:
    // :171-205: text and keys for the field.
    virtual void sendPreeditString(const QString &string,
                                   const QList<Maliit::PreeditTextFormat> &preeditFormats,
                                   int replacementStart = 0,
                                   int replacementLength = 0,
                                   int cursorPos = -1) = 0;
    virtual void sendCommitString(const QString &string, int replaceStart = 0,
                                  int replaceLength = 0, int cursorPos = -1) = 0;
    virtual void sendKeyEvent(const QKeyEvent &keyEvent,
                              Maliit::EventRequestType requestType = Maliit::EventRequestBoth) = 0;
    // :209
    virtual void notifyImInitiatedHiding() = 0;
    // :250
    virtual void switchPlugin(const QString &pluginName) = 0;
    // :272
    virtual void setInputMethodArea(const QRegion &region, QWindow *window = nullptr) = 0;

public:
    // :348
    virtual QString serviceName() const = 0;
};
