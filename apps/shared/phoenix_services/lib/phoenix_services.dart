// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

/// The Phoenix service plugin for Flutter and Dart web apps: the same API as
/// @phoenix/sdk (docs/APP-SDK.md) with Futures and Streams, over the Luna
/// service bus of webOS Phoenix's web runtime.
///
///     final phoenix = Phoenix.system();
///     phoenix.app.stageReady();
///     await phoenix.share.open(const ShareContent(title: 'Hi', text: 'Hello'));
library;

export 'src/host.dart';
export 'src/luna.dart';
export 'src/phoenix.dart';
export 'src/types.dart';
