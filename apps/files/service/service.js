// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The org.webosphoenix.filemanager Luna service: registers the methods of
// filemanager.js with webos-service, the Node.js module OSE's JavaScript
// services use (webosose/nodejs-module-webos-service). run-js-service
// starts it on demand (sysbus/org.webosphoenix.filemanager.service); the
// role and permission files beside it follow OSE's luna-service2 ACG
// format and are installed by tools/install-rootfs.py.

"use strict";

const Service = require("webos-service");
const { createFileManager, METHODS } = require("./filemanager");

const service = new Service("org.webosphoenix.filemanager");
const fm = createFileManager();

for (const name of METHODS) {
    service.register(name, (message) => {
        fm[name](message.payload).then((reply) => message.respond(reply));
    });
}
