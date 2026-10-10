// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Off the web (the Dart VM, tests, a native Flutter build): no bus, no
// PalmSystem. Every request fails with PhoenixErrorCode.unavailable and
// has() says so; the native embedder (LG's Flutter for webOS) is a later
// transport.

import 'host.dart';
import 'luna.dart';
import 'phoenix.dart';

Phoenix systemPhoenix() => Phoenix(transport: const NoTransport(), host: StubHost());
