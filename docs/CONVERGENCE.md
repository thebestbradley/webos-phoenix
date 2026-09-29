# One device, every screen (2.0)

Plan for Phoenix 2.0: one phone or tablet that adapts to what it is plugged
into. Owner's direction (29 September 2026):

- A tablet with a keyboard or mouse, or a phone or tablet plugged into a
  monitor, switches to a **desktop mode**, as Samsung DeX does.
- A phone or tablet plugged into a TV, or sending to one wirelessly, turns
  the TV into a **smart streaming device**: Phoenix's TV mode, so any TV
  gets a webOS-style TV interface.
- A large tablet gets the tablet interface at any size.
- Without Netflix, Disney+, Prime Video and the other big streaming apps,
  TV mode (and the product) is dead in the water. Streaming access is a
  requirement of 2.0, not an extra.

Nothing here is built yet. What 1.x already gives it: the shell resizes to
any window, rotates on phone and tablet, sizes art by density
([spec/hidpi-art.md](spec/hidpi-art.md)), handles trackpad gestures in card
view, and reads the device's hardware from `/etc/phoenix/device.json`
([HARDWARE.md](HARDWARE.md#device-configuration)).

## 1. Modes

| Mode | When | What the shell does |
| --- | --- | --- |
| **Phone** | Phone, no external display | The 1.x phone UI |
| **Tablet** | Tablet, or a large window, no pointer | The 1.x tablet UI, scaling to any size |
| **Desktop** | A monitor is connected, or a keyboard or pointer is attached to a tablet (the user can turn this off) | Cards become resizable, overlapping windows; card view becomes the window overview; the gesture bar becomes a dock with the launcher and running cards; Just Type is the launcher search (a key opens it); the dashboard stays top right; right-click menus; keyboard shortcuts for card switching, snapping and closing |
| **TV** | The external display is a TV (see section 2), or the user chooses TV mode for a display | A 10-foot interface on the TV: large tiles of apps and continue-watching rows, focus navigation with a remote or D-pad, full-screen playback. The phone's own screen becomes the remote: a touchpad pointer (like LG's Magic Remote), the D-pad, a keyboard for search, volume and playback controls |

The webOS metaphors stay in every mode: cards and stacks, Just Type, the
dashboard's notifications, Synergy. Desktop mode is webOS cards grown into
windows, not a copy of Windows or GNOME.

**Both screens at once.** With an external display the phone keeps its own
screen: the remote in TV mode, a second screen or a touchpad in desktop
mode. Moving a card between screens is a drag in card view.

## 2. What the shell needs to know

A **dock service** (`org.webosphoenix.dock`, working name) reports and
subscribes:

- **Displays:** connection, resolution, refresh rate and physical size from
  the kernel's DRM connectors and the display's EDID. A display with a
  CTA-861 extension, TV-sized dimensions and HDMI-CEC is probably a TV; the
  first connection asks "Use as a TV or as a monitor?" and remembers the
  answer per display.
- **Input:** keyboards, mice, trackpads, game controllers and Bluetooth
  remotes from udev and the input stack; HDMI-CEC remote buttons where the
  hardware passes CEC through (often not over USB-C).
- **Mode:** the chosen mode for each screen, with a setting to override.

The shell's modes are QML states over the same components; apps get the
mode and the screen size through the existing window properties, so a
web app lays itself out with ordinary CSS media queries.

## 3. Hardware it depends on

| Need | Why | Check per device |
| --- | --- | --- |
| **USB-C DisplayPort Alt Mode** (or HDMI) | Wired monitor and TV output. Many phones lack it | Record in [HARDWARE.md](HARDWARE.md) for every target device |
| **HDCP on the display output** (1.4 for HD, 2.2 for 4K) | Streaming services refuse HD on outputs without it | Kernel display driver support on Halium/mainline; usually vendor-kernel only |
| **Widevine L1** (a hardware TEE) | HD and 4K from the DRM services | See [APP-STORE.md](APP-STORE.md#311-streaming-apps-and-drm) |
| **Hardware video decode** (H.264, HEVC, VP9, AV1) with a secure path to the display | 4K playback without draining the battery; L1 needs the decoded frames protected | GStreamer or Chromium's media stack on the vendor's codec drivers |
| **Multiple outputs in the compositor** | The phone screen and the external display at once | OSE's compositor (luna-surfacemanager, Qt Wayland) on two outputs |

## 4. Wireless: sending to a TV

| Route | State | Notes |
| --- | --- | --- |
| **Miracast** (Wi-Fi Display) | Open implementations exist (for example GNOME Network Displays); works with most TVs | Mirroring. DRM apps block or drop to low quality unless the link has HDCP |
| **Google Cast** (sending to a Chromecast or Google TV) | Chromium contains Cast sender code (its Media Router); whether Google allows it in a third-party browser needs checking | The TV plays the stream itself, so the phone's DRM does not matter. The streaming apps must support casting from our device |
| **AirPlay** (sending to AirPlay 2 TVs) | Apple licenses AirPlay to makers of receivers; we know of no licence for other senders | Unofficial senders exist; not something to ship without Apple's agreement |
| **DLNA / UPnP** | Open | Our own media only (Photos, Videos, Music); not the streaming services |

Wired output is the dependable route for TV mode; Cast is the most useful
wireless route for streaming; Miracast covers everything else.

## 5. Streaming services in TV and desktop mode

The web versions in the Chromium browser are the fastest route, but they
have limits on a TV: Netflix, for example, has listed Chrome on Linux at
720p, and a browser page is not a 10-foot interface. For TV mode to be
a real streaming device, Phoenix needs the services' TV apps or
certification of our device by each service, on top of Widevine L1 and
HDCP. Those deals take a long time and need a company and a device that
sells, so the talks should start well before 2.0 ships. The plan and the
order are in [APP-STORE.md](APP-STORE.md#311-streaming-apps-and-drm).

**Name:** "webOS" is LG's trademark ([LEGAL.md](LEGAL.md#name-and-trademarks)).
Market it as Phoenix TV mode, not as a "webOS TV".

## 6. Roadmap (2.0)

| Phase | Contents | Depends on |
| --- | --- | --- |
| **C0** | Modes in the simulator: phoenix-sim flags for a second display (monitor or TV) and for a keyboard and mouse; the dock service simulated in `phoenix-runtime.js`; QML tests for each mode | 1.x shell |
| **C1** | Desktop mode: windows, the dock, the overview, shortcuts, right-click menus | C0 |
| **C2** | TV mode: 10-foot launcher, focus navigation, the phone as remote | C0; the Chromium browser (BROWSER plan) |
| **C3** | On a device: DRM connectors, EDID, udev input, two outputs in the compositor, HDCP | M1 on a device with DisplayPort Alt Mode |
| **C4** | Wireless: Miracast, then Google Cast sending | C3 |
| **C5** | Streaming: Widevine L1 and service certification | A company to hold the contracts; a reference device (see [STATUS.md](STATUS.md)) |

## 7. Open questions

1. Which reference device: it needs DisplayPort Alt Mode, HDCP, a TEE for
   Widevine L1 and hardware 4K decode.
2. Desktop mode on the phone's own screen with a keyboard and mouse, or only
   with an external display?
3. TV mode on its own hardware later (a Phoenix stick or box), or only
   through a phone or tablet?
