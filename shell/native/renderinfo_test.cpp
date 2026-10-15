// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// renderinfo-test: which renderers RenderInfo counts as drawing on the CPU
// (the shell's blur steps down there), PHOENIX_SOFTWARE_RENDERING's values,
// and a window on Qt Quick's software renderer seen at once.
//
//   build/renderinfo-test

#include "renderinfo.h"

#include <QGuiApplication>
#include <QQuickWindow>
#include <QWindow>

#include <cstdio>

static int failures = 0;
static void check(bool ok, const QString &what)
{
    std::printf("%s %s\n", ok ? "ok  " : "FAIL", qPrintable(what));
    if (!ok)
        ++failures;
}

static void software(QSGRendererInterface::GraphicsApi api, const char *name, QRhiDriverInfo::DeviceType type, bool expected)
{
    const bool is = RenderInfo::isSoftwareRenderer(api, QByteArray(name), type);
    check(is == expected, QStringLiteral("%1 \"%2\": %3").arg(RenderInfo::apiName(api), QLatin1String(name),
                                                             expected ? QStringLiteral("software") : QStringLiteral("GPU")));
}

int main(int argc, char **argv)
{
    using A = QSGRendererInterface;
    using D = QRhiDriverInfo;

    // OpenGL: QRhi's device name is "GL_VENDOR GL_RENDERER GL_VERSION".
    // Seen in the simulator in a container without a GPU, under Xvfb:
    software(A::OpenGL, "Mesa llvmpipe (LLVM 20.1.2, 256 bits) 4.5 (Compatibility Profile) Mesa 25.2.8-0ubuntu0.24.04.4", D::UnknownDevice, true);
    software(A::OpenGL, "Mesa softpipe 3.3 (Core Profile) Mesa 23.2.1", D::UnknownDevice, true);
    software(A::OpenGL, "Mesa Project Software Rasterizer 2.1 Mesa 10.1.3", D::UnknownDevice, true);
    software(A::OpenGL, "Google Inc. Google SwiftShader OpenGL ES 3.0 SwiftShader 4.1.0.7", D::UnknownDevice, true);
    software(A::OpenGL, "Google Inc. (Google) ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver-5.0.0) OpenGL ES 3.0.0", D::UnknownDevice, true);
    software(A::OpenGL, "Microsoft Corporation D3D12 (Microsoft Basic Render Driver) 4.2 (Compatibility Profile) Mesa 24.0.0", D::UnknownDevice, true);
    software(A::OpenGL, "Apple Computer, Inc. Apple Software Renderer 2.1 APPLE-20.1.9", D::UnknownDevice, true);
    software(A::OpenGL, "Microsoft Corporation GDI Generic 1.1.0", D::UnknownDevice, true);
    software(A::OpenGL, "Mesa zink Vulkan 1.3(llvmpipe (LLVM 15.0.7, 256 bits) (MESA_LLVMPIPE)) 4.6 (Compatibility Profile) Mesa 23.3.0", D::UnknownDevice, true);
    // GPUs, the devices' own and the VMs' (virgl and VMware draw on the host's GPU).
    software(A::OpenGL, "Intel Mesa Intel(R) UHD Graphics 620 (KBL GT2) 4.6 (Core Profile) Mesa 23.2.1", D::UnknownDevice, false);
    software(A::OpenGL, "NVIDIA Corporation NVIDIA GeForce RTX 3060/PCIe/SSE2 4.6.0 NVIDIA 535.129.03", D::UnknownDevice, false);
    software(A::OpenGL, "AMD AMD Radeon 890M Graphics (radeonsi, gfx1150, LLVM 19.1.1, DRM 3.59) 4.6 (Core Profile) Mesa 24.3.0", D::UnknownDevice, false);
    software(A::OpenGL, "freedreno FD810 OpenGL ES 3.2 Mesa 26.0.0", D::UnknownDevice, false);
    software(A::OpenGL, "Qualcomm Adreno (TM) 740 OpenGL ES 3.2 V@0615.0", D::UnknownDevice, false);
    software(A::OpenGL, "Panfrost Mali-G52 r1 (Panfrost) OpenGL ES 3.1 Mesa 24.0.0", D::UnknownDevice, false);
    software(A::OpenGL, "Broadcom V3D 4.2 OpenGL ES 3.1 Mesa 24.0.0", D::UnknownDevice, false);
    software(A::OpenGL, "Mesa virgl (Apple M2) 4.3 (Core Profile) Mesa 24.0.0", D::UnknownDevice, false);
    software(A::OpenGL, "VMware, Inc. SVGA3D; build: RELEASE;  LLVM; 4.1 (Core Profile) Mesa 23.0.0", D::UnknownDevice, false);
    software(A::OpenGL, "Apple Apple M2 4.1 Metal - 83.1", D::UnknownDevice, false);
    software(A::OpenGL, "", D::UnknownDevice, false);
    // Vulkan, Direct3D, Metal: the device's type says it.
    software(A::Vulkan, "llvmpipe (LLVM 15.0.7, 256 bits)", D::CpuDevice, true);
    software(A::Vulkan, "SwiftShader Device (Subzero)", D::CpuDevice, true);
    software(A::Direct3D11, "Microsoft Basic Render Driver", D::CpuDevice, true);
    software(A::Direct3D12, "Some future WARP", D::CpuDevice, true);
    software(A::Vulkan, "AMD Radeon 890M Graphics (RADV GFX1150)", D::IntegratedDevice, false);
    software(A::Vulkan, "Virtio-GPU Venus (Apple M2)", D::VirtualDevice, false);
    software(A::Metal, "Apple M2", D::IntegratedDevice, false);
    software(A::Direct3D11, "NVIDIA GeForce RTX 3060", D::DiscreteDevice, false);
    // Qt Quick's software renderer, whatever else it says.
    software(A::Software, "", D::UnknownDevice, true);
    // Null draws nothing (a test backend): not a CPU's work.
    software(A::Null, "Null", D::UnknownDevice, false);

    // PHOENIX_SOFTWARE_RENDERING.
    struct { const char *value; const char *mode; } modes[] = {
        { "1", "on" }, { "on", "on" }, { "ON", "on" }, { "true", "on" }, { "yes", "on" },
        { "0", "off" }, { "off", "off" }, { "false", "off" }, { "no", "off" }, { " 0 ", "off" },
        { "", "auto" }, { "auto", "auto" }, { "Auto", "auto" },
        { "2", "" }, { "gpu", "" },
    };
    for (const auto &m : modes) {
        check(RenderInfo::parseMode(m.value) == QLatin1String(m.mode),
              QStringLiteral("PHOENIX_SOFTWARE_RENDERING=\"%1\": %2").arg(QLatin1String(m.value),
                  *m.mode ? QLatin1String(m.mode) : QLatin1String("refused")));
    }

    // A window on the software renderer is seen before it draws.
    if (qEnvironmentVariableIsEmpty("QT_QPA_PLATFORM"))
        qputenv("QT_QPA_PLATFORM", "offscreen");
    QQuickWindow::setGraphicsApi(QSGRendererInterface::Software);
    QGuiApplication app(argc, argv);
    // A child window, as the simulator's view is in its menu bar's window.
    QWindow host;
    QQuickWindow window(&host);
    qunsetenv("PHOENIX_SOFTWARE_RENDERING");
    {
        RenderInfo info;
        check(info.mode() == QLatin1String("auto"), QStringLiteral("auto without PHOENIX_SOFTWARE_RENDERING"));
        check(info.graphicsApi() == QLatin1String("Software") && info.softwareDetected() && info.softwareRendering(),
              QStringLiteral("the software renderer's (child) window: software at once (%1, %2)").arg(info.graphicsApi(), info.rendererName()));
        int changes = 0;
        QObject::connect(&info, &RenderInfo::changed, [&changes] { ++changes; });
        info.setMode(QStringLiteral("off"));
        check(!info.softwareRendering() && info.softwareDetected() && changes == 1, QStringLiteral("mode off: not software, detection kept"));
        info.setMode(QStringLiteral("on"));
        check(info.softwareRendering() && changes == 2, QStringLiteral("mode on: software"));
        info.setMode(QStringLiteral("sometimes"));
        check(info.mode() == QLatin1String("on") && changes == 2, QStringLiteral("an unknown mode is refused"));
        info.setMode(QStringLiteral("auto"));
        check(info.softwareRendering() && changes == 3, QStringLiteral("mode auto: as detected"));
    }
    qputenv("PHOENIX_SOFTWARE_RENDERING", "0");
    {
        RenderInfo info;
        check(info.mode() == QLatin1String("off") && !info.softwareRendering() && info.softwareDetected(),
              QStringLiteral("PHOENIX_SOFTWARE_RENDERING=0: forced off"));
    }
    qputenv("PHOENIX_SOFTWARE_RENDERING", "bogus");
    {
        RenderInfo info;
        check(info.mode() == QLatin1String("auto"), QStringLiteral("PHOENIX_SOFTWARE_RENDERING=bogus: auto"));
    }
    qunsetenv("PHOENIX_SOFTWARE_RENDERING");

    std::printf(failures ? "\n%d check(s) failed\n" : "\nall passed\n", failures);
    return failures ? 1 : 0;
}
