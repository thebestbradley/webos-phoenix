// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// A card's corners, as the Palm devices drew them (CornerMask in
// shell/native/cornermask.h has the formula, from luna-sysmgr's
// CardRoundedCornerShaderStage). The device worked out the corner from the
// app's whole buffer, the card plus the status bar's padding above it
// (CardWindow.cpp:2491-2531), so the corners come out small and close to
// round: about 9 by 7 pixels on a TouchPad in landscape.
// Drawn as the mask OpacityMask applies to the card (Card.qml).

import QtQuick
import Phoenix.Native

CornerMask {
    // The app's buffer: the card with the status bar's padding
    // (Settings::positiveSpaceTopPadding).
    sourceWidth: width
    sourceHeight: height + Theme.positiveSpaceTopPadding
}
