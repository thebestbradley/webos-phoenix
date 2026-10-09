# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0

SUMMARY = "Firmware for the hardware Phoenix supports out of the box"
DESCRIPTION = "The redistributable firmware (linux-firmware, split per chip \
by OE) for common Wi-Fi, Bluetooth, Ethernet and graphics hardware, as \
Ubuntu and Debian ship it: installed unmodified with its licence files. \
Recommended, so PHOENIX_FIRMWARE_EXCLUDE (BAD_RECOMMENDATIONS) can leave \
pieces out of a small image; the Hardware app offers what is left out. \
See docs/HARDWARE.md, \"Firmware in the image\"."
LICENSE = "MIT"

inherit packagegroup

# Graphics: AMD (amdgpu, radeon), Intel (i915: GuC, HuC, DMC), NVIDIA
# (nouveau's signed firmware and GSP).
PHOENIX_FIRMWARE_GRAPHICS ?= "linux-firmware-amdgpu linux-firmware-radeon linux-firmware-i915 linux-firmware-nvidia-gpu"
# Wi-Fi and Bluetooth: Intel, Realtek, Qualcomm Atheros, MediaTek, Broadcom/
# Cypress, Marvell/NXP.
PHOENIX_FIRMWARE_WIRELESS ?= " \
    linux-firmware-iwlwifi-misc linux-firmware-iwlwifi-7260 linux-firmware-iwlwifi-7265 linux-firmware-iwlwifi-7265d \
    linux-firmware-iwlwifi-8000c linux-firmware-iwlwifi-8265 linux-firmware-iwlwifi-9000 linux-firmware-iwlwifi-9260 \
    linux-firmware-ibt-misc linux-firmware-ibt-11-5 linux-firmware-ibt-12-16 linux-firmware-ibt-17 linux-firmware-ibt-20 \
    linux-firmware-ibt-hw-37-7 linux-firmware-ibt-hw-37-8 \
    linux-firmware-rtl8188 linux-firmware-rtl8192cu linux-firmware-rtl8192ce linux-firmware-rtl8192su linux-firmware-rtl8723 \
    linux-firmware-rtl8761 linux-firmware-rtl8821 linux-firmware-rtl8822 \
    linux-firmware-ath9k linux-firmware-ath10k linux-firmware-ath11k linux-firmware-ath12k linux-firmware-ath3k linux-firmware-ar3k \
    linux-firmware-qca \
    linux-firmware-mediatek linux-firmware-mt7601u linux-firmware-mt76x2 linux-firmware-mt7650 \
    linux-firmware-bcm43430 linux-firmware-bcm43455 linux-firmware-bcm4350 linux-firmware-bcm4354 linux-firmware-bcm4356-pcie \
    linux-firmware-bcm43602 linux-firmware-bcm4373 \
    linux-firmware-sd8887 linux-firmware-sd8897 linux-firmware-sd8997 linux-firmware-pcie8997 linux-firmware-usb8997 \
"
# Wired: Realtek and Broadcom Ethernet.
PHOENIX_FIRMWARE_WIRED ?= "linux-firmware-rtl-nic linux-firmware-rtl8168 linux-firmware-bnx2"

RRECOMMENDS:${PN} = "${PHOENIX_FIRMWARE_GRAPHICS} ${PHOENIX_FIRMWARE_WIRELESS} ${PHOENIX_FIRMWARE_WIRED}"
