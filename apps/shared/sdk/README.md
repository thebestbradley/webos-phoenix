# @phoenix/sdk

The Phoenix service plugin: typed, promise-based access to webOS Phoenix's
services for any web framework. App lifecycle, the app menu, the share
sheet, file pickers, notifications, ongoing activities, Just Type, the
Assistant, contacts, calendar, accounts, files, media, location and more,
over the Luna service bus, with capability checks so an app also runs on
webOS OSE and in a plain browser.

```ts
import { app, has, share } from "@phoenix/sdk";

app.onBack(() => closePane());
if (has("share")) await share.open({ title: "Hello", text: "From my app" });
```

- `@phoenix/sdk/testing`: a fake Luna bus for unit tests.
- `phoenix-sdk.js`: the same API as one script (the global `Phoenix`) for
  pages without a bundler.
- Bindings: `@phoenix/react`, `@phoenix/capacitor`, `@phoenix/enact`, and
  `phoenix_services` for Dart and Flutter.

The guide, with every API and an example of each: [docs/APP-SDK.md](../../../docs/APP-SDK.md).
Apache-2.0.
