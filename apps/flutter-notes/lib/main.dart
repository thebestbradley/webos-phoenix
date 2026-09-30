// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Notes (Flutter): the Notes demo in Flutter's Material 3 widgets, for
// phones and tablets, on the same db8 notes as the Enact and Ionic demos.

import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:intl/intl.dart';

import 'src/notes_model.dart';
import 'src/platform.dart';
import 'src/ui/app.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // Flutter's web build draws into a canvas; its semantics tree is what a
  // screen reader (and the e2e test) reads, so it is always on.
  SemanticsBinding.instance.ensureSemantics();
  // Dates in the system's language where intl has it (de_DE falls back to
  // de), else English.
  await initializeDateFormatting();
  Intl.defaultLocale = Intl.verifiedLocale(
    WidgetsBinding.instance.platformDispatcher.locale.toLanguageTag(),
    DateFormat.localeExists,
    onFailure: (_) => 'en_US',
  );
  runApp(NotesApp(model: NotesModel(systemLuna())));
  WidgetsBinding.instance.addPostFrameCallback((_) => stageReady());
}
