// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// org.webosphoenix.service.xmpp on a device: run-js-service starts it
// (sysbus/org.webosphoenix.service.xmpp.service), and the connector
// kit registers the methods of the definition in connector.js with
// webos-service. tools/install-rootfs.py installs it with the kit in its
// node_modules. The simulator runs connector.js in the page instead
// (runtime/phoenix-runtime.js, "Synergy connectors on the kit").

"use strict";

require("@phoenix/connector-kit/lib/device").runOnDevice(require("./connector"));
