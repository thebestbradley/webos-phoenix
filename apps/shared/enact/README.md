# @phoenix/enact

The Phoenix service plugin for Enact apps, the recommended base for
Phoenix apps: `@phoenix/sdk` over Enact's own `LS2Request`, the hooks of
`@phoenix/react`, and the Phoenix design layer for Enact (`PhoenixDecorator`,
the tokens and fonts, Agate's colours in the Phoenix palette, a classic
header).

```tsx
import {PhoenixDecorator, useAppMenu, useBack} from '@phoenix/enact';

export default PhoenixDecorator(ThemeDecorator(App));
```

Guide: [docs/APP-SDK.md](../../../docs/APP-SDK.md) (2, 5.3, 8). Apache-2.0.
