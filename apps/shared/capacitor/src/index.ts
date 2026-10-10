// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// @phoenix/capacitor: the Phoenix service plugin for Capacitor and Ionic
// apps, registered the Capacitor way:
//
//     import { Phoenix } from "@phoenix/capacitor";
//     await Phoenix.share({ title: note.title, text: note.body });
//     Phoenix.addListener("share", (s) => createNote(s.text ?? ""));
//
// Phoenix runs web apps, so the plugin's implementation is its web one
// (over @phoenix/sdk), loaded when first used.

import { registerPlugin } from "@capacitor/core";
import type { PhoenixPlugin } from "./definitions";

export const Phoenix = registerPlugin<PhoenixPlugin>("Phoenix", {
    web: () => import("./web").then((m) => new m.PhoenixWeb()),
});

export * from "./definitions";
