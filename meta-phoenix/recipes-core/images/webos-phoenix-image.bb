# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0

require recipes-core/images/webos-image.bb

DESCRIPTION = "webOS OSE image with the Phoenix mobile shell"

IMAGE_INSTALL:append = " phoenix-shell phoenix-apps phoenix-pty phoenix-devices packagegroup-phoenix-terminal"
