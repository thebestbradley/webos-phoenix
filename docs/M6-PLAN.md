# M6: the last 1.0 features

The plan for what is left to build before the 1.0 image work, agreed with the
project owner in an interview on 7 October 2026. Each phase lists what it
builds and how it is checked. The work runs in this order; each phase is one
or more pull requests, merged when CI is green.

| Phase | What | Status |
| --- | --- | --- |
| F0 | Fixes: settings lost on save; card corners; Messaging reply bar | Settings and corners done; reply bar waits on the owner |
| F1 | Press and hold on launcher icons | To do |
| F2 | Clipboard manager | To do |
| F3 | The Phoenix Assistant 1.0 | To do |
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
2. **Cards**
   - Infinite card cycling.
   - Tap an edge card to maximize it.
   - Wave launcher.
3. **System**
   - Power menu: hold power for Airplane mode, Restart (the shell), Reboot, Shut down.
   - Richer system menu: battery percentage and quick toggles.
4. **Notifications**
   - Repeat until seen.
   - Private previews on the lock screen.
   - Cycling email dashboard with delete.
   - Per-contact tones.
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
