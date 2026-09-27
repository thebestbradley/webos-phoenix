# meta-phoenix

OpenEmbedded layer that adds the Phoenix shell to a webOS OSE build.

| Recipe | What it does |
| --- | --- |
| `phoenix-shell` | Installs the QML shell and Open webOS artwork to `/usr/share/phoenix`, plus `/etc/surface-manager.d/product.env` pointing luna-surfacemanager at it. |
| `webos-phoenix-image` | `webos-image` + `phoenix-shell`. |

Depends on `meta-webos` and `meta-qt6` (scarthgap, Qt 6.8), as pinned by
webOS OSE's `build-webos/weboslayers.py`. Use `scripts/setup-build.sh` from
the repository root to set up a build directory with this layer added.
