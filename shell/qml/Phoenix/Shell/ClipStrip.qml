// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The keyboard's clip strip (Phoenix, M6 F2), in place of the keys: the
// clipboard history (org.webosphoenix.clipboard) as small cards, newest
// first, under category tabs (Recent, Pinned, then the user's categories)
// in the launcher's tab bar art. The clips behave as card view's cards:
// the one in focus in the middle, its neighbours peeking in beside it,
// smaller and dimmed; a swipe moves them and they snap clip to clip with
// card view's flick and slide. A tap on the middle clip pastes it where
// the cursor is, a tap on a side clip brings it to the middle; a hold
// opens its actions (Pin or Unpin, Save to a category, Delete, Open
// Clipboard) in the system's popup art, as the edit popup's. ABC, Back,
// or the clipboard key again bring the keys back.
//
// The cards are drawn as card view draws an app's card, small: rounded
// corners and card-shadow-tile.png's drop shadow (CardDropShadowEffect.cpp,
// as Card.qml), the clip's text on a white page, the app it came from and
// how long ago under it. A sensitive clip is masked (••••) with what it is
// (a password, a code); it pastes only into a password field.
//
// Drawn on the keyboard's own background, sized from the keyboard's height
// (the phone's 377 keyboard pixels, the tablet's 340), as the emoji page.

import QtQuick

Item {
    id: strip
    objectName: "clipStrip"

    // The VirtualKeyboard: its clipboard client, and where pastes go.
    required property Item keyboard
    readonly property var client: keyboard.clipboard

    // "recent", "pinned" or a category id.
    property string category: "recent"
    readonly property var _tabs: {
        var t = [{ id: "recent", name: qsTr("Recent") }, { id: "pinned", name: qsTr("Pinned") }];
        var cats = client && client.categories ? client.categories : [];
        for (var i = 0; i < cats.length; ++i)
            t.push({ id: cats[i].id, name: cats[i].name });
        return t;
    }
    readonly property var clips: client && client.clips ? client.clips : []
    readonly property real unit: height / (keyboard.tablet ? 340 : 377)
    readonly property real tabHeight: Math.round(height * 0.17)

    onVisibleChanged: {
        menu.close();
        slide.stop();
        dragging = false;
        position = 0;
        if (visible) {
            _switching = true;
            category = "recent";
            _switching = false;
            _switch = 1;
            switching.stop();
            opening.restart();
            if (client)
                client.refresh(category);
        }
    }
    property bool _switching: false
    property string _lastCategory: "recent"
    onCategoryChanged: {
        menu.close();
        // From the first clip, slid in from the new tab's side.
        var from = -1, to = -1;
        for (var i = 0; i < _tabs.length; ++i) {
            if (_tabs[i].id === _lastCategory) from = i;
            if (_tabs[i].id === category) to = i;
        }
        _lastCategory = category;
        slide.stop();
        position = 0;
        if (visible && !_switching) {
            _switchDir = to >= from ? 1 : -1;
            switching.restart();
        }
        if (visible && client)
            client.refresh(category);
    }
    // A category that went away: back to Recent.
    on_TabsChanged: {
        for (var i = 0; i < _tabs.length; ++i)
            if (_tabs[i].id === category)
                return;
        category = "recent";
    }

    function kindName(clip) {
        switch (clip.kind) {
        case "password": return qsTr("Password");
        case "otp": return qsTr("One-time code");
        case "otpauth": return qsTr("Authenticator link");
        case "totp": return qsTr("Authenticator key");
        }
        return qsTr("Secret");
    }
    function appName(id) {
        var c = client && client.appTitle ? client.appTitle(id) : "";
        if (c)
            return c;
        // Not installed (any more): the id's last part ("messaging" -> "Messaging").
        var last = String(id || "").split(".").pop();
        return last ? last.charAt(0).toUpperCase() + last.slice(1) : "";
    }
    function age(time) {
        var s = Math.max(0, Math.round((Date.now() - time) / 1000));
        if (s < 60) return qsTr("now");
        if (s < 3600) return qsTr("%1 min").arg(Math.floor(s / 60));
        if (s < 86400) return qsTr("%1 h").arg(Math.floor(s / 3600));
        return qsTr("%1 d").arg(Math.floor(s / 86400));
    }

    // The keyboard's background, and a tap on it is the strip's, not the app's.
    Image {
        anchors.fill: parent
        source: strip.keyboard._artFile("keyboard-bg.png")
        fillMode: Image.Stretch
    }
    MouseArea {
        anchors.fill: parent
        onClicked: menu.close()
    }

    // ---- Opening, and changing tabs ----------------------------------------------------
    // The tab bar and the clips rise a little and fade in over the keyboard's
    // background as the strip takes the keys' place; on another tab the
    // clips cross-slide in from its side. An app's scene push
    // (cardTransitionDuration, curve 20 OutQuad) and a card slide
    // (cardSlideDuration, OutQuart; lunaAnimations.conf [Cards]).
    property real _rise: 1
    property real _switch: 1
    property int _switchDir: 1
    // Nothing moving: the strip at rest (tests wait for it).
    readonly property bool settled: !slide.running && !opening.running && !switching.running && !dragging
    NumberAnimation { id: opening; target: strip; property: "_rise"; from: 0; to: 1; duration: Theme.cardTransitionDuration; easing.type: Easing.OutQuad }
    NumberAnimation { id: switching; target: strip; property: "_switch"; from: 0; to: 1; duration: Theme.cardSlideDuration; easing.type: Theme.cardEasing }

    // ABC and the tabs, in the launcher's tab bar art (Launcher.qml's tab
    // strip: launcher3/tab-bg.png, tab-selected-bg.png under the tab in
    // front, tab-divider.png between, 16 px bold white / #C8C8C8 titles,
    // layoutsettings.cpp:67-74), a little lower and tighter to leave the
    // clips the room.
    ArtBorderImage {
        id: tabBar
        objectName: "clipTabBar"
        width: parent.width
        height: strip.tabHeight
        source: Theme.asset("launcher3/tab-bg.png")
        border { left: Theme.artBorder(4, source); right: Theme.artBorder(4, source); top: Theme.artBorder(4, source); bottom: Theme.artBorder(4, source) }
        horizontalTileMode: BorderImage.Stretch
        opacity: strip._rise
        transform: Translate { y: (1 - strip._rise) * strip.tabHeight * 0.5 }
        readonly property real fontSize: Math.min(Theme.launcherTabFontSize, Math.round(height * 0.38))
        // A tab: the room its title takes, no less than an even share of
        // the bar up to the launcher's widest (pagetabbar.cpp:85).
        readonly property real padding: Math.round(height * 0.28)
        readonly property real evenWidth: Math.min(Theme.launcherTabMaxWidth, (width - abc.width) / Math.max(1, strip._tabs.length))

        Item {
            id: abc
            objectName: "clipAbc"
            width: abcLabel.implicitWidth + 2 * tabBar.padding
            height: parent.height
            ArtBorderImage {
                anchors.fill: parent
                visible: abcArea.pressed
                source: Theme.asset("launcher3/tab-selected-bg.png")
                border { left: Theme.artBorder(4, source); right: Theme.artBorder(4, source); top: Theme.artBorder(4, source); bottom: Theme.artBorder(4, source) }
            }
            Text {
                id: abcLabel
                anchors.centerIn: parent
                text: "ABC"
                color: Theme.launcherTabSelectedColor
                font.family: Theme.fontFamily
                font.pixelSize: tabBar.fontSize
                font.bold: true
            }
            MouseArea {
                id: abcArea
                anchors.fill: parent
                onClicked: strip.keyboard.closeClips()
            }
        }

        ListView {
            id: tabs
            objectName: "clipTabs"
            anchors.left: abc.right
            anchors.right: parent.right
            height: parent.height
            orientation: ListView.Horizontal
            clip: true
            boundsBehavior: Flickable.StopAtBounds
            model: strip._tabs
            delegate: Item {
                id: tab
                required property var modelData
                required property int index
                readonly property bool current: strip.category === modelData.id
                objectName: "clipTab-" + modelData.id
                width: Math.max(tabBar.evenWidth, label.implicitWidth + 2 * tabBar.padding)
                height: tabs.height
                ArtBorderImage {
                    anchors.fill: parent
                    visible: tab.current
                    source: Theme.asset("launcher3/tab-selected-bg.png")
                    border { left: Theme.artBorder(4, source); right: Theme.artBorder(4, source); top: Theme.artBorder(4, source); bottom: Theme.artBorder(4, source) }
                }
                Text {
                    id: label
                    anchors.centerIn: parent
                    text: tab.modelData.name
                    color: tab.current ? Theme.launcherTabSelectedColor : Theme.launcherTabColor
                    font.family: Theme.fontFamily
                    font.pixelSize: tabBar.fontSize
                    font.bold: true
                }
                Image {
                    anchors.left: parent.left
                    width: Theme.artWidth(source)
                    height: parent.height
                    source: Theme.asset("launcher3/tab-divider.png")
                }
                MouseArea {
                    anchors.fill: parent
                    onClicked: strip.category = tab.modelData.id
                }
            }
        }
    }

    // ---- The clips, as card view's cards ---------------------------------------------------
    // The clip in focus in the middle; its neighbours beside it, smaller
    // and dimmed as card view's side cards are: the non-active card scale
    // against the active one (Theme.nonActiveCardRatio / activeCardRatio,
    // Settings.cpp:210-211), dimmed to cardDimming (CardWindow.cpp:211-213),
    // card view's gap between them (gapBetweenCards, Settings.cpp:214) at
    // this size. The middle clip is as wide as an active card is of the
    // screen (activeCardRatio), no wider than the strip's room allows.
    // A swipe drags them; let go, they slide to the nearest clip, or on to
    // the next one after a flick, as card view's stacks do
    // (CardView.qml's release: FlickGestureRecognizer.cpp:95-104,
    // CardWindowManager.cpp:1574-1600), over cardSlideDuration (OutQuart).
    readonly property real faceHeight: Math.round((height - tabHeight) * 0.66)
    readonly property real cardWidth: Math.round(Math.min(width * Theme.activeCardRatio, faceHeight * (keyboard.tablet ? 1.6 : 1.5)))
    readonly property real cardHeight: faceHeight
    readonly property real sideScale: Theme.nonActiveCardRatio / Theme.activeCardRatio
    readonly property real gap: Math.round(Theme.gapBetweenCards * cardWidth / Math.max(1, width * Theme.activeCardRatio))
    // From the middle clip's centre to its neighbour's, and between side clips.
    readonly property real innerPitch: cardWidth / 2 + gap + sideScale * cardWidth / 2
    readonly property real outerPitch: sideScale * cardWidth + gap
    // How many clips each side are drawn.
    readonly property int reach: Math.ceil((width / 2) / Math.max(1, outerPitch)) + 1

    // The clip in the middle: a fractional index while it moves.
    property real position: 0
    readonly property int current: Math.max(0, Math.min(clips.length - 1, Math.round(position)))
    // Time, for a flick's speed (a test sets its own).
    property var clock: function () { return Date.now(); }

    function offsetOf(d) {
        var a = Math.abs(d);
        var o = a <= 1 ? a * innerPitch : innerPitch + (a - 1) * outerPitch;
        return d < 0 ? -o : o;
    }
    function scaleOf(d) { return 1 - (1 - sideScale) * Math.min(1, Math.abs(d)); }
    // duration: the trackpad's quicker settle (Theme.wheelSettleDuration).
    function slideTo(i, duration) {
        i = Math.max(0, Math.min(clips.length - 1, i));
        slide.stop();
        if (Math.abs(position - i) < 0.0005) {
            position = i;
            return;
        }
        slide.to = i;
        slide.duration = duration !== undefined ? duration : Theme.cardSlideDuration;
        slide.start();
    }
    NumberAnimation {
        id: slide
        target: strip
        property: "position"
        duration: Theme.cardSlideDuration
        easing.type: Theme.cardEasing
    }
    // Fewer clips (one deleted, another tab): the last stays in reach.
    onClipsChanged: {
        if (position > clips.length - 1) {
            slide.stop();
            position = Math.max(0, clips.length - 1);
        }
    }

    // The clip under a point of the clips' area, or -1.
    function indexAt(x, y) {
        var p = Qt.point(x, y);
        if (p.y < cardTop || p.y > cardTop + cardHeight)
            return -1;
        var best = -1;
        for (var i = Math.max(0, Math.floor(position) - reach); i <= Math.min(clips.length - 1, Math.ceil(position) + reach); ++i) {
            var d = i - position;
            var cx = cards.width / 2 + offsetOf(d);
            var half = cardWidth * scaleOf(d) / 2;
            if (Math.abs(p.x - cx) <= half && (best < 0 || Math.abs(d) < Math.abs(best - position)))
                best = i;
        }
        return best;
    }
    readonly property real cardTop: Math.round((cards.height - cardHeight) * 0.38)

    property bool dragging: false

    Item {
        id: cards
        objectName: "clipCards"
        anchors.top: tabBar.bottom
        anchors.bottom: parent.bottom
        width: parent.width
        clip: true
        readonly property int count: strip.clips.length
        opacity: strip._rise * strip._switch
        transform: Translate {
            x: (1 - strip._switch) * strip._switchDir * strip.width * 0.3
            y: (1 - strip._rise) * strip.tabHeight
        }

        Repeater {
            model: strip.clips
            delegate: Item {
                id: cardItem
                required property var modelData
                required property int index
                readonly property var clipData: modelData
                readonly property real d: index - strip.position
                readonly property bool near: Math.abs(d) <= strip.reach
                objectName: "clipCard-" + modelData.id
                visible: near
                x: cards.width / 2 + strip.offsetOf(d) - width / 2
                width: strip.cardWidth
                height: cards.height
                // The middle one in front, then outwards; smaller about
                // the face's centre.
                z: -Math.abs(d)
                transform: Scale {
                    origin.x: strip.cardWidth / 2
                    origin.y: strip.cardTop + strip.cardHeight / 2
                    xScale: strip.scaleOf(cardItem.d)
                    yScale: strip.scaleOf(cardItem.d)
                }
                // The face (and what is drawn on it) only for the clips in reach.
                Loader {
                    anchors.fill: parent
                    active: cardItem.near
                    sourceComponent: cardFace
                }
                // The face, for a tap (the strip's touch area takes it).
                Item {
                    objectName: "clipCardArea"
                    y: strip.cardTop
                    width: parent.width
                    height: strip.cardHeight
                }
            }
        }

        Text {
            objectName: "clipEmpty"
            anchors.centerIn: parent
            width: parent.width * 0.8
            horizontalAlignment: Text.AlignHCenter
            wrapMode: Text.Wrap
            visible: cards.count === 0
            text: strip.category === "recent" ? qsTr("What you copy shows up here")
                : strip.category === "pinned" ? qsTr("Hold a clip to pin it") : qsTr("Hold a clip to save it here")
            color: "#a0a0a0"
            font.family: Theme.fontFamily
            font.pixelSize: Math.round(strip.tabHeight * 0.38)
        }
    }
    // The launcher's shadow under its tab bar, over the clips.
    Image {
        anchors.top: tabBar.bottom
        width: parent.width
        height: Theme.artHeight(source)
        opacity: strip._rise
        source: Theme.asset("launcher3/tab-shadow.png")
        fillMode: Image.Stretch
    }

    // A clip's face: card view's card, small.
    Component {
        id: cardFace
        Item {
            id: faceRoot
            readonly property Item cardItem: parent ? parent.parent : null
            readonly property var clipData: cardItem ? cardItem.clipData : ({})
            readonly property real d: cardItem ? cardItem.d : 0

            Item {
                id: face
                y: strip.cardTop
                width: parent.width
                height: strip.cardHeight
                scale: touch.pressed && !strip.dragging && touch.pressedIndex === (faceRoot.cardItem ? faceRoot.cardItem.index : -1) ? 0.96 : 1
                Behavior on scale { NumberAnimation { duration: 80 } }

                // card-shadow-tile.png, as Card.qml draws it, at this size.
                BorderImage {
                    readonly property real k: strip.cardWidth / 320
                    x: -20 * k
                    y: -20 * k + 5 * k
                    width: (face.width + 40 * k) / k
                    height: (face.height + 40 * k) / k
                    scale: k
                    transformOrigin: Item.TopLeft
                    source: Theme.asset("card-shadow-tile.png")
                    border { left: Theme.artBorder(43, source); top: Theme.artBorder(43, source); right: Theme.artBorder(43, source); bottom: Theme.artBorder(43, source) }
                }
                Rectangle {
                    id: page
                    anchors.fill: parent
                    radius: Math.round(strip.cardWidth * 0.05)
                    color: faceRoot.clipData.sensitive ? "#2b2b2b" : "#ffffff"
                    clip: true

                    // Text and links.
                    Column {
                        visible: faceRoot.clipData.type !== "image" && !faceRoot.clipData.sensitive
                        x: Math.round(10 * strip.unit)
                        y: Math.round(9 * strip.unit)
                        width: page.width - 2 * x
                        spacing: Math.round(4 * strip.unit)
                        Text {
                            visible: faceRoot.clipData.type === "link" && !!faceRoot.clipData.title
                            width: parent.width
                            text: faceRoot.clipData.title || ""
                            color: "#202020"
                            font.family: Theme.fontFamily
                            font.pixelSize: Math.round(15 * strip.unit)
                            font.bold: true
                            wrapMode: Text.Wrap
                            maximumLineCount: 2
                            elide: Text.ElideRight
                        }
                        Text {
                            objectName: "clipText"
                            width: parent.width
                            height: page.height - parent.y - Math.round(9 * strip.unit) - (faceRoot.clipData.type === "link" && faceRoot.clipData.title ? Math.round(44 * strip.unit) : 0)
                            text: faceRoot.clipData.text || ""
                            color: faceRoot.clipData.type === "link" ? "#1f5fa8" : "#303030"
                            font.family: Theme.fontFamily
                            font.pixelSize: Math.round(14 * strip.unit)
                            wrapMode: Text.WrapAtWordBoundaryOrAnywhere
                            elide: Text.ElideRight
                            clip: true
                        }
                    }
                    // A picture.
                    Image {
                        visible: faceRoot.clipData.type === "image"
                        anchors.fill: parent
                        source: faceRoot.clipData.type === "image" ? faceRoot.clipData.image : ""
                        fillMode: Image.PreserveAspectCrop
                        asynchronous: true
                    }
                    // A secret: masked.
                    Column {
                        visible: !!faceRoot.clipData.sensitive
                        anchors.centerIn: parent
                        width: page.width - Math.round(16 * strip.unit)
                        spacing: Math.round(6 * strip.unit)
                        Text {
                            objectName: "clipMask"
                            width: parent.width
                            horizontalAlignment: Text.AlignHCenter
                            text: "•".repeat(Math.max(4, Math.min(8, faceRoot.clipData.length || 8)))
                            color: "#ffffff"
                            font.family: Theme.fontFamily
                            font.pixelSize: Math.round(20 * strip.unit)
                        }
                        Text {
                            width: parent.width
                            horizontalAlignment: Text.AlignHCenter
                            text: strip.kindName(faceRoot.clipData)
                            color: "#b8b8b8"
                            font.family: Theme.fontFamily
                            font.pixelSize: Math.round(12 * strip.unit)
                            wrapMode: Text.Wrap
                            maximumLineCount: 2
                            elide: Text.ElideRight
                        }
                    }
                    // Pinned: a folded corner in the highlight colour.
                    Rectangle {
                        objectName: "clipPinned"
                        visible: !!faceRoot.clipData.pinned
                        width: Math.round(30 * strip.unit)
                        height: width
                        rotation: 45
                        x: page.width - width / 2
                        y: -height / 2
                        color: Theme.highlight
                    }
                    // Out of focus: dimmed, as a card that lost focus.
                    Rectangle {
                        objectName: "clipDim"
                        anchors.fill: parent
                        color: "#000000"
                        opacity: (1 - Theme.cardDimming) * Math.min(1, Math.abs(faceRoot.d))
                    }
                }
            }
            // Where it came from, and when.
            Text {
                anchors.top: face.bottom
                anchors.topMargin: Math.round(7 * strip.unit)
                width: parent.width
                horizontalAlignment: Text.AlignHCenter
                text: strip.appName(faceRoot.clipData.source) + " · " + strip.age(faceRoot.clipData.time)
                color: "#c8c8c8"
                opacity: 1 - 0.5 * Math.min(1, Math.abs(faceRoot.d))
                font.family: Theme.fontFamily
                font.pixelSize: Math.round(12 * strip.unit)
                elide: Text.ElideRight
            }
        }
    }

    // A finger on the clips: swiped, they follow it and snap; a tap pastes
    // the middle one or brings a side one to the middle; a hold opens the
    // clip's actions.
    MouseArea {
        id: touch
        objectName: "clipCardsTouch"
        anchors.fill: cards
        preventStealing: true
        enabled: cards.count > 0
        property real startX: 0
        property real startY: 0
        property real lastX: 0
        property real lastY: 0
        property real startTime: 0
        property real startPosition: 0
        property int pressedIndex: -1
        onPressed: (mouse) => {
            if (menu.visible)
                return;
            slide.stop();
            strip.dragging = false;
            startX = lastX = mouse.x;
            startY = lastY = mouse.y;
            startTime = strip.clock();
            startPosition = strip.position;
            pressedIndex = strip.indexAt(mouse.x, mouse.y);
        }
        onPositionChanged: (mouse) => {
            if (menu.visible)
                return;
            lastX = mouse.x;
            lastY = mouse.y;
            var dx = mouse.x - startX;
            if (!strip.dragging && Math.abs(dx) > Qt.styleHints.startDragDistance
                    && Math.abs(dx) > Theme.horizontalLockRatio * Math.abs(mouse.y - startY))
                strip.dragging = true;
            if (!strip.dragging)
                return;
            // Past either end it goes half as far (card view's rubber band).
            var p = startPosition - dx / strip.innerPitch;
            var last = Math.max(0, strip.clips.length - 1);
            if (p < 0)
                p = p / 2;
            else if (p > last)
                p = last + (p - last) / 2;
            strip.position = p;
        }
        onReleased: (mouse) => {
            if (!strip.dragging)
                return;
            strip.dragging = false;
            // A flick: the gesture's average velocity, |vx| + |vy|, between
            // flickMinVelocity and flickMaxVelocity (as CardView's release)
            // goes on to the next clip; else the nearest.
            var elapsed = strip.clock() - startTime;
            var ax = elapsed > 0 ? (lastX - startX) / elapsed : 0;
            var ay = elapsed > 0 ? (lastY - startY) / elapsed : 0;
            var speed = Math.abs(ax) + Math.abs(ay);
            var flicked = lastX !== startX && speed >= Theme.flickMinVelocity && speed <= Theme.flickMaxVelocity;
            var from = Math.round(startPosition);
            strip.slideTo(flicked ? from + (ax > 0 ? -1 : 1) : Math.round(strip.position));
            // Not a tap.
            pressedIndex = -2;
        }
        onCanceled: {
            if (strip.dragging) {
                strip.dragging = false;
                strip.slideTo(Math.round(strip.position));
            }
        }
        onClicked: (mouse) => {
            if (menu.visible) {
                menu.close();
                return;
            }
            var i = pressedIndex;
            if (i < 0 || i >= strip.clips.length)
                return;
            if (i === strip.current)
                strip.keyboard.pasteClip(strip.clips[i]);
            else
                strip.slideTo(i);
        }
        onPressAndHold: (mouse) => {
            var i = pressedIndex;
            if (strip.dragging || i < 0 || i >= strip.clips.length)
                return;
            menu.openFor(strip.clips[i], i);
        }
    }

    // A trackpad's two-finger swipe sideways moves the clips as a finger
    // does and, once the fingers lift, snaps to the clip it was heading for
    // as card view's stacks do (TrackpadSwipe); a mouse wheel moves one clip
    // a notch (Phoenix).
    TrackpadSwipe {
        id: wheel
        objectName: "clipWheel"
        anchors.fill: cards
        enabled: cards.count > 0
        blocked: function () { return touch.pressed || menu.visible; }
        property real startPosition: 0

        onNotched: (dx, dy) => {
            var d = Math.abs(dx) > Math.abs(dy) ? dx : dy;
            strip.slideTo(strip.current + (d < 0 ? 1 : -1));
        }
        onStarted: {
            // Up or down there is nothing to scroll; it goes no further
            // (not to the cards behind the keyboard).
            if (axis !== "h") {
                axis = "done";
                return;
            }
            slide.stop();
            strip.dragging = true;
            startPosition = strip.position;
        }
        onMoved: {
            // Past either end it goes half as far, as under a finger.
            var p = startPosition - sumX / strip.innerPitch;
            var last = Math.max(0, strip.clips.length - 1);
            if (p < 0)
                p = p / 2;
            else if (p > last)
                p = last + (p - last) / 2;
            strip.position = p;
        }
        onEnded: {
            strip.dragging = false;
            strip.slideTo(settleTarget(startPosition, strip.position), Theme.wheelSettleDuration);
        }
    }

    // A line for a moment (a secret that cannot be pasted here).
    Rectangle {
        objectName: "clipMessage"
        visible: strip.keyboard.clipsMessage !== ""
        anchors.horizontalCenter: parent.horizontalCenter
        anchors.bottom: parent.bottom
        anchors.bottomMargin: Math.round(8 * strip.unit)
        width: Math.min(parent.width - 20 * strip.unit, msg.implicitWidth + 28 * strip.unit)
        height: msg.implicitHeight + 14 * strip.unit
        radius: height / 2
        color: Qt.rgba(0, 0, 0, 0.8)
        Text {
            id: msg
            anchors.centerIn: parent
            width: parent.width - 20 * strip.unit
            horizontalAlignment: Text.AlignHCenter
            elide: Text.ElideRight
            text: strip.keyboard.clipsMessage
            color: "#ffffff"
            font.family: Theme.fontFamily
            font.pixelSize: Math.round(13 * strip.unit)
        }
    }

    // A held clip's actions, in the system's popup art (as EditPopup): a row
    // of actions; Save to... turns it into the categories.
    Item {
        id: menu
        objectName: "clipMenu"
        property var clip: null
        property bool choosing: false        // the categories, for Save to...
        visible: clip !== null
        anchors.fill: parent
        z: 10

        function openFor(c, i) {
            choosing = false;
            clip = c;
            // The middle of the clip held.
            anchorX = cards.width / 2 + strip.offsetOf(i - strip.position);
            anchorY = cards.y + strip.cardTop + strip.cardHeight / 2;
        }
        function close() { clip = null; choosing = false; }
        property real anchorX: 0
        property real anchorY: 0
        readonly property var items: {
            if (!clip)
                return [];
            if (choosing) {
                var list = [{ id: "cat:", label: qsTr("None"), on: !clip.category }];
                var cats = strip.client && strip.client.categories ? strip.client.categories : [];
                for (var i = 0; i < cats.length; ++i)
                    list.push({ id: "cat:" + cats[i].id, label: cats[i].name, on: clip.category === cats[i].id });
                if (cats.length === 0)
                    list.push({ id: "app", label: qsTr("New Category…") });
                return list;
            }
            return [{ id: clip.pinned ? "unpin" : "pin", label: clip.pinned ? qsTr("Unpin") : qsTr("Pin") },
                    { id: "save", label: qsTr("Save to…") },
                    { id: "delete", label: qsTr("Delete") },
                    { id: "app", label: qsTr("Open Clipboard") }];
        }
        function choose(id) {
            var c = clip;
            if (id === "save") {
                choosing = true;
                return;
            }
            close();
            if (!strip.client)
                return;
            if (id === "pin" || id === "unpin")
                strip.client.setPinned(c, id === "pin");
            else if (id === "delete")
                strip.client.remove(c);
            else if (id === "app")
                strip.client.openApp();
            else if (id.indexOf("cat:") === 0)
                strip.client.setCategory(c, id.slice(4));
        }

        MouseArea {
            anchors.fill: parent
            onClicked: menu.close()
        }
        ArtBorderImage {
            id: bubble
            readonly property real pad: Theme.artBorder(10, source)
            width: Math.min(strip.width, row.width + 2 * pad)
            height: Math.round(44 * strip.unit) + 2 * pad
            x: Math.max(0, Math.min(strip.width - width, menu.anchorX - width / 2))
            y: Math.max(0, Math.min(strip.height - height, menu.anchorY - height / 2))
            source: Theme.asset("popup-bg.png")
            border { left: Theme.artBorder(19, source); top: Theme.artBorder(19, source); right: Theme.artBorder(19, source); bottom: Theme.artBorder(19, source) }
            Flickable {
                x: bubble.pad
                y: bubble.pad
                width: bubble.width - 2 * bubble.pad
                height: bubble.height - 2 * bubble.pad
                contentWidth: row.width
                clip: true
                boundsBehavior: Flickable.StopAtBounds
                Row {
                    id: row
                    objectName: "clipMenuRow"
                    height: parent.height
                    Repeater {
                        model: menu.items
                        delegate: Item {
                            id: entry
                            required property var modelData
                            required property int index
                            objectName: "clipMenu-" + modelData.id
                            width: entryLabel.implicitWidth + 28 * strip.unit
                            height: row.height
                            Rectangle {
                                visible: entry.index > 0
                                width: Math.max(1, strip.unit)
                                height: parent.height - 16 * strip.unit
                                anchors.verticalCenter: parent.verticalCenter
                                color: "#5a5a5a"
                            }
                            Rectangle {
                                anchors.fill: parent
                                anchors.margins: 3 * strip.unit
                                radius: 6 * strip.unit
                                color: Theme.highlight
                                visible: entryArea.pressed || entry.modelData.on === true
                                opacity: entryArea.pressed ? 1 : 0.45
                            }
                            Text {
                                id: entryLabel
                                anchors.centerIn: parent
                                text: entry.modelData.label
                                color: Theme.text
                                font.family: Theme.fontFamily
                                font.pixelSize: Math.round(16 * strip.unit)
                            }
                            MouseArea {
                                id: entryArea
                                anchors.fill: parent
                                onClicked: menu.choose(entry.modelData.id)
                            }
                        }
                    }
                }
            }
        }
    }
}
