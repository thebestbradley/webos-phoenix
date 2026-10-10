# phoenix_services

The Phoenix service plugin for Flutter and Dart web apps on webOS Phoenix:
the same API as the `@phoenix/sdk` npm package, with Futures and Streams,
over the Luna service bus (`PalmServiceBridge`, through `dart:js_interop`).
Off the web there is no bus, and `has()` says so.

```dart
import 'package:phoenix_services/phoenix_services.dart';

final phoenix = Phoenix.system();
phoenix.app.stageReady();
phoenix.share.receives.listen((s) => createNote(s.text ?? ''));
await phoenix.share.open(const ShareContent(title: 'Hello', text: 'From my app'));
```

`package:phoenix_services/testing.dart` has a fake bus and host for tests
(`dart test`). Guide: [docs/APP-SDK.md](../../../docs/APP-SDK.md) (5.4).
Apache-2.0.
