// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Settings > Accessibility > High contrast: a solid white outline round a
// surface that floats over the wallpaper or an app (the system menu, the
// dashboard, banners, Just Type's field, an icon's menu, buttons), so its
// edge reads whatever is behind it (WCAG 2.x 1.4.11, 3:1 for a component's
// boundary). Nothing is drawn otherwise: the original's look is unchanged.
// A Phoenix addition.

import QtQuick

Rectangle {
    objectName: "contrastOutline"
    anchors.fill: parent
    visible: Theme.highContrast
    color: "transparent"
    border.width: Theme.contrastBorderWidth
    border.color: Theme.contrastBorder
    Accessible.ignored: true
}
