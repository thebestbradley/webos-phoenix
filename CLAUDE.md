# webOS Phoenix: notes for Claude Code

webOS Phoenix brings the webOS 1.x-3.x experience (cards, gestures, Just Type,
notifications, Synergy) to modern devices, on top of webOS OSE. This file is
what an agent needs to build, run and test it, and the project's rules.
Humans: see [docs/GETTING-STARTED.md](docs/GETTING-STARTED.md).

## Map

- `shell/qml/Phoenix/Shell`: the system UI (QML). `Shell.qml` puts it together.
- `shell/qml/Phoenix/Sim`: the simulator's device and services (`SimWindowSource.qml`,
  `SimSystemStatus.qml`); `shell/qml/sim.qml` holds its keys and scenes.
- `shell/qml/Phoenix/Lsm`: the same shell on a device (luna-surfacemanager).
- `shell/native`: C++ QML types (`Phoenix.Native`). `shell/sim`: `phoenix-sim`.
- `runtime/phoenix-runtime.js`: `PalmSystem` and the simulated Luna services
  (db8, applicationManager, telephony, ...) every web app talks to.
- `apps/`: Phoenix's React + TypeScript apps (npm workspaces), with
  `shared/phoenix-ui` (components) and `shared/luna` (service client).
- `third_party/`: the original Open webOS apps and frameworks as git
  submodules. **Never modify them**; change an original's file through the
  compat overlay in `compat/rootfs/` (see `compat/README.md`).
- `meta-phoenix/`: the OpenEmbedded layer for device images.
- `docs/`: `STATUS.md`, `ROADMAP.md`, `ARCHITECTURE.md`, `APP-RUNTIME.md`,
  `HARDWARE.md`; `docs/spec/feature-inventory.md` and `docs/spec/GAPS.md` are
  the checklists of what the original did and what Phoenix still lacks.

## Build

```sh
git submodule update --init
cmake -S shell -B build
cmake --build build
```

Add Qt's location to the first `cmake`: on a Mac
`-DCMAKE_PREFIX_PATH="$(brew --prefix qt)"`, on Ubuntu
`-DCMAKE_PREFIX_PATH=/opt/Qt/6.8.1/gcc_64` (installed by `scripts/linux-setup.sh`;
Ubuntu's own Qt is too old). The build also builds `apps/` with npm.

Only the apps: `cd apps && npm run build` (or `npm run build -w settings`).
Setup from scratch: `scripts/mac-setup.sh` or `scripts/linux-setup.sh`.

## Run and look

Check changes in the real simulator, not only in tests, and look at the result:

```sh
./build/phoenix-sim --tablet --launch org.webosphoenix.settings --screenshot out.png --delay 8000
```

`--scene cards|launcher|dashboard|systemmenu|...` opens a state, `--launch
<appId>` an app, `--screenshot` saves a PNG and exits. Without a display (Linux
containers): prefix `QTWEBENGINE_DISABLE_SANDBOX=1 xvfb-run -a -s "-screen 0
1920x1200x24"`; use a fresh `HOME` per run for a clean device. To drive it
(taps, keys), `xdotool` on Linux.

## Test

Run what covers the change before committing; CI runs all of it.

- QML: `QT_QPA_PLATFORM=offscreen qmltestrunner -import shell/qml -import build/qml -input shell/tests`
  (`/opt/Qt/6.8.1/gcc_64/bin/qmltestrunner` on Ubuntu, from `scripts/linux-setup.sh`;
  `$(brew --prefix qt)/bin/` on a Mac). Qt 6.8 is the minimum: the device's version.
- Apps: `cd apps && npm run typecheck && npx vitest run` (`--maxWorkers=2` on a busy machine).
- Web apps in Chromium: `NODE_PATH="$(npm root -g)" node tools/test-<area>.cjs` (the
  README lists them; `test-apps.cjs` covers every app).
- Art: `python3 tools/hidpi-art.py --check` whenever art or stylesheets change; every
  picture needs exact @2x/@3x variants listed in `tools/hidpi-art.json`.

## Rules

- Find the root cause. A failure is never "a flake" until proven; reproduce it,
  explain it, fix it. No workarounds that hide a problem.
- Follow the original. The behaviour to match is luna-sysmgr's, luna-systemui's
  and the original apps'; cite the source (file and line) in comments where
  Phoenix reproduces something specific.
- Licensing: only Apache-2.0 / permissive sources; Palm/HP art that wasn't in the
  open-source release isn't shipped (`docs/LEGAL.md`). Record where new art comes
  from (`PROVENANCE.md`).
- Keep 1x behaviour and layout unchanged when adding HiDPI art.
- Update `docs/spec/feature-inventory.md` / `docs/spec/GAPS.md` when a feature is done.
- Commits: clear messages; never name an AI model in commits, PRs or docs.
- Disk can be tight in cloud containers: don't copy `apps/node_modules` into worktrees
  (symlink it, and remove the symlink, not its target, afterwards).
