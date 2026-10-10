# @phoenix/capacitor

The Phoenix service plugin as a Capacitor plugin, for Ionic and Capacitor
apps on webOS Phoenix. Phoenix runs web apps, so the plugin's
implementation is its web one, over `@phoenix/sdk`.

```ts
import { Phoenix } from "@phoenix/capacitor";

await Phoenix.share({ title: note.title, text: note.body });
Phoenix.addListener("share", (s) => createNote(s.text ?? ""));
const { value } = await Phoenix.has({ capability: "pickers" });
```

Methods and events: [docs/APP-SDK.md](../../../docs/APP-SDK.md) (5.2).
Apache-2.0 (`@capacitor/core` is MIT).
