# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# What meta-phoenix's own phone and tablet machines share (docs/HARDWARE.md,
# "First targets"). OSE's machines are configured by meta-webosose; the
# Raspberry Pi's webOS settings, which these follow, are in
# meta-webos-raspberrypi/conf/machine/include/webos-rpi.inc (d7ed46c).

# A real device, not the emulator: meta-webos's webos_machine_impl_dep.bbclass
# defaults to "emulator" and adds it to the overrides; webos-rpi.inc sets
# "hardware" for the Pi.
WEBOS_TARGET_MACHINE_IMPL = "hardware"

# An override for what all of these share (packagegroup-webos-extended's
# bbappend in meta-phoenix).
MACHINEOVERRIDES =. "phoenix-mobile:"

# OSE's GStreamer media stack (g-media-pipeline, media-resource-calculator,
# media-codec-interface) is built only for OSE's own machines: their
# COMPATIBLE_MACHINE lists qemux86(-64) and raspberrypi3/4 only,
# media-resource-calculator "isn't usable for any other MACHINE" (meta-webos
# d7ed46c, recipes-webos/media-resource-calculator). For a "hardware"
# machine webruntime.inc turns on gstreamer, umediaserver, gav and
# webos-codec (PACKAGECONFIG:append:hardware), which depend on them; here
# WebAppMgr's Chromium plays media itself until a resource table for these
# devices exists. Found by the parse check's dry run (11 October 2026).
PACKAGECONFIG_MEDIA:pn-webruntime = ""
PACKAGECONFIG_WEBOS_CODEC:pn-webruntime = ""
PACKAGECONFIG_MEDIA:pn-webruntime-clang = ""
PACKAGECONFIG_WEBOS_CODEC:pn-webruntime-clang = ""
# The same calculator is needed by the camera pipeline (g-camera-pipeline.bb:25),
# which the webos-camera distro feature adds to every image
# (webos_image.bbclass:49, packagegroup-webos-camera.bb:13), and by the media
# recorder that packagegroup-webos-media brings (packagegroup-webos-media.bb:20,
# com.webos.service.mediarecorder.bb:12). Neither is in these images until
# the devices have a resource table; their cameras are a hardware item
# (docs/HARDWARE.md). Found by CI's parse job (11 October 2026).
DISTRO_FEATURES:remove = "webos-camera"
VIRTUAL-RUNTIME_mediarecorder:pn-packagegroup-webos-media = ""

# webos-graphics-drm: luna-surfacemanager on KMS/DRM, as the Pi
# (webos-rpi.inc) and the emulator (webos.inc, :qemuall) have it.
MACHINE_FEATURES = "alsa bluetooth wifi screen touchscreen keyboard usbgadget usbhost vfat ext2 rtc webos-graphics-drm"

# Every module of the kernel, as on the Pi. (The machine's device
# configuration, /etc/phoenix/device.json and the compositor's geometry, is
# phoenix-device-config's, in webos-phoenix-image for every machine.)
MACHINE_EXTRA_RRECOMMENDS += "kernel-modules"

# The kernel's device trees are deployed under their own names (no vendor
# directory) beside the kernel image, for the boot images.
KERNEL_DTBVENDORED = "0"
