// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// org.example.service.feeds on a device: run-js-service starts this
// (sysbus/org.example.service.feeds.service); the kit registers the
// connector's methods with webos-service. The simulator loads
// connector.js itself (runtime/phoenix-runtime.js, "Connectors").

"use strict";

require("@phoenix/connector-kit/lib/device").runOnDevice(require("./connector"));
