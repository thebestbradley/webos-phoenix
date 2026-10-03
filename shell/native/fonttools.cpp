// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

#include "fonttools.h"

QFont FontTools::withPercentageSpacing(const QFont &font, qreal percent) const
{
    QFont f(font);
    f.setLetterSpacing(QFont::PercentageSpacing, percent);
    return f;
}
