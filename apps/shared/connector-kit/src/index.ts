// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// @phoenix/connector-kit: write a Synergy connector (an account type that
// fills Contacts, Calendar, Messaging, ... from a service) as a definition;
// the kit makes the Luna service the accounts service and the apps call.
// docs/SYNERGY-SDK.md is the guide; apps/dav is the worked example of the
// contract, apps/fediverse and examples/feeds are written on the kit.
//
// Compiled to CommonJS in lib/ (npm run build), which a device's
// run-js-service, the simulator's page loader and Node's tests all run.
// This entry has no Node.js-only module; lib/device (runOnDevice), lib/tools
// (the phoenix-connector CLI) and lib/conformance (the suite, with the
// in-memory db8 of @phoenix/synckit's tests) are entries of their own.

export { defineConnector } from "./define";
export { createConnectorService, methodNames, CALLBACKS } from "./service";
export { syncObjects, removeObjects, emptyStats } from "./engine";
export type { CapabilityStats } from "./engine";
export * from "./types";
