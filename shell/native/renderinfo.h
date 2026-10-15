// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Whether the shell is drawn without a GPU, for the effects that cost too
// much there. The blur behind translucent surfaces (BackdropBlur; 2.0's
// glass) draws the scene behind again and blurs it whenever that scene
// changes: in passing on a GPU, pixel by pixel on a CPU, where every frame
// is slower for it (on llvmpipe in the simulator, the card view's slowest
// frames over twice as long). The shell has always stepped down for Qt
// Quick's software renderer (GraphicsInfo.Software). But without a GPU Qt
// Quick usually still runs OpenGL or Vulkan, on a software rasteriser:
// Mesa's llvmpipe or softpipe (a cloud container, a VM such as UTM or the
// ARM64 device VM without virgl, a board whose GPU driver is missing),
// SwiftShader, Windows' WARP, Apple's software renderer. GraphicsInfo.api
// says OpenGL there, so this asks which device draws.
//
//   RenderInfo.softwareRendering   true: step down, as for the software renderer
//   RenderInfo.softwareDetected    what the renderer seen says, whatever the mode
//   RenderInfo.rendererName        the device, as its driver names it (for
//                                  OpenGL: GL_VENDOR GL_RENDERER GL_VERSION)
//   RenderInfo.graphicsApi         "OpenGL", "Vulkan", "Metal", "Software", ...
//   RenderInfo.mode                "auto" (tell by the renderer), "on" or "off"
//                                  (forced): PHOENIX_SOFTWARE_RENDERING (1, on;
//                                  0, off; auto), which phoenix-sim
//                                  --software-rendering sets; tests set it here
//
// It watches the Qt Quick windows there are when QML first uses it (the
// simulator's view, a child window in its menu bar's window, and the
// device's compositor window exist before their QML loads). The API is known at once; the device once a window's scene
// graph is initialised, from its QRhi (QRhiDriverInfo: the device type, CPU
// for Vulkan's lavapipe and SwiftShader and for Direct3D's WARP, and the
// device's name, which for OpenGL holds GL_RENDERER). Until then it counts
// as a GPU, as before. The renderer seen is printed once ("phoenix:
// renderer ...").

#pragma once

#include <QList>
#include <QObject>
#include <QPointer>
#include <QSGRendererInterface>
#include <QtQml/qqmlregistration.h>
#include <rhi/qrhi.h>

class QQuickWindow;

class RenderInfo : public QObject
{
    Q_OBJECT
    QML_ELEMENT
    QML_SINGLETON

    Q_PROPERTY(bool softwareRendering READ softwareRendering NOTIFY changed)
    Q_PROPERTY(bool softwareDetected READ softwareDetected NOTIFY changed)
    Q_PROPERTY(QString rendererName READ rendererName NOTIFY changed)
    Q_PROPERTY(QString graphicsApi READ graphicsApi NOTIFY changed)
    Q_PROPERTY(QString mode READ mode WRITE setMode NOTIFY changed)

public:
    explicit RenderInfo(QObject *parent = nullptr);

    bool softwareRendering() const;
    bool softwareDetected() const { return m_detected; }
    QString rendererName() const { return m_rendererName; }
    QString graphicsApi() const { return m_api; }
    QString mode() const { return m_mode; }
    void setMode(const QString &mode);

    // Whether a renderer draws on the CPU: Qt Quick's software renderer, a
    // device of type CPU, or a device named as one of the software
    // rasterisers (llvmpipe, softpipe, "Software Rasterizer", SwiftShader,
    // "Microsoft Basic Render Driver", "Software Renderer", "GDI Generic").
    static bool isSoftwareRenderer(QSGRendererInterface::GraphicsApi api, const QByteArray &deviceName,
                                   QRhiDriverInfo::DeviceType deviceType);
    // PHOENIX_SOFTWARE_RENDERING's value as a mode: "on" (1, on, true, yes),
    // "off" (0, off, false, no) or "auto" (auto, or nothing); "" for
    // anything else.
    static QString parseMode(const QByteArray &value);
    static QString apiName(QSGRendererInterface::GraphicsApi api);

signals:
    void changed();

private:
    struct Seen {
        QSGRendererInterface::GraphicsApi api = QSGRendererInterface::Unknown;
        QByteArray deviceName;
        QRhiDriverInfo::DeviceType deviceType = QRhiDriverInfo::UnknownDevice;
    };
    // On the thread that renders the window (the render thread, or the GUI
    // thread with the basic render loop): its QRhi is used there.
    static Seen see(QQuickWindow *window);

    void watchWindows();
    void watch(QQuickWindow *window);
    void report(const Seen &seen);

    QList<QPointer<QQuickWindow>> m_windows;
    QString m_mode = QStringLiteral("auto");
    bool m_detected = false;
    QString m_rendererName;
    QString m_api;
};
