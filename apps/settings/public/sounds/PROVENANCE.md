# Provenance: Settings' sounds

`tracker-alert.mp3` is the unknown tracker alert's sound (the notification
of `services/accessories/trackers.js`, `ALERT_SOUND`; docs/ACCESSORIES.md,
"The alert's sound"). It is synthesized by `tools/make-feedback-sounds.py`
(`tracker_alert`) from sine waves alone: two bursts of three quick rising
chirps, then a ping with a struck bar's partials, 2.2 s, encoded as MP3
with LAME through ffmpeg. Nothing was sampled, recorded or downloaded, and
it is Phoenix's own design, not modelled on Apple's or anyone's alert
sounds. Dedicated to the public domain (CC0 1.0), like Phoenix's other
generated sounds (`shell/assets/sounds/PROVENANCE.md`).
`python3 tools/make-feedback-sounds.py --check` checks it against what the
script renders.
