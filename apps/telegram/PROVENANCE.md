# Unofficial Telegram account: pictures

| File | From | License |
| --- | --- | --- |
| `art/cloudchat-1024.png`, `icon.png` | Drawn for Phoenix with Pillow by `tools/make-connector-art.py` (a speaking cloud on an orange tile; deliberately not Telegram's paper plane, nor its blue: Telegram's API terms ask third-party clients not to look like the official app) | Apache-2.0 |
| `public/accounts/com.webosphoenix.telegram/images/cloudchat-*.png` (with `@2x` / `@3x`) | `art/cloudchat-1024.png` scaled down (`tools/make-connector-art.py`, then `tools/hidpi-art.py`, `downscale`) | Apache-2.0 |

TDLib is not in this package: the image installs it with its bridge
(libtdjson, BSL-1.0, and phoenix-tdjson; `meta-phoenix/recipes-connectors/tdlib`).
