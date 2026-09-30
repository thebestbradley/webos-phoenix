// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The layout by width, and back (the webOS back gesture arrives as Escape).

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_notes/src/notes_model.dart';
import 'package:flutter_notes/src/platform_stub.dart' show resetStubStorage;
import 'package:flutter_notes/src/settings.dart';
import 'package:flutter_notes/src/ui/app.dart';
import 'package:flutter_test/flutter_test.dart';

import 'fake_db8.dart';

Future<void> pumpApp(WidgetTester tester, Size size) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  resetStubStorage();
  await tester.pumpWidget(NotesApp(model: NotesModel(FakeDb8(), settings: const Settings())));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('a phone shows the list, then the note in its place; back returns', (tester) async {
    await pumpApp(tester, const Size(390, 800));
    expect(find.text('All Notes'), findsWidgets); // the large app bar's two titles
    expect(find.text('Folders'), findsNothing); // in the drawer
    await tester.tap(find.text('Welcome to Notes'));
    await tester.pumpAndSettle();
    expect(find.byTooltip('Back'), findsOneWidget);
    expect(find.text('Markdown'), findsOneWidget);

    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();
    expect(find.byTooltip('Back'), findsNothing);
    expect(find.text('Welcome to Notes'), findsOneWidget);

    await tester.tap(find.byTooltip('Folders'));
    await tester.pumpAndSettle();
    expect(find.text('Recently Deleted'), findsOneWidget);
    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();
    expect(find.text('Recently Deleted'), findsNothing);
  });

  testWidgets('a tablet in landscape shows folders, list and note together', (tester) async {
    await pumpApp(tester, const Size(1024, 740));
    expect(find.text('Folders'), findsOneWidget);
    expect(find.text('No note selected'), findsOneWidget);
    await tester.tap(find.text('Welcome to Notes'));
    await tester.pumpAndSettle();
    expect(find.text('Welcome to Notes'), findsOneWidget); // still listed
    expect(find.byTooltip('Back'), findsNothing);
    expect(find.text('Markdown'), findsOneWidget);
  });

  testWidgets('the preview checks a task box and shows the progress', (tester) async {
    await pumpApp(tester, const Size(1024, 740));
    await tester.tap(find.text('Welcome to Notes'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Preview'));
    await tester.pumpAndSettle();
    expect(find.text('1 of 3 done'), findsOneWidget);
    expect(find.byType(Checkbox), findsNWidgets(3));
    await tester.ensureVisible(find.byType(Checkbox).at(2));
    await tester.tap(find.byType(Checkbox).at(2));
    await tester.pumpAndSettle();
    expect(find.text('2 of 3 done'), findsOneWidget);
  });
}
