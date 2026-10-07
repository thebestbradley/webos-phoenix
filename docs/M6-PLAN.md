# M6: the last 1.0 features

The plan for what is left to build before the 1.0 image work, agreed with the
project owner in an interview on 7 October 2026. Each phase lists what it
builds and how it is checked. The work runs in this order; each phase is one
or more pull requests, merged when CI is green.

| Phase | What | Status |
| --- | --- | --- |
| F0 | Fixes: settings lost on save; card corners; Messaging reply bar | Settings and corners done; reply bar waits on the owner |
| F1 | Press and hold on launcher icons | Done in the simulator (7 October 2026) |
| F2 | Clipboard manager | Done in the simulator (7 October 2026) |
| F3 | The Phoenix Assistant 1.0 | Done in the simulator (7 October 2026) |
| F4 | Community features picked for 1.0 | To do |

## F0: fixes first

- **Settings lost on save (done, 7 October 2026).**
  - **Symptom:** a PIN could be set, asked for at the next start, and still shown as "Off" in Settings.
  - **Cause:** every page wrote its own copy of the shared settings back when the shell sent a change.
  - **Scope:** any setting could be lost this way.
  - **Fix:** only one page stores the shell's changes ([PR 7](https://github.com/thebestbradley/webos-phoenix/pull/7)).
- **Card corners: the original's look, drawn crisply.**
  - **Problem:** the Canvas approximation draws a straight cut with a grey edge, inside the shadow's larger round corner.
  - **Fix:** the card mask becomes a GLSL shader that runs luna-sysmgr's own formula from `CardRoundedCornerShaderStage`: `smoothstep(1, 1-Delta, length(max((abs(tc-Center)-Start)/(Center-Start), 0)))`. It is drawn at the device pixel ratio.
  - **Shadow:** redrawn so its corner matches the card's.
  - **Check:** screenshots at 1x and 2x on Qt 6.8 and 6.11, and the corner compared pixel by pixel with the formula.
- **Messaging reply bar missing in a thread.**
  - Not reproduced yet. Waiting on the owner for: phone or tablet, how the thread was opened, and a screenshot.

## F1: press and hold on launcher icons

**1.0**
- **What opens it:** holding a launcher or dock icon for 500 ms, or a right click. The hold is timed only; pressure is not used.
- **The look ("peek and menu"):**
  - The icon lifts with a slight zoom, the rest dims, and a webOS-style popup menu opens beside it.
  - Haptic feedback where the device has it.
  - Moving the finger before the menu opens, or dragging out of it, starts the existing edit and drag mode instead.
- **Menu items:**
  - Move (enters edit mode with this icon picked up)
  - Share (the app's catalog link, through the share sheet)
  - Uninstall (not for system apps)
  - Add to dock, or Remove from dock
  - Favorite
  - New window (only for apps that allow several instances)
  - App info
- **Tests:**
  - `tst_launcher.qml`: the menu opens on a hold and on a right click.
  - Each item does what it says.
  - Dragging still reorders icons.

**Built (7 October 2026, in the simulator)**
- `IconMenu.qml` over the launcher and the dock: the held icon at 1.15×, the rest dimmed to half, the menu in the system's popup art (`popup-bg.png`, the app menu's rows, dividers and pressed highlight) beside the icon (right, else left, else below; over a dock icon). A tap outside, Back or Esc closes it; Up / Down and Enter work it from a keyboard, and the Menu key (or Shift+F10) opens it on the launcher's focus ring. `--scene launchermenu` shows it.
- The hold is 500 ms (`Theme.iconMenuHoldInterval`); a right click opens it at once. Moving the finger past the drag distance while still holding closes the menu and starts the edit mode drag as before (reorder, tabs, page edges, dock). In edit mode, and on an icon still installing, the hold picks the icon up at once, as before. Moving before the 500 ms still scrolls or swipes the page.
- Haptics: a `tapdown` vibration through com.palm.vibrate (`DeviceServices`), which runs the device's motor where it has one; the simulator only shows it.
- **Move**: edit mode with the icon picked up; the next touch carries it (a tap puts it there); Back or Esc puts it back.
- **Share**: only for an app with a web address (a launch point's `url`, or a web app whose `main` is an `http(s)` site). The shell opens the share sheet's page by itself as a see-through system window (`openSystemWindow(sharesheet, {systemShare}, "share")`), which asks `org.webosphoenix.share/open` and closes itself. The built-in apps have no link, so none of them shows Share.
- **Uninstall** (Remove for a launch point): apps the user installed only; the existing "Remove Application?" dialog.
- **Add to Dock / Remove from Dock**: at the dock's end; greyed when the dock is full.
- **Favorite / Unfavorite**: the launcher already has the TouchPad's Favorites page, so Favorite moves the app there and Unfavorite moves it back to the page it would have had (`LauncherLayout.favorite` / `unfavorite`); kept with the layout. Launch points live on Favorites and have neither.
- **New Window**: for apps whose entry has `multipleInstances` (new `appinfo.json` key `"multipleInstances": true`, read by `rootfs.cpp`), and the original browser, which cannot say so but opens a card on every launch (`BrowserApp.js:132-147`). The window source's `launchNewInstance` opens a fresh window in its own stack. Not on a device yet (`LsmWindowSource` has no `launchNewInstance`, so the row is not shown there).
- **App Info**: the app dialog with the title, version, id and size (when known), Uninstall (asking first) and Done.
- Tests: `tst_launcher.qml` (`test_holdOpensTheIconMenu`, `test_rightClickOpensTheIconMenu`, `test_dragOutOfTheMenuReorders`, one per row, `test_dockIconMenu`, `LauncherLayoutFavorites`).

**Moved to 2.0**
- Lock app, Hide app.
- Menus on cards, notifications and status-bar icons.
- Menus that apps register for their own content (a message, a link, an image).

## F2: clipboard manager

Works like Paste on macOS, in the webOS style.

**Keyboard strip**
- A clipboard key on the on-screen keyboard swaps the keys for a strip of mini cards: recent clips, newest first, scrolled sideways like card view.
- Tap a card to paste it.
- Hold a card to pin it, save it to a category, or delete it.
- A row of category tabs sits above the cards: Recent, Pinned and the user's categories.

**Clipboard app (`org.webosphoenix.clipboard`, in the launcher)**
- Browse, search and preview the history, pinned and saved clips.
- Edit clips, rename and reorder categories, move clips between them.

**What's recorded**
- Text, links (with title) and images.
- Each clip records its source app.

**Sensitive clips**
- **How they're detected:**
  - A copy from a password field.
  - A copy an app marks as sensitive (the Authenticator does).
  - Text that looks like a one-time code or a password.
- **How they're shown:** recorded, but masked on their card (••••), and revealed only after the device PIN or password.
- **How they're stored:** encrypted at rest.
- **Moving them:** a sensitive clip offers "Save to Passwords" (or "Add to Authenticator" for an `otpauth://` URI or TOTP secret), depending on what it is.

**Settings > Clipboard**
- History on or off.
- How many items to keep, and how long: 1 hour, 1 day, 1 week, forever.
- Clear the history when the device locks.
- Record sensitive clips (on, masked) or skip them.
- Clear all.
- Per-app exclusions.

**Service**
- `org.webosphoenix.clipboard` on the bus, in the runtime for the simulator, so the shell, the keyboard and the app share one history.

**Tests**
- Unit tests for expiry, pins, categories and sensitive detection.
- QML: the keyboard strip.
- `tools/test-clipboard.cjs` drives the app and the Settings pane.

**Built (7 October 2026, in the simulator)**
- **Service** (`runtime/phoenix-runtime.js` "Clipboard history"; `@phoenix/luna` `clipboard`): `history`, `subscribe`, `add`, `pin`, `unpin`, `setCategory`, `update`, `delete`, `clear`, `paste`, `reveal`, `addCategory`, `renameCategory`, `deleteCategory`, `reorderCategories`, `getSettings`, `setSettings`. Each clip is its own stored key, so pages copying at once never write over each other (the lesson of PR 7). Copies are recorded from every page's copy and cut events (the selection, or what the page put on the clipboard), from `navigator.clipboard` writes, and from the shell's own (Just Type, Copy Link), with the app they came from. A link keeps its title (the link's text, or the page's title).
- **Secrets**: a copy from a password field (Copy and Cut work there again: Chromium refuses them, the runtime copies the selection itself), a copy `@phoenix/secrets`' `SecretClipboard` marks (Passwords, Authenticator), and text that looks like a one-time code, an `otpauth://` link, a TOTP key or a password. Kept AES-GCM encrypted with a non-extractable key in IndexedDB, masked, revealed by `reveal {id, passCode}` (the device passcode). Settings can skip them instead.
- **Keyboard**: the clipboard key at the left of the candidate bar, in every field (in a field without Text Assist the bar holds only the key; nothing about Phoenix's key layouts changes). The strip (`ClipStrip.qml`): Recent, Pinned and category tabs; small cards in the card view's look (rounded, `card-shadow-tile.png`), a pinned one with a blue folded corner; a tap pastes through the IME commit (a secret only into a password field, through the system UI, which the service allows to read it); a hold opens Pin or Unpin, Save to… (the categories), Delete, Open Clipboard in the popup art; ABC, Back or the key bring the keys back. `--scene clipstrip` (with `--launch <app>`: over that app's first field).
- **Clipboard app** (`apps/clipboard`): tabs, search, a clip's page (Copy, Show, Save to Passwords or Add to Authenticator, Open in Browser, Edit, Pinned, Category, Delete); Categories (new, rename, move up and down, delete) and Clear History in the app menu; Preferences opens Settings > Clipboard. Passwords gained `{newEntry: {password, title?, username?, url?}}` launch params: a filled-in new entry once a database is unlocked, saved only by the user.
- **Settings > Clipboard**: history on or off, the keyboard key, keep 1 hour, 1 day, 1 week, 1 month or forever, up to 25 to 500 clips, clear when locked, passwords and codes kept hidden or not kept, recognizing secrets by their look, apps never kept, Clear History, Clear All Clips.
- **Tests**: `apps/shared/luna/src/clipboard.test.ts`, `shell/tests/tst_clipstrip.qml`, `tools/test-clipboard.cjs` (phone and tablet, in CI).
- **Not yet**: on a device the service has to be a real bus service (it lives in the web runtime), and the keyboard must be the device's (GAPS V5). Pictures paste only into rich text (`contenteditable`); a plain field takes none.

## F3: the Phoenix Assistant 1.0

**Layers.** Each request goes down these in order:
1. **Speech to text**, on the device, with whisper.cpp (the dictation service).
2. **Commands**: a fixed grammar per language matched against the text. No language model; instant; works offline.
   - Commands: call, text, timer, alarm, reminder, toggles (Wi-Fi, Bluetooth, airplane, flashlight), open app, navigate, play music, weather, arithmetic.
   - Apps add commands through `appinfo.json`.
3. **On-device language model** (llama.cpp): optional.
   - Downloaded in Settings > Assistant (a small model, chosen by the device's memory).
   - Once installed, it is the default for free-form requests and for actions. It chooses among the same commands.
4. **Cloud model or web search.** When neither of the above can answer, the assistant asks: "Ask <cloud model>" or "Search the web".

**Cloud models**
- Providers: Anthropic, OpenAI, Google Gemini, and any OpenAI-compatible URL (Ollama, LM Studio, OpenRouter and others), so any model can be used.
- Keys go in Settings > Assistant and are stored encrypted.
- **Chat:** allowed once a provider is set up.
- **Control:** a cloud model may run commands only after the user gives it permission. A separate switch in Settings > Assistant turns this on and off. It is off until the user turns it on.
- **Confirmation:** anything that sends or deletes is read back and confirmed, whichever layer chose it.

**Opening it**
- Hold the launcher button (the app-drawer icon in the quick launch bar).
- Or open the Assistant app from the launcher.

**System view**
- The current conversation floats over whatever is on screen, on a translucent, blurred backdrop, like the recent Siri.
- A tap outside or Back closes it.

**Assistant app (`org.webosphoenix.assistant`)**
- Chat threads: past conversations, new ones, and continuing any of them.
- The system view always shows the thread in use.

**Answers**
- Shown in the thread and spoken by on-device text-to-speech.
- Speech can be turned off in Settings > Assistant.

**Settings > Assistant**
- Assistant on or off (on by default).
- Speak answers.
- On-device model: download, remove, choose.
- Providers and keys.
- Allow cloud models to control the device.
- Which commands are allowed.
- Clear history.

**Tests**
- Grammar unit tests per command.
- The router, with a fake provider for each API shape.
- The permission gate: a cloud model can't act until it is allowed.
- QML: the overlay opens on a hold of the launcher button.
- `tools/test-assistant.cjs` drives the app and Settings.

**Moved to 2.0**
- The MCP hub: the agent drives any app, not only the fixed commands.
- Multi-step tasks, memory, a wake word, and a Phoenix AI service.

**Built (7 October 2026, in the simulator)**
- **Service** (`apps/assistant/service`, `org.webosphoenix.assistant`; run in the page by the runtime, a Node.js Luna service on a device; `@phoenix/luna` `assistant`, `tts`): `ask`, `choose`, `confirm`, threads (`threads`, `thread`, `newThread`, `setCurrent`, `deleteThread`, `clearHistory`), settings, `commands`, providers (`providers`, `setProvider`, `removeProvider`, `testProvider`, `listModels`), on-device models (`models`, `downloadModel`, `cancelDownload`, `removeModel`, `selectModel`), `speak`. One stored key per thread, message and provider.
- **Commands** (English grammar, `lib/lang/en.js`; another language is another file): call, text, timer, alarm (the Clock's own), reminder (Tasks), Wi-Fi, Bluetooth, airplane mode, flashlight, ringer, open app, directions (Maps), play music (Music's new `{play}`), weather (Open-Meteo), sums and percentages, time and date, web search. Apps add commands in `appinfo.json` (`assistant.commands`, Quick Action shape with phrases per language); a Quick Action works as "<displayName> <text>".
- **On-device model**: llama.cpp's `llama-server` (`--jinja`, the commands as tools), run by the shell in phoenix-sim (`LocalModels`) and by the service on a device; Qwen2.5 0.5B, Qwen2.5 1.5B and Qwen3 4B Instruct (Apache-2.0, Q4_K_M GGUFs from the Qwen repositories, SHA-256 checked), offered by device memory; stopped after five idle minutes.
- **Cloud models**: Anthropic Messages, OpenAI Responses, Gemini `generateContent`, any Chat Completions server; models typed or picked from the provider's list; calls through the host's proxy (no CORS); keys sealed; chat only until "Allow cloud models to control the device" (off by default).
- **Read-backs**: text, call, and app commands marked `send` or `delete` wait for Send / Call / Yes, from any layer. A model's choice the words do not ground (another switch, the other way, music for a question) is read back too ("Did you mean: ...?").
- **Checked for real**: llama.cpp built from source, Qwen2.5 0.5B downloaded from Hugging Face (SHA-256 as listed), run by phoenix-sim's `LocalModels` and asked through the runtime: free-form answers and tool calls work; speech went to the speech program. Real cloud keys were not available: the providers are checked against local mocks of each API.
- **System view** (`AssistantOverlay.qml`): hold the launcher button; the thread in use over a blurred backdrop, choices and read-backs as buttons, field and microphone; a tap outside, Back or Escape closes it. `--scene assistant`.
- **Assistant app** (`apps/assistant`): the conversation like a Messaging thread with who answered, Conversations (new, open, delete), Preferences; Just Type's "Ask Assistant"; timers ring here. Icon drawn in `art/app-icons` (with Settings > Assistant's).
- **Settings > Assistant**: on/off, speak answers, weather units, on-device models (download with progress, use, remove; size and memory; how to get llama-server), providers (add, edit, test, remove, the default), cloud control, commands, Clear History.
- **Speech**: `org.webosphoenix.tts`; espeak-ng (or `say` on a Mac, or `--speech-command`) run by the shell; Qt TextToSpeech is not in Phoenix's Qt, and QtWebEngine has no `speechSynthesis` voices.
- **Tests**: `apps/assistant/service/grammar.test.ts`, `assistant.test.ts` (each provider's API against a local mock, the permission gate, read-backs, the on-device model), `node-device.test.ts`; `apps/shared/luna/src/assistant.test.ts`; `shell/tests/tst_assistant.qml`; `build/localmodels-test`; `tools/test-assistant.cjs` (phone and tablet, in CI).
- **Decided on the owner's behalf**: the grammar answers before the on-device model even once one is installed (exact and instant; the model takes the rest); calls are read back like texts; a thread taken to a cloud model goes on with it; one tool call per request; answers are spoken for typed requests too when Speak answers is on; timers are the assistant's own (the Clock has none), alarms the Clock's.
- **Not yet**: streaming answers; languages other than English; the meta-phoenix recipes for llama.cpp and espeak-ng; the device service untested on hardware; a dashboard for running timers.

Where the line between 1.0 and 2.0 falls may move as F3 is built. Any change is recorded here.

## F4: community features for 1.0

Picked by the owner from [COMMUNITY-FEATURES.md](COMMUNITY-FEATURES.md).

**Rule:** Phoenix's own customizations always come first. Where a community
feature clashes with something Phoenix already does, the owner is asked
before it's built.

**Already covered by Phoenix's own work (not rebuilt)**
- Hide app.
- Cursor control, in place of arrow keys.
- The keyboard's sizes.

**Built, in this order, each checked in the simulator**
1. **Launcher**
   - App groups (folders): drag an icon onto another to group, rename, hold to pop an app out.
   - Tabs: rename, add and remove, up to six.
   - Grid density.
   - **Built (7 October 2026, in the simulator).** An icon carried onto another's centre and held there 400 ms joins it in a group named "Group" where the other was; nearer the edge it still reorders (the others now make room once the icon rests 150 ms, so it can pass over them). A group is a 2 × 2 mini-grid of its apps on a dark tile (`AppIcon.groupIcons`); a tap opens it over the dimmed page (`LauncherGroup.qml`): tap an app to launch it, tap the name to rename it. Holding an app in it opens the F1 icon menu with **Remove from Folder** (Move takes it out and carries it); moving on from the hold carries it out onto the page. Down to one app the group dissolves. Tabs: hold a tab to rename it ("Rename Tab"), "+" adds one ("New Tab"; held on the strip's empty part as in LunaCE, and in edit mode, since a phone's strip has no empty part), a trash can in the dialog removes a tab the user added (its icons go to Apps); the first four are protected, six at most (`LauncherNameDialog.qml`). Groups, tab names and added tabs are kept with the layout (`LauncherLayout.js` `groups`, `titles`, `user:n` designators; a layout saved before reads as before). Settings > Advanced > Icon grid: Dense (tablets 108 px pitch, phones 4 across). Tests: `tst_launcher.qml` (`LauncherLayoutGroupsAndTabs`, `test_dragOntoACentreMakesAGroup`, `test_groupOverlay`, `test_groupMemberMenuAndDragOut`, `test_tabsAddRenameRemove`, `test_gridDensity`); `--scene launchergroup`, `launchergroupopen`, `launchertabs`. Clash: LunaCE renames Favorites "Games" by default; Phoenix keeps Favorites (the F1 menu's Favorite puts apps there).
2. **Cards**
   - Infinite card cycling.
   - Tap an edge card to maximize it.
   - Wave launcher.
   - **Built (7 October 2026, in the simulator).** All three are LunaCE's Tweaks options under their own preference keys, off by default as there (Settings > Advanced). Infinite card cycling (`infiniteCardCyclingEnabled`): a flick, the keyboard's arrows, a trackpad swipe or an advanced gesture past the last stack goes to the first, and back (`CardView.wrapGroup`). Tap-to-maximize edge cards (`sysUiEnableMaximizeEdges`): a tap on a stack beside the centre one maximizes its card at once. Wave launcher (`sysUiEnableWaveLauncher`): a finger slid up from the left or right quarter of the gesture area raises a glass wave along the bottom with the dock's apps and the launcher button; it swells under the finger, lifting and enlarging that icon with its name above; letting go there opens it, letting go far above it is the ordinary swipe up (card view), anywhere else puts it away (`WaveLauncher.qml`; not over the lock screen, First Use, dock mode or the launcher). The Pre's own wave was not in the open-source release, so it is drawn from the community's descriptions. Tests: `tst_tweaks.qml`; `--scene wave`.
3. **System**
   - Power menu: hold power for Airplane mode, Restart (the shell), Reboot, Shut down.
   - Richer system menu: battery percentage and quick toggles.
   - **Built (7 October 2026, in the simulator).** Power held 3 s with the screen on (unlocked, or in dock mode) sends com.palm.display's `powerKeyPressed {showDialog: true}` and eats the release, as DisplayManager did (`DisplayManager.cpp:232, 2489-2499, 3085-3099`); luna-systemui opens its own PowerOffAlert, which a compat overlay of `PowerdAlerts.js` gives webOS CE 3.1.0's layout: Airplane Mode (with its info button), Luna Restart and Device Restart (Enyo's yellow alternate buttons, as the original's PowerResetAlert Restart), Shut Down and Cancel. Airplane Mode sets the `airplaneMode` preference, which now turns the radios off as LunaSysMgr's preference watcher did; Luna Restart is `org.webosphoenix.system/restartUi` (the simulator starts again without the shutdown sound); Device Restart is `machineReboot`; Shut Down is `com.palm.power/shutdown/machineOff` (the simulator goes dark with the shutdown sound until F3 or a click). A chord (Power with a volume key, Home) is not the menu. In the simulator: hold F3, or Device > Hold Power Button (Shift+F3); `--scene powermenu`. The system menu already had Wi-Fi, Bluetooth, Airplane Mode, Rotation Lock and Mute rows; it gains a **Flashlight** row (LuneOS's torchd, where the device has a torch) in the same look, and Settings > Advanced > Battery percentage puts the charge beside the status bar's battery (red at 12% and under, amber to 20%, green while charging). Tests: `tst_powermenu.qml`, `apps/shared/luna/src/tweaks.test.ts`. On a device: `restartUi` still needs the systemd unit restart, and the display signal comes from the compositor's power key handling.
4. **Notifications**
   - Repeat until seen.
   - Private previews on the lock screen.
   - Cycling email dashboard with delete.
   - Per-contact tones.
   - **Built (7 October 2026, in the simulator).** *Repeat until seen* (Settings > Sounds & Ringtones > Repeat alerts; preference `notificationRepeat`, off by default): an app's notification sound again every 1, 2 (default), 5, 10 or 15 minutes while it has a notification nobody has looked at (the dashboard opened, the app's card in front, or its notifications gone); per app for Messaging, Phone, Email and Calendar, others repeat too; not ringtones or alarms (the shell, `Shell.qml` "Repeat until seen"). *Private previews* (Settings > Screen & Lock > Show previews; `lockScreenPreviews`, on by default): off, the locked screen's banner and dashboard show the app's name and icon with "New Message" ("New Email", "New Notification"), and no dashboard window (`LockScreen.qml`). *Cycling email dashboard* (Settings > Advanced; `emailDashboardCycling`, off): the Email app's new-mail dashboard, through a compat overlay (`source/phoenix-dashboard.js`, `phoenix-dashboard/`), goes through the new emails one at a time every 4 s, newest first, "2/5" in the count's badge, each with its time, and a trash can that deletes the one shown (`Email.deleteEmails`); error dashboards are unchanged. *Per-contact tones*: Contacts' Edit gains a Tones group (compat `app/phoenix-tones.js`): Ringtone, the person's own (`com.palm.person` ringtone, which Phone already rang with), and Message tone, kept in `org.webosphoenix.contacttone:1` because the contacts framework saves the person whole from the fields it knows; a text from that person plays it. Other pages' preference changes now reach a page's getPreferences subscribers (the runtime's storage event), as on the bus. Tests: `tst_notifyoptions.qml`, `tools/test-community.cjs` (phone and tablet, in CI).
5. **Advanced settings (Tweaks)**
   - Animation speed.
   - Tap ripple.
   - Gesture sensitivity.
   - Haptics.
6. **Keyboard: a number row**
   - Off by default.
   - A switch in Settings turns it on.
7. **Browser**
   - Private browsing.
   - Find in page.
   - Content blocker.
   - User-agent switch.
   - Search engine choice.
   - Proxy.
8. **Sharing and sync**
   - **DropShare**: Phoenix's version of LuneDrop, built as an extension of Touch to Share ([APP-RUNTIME.md](APP-RUNTIME.md#touch-to-share)). Another phone or PC sends files to the device over Wi-Fi by scanning a QR code, and the device can share the same way.
   - Subscribe to `.ics` calendars.
   - Game controllers.
   - A USB OTG page with safe unmount.
   - Tethering on phones.
9. **Health**
   - Temperature warnings.
   - A battery usage pane in Settings.

Items that need a device (tethering, controllers, USB OTG, temperature) are
built against the simulated services first. They are finished on hardware in
the image work.

**Left for later** (not in 1.0 unless the owner adds them)
- Developer tools: log viewer, bus monitor, database browser.
- Simple profiles.
- Device-code sign-in.
- Mini cards.
- Status-bar text options.
- Quick USB dashboard.
- On-device Help.
- Classic wallpapers and the Treo ringtone.

## How it is built

Each change is:
- checked in the simulator, with screenshots;
- covered by QML and Chromium tests;
- recorded in `docs/spec/feature-inventory.md` and `docs/spec/GAPS.md` when done.

Original behaviour is cited from the source where Phoenix reproduces it.
