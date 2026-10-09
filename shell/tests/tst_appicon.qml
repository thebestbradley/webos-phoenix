// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// An app's icon is never an empty square: with no picture, or one that does
// not load (an icon address out of reach, as a catalog's for an app still
// installing), the app's initial on its colour stands in.
//
// Run: qmltestrunner -import qml -import <build>/qml -input tests/tst_appicon.qml

import QtQuick
import QtTest
import Phoenix.Shell

Item {
    id: root
    width: 300
    height: 200

    readonly property url calculator: Qt.resolvedUrl("../../third_party/core-apps/com.palm.app.calculator/icon.png")

    AppIcon { id: none; showLabel: false; interactive: false; glyph: "B"; color: "#3366aa" }
    AppIcon { id: broken; x: 100; showLabel: false; interactive: false; glyph: "M"; source: "file:///nonexistent/phoenix-icon.png" }
    AppIcon { id: good; x: 200; showLabel: false; interactive: false; glyph: "C"; source: root.calculator }

    TestCase {
        name: "AppIcon"
        when: windowShown

        function test_initialWhenThereIsNoPicture() {
            verify(findChild(none, "iconGlyph").visible);
            verify(!findChild(none, "iconImage").visible);
        }

        function test_initialWhenThePictureDoesNotLoad() {
            const image = findChild(broken, "iconImage");
            tryCompare(image, "status", Image.Error);
            verify(!image.visible);
            verify(findChild(broken, "iconGlyph").visible, "the initial stands in for a picture that does not load");
        }

        function test_pictureWhenItLoads() {
            const image = findChild(good, "iconImage");
            tryCompare(image, "status", Image.Ready);
            verify(image.visible);
            verify(!findChild(good, "iconGlyph").visible);
        }
    }
}
