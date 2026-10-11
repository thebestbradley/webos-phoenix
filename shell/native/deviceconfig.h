// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// What the device's maker says about the hardware, from a JSON file the
// device image installs: /etc/phoenix/device.json, or the file named by the
// PHOENIX_DEVICE_CONFIG environment variable. A missing file or key means
// the default. Read once, at first use.
//
//   hardwareHomeButton  (bool, default false) the device has a Home button
//       (a physical or capacitive key) that its maker uses instead of the
//       on-screen gesture bar; the shell then hides the bar and the key does
//       its job. Phoenix keeps the gesture bar on phones and tablets alike
//       otherwise.
//   homeButtonOrientationAngle  (int, default 0) where that button is, as
//       the angle from the screen's own bottom edge: 0, 90, 180 or 270
//       (luna.conf [UI] HomeButtonOrientationAngle; the TouchPad's 270).
//       The boot animation is drawn upright with the button below, and the
//       Touch to Share glow comes from its edge.
//   formFactor  (string, default "auto") "phone", "tablet" or "auto": the
//       layout (Shell.formFactor). "auto" takes the tablet layout when the
//       screen's shorter side is at least Theme.tabletMinSide legacy
//       pixels. A device names its own so it does not change layout with
//       the screen's size (the Odin 2 Portal's 7" is a tablet).
//   density  (number, default 0) device pixels per legacy pixel
//       (Shell.density: 1.0 on a Pre, 1.5 on a Pre 3); 0 derives it from
//       the panel's size as DRM reports it, which some panels get wrong.
//   displayCornerRadius  (number, default 0) the screen's rounded corners'
//       radius in device pixels; the status bar keeps its content out of
//       them (StatusBar, as Phosh's layout manager does).
//   displayCutouts  (array, default none) the camera's holes or notches in
//       the screen, each {"shape": "circle" | "rect", "x", "y", "width",
//       "height"} in device pixels on the screen upright (the compositor's
//       output, unturned). One at the top edge makes the status bar tall
//       enough to hold it and moves the clock beside it (Shell, StatusBar).
//   ringerSwitch  (object) the ringer switch (phoenix-devices reads it;
//       hasRingerSwitch here says there is one).

#pragma once

#include <QJsonObject>
#include <QObject>
#include <QVariantList>
#include <QtQml/qqmlregistration.h>

class DeviceConfig : public QObject
{
    Q_OBJECT
    QML_ELEMENT
    QML_SINGLETON
    Q_PROPERTY(bool hardwareHomeButton READ hardwareHomeButton CONSTANT)
    Q_PROPERTY(int homeButtonOrientationAngle READ homeButtonOrientationAngle CONSTANT)
    Q_PROPERTY(QString formFactor READ formFactor CONSTANT)
    Q_PROPERTY(qreal density READ density CONSTANT)
    Q_PROPERTY(qreal displayCornerRadius READ displayCornerRadius CONSTANT)
    Q_PROPERTY(QVariantList displayCutouts READ displayCutouts CONSTANT)
    Q_PROPERTY(bool hasRingerSwitch READ hasRingerSwitch CONSTANT)
    Q_PROPERTY(QString path READ path CONSTANT)

public:
    explicit DeviceConfig(QObject *parent = nullptr);

    bool hardwareHomeButton() const;
    int homeButtonOrientationAngle() const;
    QString formFactor() const;
    qreal density() const;
    qreal displayCornerRadius() const;
    QVariantList displayCutouts() const;
    bool hasRingerSwitch() const;
    QString path() const { return m_path; }

private:
    QString m_path;
    QJsonObject m_values;
};
