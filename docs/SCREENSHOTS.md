# Screenshots and screen recording

A plan, not built yet. How the original took screenshots, how Phoenix 1.x
keeps that, and what 2.0 adds to match today's phones, including the AI
features people now expect.

## 1. What the original did

From the webOS 3.0.5 source (`luna-sysmgr`):

- **Keys.** On the TouchPad, Home and Power pressed together (both within
  3 s). Phones used Orange + Sym + P; that chord is commented out in the
  3.0.5 tree, which was the TouchPad's.
- **Where.** A PNG in `/media/internal/screencaptures/`, named
  `<app>_YYYY-DD-MM_HHMMSS.png` after the app in front. The date puts the
  day before the month, a bug Phoenix does not copy.
- **Feedback.** The "shutter" sound and `WSOverlayScreenShotAnimation`: a
  dark radial overlay over the screen that fades out in 900 ms.
- **After.** Nothing on screen. Photos showed the screencaptures album,
  and from there the picture could be shared.

## 2. 1.x: as the original, fixed

| What | Phoenix 1.x |
| --- | --- |
| Keys | Home + Power on tablets (Power + Volume Down on devices without Home); Ctrl + Shift + 3 on a hardware keyboard (on a Mac host, the simulator's own key); Orange + Sym + P on phones with a keyboard |
| Feedback | The shutter sound (the system's feedback stream, so the ringer switch mutes it) and the radial overlay, 900 ms |
| File | `/media/internal/screencaptures/<App name> YYYY-MM-DD HH.MM.SS.png` (ISO date) |
| Photos | The "Screen captures" album, as the original |
| Notification | A notification, "Screen captured", with the picture as its icon; a tap opens it in Photos, Share in the notification shares it (Phoenix addition, the minimum a user expects today) |
| Service | `luna://org.webosphoenix.screenshot/capture {}` and the original's `com.palm.systemmanager/takeScreenShot` (for patches and apps that used it); both reply with the file |
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
| SC1 | Capture in the compositor; keys; shutter sound and overlay; file with ISO dates; the screencaptures album; `org.webosphoenix.screenshot` and `takeScreenShot`; simulator support and tests | 1.x | M (2 weeks) |
| SC2 | The "Screen captured" notification with open and share; secure cards | 1.x | S (1 week) |
| SC3 | Preview thumbnail with swipe, tap and drag into a card | 2.0 | S to M |
| SC4 | Markup editor (crop, pen, text, shapes, redact) | 2.0 | M (2 to 3 weeks) |
| SC5 | Region and full-page capture (scrolling web views and lists) | 2.0 | M |
| SC6 | Screen recording with the status bar indicator | 2.0 | M |
| SC7 | On-device OCR, select text in screenshots, search them in Photos | 2.0 | M; needs the on-device model work |
| SC8 | Ask, circle to look up, the opt-in screenshot memory | 2.0 | L; with the assistant |

## Open questions for you

1. Should 1.x show the notification after a capture (a small change from
   the original), or stay silent like it?
2. Is the screenshot memory (SC8) something you want at all? It is opt-in
   either way.
