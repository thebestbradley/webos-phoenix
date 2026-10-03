// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// What the app needs from the web runtime: Luna, settings storage, opening
// links and telling the card the first frame is ready. The web build uses
// the browser's (platform_web.dart); elsewhere (unit tests) an in-memory
// stand-in (platform_stub.dart).

export 'platform_stub.dart' if (dart.library.js_interop) 'platform_web.dart';
