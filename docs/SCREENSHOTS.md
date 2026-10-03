# Screenshots and screen recording

How the original took screenshots, how Phoenix 1.x keeps that, and what
2.0 adds to match today's phones, including the AI features people now
expect.

> **Decisions (2 October 2026, from the project owner).** 1.x behaves
> like iOS without its premium features: after a capture its thumbnail sits
> in the corner for a few seconds, and tapping it (or the notification)
> opens a preview of the capture with the easy features: share, save,
> delete and simple edits.
>
> **Status.** SC1 and SC2 are done in the simulator (below). On a device,
> the capture is the compositor's frame (M1).

## 1. What the original did

From the webOS 3.0.5 source (`luna-sysmgr`):

- **Keys.** On the TouchPad, Home and Power pressed together (both within
  3 s). Phones used Orange + Sym + P; that chord is commented out in the
  3.0.5 tree, which was the TouchPad's.
- **Where.** A PNG in `/media/internal/screencaptures/`, named
  `<app>_YYYY-DD-MM_HHMMSS.png` after the app in front. The date puts the
  day before the month, a bug Phoenix does not copy.
- **Keys, exactly.** Releasing one of Home and Power while the other is
  held, within 3 s of its press, takes the capture, and the other key's
  release is eaten, so neither goes home nor turns the screen off
  (`WindowServer.cpp:629-683`).
- **Feedback.** The "shutter" feedback sound (`Settings.cpp:107`) and
  `WSOverlayScreenShotAnimation`: a flash. The screen dims to black at
  0x88 under a radial glow from its centre, white to pale yellow, gone at
  half the shorter side, all fading out over 900 ms.
- **After.** Nothing on screen. Photos showed the screencaptures album,
  and from there the picture could be shared.

## 2. 1.x: as the original, fixed

| What | Phoenix 1.x |
| --- | --- |
| Keys | Home + Power, as the original (Power + Volume Down on devices without Home); Print Screen or Ctrl+Alt+P on a hardware keyboard (the phones' Orange+Sym+P; on a Mac, Command+Option+P or Control+Option+P); F9 in the simulator (fn+F9 on a Mac keyboard set to media keys). The shell takes these keys whatever has the focus, as the original's WindowServer did: an app never sees them |
| Feedback | The "shutter" feedback sound (synthesized, `tools/make-feedback-sounds.py`) and the original's flash, 900 ms |
| File | `/media/internal/screencaptures/<App name> YYYY-MM-DD at HH.MM.SS.png` (ISO date); "Card View", "Launcher" or "Lock Screen" when no app is in front |
| Photos | The "Screen captures" album, as the original |
| Thumbnail | As iOS: the capture, framed, in the bottom left corner for 5 s (above the phone's notification area); a tap opens it in the preview, a swipe to the left puts it away (Phoenix addition, the owner's decision) |
| Notification | "Screen captured" and the capture's name; a tap opens the preview (Phoenix addition, the owner's decision) |
| Preview | The Screenshot app (`apps/screenshot`, hidden from the launcher): the capture, with Crop (drag the frame's corners or middle), Markup (a pen in six colours, Undo), Share (the system's share sheet: [SHARE-AND-FILES.md](SHARE-AND-FILES.md)), Delete (after asking), and Save, which asks: Save to Photos writes the edits over the capture (Revert drops them), Save to Files writes the edited picture to a folder the user picks |
| Service | Later: `luna://org.webosphoenix.screenshot/capture {}` and the original's `com.palm.systemmanager/takeScreenShot` (SystemService.cpp:210, for patches and apps that used it); both reply with the file |
| Protected cards | An app can mark its card secure (a Phoenix appinfo key, like Android's FLAG_SECURE); the capture shows it black |

The capture is the composited screen (the compositor's frame), status bar
included, at the device's resolution.

## 3. 2.0: on a par with iOS and Android

| Feature | What it does | Seen in |
| --- | --- | --- |
| **Preview** | A thumbnail in the corner for a few seconds; swipe it away, tap to edit, hold to drag it into another card (an email, a message) | iOS, Android |
| **Edit and mark up** | Crop, pen, highlighter, text, shapes, a magnifier, a ruler; redact (blur or black out) with one stroke | iOS Markup, Android |
| **Full page** | For a web page or a long list: "Full page" in the preview captures the whole scroll as a long image or a PDF | iOS Full Page, Android "Capture more" |
| **Region** | Drag a box to capture part of the screen | Desktops; Android 15's partial screen recording |
| **Recording** | Record the screen (or one card) with the microphone or not; a red dot in the status bar while it records; stop from the dashboard | iOS, Android |
| **Text in it** | The text in any screenshot can be selected, copied, searched and read aloud (on-device OCR); Photos can search screenshots by their text | iOS Live Text, Pixel Screenshots |
| **Ask about it** | "Ask" in the preview hands the picture to the assistant ([AI-AND-MCP.md](AI-AND-MCP.md)): what is this, translate it, add this event to my calendar, find this product | iOS Visual Intelligence, Android Circle to Search |
| **Circle to look up** | Hold the gesture bar and draw around anything on screen to ask about just that part, without saving a file | Android Circle to Search |
| **Remembered** | An opt-in, on-device index of screenshots (what they say and show) so the user can ask "the Wi-Fi password I screenshotted" | Pixel Screenshots |
| **Private by default** | Secure cards and sensitive fields (passwords, one-time codes) are blacked out; the assistant only sees a screenshot when the user taps Ask; nothing leaves the device unless the user picks a cloud model | |
| **Android apps** | Android cards are captured like any card; Android's own screenshot request (from an app) goes to Phoenix's | [ANDROID.md](ANDROID.md) |

The AI parts use the same assistant and the same rules as everything else
in [AI-AND-MCP.md](AI-AND-MCP.md): on device first, the user's own model if
they choose one, and a tool (`screenshot.capture`, `screenshot.read`) for
MCP clients only with the user's permission each time.

## 4. Work

| Step | What | Line | Effort |
| --- | --- | --- | --- |
| SC1 | Capture; keys; shutter sound and flash; file with ISO dates; the Screen Captures album; simulator support and tests. Then on a device: the compositor's frame, `org.webosphoenix.screenshot` and `takeScreenShot` | 1.x | Done in the simulator; the device part M1 |
| SC2 | The "Screen captured" notification and the preview: crop, markup, share, delete, save. Then: secure cards | 1.x | Done in the simulator; secure cards to do |
| SC3 | Preview thumbnail: tap to open, swipe away (1.x, done in the simulator); drag into a card (2.0) | 1.x / 2.0 | Done; the drag S to M |
| SC4 | Markup editor (crop, pen, text, shapes, redact) | 2.0 | M (2 to 3 weeks) |
| SC5 | Region and full-page capture (scrolling web views and lists) | 2.0 | M |
| SC6 | Screen recording with the status bar indicator | 2.0 | M |
| SC7 | On-device OCR, select text in screenshots, search them in Photos | 2.0 | M; needs the on-device model work |
| SC8 | Ask, circle to look up, the opt-in screenshot memory | 2.0 | L; with the assistant |

## Open questions for you

1. ~~Should 1.x show the notification after a capture?~~ Decided: yes, and
   it opens a preview with the easy features.
2. Is the screenshot memory (SC8) something you want at all? It is opt-in
   either way.
