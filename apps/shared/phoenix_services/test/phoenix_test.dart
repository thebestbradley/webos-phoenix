// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

import 'dart:async';

import 'package:phoenix_services/phoenix_services.dart';
import 'package:phoenix_services/testing.dart';
import 'package:test/test.dart';

void main() {
  late FakeBus bus;
  late StubHost host;
  late Phoenix phoenix;

  setUp(() {
    bus = FakeBus();
    host = StubHost(webos: true, phoenix: true, shell: true, appId: 'com.example.flutter', launchParams: '{"share":{"text":"at launch"}}');
    phoenix = Phoenix(transport: bus, host: host);
  });

  group('core', () {
    test('error replies keep errorCode and errorText, classified as @phoenix/sdk does', () async {
      bus.handle('luna://s/denied', (_) => throw LunaException('luna://s/denied', {'errorCode': -1, 'errorText': 'Denied method call'}));
      bus.handle('luna://s/bad', (_) => throw LunaException('luna://s/bad', {'errorCode': 42, 'errorText': 'Nope'}));
      await expectLater(
        phoenix.request('luna://s/denied'),
        throwsA(isA<LunaException>().having((e) => e.code, 'code', PhoenixErrorCode.permissionDenied)),
      );
      await expectLater(
        phoenix.request('luna://s/bad'),
        throwsA(isA<LunaException>().having((e) => e.errorCode, 'errorCode', 42).having((e) => e.code, 'code', PhoenixErrorCode.failed)),
      );
      await expectLater(
        phoenix.request('luna://s/none'),
        throwsA(isA<LunaException>().having((e) => e.code, 'code', PhoenixErrorCode.unavailable)),
      );
    });

    test('subscriptions are streams; cancelling the listen cancels the subscription', () async {
      bus.handle('luna://s/watch', (_) => {'n': 0});
      final got = <int>[];
      final sub = phoenix.subscribe('luna://s/watch').listen((r) => got.add(r['n'] as int));
      await Future<void>.delayed(Duration.zero);
      bus.emit('luna://s/watch', {'n': 1});
      await Future<void>.delayed(Duration.zero);
      expect(got, [0, 1]);
      expect(bus.calls.single.subscribed, isTrue);
      await sub.cancel();
      expect(bus.calls.single.subscribed, isFalse);
    });

    test('has() tells a browser, webOS OSE and Phoenix apart', () {
      final browser = Phoenix(transport: const NoTransport(), host: StubHost());
      expect(browser.has(Capability.bus), isFalse);
      expect(browser.has(Capability.share), isFalse);
      final ose = Phoenix(transport: bus, host: StubHost(webos: true));
      expect(ose.has(Capability.location), isTrue);
      expect(ose.has(Capability.share), isFalse);
      expect(ose.has(Capability.orientation), isTrue);
      expect(phoenix.has(Capability.share), isTrue);
    });

    test('off the web, Phoenix.system() has no bus', () async {
      final p = Phoenix.system();
      expect(p.has(Capability.bus), isFalse);
      await expectLater(
        p.request('luna://a.b/c'),
        throwsA(isA<LunaException>().having((e) => e.code, 'code', PhoenixErrorCode.unavailable)),
      );
    });
  });

  group('app', () {
    test('launch params, relaunches and the back gesture', () async {
      expect(phoenix.app.id, 'com.example.flutter');
      expect(phoenix.app.launchParams, {
        'share': {'text': 'at launch'},
      });
      final launches = <Json>[];
      final sub = phoenix.app.launches.listen(launches.add);
      await Future<void>.delayed(Duration.zero);
      host.relaunch({'b': 2});
      expect(launches, [
        {
          'share': {'text': 'at launch'},
        },
        {'b': 2},
      ]);
      await sub.cancel();

      var taken = 0;
      final off = phoenix.app.onBack(() => ++taken > 0);
      expect(host.back(), isTrue);
      off();
      expect(host.back(), isFalse);
    });

    test('the window through PalmSystem', () {
      phoenix.app.stageReady();
      phoenix.app.setOrientation(Orientation.landscape);
      phoenix.app.keepScreenOn(true);
      expect(host.log.map((l) => l[0]), ['PalmSystem.stageReady', 'PalmSystem.setWindowOrientation', 'PalmSystem.setWindowProperties']);
      expect(host.log[1][1], ['landscape']);
    });

    test('launch and open through the application manager', () async {
      bus.handle('luna://com.webos.applicationManager/launch', (_) => {});
      await phoenix.app.launch('com.palm.app.email', {'x': 1});
      expect(bus.calls.single.params, {
        'id': 'com.palm.app.email',
        'params': {'x': 1},
      });
    });
  });

  group('app menu, share, pickers', () {
    test('the app menu opens on the tap and on the palm-command relaunch', () async {
      var n = 0;
      final sub = phoenix.appMenu.toggles.listen((_) => n++);
      host.tapAppName();
      host.relaunch({'palm-command': 'open-app-menu'});
      host.relaunch({'other': 1});
      await Future<void>.delayed(Duration.zero);
      expect(n, 2);
      await sub.cancel();
      host.edits = {'canCopy': true};
      expect(phoenix.appMenu.editState().can(EditAction.copy), isTrue);
      phoenix.appMenu.edit(EditAction.copy);
      expect(host.log.last, ['edit', 'copy']);
    });

    test('opens the share sheet and receives shares', () async {
      bus.handle('luna://org.webosphoenix.share/open', (p) => {'action': 'app', 'appId': 'com.palm.app.email'});
      final r = await phoenix.share.open(const ShareContent(title: 'T', text: 'body'));
      expect(r.action, 'app');
      expect(r.appId, 'com.palm.app.email');
      expect(bus.calls.single.params, {'title': 'T', 'text': 'body'});

      final got = <String?>[];
      final sub = phoenix.share.receives.listen((s) => got.add(s.text ?? s.url));
      await Future<void>.delayed(Duration.zero);
      host.relaunch({
        'share': {'url': 'https://x'},
      });
      host.relaunch({'newNote': 'no'});
      expect(got, ['at launch', 'https://x']);
      await sub.cancel();
    });

    test('picks files, null when cancelled, and saves', () async {
      bus.handle(
        'luna://org.webosphoenix.filepicker/pick',
        (p) => p['multiple'] == true
            ? {
                'files': [
                  {'fullPath': '/media/internal/a.pdf', 'mimeType': 'application/pdf', 'name': 'a.pdf'},
                ],
              }
            : {'canceled': true},
      );
      final files = await phoenix.pickers.open(kinds: [PickKind.document], multiple: true, extensions: ['pdf']);
      expect(files!.single.name, 'a.pdf');
      expect(bus.calls.single.params, {
        'kinds': ['document'],
        'multiple': true,
        'extensions': ['pdf'],
      });
      expect(await phoenix.pickers.open(), isNull);
      bus.handle('luna://org.webosphoenix.filepicker/save', (_) => {'path': '/media/internal/Documents/x.txt'});
      expect(await phoenix.pickers.save(name: 'x.txt', data: 'aGk='), '/media/internal/Documents/x.txt');
    });
  });

  group('telling the user', () {
    test('banners through PalmSystem, notifications to the shell', () async {
      expect(await phoenix.notifications.banner('Saved', params: {'id': 1}), isNotEmpty);
      expect(host.log.single[1], ['Saved', '{"id":1}', '', '', '', 0]);
      await phoenix.notifications.post(
        'Upload',
        body: 'Done',
        tag: 'up',
        actions: const NotificationActions('luna://x/act', [('retry', 'Retry')]),
      );
      expect(host.log.last, [
        'postToHost',
        'notification',
        {
          'appId': 'com.example.flutter',
          'title': 'Upload',
          'body': 'Done',
          'params': <String, dynamic>{},
          'tag': 'up',
          'actions': {
            'uri': 'luna://x/act',
            'params': <String, dynamic>{},
            'items': [
              {'id': 'retry', 'label': 'Retry'},
            ],
          },
        },
      ]);
    });

    test('a banner falls back to OSE createToast without PalmSystem', () async {
      host.webos = false;
      bus.handle('luna://com.webos.notification/createToast', (_) => {'toastId': 't9'});
      expect(await phoenix.notifications.banner('Hi'), 't9');
    });

    test('ongoing activities and scheduled activities', () async {
      bus.handle('luna://org.webosphoenix.ongoing/set', (_) => {});
      bus.handle('luna://com.palm.activitymanager/create', (_) => {});
      await phoenix.ongoing.set('dl', 'Downloading', progress: 40);
      await phoenix.activities.schedule('com.example.sync', every: '1h', params: {'sync': true});
      expect(bus.calls[0].params['progress'], 40);
      final activity = bus.calls[1].params['activity'] as Map;
      expect(activity['schedule'], {'interval': '1h'});
      expect((activity['callback'] as Map)['params'], {
        'id': 'com.example.flutter',
        'params': {'sync': true},
      });
      expect(PhoenixActivities.activityDate(DateTime.utc(2026, 9, 28, 14, 5)), '2026-09-28 14:05:00Z');
    });
  });

  group('ways in, Synergy, device', () {
    test('Just Type actions and Assistant commands', () async {
      final typed = <String>[];
      final said = <String>[];
      final a = phoenix.justType.actions('newNote').listen(typed.add);
      final b = phoenix.assistant.commands('newNote').listen(said.add);
      await Future<void>.delayed(Duration.zero);
      host.relaunch({'newNote': 'milk'});
      expect(typed, ['milk']);
      expect(said, ['milk']);
      await a.cancel();
      await b.cancel();
    });

    test('contacts, calendar, compose', () async {
      bus.handle(
        'luna://com.palm.db/find',
        (p) => (p['query'] as Map)['from'] == 'com.palm.person:1'
            ? {
                'results': [
                  {
                    '_id': 'p1',
                    'name': {'givenName': 'Mary', 'familyName': 'Spetzler'},
                    'phoneNumbers': [
                      {'value': '(408) 555-0101'},
                    ],
                  },
                ],
              }
            : {
                'results': [
                  {'_id': 'e1', 'subject': 'Lunch', 'dtstart': 1000, 'dtend': 2000},
                  {'_id': 'e2', 'subject': 'Later', 'dtstart': 9000, 'dtend': 9500},
                ],
              },
      );
      expect((await phoenix.contacts.search('555 0101')).single.name, 'Mary Spetzler');
      expect(
        (await phoenix.calendar.events(DateTime.fromMillisecondsSinceEpoch(0), DateTime.fromMillisecondsSinceEpoch(5000))).single.subject,
        'Lunch',
      );
      bus.handle('luna://com.webos.applicationManager/launch', (_) => {});
      await phoenix.email.compose(to: ['a@x'], subject: 'S', body: 'B');
      expect(bus.calls.last.params, {
        'id': 'com.palm.app.email',
        'params': {
          'summary': 'S',
          'text': 'B',
          'isHtml': false,
          'recipients': [
            {'value': 'a@x', 'type': 'email', 'role': 1},
          ],
        },
      });
    });

    test('messaging falls back to an sms: link without Phoenix Messaging', () async {
      bus.handle(
        'luna://com.webos.applicationManager/launch',
        (_) => throw LunaException('x', {'errorText': 'app not found: org.webosphoenix.messaging'}),
      );
      bus.handle('luna://com.webos.applicationManager/open', (_) => {});
      await phoenix.messaging.compose(to: '4085550101', text: 'On my way');
      expect(bus.calls.last.params, {'target': 'sms:4085550101?body=On%20my%20way'});
    });

    test('a location refusal is permissionDenied', () async {
      bus.handle(
        'luna://com.webos.service.location/getLocationUpdates',
        (_) => throw LunaException('x', {'errorCode': 6, 'errorText': 'User denied'}),
      );
      await expectLater(
        phoenix.location.current(),
        throwsA(isA<LunaException>().having((e) => e.code, 'code', PhoenixErrorCode.permissionDenied)),
      );
    });
  });
}
