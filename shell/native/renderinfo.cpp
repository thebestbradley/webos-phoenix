// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

#include "renderinfo.h"

#include <QGuiApplication>
#include <QQuickWindow>
#include <QTimer>
#include <QWindow>

namespace {

QString deviceTypeName(QRhiDriverInfo::DeviceType type)
{
    switch (type) {
    case QRhiDriverInfo::IntegratedDevice: return QStringLiteral("integrated GPU");
    case QRhiDriverInfo::DiscreteDevice: return QStringLiteral("discrete GPU");
    case QRhiDriverInfo::ExternalDevice: return QStringLiteral("external GPU");
    case QRhiDriverInfo::VirtualDevice: return QStringLiteral("virtual GPU");
    case QRhiDriverInfo::CpuDevice: return QStringLiteral("CPU");
    case QRhiDriverInfo::UnknownDevice: break;
    }
    return QString();
}

} // namespace

RenderInfo::RenderInfo(QObject *parent)
    : QObject(parent)
{
    const QByteArray env = qgetenv("PHOENIX_SOFTWARE_RENDERING");
    const QString mode = parseMode(env);
    if (mode.isEmpty())
        qWarning("phoenix: PHOENIX_SOFTWARE_RENDERING=%s: use 1 (on), 0 (off) or auto; telling by the renderer",
                 env.constData());
    else
        m_mode = mode;
    if (m_mode != QLatin1String("auto"))
        qInfo("phoenix: software rendering forced %s (PHOENIX_SOFTWARE_RENDERING)", qPrintable(m_mode));
    watchWindows();
    // A window made just after (a Window that is the root of its QML).
    if (m_windows.isEmpty())
        QTimer::singleShot(0, this, &RenderInfo::watchWindows);
}

bool RenderInfo::softwareRendering() const
{
    if (m_mode == QLatin1String("on"))
        return true;
    if (m_mode == QLatin1String("off"))
        return false;
    return m_detected;
}

void RenderInfo::setMode(const QString &mode)
{
    const QString m = parseMode(mode.toUtf8());
    if (m.isEmpty() || mode.isEmpty()) {
        qWarning("RenderInfo.mode: \"%s\" is not auto, on or off", qPrintable(mode));
        return;
    }
    if (m == m_mode)
        return;
    m_mode = m;
    emit changed();
}

bool RenderInfo::isSoftwareRenderer(QSGRendererInterface::GraphicsApi api, const QByteArray &deviceName,
                                    QRhiDriverInfo::DeviceType deviceType)
{
    // Qt Quick's own software renderer (QT_QUICK_BACKEND=software, or no
    // OpenGL on the platform): no shader effects at all.
    if (api == QSGRendererInterface::Software)
        return true;
    // Vulkan's lavapipe and SwiftShader (VK_PHYSICAL_DEVICE_TYPE_CPU),
    // Direct3D's WARP (DXGI_ADAPTER_FLAG_SOFTWARE).
    if (deviceType == QRhiDriverInfo::CpuDevice)
        return true;
    // OpenGL says only its names (GL_VENDOR, GL_RENDERER, GL_VERSION):
    //   Mesa's   "llvmpipe (LLVM 20.1.2, 256 bits)", "softpipe",
    //            "Software Rasterizer" (classic swrast), and zink or
    //            d3d12 over them: "zink Vulkan 1.3(llvmpipe ...)",
    //            "D3D12 (Microsoft Basic Render Driver)"
    //   Google's "Google SwiftShader", ANGLE's "ANGLE (..., SwiftShader Device ...)"
    //   Apple's  "Apple Software Renderer"
    //   Windows' "GDI Generic" (OpenGL 1.1 in software)
    static const char *const names[] = {
        "llvmpipe", "softpipe", "software rasterizer", "swiftshader",
        "microsoft basic render driver", "software renderer", "gdi generic",
    };
    const QByteArray name = deviceName.toLower();
    for (const char *software : names) {
        if (name.contains(software))
            return true;
    }
    return false;
}

QString RenderInfo::parseMode(const QByteArray &value)
{
    const QByteArray v = value.trimmed().toLower();
    if (v.isEmpty() || v == "auto")
        return QStringLiteral("auto");
    if (v == "1" || v == "on" || v == "true" || v == "yes")
        return QStringLiteral("on");
    if (v == "0" || v == "off" || v == "false" || v == "no")
        return QStringLiteral("off");
    return QString();
}

QString RenderInfo::apiName(QSGRendererInterface::GraphicsApi api)
{
    switch (api) {
    case QSGRendererInterface::Software: return QStringLiteral("Software");
    case QSGRendererInterface::OpenVG: return QStringLiteral("OpenVG");
    case QSGRendererInterface::OpenGL: return QStringLiteral("OpenGL");
    case QSGRendererInterface::Direct3D11: return QStringLiteral("Direct3D 11");
    case QSGRendererInterface::Direct3D12: return QStringLiteral("Direct3D 12");
    case QSGRendererInterface::Vulkan: return QStringLiteral("Vulkan");
    case QSGRendererInterface::Metal: return QStringLiteral("Metal");
    case QSGRendererInterface::Null: return QStringLiteral("Null");
    case QSGRendererInterface::Unknown: break;
    }
    return QStringLiteral("Unknown");
}

RenderInfo::Seen RenderInfo::see(QQuickWindow *window)
{
    Seen seen;
    seen.api = window->rendererInterface()->graphicsApi();
    if (QRhi *rhi = window->rhi()) {
        const QRhiDriverInfo info = rhi->driverInfo();
        seen.deviceName = info.deviceName;
        seen.deviceType = info.deviceType;
    }
    return seen;
}

void RenderInfo::watchWindows()
{
    // All of them: the simulator's view is a child window, inside the
    // widget window with its menu bar (SimChrome, createWindowContainer).
    const QList<QWindow *> windows = QGuiApplication::allWindows();
    for (QWindow *window : windows) {
        if (auto *quick = qobject_cast<QQuickWindow *>(window))
            watch(quick);
    }
}

void RenderInfo::watch(QQuickWindow *window)
{
    for (const QPointer<QQuickWindow> &w : std::as_const(m_windows)) {
        if (w == window)
            return;
    }
    m_windows.append(window);
    // Emitted where the window renders, the render thread with the threaded
    // render loop: its QRhi is read there and what it says is passed to this
    // thread, where QML reads it. Again if the scene graph is made anew.
    connect(window, &QQuickWindow::sceneGraphInitialized, this, [this, window] {
        const Seen seen = see(window);
        QMetaObject::invokeMethod(this, [this, seen] { report(seen); }, Qt::QueuedConnection);
    }, Qt::DirectConnection);
    // The API is known before the scene graph is: the software renderer at
    // once, with nothing drawn yet.
    const QSGRendererInterface::GraphicsApi api = window->rendererInterface()->graphicsApi();
    if (api == QSGRendererInterface::Software || window->isSceneGraphInitialized())
        report(see(window));
}

void RenderInfo::report(const Seen &seen)
{
    const bool software = isSoftwareRenderer(seen.api, seen.deviceName, seen.deviceType);
    const QString api = apiName(seen.api);
    const QString name = seen.api == QSGRendererInterface::Software
        ? QStringLiteral("Qt Quick software renderer") : QString::fromUtf8(seen.deviceName).simplified();
    if (software == m_detected && name == m_rendererName && api == m_api)
        return;
    m_detected = software;
    m_rendererName = name;
    m_api = api;
    const QString type = deviceTypeName(seen.deviceType);
    QString note;
    if (m_mode == QLatin1String("auto"))
        note = software ? QStringLiteral(": drawing on the CPU, so the shell steps down (no blur behind translucent surfaces)") : QString();
    else
        note = QStringLiteral(" (software rendering forced %1)").arg(m_mode);
    qInfo("phoenix: renderer %s (%s%s%s)%s", qPrintable(name.isEmpty() ? QStringLiteral("unknown") : name),
          qPrintable(api), type.isEmpty() ? "" : ", ", qPrintable(type), qPrintable(note));
    emit changed();
}
