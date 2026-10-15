# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0

SUMMARY = "AirPods and unknown tracker alerts"
DESCRIPTION = "What org.webosphoenix.earbuds and org.webosphoenix.trackers \
(services/accessories, installed by phoenix-apps; docs/ACCESSORIES.md) need \
beyond the Bluetooth stack the image already has (BlueZ under OSE's \
com.webos.service.bluetooth2, on both device stacks): phoenix-l2cap, for \
the AirPods' control channel. Without it AirPods still show nearby and \
their batteries from their advertisements, and tracker alerts work; only \
the control channel's exact batteries, ear detection and listening modes \
are missing."
LICENSE = "Apache-2.0"

inherit packagegroup

RDEPENDS:${PN} = " \
    phoenix-l2cap \
"
