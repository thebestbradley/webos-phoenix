# Master prompt: the Phoenix developer extension for VS Code and Cursor

A task for later, when there are people and time for it (the owner, 11
October 2026). It will be **its own repository**, not part of this one. The
owner gives the text below (everything after the line) to the agent that
builds it. It is self-contained: that agent has not seen this repository's
history. Update it when the SDK, the simulator's downloads or the catalog's
developer API change.

---

## Who you are working for, and the goal

You are building **the Phoenix developer extension**: one extension for
**Visual Studio Code and Cursor** (Cursor runs VS Code extensions; publish
to the Visual Studio Marketplace and to Open VSX, which Cursor, VSCodium
and others install from). It is for people who write apps and Synergy
connectors for **webOS Phoenix**, an open-source project that brings the
webOS 1.x-3.x experience (cards, gestures, Just Type, notifications,
Synergy) to modern phones and tablets on top of webOS OSE.

The goal is adoption. Make it as easy as possible to go from "never heard
of webOS" to a running app in the simulator, and from there to the
Phoenix catalog. Every step a developer would have to read about should be
a command, a template or a button.

Work in a new repository (the owner creates it). Read these files of the
`webos-phoenix` repository first; they are the contract the extension
drives, and the extension must not invent its own:

- `docs/APP-SDK.md`: the app SDK (the Phoenix service plugin, its bindings
  for React, Enact, Capacitor and Dart), getting started for each
  framework (section 2), packaging (6), testing (7), publishing (9).
- `docs/SYNERGY-SDK.md` and `docs/SYNERGY-CONNECTORS.md`: Synergy
  connectors and the `phoenix-connector` command line (`new`, `test`,
  `pack`, `publish`), the connector kit's conformance suite.
- `docs/GETTING-STARTED.md`: the simulator (`phoenix-sim`) and its options
  (`--phone`, `--tablet`, `--device <id>`, `--launch <appId>`, `--scene`,
  `--screenshot`, `--marketplace`).
- `docs/PLATFORM.md`: the servers. Downloads (simulator builds:
  `downloads.<domain>`), the developer portal and its submission API, the
  update feeds' format (section 2.3) and the catalog's.
- `docs/APP-STORE.md`: the Marketplace, review, what a package may
  contain, Developer Mode.
- The sample apps: `apps/enact-notes-agate`, `apps/enact-notes-limestone`,
  `apps/ionic-notes`, `apps/flutter-notes`, and a connector made with
  `phoenix-connector new`.

## What it does

1. **The simulator, installed and kept current.** Download the latest
   `phoenix-sim` for the developer's system (macOS Apple silicon and
   Intel, Linux x86-64 and ARM64; Windows when one exists) from Phoenix's
   downloads server, check its signature or checksum, keep it in the
   extension's storage, and check for a new version at start and once a
   day (the simulator's update feed: `compatible=phoenix-sim`,
   PLATFORM.md 2.3). Say what changed; update with one click; keep the
   previous version to go back to. Let a developer point it at a
   simulator they built themselves instead.
2. **New project.** A wizard (and a command) that asks for the kind
   (app, Synergy connector, or an app with a connector), the framework,
   the form factors (phone, tablet, both), the app id (reverse domain,
   checked as the catalog checks it) and the title, then writes the
   project with the right layout, `appinfo.json`, icons at every size the
   launcher and HiDPI screens need, the Phoenix service plugin and its
   binding, build scripts, tests, a README and a licence of the
   developer's choice. Frameworks: only the ones Phoenix supports
   (APP-SDK.md section 2): **Enact** (Agate and Limestone; recommended),
   **React + TypeScript**, **Ionic / Capacitor**, **plain web and PWAs**,
   **Flutter**, and **Enyo 2** for people porting old webOS apps. Read the
   list and templates from a file the extension downloads, so a new
   framework needs no new version of the extension.
3. **Run.** One button: build, package, install and launch in the
   simulator on a chosen device profile (`--device`: Fairphone 6, Odin 2
   Portal, PinePhone Pro, PineTab2, Pi 4; phone, tablet), with the app's
   console and the Luna calls it makes in VS Code's output, and live
   reload where the framework has it. Screenshots of every profile in one
   command (for the catalog listing). Later: the same on a device in
   Developer Mode over the network, and in the device VMs
   (`scripts/vm.sh`).
4. **Connectors.** `phoenix-connector new / test / pack` as commands and
   a test view: the kit's conformance suite with each check's result, a
   button to sign an account in, in the simulator, against the
   connector's test server.
5. **Check before submitting.** The checks the catalog runs (appinfo.json,
   icons, permissions, what a package may contain, licences of bundled
   code), run locally with each problem shown in the editor as a
   diagnostic with a fix where there is one.
6. **Publish.** Sign in to the developer portal, create the catalog
   listing (title, description, screenshots, categories), upload a
   build, and follow its review, from the editor. Use the portal's API
   (PLATFORM.md); until the portal exists, publish to a local catalog
   (`server/marketplace/bin/serve.sh`) as the simulator does.
7. **Help.** Hover documentation and completion for the Phoenix service
   plugin and `appinfo.json` (a JSON schema), snippets for the common
   things (a card's app menu, a banner, Just Type actions, sharing,
   Synergy), and links into the docs. A "Getting started" walkthrough
   (VS Code's walkthroughs) that ends with the developer's first app
   running.

## Rules

- Licence: Apache-2.0 for the extension; only permissive dependencies.
- No Palm, HP or LG logos or art; Phoenix's own (`docs/BRANDING.md`).
- Nothing about the developer goes anywhere except the Phoenix servers
  they sign in to; no analytics without an opt-in.
- Tests for each command (VS Code's extension test runner), CI on macOS,
  Linux and Windows, and a check in a real VS Code and a real Cursor.
- Never name an AI model in commits, pull requests or docs.

## Done when

A developer with VS Code or Cursor and nothing else installs the
extension, runs "Phoenix: New Project", picks Enact, presses Run, and sees
the app in the simulator on a phone and a tablet profile; then changes a
line and sees it reload; then runs the checks and uploads to a local
catalog. The same for a Synergy connector, with its conformance suite
passing.
