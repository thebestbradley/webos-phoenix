// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Font settings QML's font value type cannot express. Its letterSpacing is
// always absolute (pixels), but luna-sysmgr drew the status bar title with
// QFont::PercentageSpacing (StatusBarTitle.cpp:59, kStatusBarQtLetterSpacing
// 90): every glyph's advance scaled, not a fixed amount taken off.
//
//   font: FontTools.withPercentageSpacing(Qt.font({ ... }), 90)

#pragma once

#include <QFont>
#include <QObject>
#include <QtQml/qqmlregistration.h>

class FontTools : public QObject
{
    Q_OBJECT
    QML_ELEMENT
    QML_SINGLETON

public:
    using QObject::QObject;

    // `font` with its letter spacing set to `percent` of normal
    // (100 = unchanged).
    Q_INVOKABLE QFont withPercentageSpacing(const QFont &font, qreal percent) const;
};
