# A local agent on your own machines

A brief for a coding agent (Claude Code on the Mac, or on a Linux box) that
builds and runs webOS Phoenix on your own machines, with the double shell
first: 1.0 and 2.0 side by side. Paste the block below as its first message.
The cloud sessions keep working in the same repos; the brief tells the local
agent how to stay out of their way.

````text
You're setting up and running webOS Phoenix on my machines: an M1 Pro MacBook Pro (macOS, my daily machine) and Ubuntu 24.04 Linux when I ask. Work only with the four repos below and their tools; no other projects or organisations' data.

## The repos (github.com/thebestbradley; the last three are private)
- webos-phoenix: 1.0. The shell (QML), the simulator phoenix-sim, the runtime, the original Open webOS apps (git submodules in third_party/), device images (meta-phoenix/).
- phoenix-ember-glass-ui: 2.0. webos-phoenix plus the Ember Glass shell; it takes 1.0's changes by merging webos-phoenix's main.
- phoenix-default-apps: the rebuilt built-in apps (React + TypeScript on Enact), built against the webos-phoenix commit in phoenix.pin.json.
- ember-glass-ui: the 2.0 UI layer the rebuilt apps are moving to.

Clone all four side by side in ~/Developer/phoenix (the tools look for ../webos-phoenix and ../phoenix-default-apps); the two shells with --recurse-submodules. Use my GitHub sign-in (gh auth status, or my SSH key).

## Read first
Each repo's CLAUDE.md (its rules: follow them). webos-phoenix's docs/GETTING-STARTED.md, docs/BUILDING-MAC.md and docs/COMMANDS.md (every build, run and test command, checked against the scripts; `python3 tools/commands-doc.py --html build/commands.html` makes a searchable page of them). phoenix-ember-glass-ui's docs/SYSTEM-UI-2.md. phoenix-default-apps' README.md and docs/APP-GUIDE.md.

## The goal: a double shell
Run 1.0 and 2.0 side by side on the Mac, two simulator windows at once, to compare them screen for screen:
- left: webos-phoenix main as it is, with the original apps;
- right: phoenix-ember-glass-ui in the Ember Glass look (`-- --look ember-glass` after phoenix-sim's own options), with the rebuilt apps (`--extra-rootfs ../phoenix-default-apps/build/rootfs`).

Steps:
1. Set up. In webos-phoenix: `./phoenix check`, then `./phoenix --tests` (installs Homebrew's Qt, Node 22, PHP, the assistant's models and the test tools once, then builds). In phoenix-ember-glass-ui: `./phoenix` (its own build/). In phoenix-default-apps: `npm install && npm run build && npm run stage` (stage puts the apps in build/rootfs). In ember-glass-ui: `npm install && npm run build`.
2. Run each shell alone first (`./phoenix run tablet --screenshot one.png --delay 8000` in each), open the screenshots and look at them.
3. Keep the two devices apart: start each with its own `--instance NAME` (v1 and v2). phoenix-sim keeps its simulated device (db8, settings, installed apps, web storage) in one folder per name, so two windows without it would share one device. Never run two at once without it. Each one's Window menu lists both and brings the other to the front (Next Simulator: Ctrl+Shift+\).
4. Write scripts/dual-sim.sh in phoenix-ember-glass-ui, POSIX sh like ./phoenix. It builds both if needed; starts 1.0 from ../webos-phoenix with `--instance v1` and 2.0 with `--instance v2`; takes phone, tablet or adaptive like `./phoenix run` and passes the same scene and launch arguments to both; with `--screenshot FILE` takes both and joins them into one side-by-side PNG (Pillow is in webos-phoenix's .venv); stops both on Ctrl+C, killing only the PIDs it started. Test it, add it to tools/commands-doc.py and regenerate docs/COMMANDS.md.
5. Work on a branch (e.g. mac/dual-sim) and open a draft PR; never push to main. A cloud agent works in these repos too: pull before you start and before you push, and keep to your files.

## Rules (also in CLAUDE.md)
- Root causes only; never call a failure a flake.
- Check changes in the real simulator and look at every screenshot.
- Never modify third_party/.
- Commits: clear messages; never name an AI model.
- Mac-only problems (Homebrew's Qt, Retina scaling, Apple silicon): report them with the exact error and their cause.

## Report back
What you installed and how long each build took; the screenshots (each shell alone, then side by side); what failed on the Mac and why; the PR link.

## Next, when I ask
- The 1.0 image: `scripts/mac-build.sh phoenix-vm-arm64`, then `scripts/vm.sh fairphone-fp6`, and `scripts/make-utm.sh --for ipad-se` for the iPad.
- Check the HiDPI fix on the Mac's Retina screen.
````
