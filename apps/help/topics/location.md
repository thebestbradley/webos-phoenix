---
title: Location Services
category: Settings
order: 4
summary: GPS, network location and which apps know where you are
keywords: gps, location, position, privacy, permission, maps, weather, beacondb
app: org.webosphoenix.settings
---
**Settings > Location Services** turns location on and off, and chooses
how the phone finds itself:

- **GPS:** satellites. Exact, but only outdoors.
- **Network location:** from the Wi-Fi networks and cell towers around
  you. Quicker and works indoors, but less exact.

The first time an app wants your position, the phone asks you. The
**Apps** list shows every app that asked; change your answer there, or
choose *Ask next time*.

## Network location and privacy

To find where it is without GPS, the phone sends the IDs of the Wi-Fi
networks (not their names) and cell towers around it to webOS Phoenix's
location service, which looks them up in beaconDB, an open location
database. Your internet address is not passed on. With none around, the
service estimates your town from your internet address, on its own
server. Weather and Maps also ask it for the name of the town at a
position. Nothing from these lookups is kept.

Turn off **Network location** to stop them, or **Location Services** to
stop all of them. A town you choose with **Set my location** stays on the
phone.
