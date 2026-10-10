// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The app's part in the system through phoenix_services: the app menu,
// shares received and Just Type's action (a fake bus and host).

import 'package:flutter/material.dart';
import 'package:flutter_notes/src/notes_model.dart';
import 'package:flutter_notes/src/platform_stub.dart' show resetStubStorage;
import 'package:flutter_notes/src/settings.dart';
import 'package:flutter_notes/src/share.dart';
import 'package:flutter_notes/src/ui/app.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:phoenix_services/phoenix_services.dart' show Phoenix;
import 'package:phoenix_services/testing.dart';

import 'fake_db8.dart';

void main() {
  late StubHost host;
  late FakeBus bus;
  late NotesModel model;

  Future<void> pumpApp(WidgetTester tester, {String launchParams = '{}'}) async {
    tester.view.physicalSize = const Size(1024, 740);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    resetStubStorage();
    host = StubHost(webos: true, phoenix: true, appId: 'org.webosphoenix.flutternotes', launchParams: launchParams);
    bus = FakeBus();
    model = NotesModel(FakeDb8(), settings: const Settings());
    await tester.pumpWidget(NotesApp(model: model, phoenix: Phoenix(transport: bus, host: host)));
    await tester.pumpAndSettle();
  }

  testWidgets('a share at launch, and one later, become notes', (tester) async {
    await pumpApp(tester, launchParams: '{"share":{"title":"Recipe","text":"Flour, eggs"}}');
    expect(model.draft, '# Recipe\n\nFlour, eggs');
    host.relaunch({
      'share': {'url': 'https://example.com'}
    });
    await tester.pumpAndSettle();
    expect(model.draft, 'https://example.com');
  });

  testWidgets("Just Type's action makes a note of the words", (tester) async {
    await pumpApp(tester);
    host.relaunch({'newNote': 'Typed in Just Type'});
    await tester.pumpAndSettle();
    expect(model.draft, 'Typed in Just Type');
  });

  testWidgets('the app name opens the menu: Edit, Share, New Note, Settings', (tester) async {
    await pumpApp(tester);
    host.tapAppName();
    await tester.pumpAndSettle();
    for (final label in ['Edit', 'Share', 'New Note', 'Settings']) {
      expect(find.text(label), findsWidgets);
    }
    bus.handle('luna://org.webosphoenix.share/open', (_) => {'action': 'cancel'});
    await tester.tap(find.text('New Note').last);
    await tester.pumpAndSettle();
    expect(model.selected, isNotNull);
    host.tapAppName();
    await tester.pumpAndSettle();
    await tester.tap(find.text('Share').last);
    await tester.pumpAndSettle();
    expect(bus.calls.single.uri, 'luna://org.webosphoenix.share/open');
  });

  test('share helpers match notes-core', () {
    expect(noteFromShare(title: 'Recipe', text: 'Flour, eggs', url: 'https://example.com/r'), '# Recipe\n\nFlour, eggs\n\nhttps://example.com/r');
    expect(noteFromShare(text: 'see https://x.org', url: 'https://x.org'), 'see https://x.org');
    expect(shareOfNote('# Shopping\n\n- milk').title, 'Shopping');
  });
}
