// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// A notification's check mark while the drawer is selecting (Phoenix).

import QtQuick

Rectangle {
    id: mark
    property bool checked: false
    objectName: "drawerSelectMark"
    width: Theme.drawerCheckSize
    height: width
    radius: width / 2
    color: checked ? "#3a8de0" : "transparent"
    border.width: Math.max(1, Theme.px(2))
    border.color: checked ? "#3a8de0" : Qt.rgba(1, 1, 1, 0.7)
    Canvas {
        anchors.fill: parent
        visible: mark.checked
        onPaint: {
            var c = getContext("2d");
            c.reset();
            c.strokeStyle = "#ffffff";
            c.lineWidth = Math.max(2, width / 9);
            c.lineCap = "round";
            c.lineJoin = "round";
            c.beginPath();
            c.moveTo(width * 0.28, height * 0.52);
            c.lineTo(width * 0.44, height * 0.68);
            c.lineTo(width * 0.73, height * 0.35);
            c.stroke();
        }
    }
}
