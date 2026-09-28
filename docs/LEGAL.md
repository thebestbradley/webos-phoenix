# Licensing and assets

Not legal advice. This page records what we reuse and why we believe it is
allowed, so contributors can keep it that way.

## Our code

Everything in this repository is Apache-2.0 (see `LICENSE`), the same license
as webOS OSE and Open webOS.

## Open webOS artwork (`shell/assets/openwebos/`)

Copied from `openwebos/luna-sysmgr/images`
(<https://github.com/openwebos/luna-sysmgr>), which HP and later LG released as
part of Open webOS under Apache-2.0 (see the license headers throughout that
repository). Attribution is in `NOTICE`.

Excluded on purpose:

- `hp-logo*.png`. Trademarks are not licensed by Apache-2.0 (section 6).
- `normal-usb.png` and `fsck-usb.png`, which picture the TouchPad hardware.
- Palm and HP app icons, wallpapers and ringtones. They were not in the
  open-source release, so we do not ship them.
- The Open webOS `sounds/` directory, until its provenance has been checked.

## Original apps and frameworks (`third_party/`)

Git submodules of the Open webOS repositories (`openwebos/core-apps`,
`app-services`, `foundation-frameworks`, `loadable-frameworks`, `mojoloader`,
`underscore`, `luna-applauncher`, `luna-systemui`) and `enyojs/enyo-1.0`, all
Apache-2.0 and unmodified. Their app icons (Email, Calendar, Memos, ...) are
part of that release and are shown in the launcher. Fixes go in
`compat/rootfs/`, not in the submodules.

## Fonts

Legacy webOS used **Prelude**, which was made for Palm and is not openly
licensed. Phoenix asks for "Prelude" first, so a user who owns it can install
it, and otherwise falls back to open fonts. Choosing or commissioning an
open-licensed look-alike is an open task.

## Name and trademarks

"webOS" is a trademark of LG Electronics. "Palm", "Pre", "TouchPad" and
related marks belong to their owners. We use them only to describe
compatibility and history. If the project is published or distributed widely,
consider a name that doesn't include "webOS" (for example "Phoenix, a shell
for webOS OSE").

## Code from other projects

- webOS OSE / Open webOS (Apache-2.0): fine to reuse with attribution.
- LuneOS repositories use several licenses, including GPL-3.0 for some
  components. Don't copy their code into the Apache-2.0 parts of this
  repository. Reading them for reference is fine.
