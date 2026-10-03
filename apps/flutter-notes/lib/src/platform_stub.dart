// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

import 'luna.dart';

final Map<String, String> _store = {};

/// No Luna bus outside webOS: every call fails.
LunaTransport? systemLuna() => null;

String? readSetting(String key) => _store[key];

void writeSetting(String key, String value) => _store[key] = value;

void openLink(LunaTransport? luna, String url) {}

void stageReady() {}

/// Forgets the stored settings (tests start from a first run).
void resetStubStorage() => _store.clear();
