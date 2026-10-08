# The Assistant's character

The Assistant has a face: a small bird that shows what the
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
- Every pose acts: a loop of movement over its parts (body, head, eyes,
  lids, each flipper, beak, crest), so it is never a still picture with
  only its fire moving (see *Acting* below).

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
| `apps/assistant/src/bird/bird.generated.css` | the app's keyframes, the acting loops' among them (its CSP allows no style made at run time) |

CI runs `python3 tools/gen-assistant-bird.py --check`. Generating, rather
than reading the JSON at run time, keeps the shell free of file reads and
the app free of run-time styles, and the check keeps the three in step.

Both draw vectors, so the bird is crisp at any size and pixel ratio. All of
its motion follows Animation speed (Settings > Advanced) and stops under
Reduce motion (and, in the app, the browser's prefers-reduced-motion): it
then holds each pose still. In the shell everything is a plain property
animation: nothing runs script per frame.

## Acting

Each pose plays a loop on top of its values (`motion.acting.poses` in
`bird.json`): per part that moves (a *channel*: `body` about its feet,
`head` (the crest and the face together) about its neck, `eyes` (with
their lids), `lids` alone, `wingL`, `wingR` about their shoulders, `beak`,
`crest` about its base), keys of `[at, rotation, x, y, scale x, scale y]`
over the pose's `period`, eased in and out between keys. Each loop starts
and ends at rest, so it joins up; a pose change takes over from wherever
the parts are and eases that away over `lead` (280 ms) while the new loop
begins, so nothing jumps. The shell plays them as property animations
(`Act` in `AssistantBird.qml`); the app as the generated keyframes
(`.ab-act-<pose>-<channel>`), blending through the part's drawn transform.

| Pose | Its acting | Loop |
| --- | --- | --- |
| `asleep` | slow, deep sleep breaths, the head nodding down (with the z's) | 3.6 s |
| `hello` | the raised flipper waves back and forth, the body and head sway with it | 0.46 s |
| `idle` | now and then (3 to 7.5 s apart, at random, like the blink): shifts its weight one way and looks that way, then the other, and settles | 2.8 s, once |
| `listening` | (as before) leans in; the crest and the rings swell with the voice | |
| `thinking` | the head tilts one way then the other, the flipper taps its chin twice, the eyes glance up and aside, the beak purses side to side (embers drifting up) | 2.6 s |
| `working` | busy: bobs up twice a beat, the flippers pump in turn, the head lags a little behind, the lids press into a squint, the crest flares with each bob (dots pulsing) | 0.64 s |
| `speaking` | the flipper gestures and the head bobs on the syllables (the beak's rhythm, `motion.speech`) | 0.93 s |
| `done` | (as before) the hop with squash and stretch, sparkles; the raised flippers flutter | 0.38 s |
| `asking` | the head cocks further and back, the pointing flipper reaches toward the buttons twice | 1.5 s |
| `confused` | a double shrug (flippers and shoulders up, the head sinking between them) while the flopped crest droops lower | 1.5 s |
| `proud` | crouches, bounces up with the crest flaring, lands with its chest puffed out | 1.2 s |
| `shy` | hides: the flipper comes up by its face, the head ducks away and it shrinks; then peeks back out, eyes glancing over | 2.2 s |

Animation speed scales them; Reduce motion (and prefers-reduced-motion in
the app) stops them with everything else. The wake shake and the nod stay
as they were. `phoenix-sim --scene assistantbird` and `--scene
assistantbirds` show them playing.

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
   extras go in their tables, with any new parts in `parts`. Give it its
   acting in `motion.acting.poses` (a `period` and its channels' keys;
   `every: [min, max]` for one now and then).
2. Run `python3 tools/gen-assistant-bird.py`; it refuses a pose that names
   something missing.
3. Use it: in the shell, from `AssistantOverlay.qml`'s `birdPose` or
   `beatsFor`; in the app, from `pose.ts`.
4. Add it to the poses checked in `shell/tests/tst_assistantbird.qml` and
   `apps/assistant/src/bird/bird.test.tsx` (both list all of them), and to
   the table above.
