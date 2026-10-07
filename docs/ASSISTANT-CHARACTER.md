# The Assistant's character

The Phoenix Assistant has a face: a small bird that shows what the
assistant is doing. It is original art for Phoenix (Apache-2.0), designed
with the project's owner on 7–8 October 2026 ([art/assistant-bird/PROVENANCE.md](../art/assistant-bird/PROVENANCE.md)).

## The design

- A black bean-shaped body with a white tuxedo belly (a penguin's).
- Black flipper wings with golden tips, and golden feet.
- A golden flame crest in three layers (outer, inner, core) and a fan of
  golden tail flames. Both always burn: they flicker at all times, each
  layer at its own pace, with a slower gust over the crest.
- White pill-oval eyes with no pupils. They show feeling through their
  size, place and lids (lids slide in; happy and sleepy eyes are curves).
- A two-part golden beak with nostrils and a highlight. It opens, grins,
  purses and tilts.
- It breathes, blinks every few seconds at random (now and then twice),
  hops with a squash and a stretch, and shakes itself awake.

## One source, two renderers

`art/assistant-bird/bird.json` holds everything: the parts as SVG path data
in a 400 × 440 drawing, their colours, the pivots they turn about, the eye
and beak shapes, the extras, the pose table and the motion (flicker keys,
breath, blink, hop, speech and listening rhythms, transition times).

`tools/gen-assistant-bird.py` writes it out for both renderers, with each
part's bounding box and each flame's pivot worked out once:

| Output | For |
| --- | --- |
| `shell/qml/Phoenix/Shell/AssistantBirdData.js` | the shell's `AssistantBird.qml` (Qt Quick Shapes, the curve renderer) |
| `apps/assistant/src/bird/birdData.ts` | the Assistant app's `Bird.tsx` (SVG) |
| `apps/assistant/src/bird/bird.generated.css` | the app's keyframes (its CSP allows no style made at run time) |

CI runs `python3 tools/gen-assistant-bird.py --check`. Generating, rather
than reading the JSON at run time, keeps the shell free of file reads and
the app free of run-time styles, and the check keeps the three in step.

Both draw vectors, so the bird is crisp at any size and pixel ratio. All of
its motion follows Animation speed (Settings > Advanced) and stops under
Reduce motion (and, in the app, the browser's prefers-reduced-motion): it
then holds each pose still. In the shell everything is a plain property
animation: nothing runs script per frame.

## The poses

| Pose | Label | Eyes | Beak | What it does | When |
| --- | --- | --- | --- | --- | --- |
| `asleep` | Asleep | sleepy | closed | slumped, flippers tucked, the crest a tiny ember, z's | the view opening (and closing) |
| `hello` | Hello | happy | grin | a big flipper wave | just after it opens; a tap on it; the app's empty conversation |
| `idle` | Idle | open | closed | upright, breathing, blinking | nothing going on |
| `listening` | Listening | wide | open | leans in, a flipper up; the crest and rings swell with the voice | the microphone is on |
| `thinking` | Thinking | lower lids up | closed, pursed | a flipper to the chin, embers drifting up | a request (or a transcription) waits |
| `working` | Working on it | determined lids | closed | flippers braced, the crest burning hot, dots pulsing | a command ran (first beat) |
| `speaking` | Speaking | open | wide, moving | a flipper gestures; the beak opens and closes in a syllable rhythm | the answer is spoken |
| `done` | Done! | happy | grin | hops up, both flippers high, the crest flares, sparkles | a command ran (second beat) |
| `asking` | Asking first | one wide, one lidded | open | head cocked, a flipper pointing, a question mark | a read-back waits for Send / Cancel |
| `confused` | Didn't get that | uneven | crooked | a shrug, the crest flopped over, a sweat drop | "I can't do that", with its choices |
| `proud` | Proud | happy | closed | chest out, flippers on hips | not used yet (a long task finishing) |
| `shy` | Oops | sleepy | closed | a flipper over its face | something failed |

The system view (`AssistantOverlay.qml`, `birdPose`) chooses: not open →
asleep; opening → asleep, then hello; listening; busy → thinking; the
reply's beats (working 450 ms then done 700 ms; confused or shy 1500 ms);
speaking while the shell's speech speaks; asking while a read-back waits;
else idle. The app (`apps/assistant/src/bird/pose.ts`) plays the same beats
for its requests. `phoenix-sim --scene assistantbird` cycles through the
poses; `--scene assistantbirds` shows them all.

## Adding a pose

1. In `bird.json`, add it to `poses`: `eyes` (a key of `eyes`), `beak` (a
   key of `beaks`), `lift` (how high it hops; 0 stays down), `tilt`,
   `wingL`, `wingR`, `crestScale`, `crestRotation`, `beakTilt` (degrees,
   clockwise) and `extras` (keys of `extras`). New eyes, lids, beaks or
   extras go in their tables, with any new parts in `parts`.
2. Run `python3 tools/gen-assistant-bird.py`; it refuses a pose that names
   something missing.
3. Use it: in the shell, from `AssistantOverlay.qml`'s `birdPose` or
   `beatsFor`; in the app, from `pose.ts`.
4. Add it to the poses checked in `shell/tests/tst_assistantbird.qml` and
   `apps/assistant/src/bird/bird.test.tsx` (both list all of them), and to
   the table above.
