# The Assistant on par with the others: the review and the plan

On 11 October 2026 the owner asked for the Assistant to be "on par with
everyone else's", with three points in their words:

- "Anything connected through the Synergy system should be able to [be
  accessed and acted on]."
- "If the language model is installed ... some of the commands now are
  taking a long time because the language model is doing it; shouldn't it
  go through our tool first so it's done quicker before the language model."
- "Anything else [the agents] notice should be fixed and addressed as well."

This page keeps the review that started that work and the plan made from
it. What was built, and how well it does, is in
[AI-AND-MCP.md](AI-AND-MCP.md) (the decision model, "Evaluation") and
[GAPS.md](spec/GAPS.md) E3; the hands-free half (every button asked aloud
in talk mode, Search the web automatically) is AI-AND-MCP.md "Every button,
asked aloud".

## The review (42 requests, 11 October 2026)

The Assistant's capabilities, commands and tools were compared with what
people commonly ask of Siri, Google Assistant, Alexa and the chat
assistants, by trying 42 requests in the simulator.

Bugs found:

1. "send my ETA to Sam" texted a contact named "my".
2. "remind me to buy milk when I get home" silently made a plain task,
   dropping the condition.
3. "set a sleep timer for 30 minutes" made a plain timer; the music did not
   stop.
4. "play my podcast" answered "Playing podcast." (it searched music for the
   word).
5. "call 911" asked "Call 911?": emergency numbers need their own rule, a
   short spoken countdown with Cancel, as Siri and Google do, never blocked.
6. "what's on my screen" suggested "set brightness to 50%".

And with the on-device model installed, requests the grammar and the
commands could answer went through the model first, which made them slow.

## The plan

Three parts, worked side by side:

- **Speed and correctness.** The model never slows a request the grammar
  and the commands can do; the six bugs; anything else found.
- **Everything in Synergy.** The Assistant reads and acts on every account
  connected through Synergy (messages, email, calendars, contacts, tasks,
  drives, social), and a future connector works without Assistant code
  changes.
- **The everyday features others have**, none needing a model:
  - "What did I miss" and reading notifications; announcing messages on
    headphones; a driving mode.
  - Routines ("good night", "good morning", at a time, on a phrase): a
    sequence of commands, made and edited in Settings > Assistant >
    Routines.
  - Camera: a photo, a selfie with a countdown, a video; a voice memo.
  - Sharing one's location or ETA with someone.
  - Location reminders ("when I get home", "when I leave work"); "remember
    where I parked" and "where did I park".
  - Email: archive, delete, mark read or unread, flag, on every account;
    calendar invitations: accept, decline, tentative.
  - Music: what's playing, shuffle, repeat, like, a sleep timer that stops
    the music, podcasts (where a podcast app or feed exists, else saying so).
  - Quick facts: define, spell, flip a coin, roll dice, a random number,
    Wikipedia summaries (its REST API, attributed), a news briefing from the
    user's own feeds.
  - Settings: dark mode and any device setting a person would say.
  - Emergency SOS: the countdown call, then offering to text the user's
    location to their emergency contacts.
  - Smart home through Home Assistant (lights, plugs, thermostats, scenes),
    last, if time allows.

Every command keeps the Assistant's safety rules: its risk (read, change,
open, send, call, delete), a read-back before sending, calling or deleting,
never acting on a model's guess for anything outward or destructive, and
the evaluation's unsafe count at 0.

**Needs a language model** (the 2.0 plan, not this round): summaries,
writing tools, translation, screen awareness, understanding what the camera
sees, memory, multi-step tasks, proactive suggestions.

## How it is measured

- Grammar only: `node tools/eval-assistant.cjs` (the main cases, and each
  area's `apps/assistant/eval/cases-<area>.json`) and
  `--cases apps/assistant/eval/held-out.json` (phrasings not tuned on).
- With the on-device model: `llama-server` on the built-in model, then
  `node tools/eval-assistant.cjs --model http://127.0.0.1:<port>/v1`, for
  accuracy and latency (mean, 90th percentile, slowest).
- Unit tests for the Assistant, and each new feature tried in the real
  simulator.
