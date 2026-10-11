# Delta Chat account: pictures

| File | From | License |
| --- | --- | --- |
| `art/deltachat-1024.png`, `icon.png` | Drawn for Phoenix with Pillow by `tools/make-connector-art.py` (an envelope as a speech bubble on a blue tile; not Delta Chat's logo) | Apache-2.0 |
| `public/accounts/com.webosphoenix.deltachat/images/deltachat-*.png` (with `@2x` / `@3x`) | `art/deltachat-1024.png` scaled down (`tools/make-connector-art.py`, then `tools/hidpi-art.py`, `downscale`) | Apache-2.0 |

Delta Chat's core is not in this package: the image installs it as its own
program (deltachat-rpc-server, MPL-2.0, unmodified;
`meta-phoenix/recipes-connectors/deltachat-rpc-server`).
