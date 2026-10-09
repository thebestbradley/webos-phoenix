# AI and MCP

> **Decisions (28 September 2026, from the project owner).** The assistant
> is **on by default**, like on any modern phone, with settings to turn it
> off or limit it. Where the device can run one, a local model answers
> first. Beyond bring-your-own keys, the project may run its own **paid
> Phoenix AI service**, alongside iCloud-style Phoenix cloud services, so
> Settings > Assistant must allow a first-party provider next to the others.
> Which third-party providers come first is still open.

## 1.0 and 2.0

> **Decision (29 September 2026, from the project owner).** A digital
> assistant like Siri is part of **1.0**. The MCP layer and the frontier
> AI work (the agent, local LLMs, bring-your-own LLM, a Phoenix AI service)
> are **2.0**.

> **Revised (7 October 2026, from the project owner).** 1.0 adds language
> models after all, in layers: the commands below first; then an optional
> on-device model (llama.cpp, downloaded in Settings), which becomes the
> default for actions once installed; then, when neither can answer, the
> choice of a cloud model (Anthropic, OpenAI, Google, any OpenAI-compatible
> URL) or a web search. A cloud model may run commands only with the user's
> permission, set in Settings > Assistant. It opens by holding the launcher
> button, has its own app with chat threads, and shows the active thread
> over a translucent backdrop. The MCP agent stays 2.0. The plan is
> [M6-PLAN.md](M6-PLAN.md) F3; the table below is its command layer.

The **Assistant in 1.0** starts with a voice assistant in the classic style:

| Part | 1.0 |
| --- | --- |
| **Asking** | Push-to-talk from the gesture area (press and hold while the keyboard is down; see [spec/GAPS.md](spec/GAPS.md) V4 for the keyboard-up case), a mic button in Just Type, a headset button, and "Hey Phoenix" (an on-device wake word, off by default; see Voice) |
| **Hearing** | On-device speech recognition with the transcriber Voice Memos already uses (`org.webosphoenix.transcriber`, whisper.cpp); nothing leaves the phone |
| **Understanding** | Intents: a fixed grammar per command in each supported language ("call Mum", "text Sam I'm late", "set a timer for 10 minutes", "wake me at 7", "turn off Wi-Fi", "open Maps", "navigate home", "play <artist>", "remind me to ...", "what's the weather", "what's 15% of 80"). Apps add their own through `appinfo.json`, the same way they add Just Type Quick Actions |
| **Doing** | The same Luna calls Just Type's actions and the apps already make: Phone, Messaging, Clock, Settings, Maps, Music, Tasks, Weather, Contacts. Anything that sends or deletes is read back first ("Send 'I'm late' to Sam?") |
| **Answering** | A popup alert or dashboard in the webOS style with the answer, spoken by the text-to-speech service; for anything it cannot do, "Search the web for ...", as Just Type does |

### 1.0 as built (7 October 2026, in the simulator)

What [M6-PLAN.md](M6-PLAN.md) F3 built, and what runs where. The table
above was the plan's command layer; this is the whole 1.0 assistant.

| Layer | What runs | Where |
| --- | --- | --- |
| 1. Speech to text | The shell's dictation: whisper.cpp through `org.webosphoenix.transcriber` | On the device (in phoenix-sim, the same service code on the computer) |
| 2. Commands | A grammar per language (`apps/assistant/service/lib/lang/en.js`): the 58 commands in the table below (9 October 2026), with the days and times people say; plus commands apps declare in `appinfo.json` (`"assistant": {"commands": [...]}`, Just Type's Quick Action shape with phrases per language; a Quick Action counts as `"<displayName> {text}"`, after the built-in commands) | In the service, no model, no network (weather, distances, currencies and unknown cities fetch Open-Meteo or Frankfurter) |
| 3. On-device model | llama.cpp's `llama-server` with a GGUF model the user downloads in Settings > Assistant, called with the same commands as tools (Chat Completions, `--jinja`) | On the device. phoenix-sim runs it from the shell (`LocalModels`, Phoenix.Native); the device service runs it itself (`lib/node-device.js`) |
| 4. Cloud model or web | "Ask <provider (model)>" and "Search the web" as choices on the answer, and "Connect model" while no cloud model is set up; a thread taken to a cloud model goes on with it | The provider's servers; the browser |

**The commands** (8 October 2026). The grammar's phrasings are examples:
each family takes the usual variations ("please", "can you", the order of
the parts), and the tests have more (`apps/assistant/service/everyday.test.ts`,
`grammar.test.ts`). Every command is also a tool the models are given, with
the same arguments (`lib/commands.js` `BUILT_IN`); times a model writes
("friday at 10am", ISO 8601) go through the same date reading. Answers are
one short sentence and offer the app where it helps ("Open Calendar"); the
bird plays done, asking (a read-back), confused (nothing here can) or oops
(it could not).

**Casual words** (9 October 2026). Talk rather than dictation reaches the
commands without a model: when no rule takes the words as said, they are
said again in the rules' words and tried once more (`lib/lang/en.js`
`CASUAL`, `lib/grammar.js` `parse`): "kill the wifi for now" (turn off
wifi), "get the bluetooth going", "it's pitch dark in here, I need some
light" (the flashlight), "I don't want any calls for a while, go silent",
"set up a wake up call at 6", "I need to be up by 5:45", "count down three
minutes for the eggs", "don't let me forget to water the plants tonight at
8", "ping me about the rent on friday", "pencil in a dentist visit next
tuesday at 3", "drop Sam a line saying I'm on my way", "let Mary know I'll
be late", "it's way too loud", "the screen is too bright", "throw on some
tunes", "what's the forecast looking like for the weekend", "fire up the
camera". All 18 phrasings that the grammar missed and that the on-device
model was measured on (below) now reach the right command in the grammar, as do some 40 more
(`casual.test.ts`), and words such as "let me know what you think", "drop
it" or "tell me about palm" are left alone.

**One thing about one item** (9 October 2026, the owner: retrieve
specifics, not just lists). "What time is my meeting with Sam", "where is
it", "who's invited", "how long is it", "what did I write in my grocery
memo", "when is Sam's birthday", "when did Mom call", "what did Alex's last
email say", "what's on my to-do list for today", "when is my next dentist
appointment": the one field asked for, in a sentence, with the item's card
(`detail`, `lib/details.js`; `contactInfo`, `callLog {who}`, `readEmail`,
`taskList {day}`). The item an answer shows (the one thing it opens) is
the conversation's **focus**, kept with the conversation
(`assistant.js` `keepFocus`), and "it", "that" or no name at all
("who's invited") means it. Tests: `details.test.ts`.

**Changing what was found** (9 October 2026). "Rename it to Coffee with
Sam", "move it to Zoom", "add Alex to it", "remove Priya from it", "move
it to 4", "change the meeting with Sam to 4", "add milk to my grocery
list" then "remove eggs from it", "rename my grocery memo to Shopping",
"change Sam's email to ...", "set my 7am alarm to 6:30", "mark it done":
the command `edit` (`lib/details.js`) finds the item by its words or the
focus, changes that one record, says what changed, and offers Undo with
what it replaced; "it" in `eventMove`, `eventCancel`, `noteAppend` and
`taskDone` is the focus too. What "add X to it" means is the item's: a
guest for an event (by their contact's email), a line for a memo, a task
for a list. Like every write, each change is read back before the answer
says it was done ("Said only when done").

**How well it understands** (9 October 2026). Three sets, kept as tests:

- `test/eval-phrasings.cjs`, 150 requests as people say them across all
  the commands, details and edits included. The grammar alone took 135 of
  the first 147; widened on its misses ("ring my mom", "can you get Sam on
  the phone", "what does my day look like tomorrow", "get rid of my
  dentist appointment", "give me a 20 minute timer", "how much battery do
  I have left", ...), it takes all 150 (`eval.test.ts`, in CI).
- Its held-out part, 40 written afterwards and never used to change the
  grammar: 35 (88%) with the grammar alone. The five it misses ("did
  anyone call while I was out", "get me up at half six", "is it cold out",
  ...) are what the on-device model is there for.
- `test/model-eval.json`, 163 requests the grammar does not take (25 of
  them questions and chat, `"none"`), for the model's choice
  (`pickCommand`); `eval.test.ts` checks that the grammar takes none of
  them wrongly, and that none repeats an example. Each command now has up
  to four examples in other words (`lib/examples.js`, `examples` on
  `BUILT_IN`), which the model sees beside its description. The model's
  hit rates on this set are measured with llama-server
  (opt-in, not in CI).

Writing the sets found a crash: "to-do: renew the car insurance" threw
in the task rule (`m` stayed null); it is a task now.

| Command | Say, for example | Does | Asks first |
| --- | --- | --- | --- |
| `event` | "add a meeting with Sam tomorrow at 3", "create an event called dentist on Friday at 10am", "schedule lunch with Priya next Tuesday at noon at Bistro Verde", "put yoga on my calendar every Monday at 7pm for 90 minutes", "team offsite on the 20th all day" | A calendar event: title, day and time, end or length (an hour by default), place, invitees (contacts with an email), repeats; without a time it asks "When is it?" and the next words say it | |
| `agenda` | "what's on my calendar today / tomorrow / this week / next week", "do I have anything on Friday", "what's my next meeting", "when is my dentist appointment" | Reads the events, repeats included | |
| `alarm` | "set an alarm for 7am weekdays", "wake me up at 6:30 every day", "alarm at half past six tomorrow called gym" | The Clock's alarm; repeats daily, on weekdays or at weekends (the Clock's own; "every Monday" is set once and says so) | |
| `alarmList`, `alarmManage` | "what alarms do I have", "cancel my 7am alarm", "turn off all alarms", "delete all alarms" | Lists, turns off, deletes | Deleting |
| `timer`, `timerStatus`, `timerCancel` | "set a 5 minute timer for the eggs", "how much time is left", "cancel the timer" | Timers that ring in the Assistant app | |
| `stopwatch` | "start a stopwatch", "how long has the stopwatch been running", "stop the stopwatch" | A stopwatch in the assistant (webOS's Clock had none) | |
| `reminder` | "remind me to call mom at 6", "remind me in 2 hours to check the oven", "remind me tomorrow morning to call the bank" | A task with a reminder | |
| `task` | "add milk to my shopping list", "create a task pay rent", "add a task to call the bank tomorrow" | A task, in a named list (made if new) or the default one | |
| `note`, `findNotes` | "new note: buy flowers for Ada", "take a note that ...", "find my notes about Wi-Fi" | A memo, first on the wall; memos found by their words | |
| `contactAdd`, `contactInfo` | "add Sam to contacts with number 555 0100", "new contact Jo March email jo@example.com", "what's Sam's number" | A contact; a contact's number, email, address or birthday | |
| `call` | "call mom", "call Sam on his mobile", "dial 555 123 4567" | Phone dials | Yes (Call) |
| `text`, `readMessages` | "text Sam I'm running late", "read my last message", "what did Priya say" | Sends an SMS (the words as typed); reads the last one received | Yes (Send) |
| `email`, `searchEmail` | "send an email to Priya saying see you soon", "email Alex about the report", "search my email for invoice", "do I have any new emails" | Sends (with words) or opens a new email (without); finds email | Yes (Send) |
| `toggle` | "turn on Wi-Fi", "turn off Bluetooth", "airplane mode on", "turn on the flashlight", "silence the phone", "turn on do not disturb", "turn on location services", "turn on rotation lock", "turn on the hotspot", "turn on VPN" | The switch; Do Not Disturb is the ringer off; Location Services both handlers (`setState`); the rotation lock the system preference; the Wi-Fi hotspot (`org.webosphoenix.tethering setWifi`; without its password it says so and opens Hotspot & Tethering); the first VPN profile (`com.webos.service.vpn connect`; one asking to sign in opens VPN settings) or all down | |
| `media` | "pause", "resume the music", "next song", "previous track", "what's playing", "what song is this" | The media keys, for whichever player plays; what is playing, as the player last told the system (`org.webosphoenix.system getNowPlaying`), with Pause or Play and Next | |
| `volume` | "turn up the volume", "set the volume to 30%", "mute", "unmute" | The master volume | |
| `brightness` | "set brightness to 50%", "turn the brightness up", "make the screen dimmer" | The screen's brightness | |
| `screenshot`, `lock`, `battery` | "take a screenshot", "lock the screen", "what's my battery" | A screen capture (the assistant's view out of the way); the screen off and locked; the level and charging | |
| `settings`, `open` | "open Wi-Fi settings", "open settings", "open Maps" | Settings at a pane (or its list); an app | |
| `navigate`, `distance` | "navigate to the nearest coffee shop", "how do I get to Starbucks", "walk to the park", "how far is Paris" | The place (the closest of a kind, or the nearest of that name, `lib/nearby.js`, as Maps finds them) as a card with the time there by Valhalla, the others offered as cards; Start Navigation (Maps `{destination, navigate: true}`) and Open Maps; Maps opens behind on the directions. The distance as the crow flies | |
| `play`, `photos` | "play some music by Miles Davis", "show my photos from yesterday / last week", "show my screenshots", "how many photos did I take yesterday" | Music plays; the photos shown in the conversation and in Photos (just those) behind it; how many, only said | |
| `weather` | "what's the weather tomorrow", "will it rain in London", "what's the weather this week", "what's the weather at 5pm", "will it rain this afternoon" | Open-Meteo, here (with the Assistant's location permission) or there; "will it rain" by the chance of rain; an hour by its hourly forecast; the week's highs, lows and rainy days | |
| `convert` | "convert 10 miles to km", "how many cups in a liter", "100 fahrenheit in celsius", "what's 20 USD in EUR" | Units offline; currencies with the day's ECB rates (offline it says so and offers the web) | |
| `worldTime`, `time` | "what time is it in Tokyo", "what time is it", "what's the date" | The time there (big cities offline), here, the date | |
| `calculate` | "what's 15% of 80", "twelve times seven" | The sum | |
| `search` | "search the web for palm pre", "look up webos history" | The browser | |
| `callBack`, `callLog`, `voicemail` | "call back", "redial", "who called me", "did I miss any calls", "check my voicemail", "call voicemail" | The last caller or number called (the call log, `com.palm.phonecall:1`); the missed calls of the week; how many voicemails (`com.palm.telephony` voicemailQuery), Call Voicemail | Calling |
| `replyMessage`, `readMessages {unread}` | "reply on my way", "any new texts", "read my new messages" | A text to whoever sent the last one; the unread ones counted and the newest read, with Reply | Yes (Send) |
| `eventMove`, `eventCancel`, `freeTime` | "move my dentist appointment to 4pm", "reschedule lunch with Priya to Friday at noon", "cancel my 3pm meeting tomorrow", "move my stand-up to 11am", "move all my stand-ups to 9am", "cancel my stand-up on Friday", "cancel every team stand-up", "am I free tomorrow at 3", "when am I free on Friday" | Moves an event (a time keeps the day, a day keeps the time), deletes one (undo puts it back); of a repeating one the next day only, as the Calendar's "this event only" does it (an exception date on it, `exdates`, and for a move a child event with `parentId` and `recurrenceId`: com.palm.app.calendar EditView.js:1170-1185, DeleteConfirm.js), or with "all"/"every" the whole series (its time; cancelled whole); the free stretches between 8 AM and 8 PM | Cancelling |
| `noteAppend`, `taskList`, `taskDone` | "add the guest code to my Wi-Fi note", "what's on my shopping list", "what are my tasks", "check off milk", "mark pay rent as done" | Adds a line to a memo; reads a list; completes a task (undo opens it again) | |
| `readEmail`, `emailReply` | "read my latest email", "read the email from Alex", "reply to the email from Alex saying paid, thanks", "reply to my last email" | The newest (from someone): who, when, the subject and the start of its words, with Reply; a reply "Re: ..." sent through `com.palm.smtp` after the read-back, or opened in Email to write | Yes (Send) |
| `findFiles` | "find my file called budget", "find the trip pdf", "search my files for invoice" | `org.webosphoenix.filemanager` `search`: cards opening each one's folder in Files | |
| `travelTime` | "how long will it take to drive to the airport", "how long to walk to Union Square", "what's the traffic like to work" | The place by Photon near here, the route by Valhalla (the keyless FOSSGIS servers Maps uses): the time and distance by car, on foot or by bike, without traffic (no keyless source has live traffic: it says so), with Open Maps | |
| `nearby`, `website`, `storage`, `appStore` | "coffee near me", "where's the nearest pharmacy", "what coffee shops are near me", "open example.com", "how much storage do I have", "find Doom in the Marketplace", "install Doom" | The closest five as cards (name, distance, kind, address; OpenStreetMap has no ratings), each opening Maps on that place (Back returns to the conversation), Maps behind on the whole list (`{nearby}`, what is looked for, never the sentence); offline, Maps finds them; the browser opens the site; the free storage; the Marketplace's search (`org.webosphoenix.service.packages`), and its page to install from (it never installs unasked) | |
| `help` | "help", "what can you do", "give me some tips", "how do I close an app", "how do I go back", "what is Just Type" | What it can do, by app, with examples (a tap puts one in the field) and what fits now; how to use Phoenix from the Help app's topics (`lib/lang/en-help.js`), with Open Help | |
| `undo` | "undo", "cancel that", "never mind" | Cancels a read-back waiting; else takes back what was just made (deletes the event, task, memo, contact or alarm, cancels the timer, turns alarms back on) | Yes |
| (models) | "translate hello into French", questions | Not a command: the on-device model, else "Ask <cloud model>" / "Search the web" (it says why) | |

Days and times (`lib/lang/en.js` `extract`, `resolve`; `lib/dates.js`):
"today", "tonight", "tomorrow morning", "the day after tomorrow", "on
Friday", "next Tuesday" (the coming one), "last Monday", "this weekend",
"next week", "in 2 hours", "in 3 days", "half an hour from now", "October
20th", "the 15th", "at 3", "3pm", "noon", "half past six", "seven thirty",
"from 2 to 3:30", "3-4pm", "until 5", "for 90 minutes", "all day", "every
day", "every weekday", "every Monday and Wednesday", "every other week",
"monthly". An hour said without am or pm is read as people mean it: 1 to 6
in the afternoon and 7 to 11 in the morning for events and reminders, the
next of the two for an alarm (the morning on a given day), the morning for
waking up. Another
language writes its own `extract` and words; the calendar arithmetic is
shared.

**The router.** Commands first; then the on-device model, if one is chosen
and installed (it answers free-form requests and picks commands as
tools); then the choice. Decided on the owner's behalf: the grammar still
answers first once a model is installed (it is instant and exact; the
model handles what it does not match), and one tool call per turn (the
multi-step agent is 2.0). A model's choice runs only when the words name
that kind of thing and, for a switch, the way it goes (`grounded()` in the
language file); otherwise it is read back ("Did you mean: turn the
flashlight off?"). Checked against the real Qwen2.5 0.5B with llama.cpp
(built from source here; 7 October 2026): it answers questions well, but
picks the wrong switch or direction often enough that this check is
needed; the 1.5B and 4B models are recommended where they fit. In
phoenix-sim the model loaded and answered in about 18 s the first time
and 2 s after, on four CPU cores.

**Built in: Qwen3 0.6B** (9 October 2026, the owner's decision). The device
image ships Qwen3 0.6B (the Qwen team's own GGUF, Q8_0, 639 MB; at first
Unsloth's Q4_K_M, 397 MB, which the measurements below were made with
unless they say Q8_0) and `./phoenix` puts it in
`build/models`; it is the on-device model in use until another is chosen
(`localModel` "": the built-in one; "off": none), listed in Settings as
**Built in**, never downloaded or removed. The commands still answer
first (a test checks that what the grammar knows never reaches the
model). Qwen3's template thinks aloud unless told not to: every request
says `enable_thinking: false`. A model this small, offered tools, often
said what it would do instead of calling one ("I'll turn off the Wi-Fi"),
or was not offered the right one for words it did not share with it
("throw on some tunes"). So where the words may ask the phone to act it
works in two steps (`assistant.js` `pickCommand`): it first chooses among
every command, by name and the first sentence of its description, or
"none", its answer held to those names by a JSON schema (llama-server
turns it into a grammar), at temperature 0, with sixteen examples as
earlier turns (other words than the grammar's); then it gets that one
tool with `tool_choice: "required"`, which makes it call it and fill in
the arguments. "None" is answered in words, without tools; what it
chooses wrongly is still read back unless the words name it
(`grounded()`). Measured with the real model and llama-server on 28 action
phrasings the grammar misses ("kill the wifi for now", "pencil in a
dentist visit next tuesday at 3", "drop Sam a line saying I'm on my way"):
the right command 7 times before (the closest ten tools offered), 17
after; the choice alone 20, 9 without the examples; with the official
Q8_0 the choice alone 17 (as close as 28 phrasings can tell; a request 2.4 s on this machine while it was loaded with other work). A request takes about
0.8 s here once the server is up (the choice 0.45 s). llama-server ran
with 8,192 tokens of context (the commands as tools passed 4,096: it
refused the request), one slot and an 8-bit cache with flash attention:
1.3 GB in all for Qwen3 0.6B Q4_K_M, as much as 4,096 tokens took before
(1.8 GB for the official Q8_0); since the shared prompt, 4,096 tokens in
16 bits again (below). One
slot against four made no difference here (0.44 s against 0.46 s a
choice: this llama.cpp shares one cache between its slots), but keeps
the prompt cached for a phone's single user. Checked in phoenix-sim:
"please set up a wake up call at 6 tomorrow morning", which the grammar
does not know, set the alarm through Qwen3 0.6B and was spoken by Kitten
TTS.

**One deadline for the whole answer** (`assistant.js` `bounded`, 9
October). llama-server answers a request only when it is done and serves
one at a time, so on a busy computer the steps (starting the server, the
choice, the call) each ran into their own HTTP timeout, one after the
other: "show my photos of flowers" showed the dots for seven minutes and
then "The on-device model didn't answer (Operation canceled)", the
simulator's proxy giving up after its 3 minutes without a byte. Now the
on-device model has 75 s in all; each request is given the time left
(`timeoutMs`, which phoenix-sim's proxy, `tools/serve-rootfs.py` and
`lib/node-http.js` honour), so it is closed then. Meanwhile the thread
says what is happening (`working: {stage, since, until}`) and the app shows
it under the dots ("Thinking it over on this device · 19 s (I'll stop in
56 s)"); past it: "I couldn't think that through in time. Want me to
search the web or open Photos?" with those buttons. llama-server notices a
closed request only between prompt batches: with its default 2,048
tokens it went on 46 s for a question nobody waited for (the choice's
prompt is some 3,100 tokens; 76 tokens a second on this 4-core machine
under load), keeping the next one waiting; it now reads 512 at a time
(`-b 512`, 9 s). On that loaded machine Qwen3 0.6B did not get through
the choice's prompt in 75 s at all, so the deadline is what the user
saw there; the prompt is now shorter and read once (below).

**One prompt, read once** (`assistant.js` `localPrefix`, 9 October).
The choice's prompt was some 3,000 tokens, two thirds of them each
command's own examples, and the call's began with another system prompt,
so llama-server read most of every question afresh: 77 s for the first
choice on this machine. Now the on-device model's requests all begin with
one system prompt, the same for every request and both steps: the
persona, every command by its name and the first sentence of its
description, and the sixteen examples of a choice. What changes comes
after it in messages of its own: for the choice, the examples of the four
commands the words come nearest (a lexical score over each command's
name, description and examples; two each) and the words; for the call or
the answer, the time and the history (the Qwen3 template puts a call's
one tool after the system prompt, so it is shared too). Requests say
`cache_prompt`; llama-server has one slot (`-np 1`). Naming it (`id_slot`)
was tried and dropped: with it, requests from two clients at once came
back with each other's words in them. Measured with Qwen3 0.6B Q8_0 and llama-server
on this 4-core machine (busy with other work, load 6 to 9, so the times
are long and vary; the token counts do not):

| | before | after |
|---|---|---|
| first choice after the server starts (tokens read) | 3,028 (77 s) | 1,365 (14 s) |
| a choice after a call (read / kept) | 17-22 / 3,014 | 145-160 / 1,314 |
| the call or the answer (read / kept) | 150-355 / 4-113 | 64-320 / 1,314-1,319 |
| the choice right on the evaluation set (`model-eval.json`, 163) | 97 | 105 |

Two things had to be said for the shared prompt: its choice examples made
the answer in words come back "None." until the message after it says to
answer in words, never with a command's name; and a call may say at most
160 tokens (its arguments), where a call that rambled had gone on to
512. A first question with the server cold read about 1,400 tokens and
took 18 s in all, pick and answer; later ones read some 150 for the
choice and 300 for the call, so their time is the model's writing (2 to
6 tokens a second under that load: 15 to 40 s for a call's arguments;
idle, several times faster).

**The cache: 4,096 tokens in 16 bits** (9 October). With one tool at a
time and the shared prompt some 1,400 tokens, 8,192 tokens of context are
no longer needed; the cache in 8 bits had kept that as small as 4,096 in
16 bits, but llama-server reads a prompt in 8 bits half as fast. Measured
on the same machine, the same prompt (1,464 tokens, not kept), two runs
of three, each configuration in turn:

| | 8,192 tokens, 8-bit cache | 4,096 tokens, 16-bit cache |
|---|---|---|
| reading the prompt | 97-106 tokens/s | 183-208 tokens/s |
| llama-server's memory after start | 1.86 GB | 1.83 GB |
| the choice right on `model-eval.json` | 105 of 163 | 110 of 163 |
| the choice's mean time on it | 4.0 s | 1.7 s |

So llama-server now runs with `-c 4096` and its default cache
(`shell/native/localmodels.cpp`, `lib/node-device.js`). The conversation
the model sees is held to the latest turns that fit (`LOCAL_HISTORY_CHARS`,
5,000 characters, some 1,500 tokens), so the shared prompt, a tool and a
512-token answer always fit. A first question with the server cold
(`why is the sky blue`) took 12.5 s in all, pick and answer.

**A call held to its schema** (`assistant.js` `callCommand`, 9 October).
Offered the chosen command as a tool with `tool_choice: "required"`,
Qwen3 0.6B often wrote the call's JSON, a full stop and then more until
its 160 tokens (llama-server's tool-call grammar only starts at a
`<tool_call>` tag, which it left out). Now the call asks for the
command's arguments as JSON held to its parameters' schema
(`response_format`, which llama-server turns into a grammar), at
temperature 0, and the call is made from that JSON: generation ends at
the closing brace. The shared prompt stays first; after it, the time and
which command to fill in. On the first 80 phrasings of `model-eval.json`
(the whole answer through the router, commands run against stand-in
services that keep nothing, so a read-back check fails either way):

| | a tool, `required` | JSON held to the schema |
|---|---|---|
| ends in the right command | 34 of 80 | 47 of 80 |
| calls done or read back (of 66 calls) | 34 | 46 |
| the call's mean time | 13.3 s | 3.0 s |
| the call's mean tokens written | 84 | 22 |

With a stand-in device that keeps what is saved (`test/device.ts`: the
alarms, reminders, tasks, events and memos made are there to read back;
`model-calls.test.ts`, run with `PHOENIX_TEST_LLAMA_URL`, a read-back
confirmed), the same 80 phrasings measure whether the arguments were right:
the right command 47 times, and 41 of those ran (their arguments good
enough to do it and find it again; no read-back fails from the stand-in
any more). The 6 that did not: 5 times the model gave the whole sentence
as the thing's name ("milk's bought" for the task Milk, "I'm not going to
the dentist, take it off my calendar" for the event Dentist), once the
contact has no email to write to. 55 of the 80 answers ran in all; the
call took 3.0 s and 22 tokens on average.

**A sentence for a name** (`lib/commands.js` `namedIn`, 9 October). The
user means a task, event or memo that exists, so when the name given
matches none, the ones whose every word of their name is in what was
said are found ("milk's bought": Milk; "I'm not going to the dentist,
take it off my calendar": Dentist), the most specific first, and when
several fit equally it asks which ("Which one: “Bank” or “Rent”?"). The
call's message now lists what each argument is (the schema's
descriptions, which the grammar alone does not show the model: "the
task's name as it is in Tasks, in a few words, not the whole sentence"),
with a length limit in the schema. An example name in a description
was taken as the answer ("milk" for "I've done the laundry"), so the
descriptions have none, and a name the model gives with no word of what
was said is replaced by the words (`assistant.js` `NAMED_ARG`). On the
same 80: the right command 47 times, 43 of them ran (41 before). The 4
that did not name things the stand-in does not have (a laundry task, a
packing memo, lunch with Sam, Priya's email), so they should not; every
right command whose thing exists ran. One wrong choice still runs: "Sam
and I are doing lunch friday at 1" is taken as a text to Sam (read back
first; the harness confirms it).

**What the grammar could not read** (`fillArgs`). When the grammar knows
the command but not all it needs (a required argument empty: "add an
event called dentist friday-ish" has no time it can read), or a language
file marks its parse `partial: true`, the on-device model fills in what
the words say, before any choosing: its answer held to the command's own
parameters (their JSON schema, nothing required), at temperature 0. What
the grammar read stays; a value from the model is kept only when a word
of it was said (a small model left free invents times); what is still
missing is asked for as before ("When is it?"), and what the model filled
is read back unless the words name it.

**Measured on the evaluation set** (`test/model-eval.json`: 163 requests
the grammar does not take, 25 of them questions or chat; the commands
with their examples, `lib/examples.js`): the right command chosen for 78 of the 138
requests to the phone with the built-in Qwen3 0.6B (57%), 114 with Qwen3
4B (83%); the 25 questions and chat stayed words with 0.6B (25), 4B put
one in Arithmetic ("how many legs does a spider have": a command that
reads, so it was taken). End to end, the right command was carried out
for 49 with 0.6B (before questions reached the choice; on a computer busy
with other work, where some requests ran out of time). Questions now
reach the choice too (37 of the 138 are worded as questions, "is my
thursday afternoon open"): 17 of them right with 0.6B, 30 with 4B; for a
question only a command that reads is taken, so "how do I make banana
pudding" (0.6B: append to a memo) stays words. Checked with the real
0.6B: "add an event called dentist friday-ish" was made for Friday;
"... in a fortnight" (the model gave nothing the dates understand) and
"add an event called dentist" (nothing said) were asked "When is it?".

**Never a dead end** (9 October 2026, from the owner's "how do you make
banana pudding": the commands said "I can't do that on the phone", and the
model connected later copied it). What nothing here can do gets what can,
as buttons: the app that does it ("I don't have the tools for that yet,
but I can open Music for you", by its words: `lib/lang/en.js`
`APP_WORDS`), a web search for a question ("I can't answer that on my own
yet, but I can search the web for it"), a model; and the commands near the
words. That reply is a message of kind `fallback`, never in what a model
sees of the conversation. The system prompt asks a model to answer
directly: facts, how-tos, recipes, advice, small talk; concise for voice
but with every step when steps are needed. After a model's answer to a
question: Search the web, and what to do with it (Save as Memo for a
recipe, Show in Maps for a place: `say.related`). A model is offered the
commands as tools only for words that may ask the device to do something
(not a question about the world, not small talk) and only the ten nearest
them: all of them are some 5,000 tokens. Checked with Qwen3 0.6B in
llama-server (9 October 2026): the banana pudding has steps and Save as
Memo, small talk and jokes are answered, "where is the Eiffel Tower" offers
Show in Maps, "I'd like the bluetooth off please" calls the toggle; at
0.6B it sometimes talks about a tool rather than calling it ("can you put
the torch on").

**What it finds, in the conversation** (9 October 2026, from the owner:
"Here are 2 photos" with nothing to see). An answer carries what it found
(`data.attachments`): photos as thumbnails (the first twelve, "+N more"),
events, emails, memos, tasks, calls, a contact, a message as cards, under
the words in the shell's view (`AssistantAttachments.qml`) and the app
(`Attachments.tsx`); a tap shows one in its app (choice `show:<n>`). The
conversation stays in front (the owner: "the chat should stay in focus"):
an app a command opens waits behind it, and the answer says so ("I've
opened them in Photos too") and offers Open Photos, which brings it
forward. The app opens behind for real (`applicationManager/launch
{behind: true}`: in the conversation's stack, which keeps the focus), and
everything the Assistant opens (the app, a thumbnail, a card, Open X)
carries the Assistant as its caller (`returnToCaller`, launch params
`$caller`): Back where it was opened (the picture, the memo, the event,
the contact, the message, the folder) closes it and the conversation is in
front again (docs/APP-RUNTIME.md, after "newCard"). Photos opened with several pictures shows just those, titled as
asked ("Photos from Yesterday"). Only how many ("how many photos did I take
yesterday") opens nothing. In the simulator the shell gets a small copy of
a picture from the page (`com.webos.service.mediaindexer
phoenix/thumbnail`: it cannot read IndexedDB); a device loads the file.

**Location** (9 October 2026, the owner: "it doesn't have my location but
weather has location services on"). The assistant asked OSE's
`com.webos.service.location` for `getCurrentPosition`, which only the
legacy `com.palm.location` had; the simulator's catch-all answered success
without a position (a device: Unknown method). One fix is
`getLocationUpdates` without subscribe, as `@phoenix/luna` location does,
and the simulator now answers the old name as luna-service2 would. The
position is the Assistant's to have: its row in Settings > Location
Services (`org.webosphoenix.service.location`; the simulator's services
run in a page call as their service, `nodeServiceLuna(id)`, not as that
page's app), the same grant as Settings > Assistant > Permissions >
Location. Not answered yet, the Assistant asks in the conversation (Allow,
Don't Allow) rather than leave the request waiting on the system UI's
alert; denied, or Location Services off, it says so with Allow Location or
Turn On Location Services and Location Settings, then answers what was
asked.

**Said only when done** (9 October 2026, the owner's "Save as Memo" with
no memo in Memos). The memo was saved; Memos was already running, and
"Open Memos" brought its card forward as it was (launched with no
params, a running app is not relaunched), its grid read before the memo
was made. Now the Assistant opens Memos on the memo (`{memoId}`, a
compat overlay of Memos' `GridView.js`: the memos read again, that one
opened), as Calendar is opened on an event. And every command's db8
writes are read back before it says it is done (`commands.js` `run`:
what it put is there with the words, numbers and switches it wrote, what
it merged has them, what it deleted is gone); otherwise it says "I
couldn't save it to Memos: ..." with Copy It Instead and the app. Other
services' failures (`returnValue: false`) already fail the command with
their reason. `tools/test-assistant.cjs` runs each command that writes
(memos, events moved and cancelled, alarms, lists, tasks completed,
reminders, contacts, texts) on the simulated services and reads the
effect back from the store the app reads; it found a text to "555 0142"
going to "555".

**Permissions** (9 October 2026). On a device a command can only do what
luna-service2 and db8 let the service do; `permissions.test.ts` runs every
command through a recording stand-in and checks each Luna method against
the service's client permissions (`sysbus/org.webosphoenix.assistant.perm.json`)
by the called method's API group, and each db8 kind it reads, creates,
changes or deletes against its grants
(`public/configuration/db/permissions/org.webosphoenix.assistant`,
installed to `/etc/palm/db/permissions`). The groups of OSE's services are
from their own sysbus files (webosose: db8, activitymanager, sam,
com.webos.service.location, audiod-pro, com.webos.service.bluetooth2,
luna-sysservice); the ones for legacy names Phoenix answers on a device
(`com.palm.applicationManager`, `com.palm.telephony`, `com.palm.power`, ...)
and for Phoenix's own services are as listed in the test, to check on a
device. Found and fixed: no db8 grants at all; `location.query` /
`location.operation`, `audio.query`, `bluetooth.query`,
`systemsettings.query` / `.management`, `application.launcher` /
`.operation` missing; `vocabulary` not in the API file. Later added: `filemanager.operation` (`apps/files/service`'s group), the tethering and VPN services' groups (names to check on a device). In the simulator
(`tools/test-assistant.cjs`) every command runs on the simulated services
(none fails for want of a method) and each, turned off in Settings >
Assistant's Commands, is refused. The user's switches: Settings > Assistant
> Permissions (Location) and Commands (each command; what sends, calls or
deletes is read back whatever chose it).

**Help** (9 October 2026). "Help", "what can you do", "give me some
tips", "what can I say": what it can do by app (Phone & Messages, Email,
Calendar, Reminders, Tasks & Memos, Clock, Weather & Maps, Music & Photos,
Settings & Device, Answers, Using Phoenix), each with examples a tap puts
in the field, and first what fits now: the next event within three hours,
an unread message or email, a missed call, the time of day. "How do I
close an app / go back / switch apps / use Just Type / see my
notifications / set a passcode / take a screenshot", "what is Just Type":
an answer from the Help app's topic (`lib/lang/en-help.js`; a test checks
each answer's words against its topic) and Open Help on it.

**What it can do for each app** (9 October 2026): what a user would ask
Siri or Google Assistant of each built-in app, and where Phoenix stands.

| App | Done | Still missing (why) |
| --- | --- | --- |
| Phone | call a contact or number, call back, redial, who called, missed calls, voicemail count and call | answer or end a call by voice (a call in progress has its own screen; 2.0) |
| Messaging | send (read back), compose, read the last or the new ones, reply | read a whole conversation aloud; group messages |
| Email | send (read back), compose, find, unread count, read the latest (from someone), reply (read back) | forward, delete |
| Calendar | add (with place, invitees, repeats), what's on a day or week, next, find, move, cancel, free time; one day of a repeating event, or all of them | |
| Contacts | add, a number, email, address or birthday | edit or delete a contact; "call my wife" (relations) |
| Memos | new, find, add to one | delete one (undo covers a new one) |
| Tasks | add (lists made as needed), reminders, read a list, complete | delete or move a task |
| Clock | alarms (set, list, off, delete), timers, stopwatch, world time | (timers ring in the Assistant app, not the Clock) |
| Weather | now, at an hour, today, tomorrow, will it rain or snow, this week or weekend, anywhere | |
| Maps | directions, distances, places nearby, travel time by car, on foot or by bike | live traffic (no keyless source: it says so, gives the time without traffic and offers Maps) |
| Music | play an artist, album or song, pause, next, previous, what's playing (Music and Podcasts tell the system) | Videos does not tell the system what plays yet |
| Photos | photos by day, screenshots, how many, shown in the conversation; "photos of flowers" by album or file name, saying so | by what is in them, place or person (no labels or index of any) |
| Files | find files and folders by name (the file manager's new `search`) | find by what a file says (no content index) |
| Settings | Wi-Fi, Bluetooth, airplane mode, flashlight, ringer, Do Not Disturb, Location Services, rotation lock, hotspot, VPN, volume, brightness, any pane | USB tethering; choosing a VPN profile by name |
| Device | battery, storage, lock, screenshot | |
| Browser | search, open a site | bookmarks, reading a page aloud |
| Calculator, units | sums, percentages, units, currencies | |
| Marketplace | find an app, show it to install | install unasked (deliberately not: it asks on the app's page) |
| Help | what it can do, how-tos for Phoenix | |

**Connect model** (8 October 2026, from the owner: "there is the local
model option so I think the second button should just be connect model
and clicking that presents the options to choose local cloud or both").
While no cloud model is set up, an answer nothing here could give offers
"Search the web" and "Connect model" (with one set up, "Ask <model>" and
"Search the web", as before). Connect model asks which kind, in a small
sheet in the shell's view and a dialog in the app: an **on-device model**
(private and offline: Qwen3 0.6B comes with it, larger ones are 1.8 to
19 GB downloads), a **cloud model**
(Anthropic, OpenAI, Gemini or a compatible server, with the user's key),
or **both** (the on-device model first, as the router does; "Ask <cloud
model>" for what it cannot). The service's `connect` keeps the question on
the thread and opens Settings > Assistant at **Connect a Model** for that
kind (the download, or the providers with Allow cloud models to control
the device beside them, off); once a model is there, **Back to Your
Question** opens the Assistant app on the conversation and `retry` asks the
question again: the on-device model when there is one (unless the cloud
was chosen), else the cloud model, with which the conversation then goes
on. Decided on the owner's behalf: the shell's view closes as Settings
opens (Settings is an app card) and the conversation comes back in the
Assistant app, where it is kept.

**Finding out what it can do.** An empty conversation (the shell's view
and the app) shows a few things to ask, one of each kind of command
(events, the agenda, reminders, alarms, timers, notes, tasks, email, texts,
music, switches, brightness, conversions, weather, the time somewhere,
directions, photos, sums), a different few every five seconds. A tap puts
the words in the field to change or send rather than asking at once:
"Add a meeting with Sam tomorrow at 3" would otherwise make a meeting
nobody meant (decided on the owner's behalf). Words nothing understood and
no model answered get up to two requests close to them, by their words
("Did you mean something like 'add a meeting with Sam tomorrow at 3' or
'what's on my calendar tomorrow'?", `lib/lang/en.js` `SUGGESTIONS`), as
chips that go to the field too. Every example and suggestion is a request
the grammar takes as it stands (`grammar.test.ts`).

**Follow-up questions** (8 October 2026; `lib/followups.js`, the words in
`lib/lang/en.js` `followUp`). After a command makes something, the
assistant asks one short question about the most useful detail it still
lacks, instead of leaving it to the user, with answers to tap; a typed or
spoken answer works too (a spoken turn listens for it, as for a read-back).
The same service code serves the system view, the app, voice and the
models' tool calls.

| Made | Asked, most useful first (two at most per thing) | Answers offered |
| --- | --- | --- |
| Event | where; who's coming (when contacts have an email); how long (unless said); a reminder before | other events' places, the invitees' addresses, Video call; favourites and people of other events; 30 min / 1 hour / 2 hours; 10 min / 1 hour before |
| Reminder | when (if no time) | In 1 hour, This evening, Tomorrow morning (as said when answered) |
| Task | when it is due; which list (when put in the default one) | Today, Tomorrow, Next week; the other lists |
| Alarm | whether it repeats; what it is for | Every day, Weekdays, Weekends, Just once; other alarms' labels |
| Contact | the email or the number it lacks | (typed or said) |
| Memo | nothing (Memos has no tags, and its title is its first line) | |

Never what was said ("for 2 hours at Bistro Verde" asks neither). The
answer changes the real record through the same calls the command made
(db8 merge; the Tasks reminder and the Clock's activity rescheduled) and is
said back ("Got it, I've put Office as the place."). The questions are
conversation, naming the thing as people do ("Hey, where are you and Sam
meeting for your 3 o'clock tomorrow?", "Quick one about tomorrow's lunch:
should I remind you beforehand?"), two or three phrasings each, taken in
turn.

Not answered: when the view closes, the next words are another request, or
two minutes pass, the question is queued in the service's store (it
survives a restart). The activity manager wakes the service
(`followUpWake`, one activity at the next time anything is due, as webOS
services were woken). Decided for the owner, with these defaults: the
question goes out an hour after it was queued (for something sooner, half
an hour before it, but not within ten minutes of queueing), as a
notification with the same answers as buttons (two and Skip) and as a
message in the conversation the thing was made in, counted unread there
until it is opened; unanswered, once more four hours later, then dropped.
The user chooses these brackets in Settings > Assistant (the owner's
decision, 9 October 2026; settings `followUpFirst` / `followUpAgain`, in
minutes): First follow-up 15 minutes, 1 hour (default) or 3 hours; Second
follow-up off, 1 hour, 4 hours (default) or the next day (24 hours); with
no second, an unanswered notification goes after four hours. A change
applies to questions queued after it.
Never in the quiet hours (22:00 to 08:00, Settings), never with Do Not
Disturb on (tried again in 30 minutes) or in a call (in 10), and dropped
once the thing's time has passed, it is gone, or the user filled the
detail in themselves (the field changed since). With the screen off it is
posted silently and waits there for the unlock; on the lock screen it
shows the question without the answer buttons (the owner's choice: the
answers change your things, so they wait for the unlock; `DashboardItem`
gets no `actions` there, `tst_notifyoptions.qml`). A button applies the answer
without opening anything and says so in a banner; tapping the notification
opens the Assistant app on its conversation, where the question waits.
Where they live: the conversation the thing was made in (it reads best
with what was made just above), not one ongoing thread.

Restraint: two Skips on one thing end the questions about it. After three
Skips in a row of one kind (across things) it asks whether that kind helps
("I've been asking about where your meetings are. Is that helpful, or
should I stop asking?" Keep asking / Stop asking) and stops only on Stop
asking. Settings > Assistant has Follow-up questions (on by default), the
first and second follow-up's delay, the quiet hours, the questions waiting and Follow-up topics, a switch per kind
(one stopped shows off there). The app reads like a text chat: the bird is
the assistant's avatar beside its words and in the header, asking while a
question waits; the answers are quick replies. phoenix-sim: Simulate >
Assistant Follow-ups Now moves the service's clock on until one is sent;
`--scene followup`, `followupanswer`, `followuplater`, `followupaction`,
`followupchat`. On a device the notification is OSE's toast (no buttons;
it opens the Assistant on the question) until the device shell shows
Phoenix's notifications.

**Cloud models.** Four API shapes, raw HTTP, no SDKs
(`lib/providers.js`): Anthropic Messages (`POST /v1/messages`,
`x-api-key`, `anthropic-version: 2023-06-01`; `claude-sonnet-5-5` by
default, `claude-opus-5-5` and `claude-haiku-4-5-20251001` offered),
OpenAI Responses (`POST /v1/responses`; `gpt-5-mini` suggested), Gemini
`generateContent` (`gemini-2.5-flash` suggested) and Chat Completions for
any OpenAI-compatible server (Ollama, LM Studio, OpenRouter, vLLM,
llama-server). Every model field is the user's to type, or to pick from
the provider's own model list. They chat once set up; they get the
commands as tools only with **Allow cloud models to control the device**
(off by default, settable only by Settings), and a tool call from one
without it is refused. Whatever sends, calls or deletes is read back and
waits for Send / Call / Yes, whichever layer chose it.

**Where provider calls are made, and CORS.** The providers' APIs refuse
cross-origin requests from web pages (Anthropic's only with a
`dangerous-direct-browser-access` header), so a page's `fetch` cannot call
them. In phoenix-sim the service code runs in the page but its requests
go through the shell's own HTTP proxy (`/__phoenix/proxy`, Qt Network in
phoenix-sim's process; `tools/serve-rootfs.py` in the browser tests), the
same path DAV and the podcast feeds use: no CORS, and the key goes from
the service to the provider and nowhere else. On a device the service is
a Node.js Luna service (`apps/assistant/service/service.js`) with Node's
https. Streaming is not used in 1.0: an answer arrives whole.

**Keys.** Sealed with AES-GCM: in phoenix-sim under a non-extractable
WebCrypto key in IndexedDB (the clipboard's sealing, shared:
`webCryptoSealer`), on a device under a key file only the service can read
(`fileSecrets`). Pages get a key's last four characters at most. Honest
limit: in the simulator every app page runs the runtime, so a page of the
same origin could use the sealing key; the service only answers
`ask`/`choose`/`confirm` for the system UI, the Assistant app and
Settings, and provider changes only for Settings. On a device the
Phoenix key store (SYNERGY.md) replaces the key file.

**On-device models** (`lib/models.js`; Apache-2.0, SHA-256 from Hugging
Face, checked after download). All the Qwen team's own GGUFs
(huggingface.co/Qwen, pinned revisions; 9 October 2026, the owner's
decision), one per size, the smallest quantization they publish:

| Model | File | Size | Device memory (`ram`) | For |
| --- | --- | --- | --- | --- |
| Qwen3 0.6B (built in) | Qwen3-0.6B-Q8_0.gguf | 639 MB | 3 GB (1.8 GB while it runs) | every device; the only one at 4 GB or less |
| Qwen3 1.7B | Qwen3-1.7B-Q8_0.gguf (their only quant) | 1.8 GB | 6 GB | 6 GB phones |
| Qwen3 4B | Qwen3-4B-Q4_K_M.gguf | 2.5 GB | 8 GB | 8 GB phones and tablets |
| Qwen3 8B | Qwen3-8B-Q4_K_M.gguf | 5.0 GB | 12 GB | 12-16 GB devices |
| Qwen3 14B | Qwen3-14B-Q4_K_M.gguf | 9.0 GB | 16 GB | 16 GB devices and computers |
| Qwen3 30B-A3B (3B active) | Qwen3-30B-A3B-Q4_K_M.gguf | 18.6 GB | 32 GB | computers with 32 GB or more |

Settings shows each one's size and memory, marks what is too big for this
device, and recommends the largest that fits (a device sold as 8 GB
reports a little less, so 15% of room is allowed; a test checks the
recommendation from 4 GB to 64 GB). Downloads stay optional.

**Where a model comes from** (the owner's rule, October 2026): the Qwen
team's own GGUF when they publish one; otherwise Phoenix's conversion of
the Qwen team's own weights at a pinned revision. The newest official
GGUFs are Qwen3's (May 2025); Qwen3.5 (2B, 4B, 9B), Qwen3.6 35B-A3B and
Qwen3.8 27B (2026) have only safetensors from Qwen (checked 9 October
2026), so `lib/models.js` lists them with their weights, and they are
offered once a conversion is recorded:

| Model | Replaces | Quant | Memory | Weights |
|---|---|---|---|---|
| Qwen3.5 2B | Qwen3 1.7B | Q8_0 | 6 GB | 4.5 GB |
| Qwen3.5 4B | Qwen3 4B | Q4_K_M | 8 GB | 9.3 GB |
| Qwen3.5 9B | Qwen3 8B | Q4_K_M | 12 GB | 19.3 GB |
| Qwen3.8 27B (dense; offered, not recommended: slow) | - | Q4_K_M | 32 GB | 55.6 GB |
| Qwen3.6 35B-A3B | Qwen3 30B-A3B | Q4_K_M | 32 GB | 71.9 GB |

- `tools/convert-model.sh` converts one: llama.cpp at `./phoenix`'s
  `LLAMA_COMMIT` (`convert_hf_to_gguf.py` to bf16, `llama-quantize`, text
  only), then `llama-gguf-split` into parts under 2 GiB (a GitHub
  release's limit). It writes the entry `tools/models-converted.py add`
  records in `lib/models-converted.js` (files, sizes, SHA-256, the
  weights' revision). Checked here on Qwen3.5 0.8B: converted, run by our
  llama-server, a clean tool call.
- `.github/workflows/models.yml` (Actions > models > Run workflow, convert)
  does that on a runner for every model still wanted whose weights fit its
  disk (up to 25 GB: the three Qwen3.5), publishes each as the release
  `models-<id>` of this repository and opens a pull request recording
  them. The 27B and 35B-A3B need some 150-200 GB free: the script on a
  computer with that, the parts uploaded to the release by hand. Every
  Monday it also looks for an official GGUF of each, and fails when one
  appears so it can be added ahead of ours.
- A download tries each source in order until one comes whole, every file
  checked against its SHA-256 (`lib/node-device.js`; the simulator's
  `shell/native/localmodels.cpp`); a model in parts is kept as
  `<id>-00001-of-0000N.gguf`, the names llama.cpp loads the rest by.
  Settings says "converted by Phoenix from Qwen's weights" for ours. A
  newer model hides the one it replaces once it can be downloaded, unless
  that one is installed.

Qwen3-Next-80B-A3B-Instruct has an official GGUF but is
48 GB, beyond these tiers. Llama 3.2 was left out (its licence is not
permissive); Qwen2.5 3B too (Qwen Research License). `llama-server` is
found on the PATH or given (`phoenix-sim --llama-server <path>`); the
setup scripts install it (below), and on a device meta-phoenix's
`llama-cpp` recipe does. It stops after five idle minutes to give the
memory back.

**Speech** (`org.webosphoenix.tts`: `speak {text, lang?, voice?}`,
`stop`, `getStatus` -> `{available, engine, voices}`). Qt's TextToSpeech
module is not part of the Qt installs Phoenix builds with, and
QtWebEngine's `speechSynthesis` has no voices (it needs speech-dispatcher,
which Qt's builds do not use), so the shell runs a speech program with the
text on its input. Since 9 October 2026 (the owner's decision) that is
**Kitten TTS**: `phoenix-tts` (`services/tts`, C++), KittenML's nano 0.2
model (15 million parameters, 24 MB, eight voices, 24 kHz) on ONNX
Runtime, which it loads at run time (its C API, version 16 or later), as
the wake word loads libvosk. It speaks sentence by sentence (the first is
heard while the next is made) through PulseAudio, else ALSA (both loaded
when needed), or Audio Queue Services on a Mac; it writes one line on
its standard error, which phoenix-sim's log shows ("phoenix-tts: Kitten
TTS ..., voice expr-voice-3-f, 2 sentences, 9.8 s of speech; first sound
after 1.97 s ..., real-time factor 0.32; dictionary phonemes; ALSA").
Where it cannot speak (no model or ONNX Runtime: exit status 3; no sound
output: 4), and for languages other than English, the programs before it
take the same words: `espeak-ng` (GPL-3.0, run as a separate program,
never linked) where it is installed, `say` on a Mac, else Flite
(BSD-3-Clause, English only); or `--speech-command` (Piper, for
instance; `%l` the language, `%v` the voice). The device service does the
same (`lib/node-device.js` `speech`). A browser page with voices uses
`speechSynthesis`. Answers are spoken when **Speak answers** is on (on by
default).

*Phonemes.* Kitten reads phonemes, not letters: it was trained on
espeak-ng's IPA (en-us, stress marks, punctuation kept, as the Python
`phonemizer` writes it), and KittenML's own code runs espeak-ng's library.
espeak-ng is GPL-3.0, which the image avoids (below), so `phoenix-tts`
makes those phonemes itself by default: the CMU Pronouncing Dictionary
(BSD-2-Clause, 135,000 words) turned into espeak's en-us IPA by rules
(`services/tts/src/phonemes.cpp`: stress before the vowel, the flapped t,
reduced vowels, small words as espeak says them in a sentence, "the" and
"to" before a vowel), letter-to-sound rules for words it lacks, and
numbers, times, money, units and abbreviations as words. Against
espeak-ng on 515 sentences of these docs it differs in 8% of phoneme
characters (5% without the stress marks); spoken by Kitten and
transcribed by whisper base.en, 30 assistant answers came out with 3.1%
of words wrong either way (the same eight, all "ten" written "10" and the
like). `--phonemizer espeak` uses the espeak-ng program instead, as a
program of its own run for each stretch between punctuation marks: that
is an aggregate, not a derived work, and it is opt-in.

*The voice.* Kitten has eight voices (KittenML's names for them in its
0.8 model: Bella, Jasper, Luna, Bruno, Rosie, Hugo, Kiki, Leo). Chosen
without listening, by measure: Luna (`expr-voice-3-f`) has the darkest
tone of the women's voices (spectral centroid about 1,400 Hz against
1,400-1,900), a mid pitch (about 230 Hz) and an unhurried pace, and
whisper understood all eight equally. It is the default; **Settings >
Assistant > Voice** offers the others (`speechVoice`) with **Play
Sample**, where the engine has voices (not with Flite or espeak-ng).

*Speed.* On this simulator's computer (4 cores of a 2.3 GHz Xeon, one
thread for Kitten: more did not help a model this small, and ONNX
Runtime's graph optimizations cost more to load, 0.7 s, than they saved,
so they are off): a real-time factor of 0.3 (a 3 s sentence in 0.9 s),
0.3-0.5 s to load the model, the first sound 1-2 s after the words
arrive for a typical answer; `phoenix-tts --check` (what Speech asks
first) takes 40 ms. A phone's Cortex-A76 class core should be about half
as fast (0.6, still faster than real time); a slower A55 class core about
real time, where the sentence-by-sentence playing keeps the first words
prompt. Not measured on a device yet.

**What's installed where** (8 October 2026). The command grammar needs
nothing extra. Everything else is a program or a model beside Phoenix,
installed by the setup scripts on a computer and by meta-phoenix's
`packagegroup-phoenix-assistant` in `webos-phoenix-image`:

| Part | Simulator on a Mac (`scripts/mac-setup.sh`) | Simulator on Linux (`scripts/linux-setup.sh`) | Device image (meta-phoenix) | Licence |
| --- | --- | --- | --- | --- |
| Speech recognition: `whisper-cli` | Homebrew `whisper-cpp` | Built from whisper.cpp `d09f61a` into `/usr/local/bin` (3 MB) | `whisper-cpp` (static) | MIT |
| Its model, `ggml-base.en.bin` (148 MB) | `build/whisper` (`tools/get-whisper-model.py`) | `build/whisper` | `whisper-cpp-model-base-en`, in the image, `/usr/share/whisper` | MIT (OpenAI's Whisper weights) |
| On-device model runner: `llama-server` | Homebrew `llama.cpp` | Built from llama.cpp b11239 into `/usr/local/bin` (15 MB) | `llama-cpp-server` (static, b11239) | MIT |
| The larger language models (1.8 to 19 GB) | Downloaded in Settings > Assistant | Same | Same, into `/media/internal/.phoenix/models` | Apache-2.0 (Qwen) |
| Wake word: `phoenix-wakeword` | Built with phoenix-sim | Built with phoenix-sim | `phoenix-shell` | Apache-2.0 (Phoenix) |
| Wake word: libvosk | `build/wakeword` (`tools/get-wakeword.py`, 13 MB) | `build/wakeword` (26 MB) | `libvosk`, prebuilt from Alpha Cephei's PyPI wheels (x86-64, aarch64, armv7) | Apache-2.0; Kaldi, OpenFST Apache-2.0; OpenBLAS, CLAPACK BSD-3-Clause |
| Wake word: `vosk-model-small-en-us-0.15` (40 MB download, 71 MB) | `build/wakeword` | `build/wakeword` | `vosk-model-small-en-us`, in the image, `/usr/share/phoenix/wakeword` | Apache-2.0 |
| The built-in language model: Qwen3 0.6B Q8_0 (639 MB) | `build/models` (`tools/get-base-model.py`) | `build/models` | `qwen3-0.6b-gguf`, in the image, `/usr/share/phoenix/models` (`PHOENIX_BASE_MODEL`) | Apache-2.0 (Qwen) |
| The voice: `phoenix-tts` | Built with phoenix-sim | Built with phoenix-sim | `phoenix-shell` | Apache-2.0 (Phoenix); its `onnxruntime_c_api.h` MIT |
| Kitten TTS nano 0.2 (24 MB) | `build/kitten` (`tools/get-kitten.py`) | `build/kitten` | `kitten-tts-nano`, in the image, `/usr/share/phoenix/kitten` | Apache-2.0 (KittenML: code, weights and voices) |
| The CMU Pronouncing Dictionary (3.6 MB) | `build/kitten` | `build/kitten` | `cmudict`, `/usr/share/phoenix/kitten` | BSD-2-Clause |
| ONNX Runtime 1.30 (29 MB) | Homebrew `onnxruntime` | `build/kitten` (Microsoft's build, 11 MB download) | `onnxruntime`, Microsoft's build (x86-64, aarch64; `PHOENIX_KITTEN`) | MIT |
| Spoken answers when Kitten cannot | `say` (part of macOS) | `espeak-ng` (apt) | `flite` (meta-multimedia; `PHOENIX_TTS` to change) | Flite BSD-3-Clause; espeak-ng GPL-3.0 |

Each setup script installs all of it by default, skips what is already
there, checks downloads against their SHA-256 (or a pinned git commit),
and leaves it out with `--no-assistant`. On a Mac it is about 900 MB of
models plus the three Homebrew packages; on Linux about 980 MB, and a few
minutes to build the two programs (the voice is about 40 MB of it, the
built-in model 639 MB).

In the image, by device class (HARDWARE.md: 4 GB is the practical
minimum): whisper's base.en and the Vosk model ship in the image, since
dictation and "Hey Phoenix" must work offline from the first boot and
together they take about 220 MB of storage, which every supported device
has; tiny.en (78 MB, about twice as fast, less exact) is the choice to
make for a 2-3 GB community device. Qwen3 0.6B (639 MB, 1.8 GB of memory
while it runs, stopped after five idle minutes) ships too, so the
Assistant answers what its commands miss offline from the first boot;
the larger models are 1.8 to 19 GB, the right one depends on the memory
(Settings offers what fits), and are downloads. Kitten TTS is the image's
voice (with its dictionary and ONNX Runtime, about 57 MB, all
permissive), and Flite its fallback, because both are permissive; armv7
devices have no prebuilt ONNX Runtime and speak with Flite. espeak-ng (more languages)
is GPL-3.0, which docs/LEGAL.md allows only as a separate program with its
own licence and source offer, and GPL-3.0 also asks a device maker who
locks the bootloader to give the user a way to install a changed version.
So it is the owner's choice per image, not the default. Piper is no way
round that: even the original MIT `rhasspy/piper` phonemizes with
espeak-ng's library (`piper-phonemize`). OSE's own
`com.webos.service.tts` (meta-webos) is a Google Cloud Text-to-Speech
client (it builds against googleapis and gRPC), so it is not used.

When a part is missing the assistant says so instead of failing
silently: phoenix-sim logs one line per missing part with how to get it,
and Settings > Assistant lists them under Voice (service method `voice`:
the simulator's from what phoenix-sim found at start, the device's from
the transcriber, the wake word's files and the speech program, Kitten
TTS first; on a device the hint names the meta-phoenix package). The
on-device model's note says how to get `llama-server`.

**Where it shows.** Holding the launcher button opens the system view
(its heading says "Assistant": Phoenix is the UI's version name):
the conversation in use over a blurred backdrop, a text field and the
microphone (`AssistantOverlay.qml`). The Assistant app has the
conversations (new, open, delete). Both show the same thread through the
service; each thread and message is its own stored key.

The app is laid out as a TouchPad (Enyo 1.0) app, with `@phoenix/ui`'s
`SlidingPanes` (after Enyo's `SlidingPane`): wider than 500 px,
Conversations (320 px) at the left and the conversation beside it, which
can be dragged over the list and back (its edge, or the grip in its
compose bar); narrower, the conversation slides in over the list and Back
shows the list. It follows the card's width live (the simulator's adaptive
layout, a rotation). Each conversation is titled by its first request;
New in the list's toolbar starts one; swipe one across to delete it. Hold
a conversation or a message, or right-click it, for its menu (Open, Open
in New Card, Delete; Open in New Card, Copy). **Open in New Card** opens
that conversation in another card of the app, in a stack of its own
(`applicationManager/launch {id, params: {conversationId}, newCard: true}`):
several conversations at once, side by side in card view. Each card keeps
to its own conversation (the one in use only decides what a card shows
first); all follow the one store, so a message sent in one card shows at
once in the others' lists. A conversation slid out of sight does not mark
its follow-ups read. Tests: `apps/assistant/src/App.test.tsx`,
`apps/shared/phoenix-ui/src/panes.test.tsx`, `tools/test-assistant.cjs`
(phone and tablet, two cards).

**In 2.0** the same assistant grows into the agent this document plans:
the MCP hub behind it, language models (local or a provider) for open
questions and multi-step tasks, memory, Settings > Assistant with
providers. The 1.0 intents stay as the fast, offline path (the "short
command" row of Routing).

A plan for three things (2.0, except where the table above says 1.0):

1. an **MCP layer**, so that an AI client can use every app and the OS
   through the Model Context Protocol;
2. an **on-device assistant**, an app and a system service that uses that
   layer to act on the device and answer questions;
3. **Bring your own LLM**, a Settings page to plug in the model you like,
   from a cloud provider, a machine on your network, or the phone itself.

This is a plan, not a status report: apart from the 1.0 assistant above,
none of it is built. Facts are as of
28 September 2026 and each has a source at the end. Where we could not
check something it says *unverified*. Performance figures for Phoenix's
devices are **estimates** until measured on them.

## Summary

- **One MCP hub for the whole device**: a Luna service,
  `org.webosphoenix.mcp`, that serves OS tools itself and collects the tools
  apps declare in their `appinfo.json`. Every call goes through one policy
  engine (grants, confirmations, rate limits, audit log). Apps never talk
  MCP to clients directly.
- **Target MCP 2026-07-28**, the current revision: stateless, no
  `initialize` handshake, results carry `resultType`, user input through
  Multi Round-Trip Requests. Accept 2025-11-25 clients too, since many
  clients will lag.
- **Transports**: Luna (on the device, access controlled by OSE's ACG), a
  stdio program (`phoenix-mcp`) that also works over SSH from a Mac, and
  later Streamable HTTP on the LAN, paired with a QR code and OAuth 2.1.
- **Confirm on the phone, in webOS style**: a popup alert for anything that
  sends, spends, deletes or changes a setting; a dashboard while the
  assistant works in the background; a banner when it is done; an activity
  log in Settings.
- **The assistant is an MCP client** of the hub like any other. Its model
  comes from a provider adapter: Anthropic, OpenAI, Google, any
  OpenAI-compatible endpoint (Ollama, LM Studio, llama.cpp's server, vLLM),
  or llama.cpp on the device, which is just another OpenAI-compatible
  endpoint on localhost.
- **Honest about local models**: on a Raspberry Pi 4 a local model is too
  slow for chat (1 to 2 tokens/s for 1B to 3B models); on an 8 GB
  Snapdragon 845 phone a 2B model should be usable (estimate). Default to
  "cloud or LAN model for conversation, local model for short commands and
  offline".
- **Prompt injection is designed in, not bolted on**: content from the web,
  email, messages and files is untrusted; once it is in the context,
  consequential tools need a confirmation even if pre-approved, and sending
  data to a recipient the user did not name is blocked.

## Background

### MCP in September 2026

The current revision is **2026-07-28** (released 28 July 2026, release
candidate 21 May 2026). The previous one, 2025-11-25, is what many clients
still speak. What matters for Phoenix:

| Topic | 2026-07-28 | Consequence for Phoenix |
| --- | --- | --- |
| Sessions | Removed: no `initialize` / `initialized`, no `Mcp-Session-Id`. Each request carries its protocol version and client capabilities in `_meta` | The hub is a stateless request handler, which suits Luna calls. Cross-call state is an explicit handle passed as a tool argument |
| Discovery | `server/discover` is mandatory: versions, capabilities, identity | Implement it; clients may probe with it over stdio |
| Server-to-client requests | Replaced by **Multi Round-Trip Requests** (MRTR): the server returns `resultType: "input_required"` with `inputRequests`; the client retries with `inputResponses` | Used for elicitation (asking the user to pick a contact, fill a field) |
| Tools | `tools/list`, `tools/call`; JSON Schema 2020-12 input and output schemas; `structuredContent`; deterministic order; `ttlMs` and `cacheScope` on list results | One tool per action; list in a stable order |
| Tool annotations | Hints such as read-only or destructive. Clients **must** treat annotations as untrusted unless the server is trusted | The hub decides risk itself; app-declared hints can only raise it |
| Resources, prompts | Still core; `resources/subscribe` replaced by one `subscriptions/listen` stream | Contacts, calendar, messages, memos as resources; prompts as Just Type quick actions |
| Elicitation | Form mode (flat schemas, no secrets) and URL mode (secrets, OAuth, payment) | Form mode for choices; never ask for a password in a form |
| Deprecated | **Sampling, Roots, Logging** (SEP-2577), the old HTTP+SSE transport, Dynamic Client Registration (in favour of Client ID Metadata Documents) | Do not build on sampling: the assistant calls its LLM directly |
| Transports | stdio (newline-delimited JSON-RPC) and Streamable HTTP (a POST per message, JSON or a request-scoped SSE stream). Custom byte-stream transports **should** reuse the stdio framing | Luna and Unix socket transports reuse stdio framing |
| HTTP security | Servers **must** validate `Origin` (DNS rebinding), **should** bind to localhost when local, **should** authenticate; `MCP-Protocol-Version`, `Mcp-Method`, `Mcp-Name` headers required | The LAN listener is off by default and always authenticated |
| Authorization | OAuth 2.1 for HTTP transports: Protected Resource Metadata (RFC 9728) is required, resource indicators (RFC 8707), PKCE, `iss` validation (RFC 9207). stdio **should not** use it and takes credentials from the environment | The phone is its own authorization server for LAN clients |
| Extensions | Formal framework. **Tasks** (long-running calls, polled with `tasks/get`) and **MCP Apps** (`io.modelcontextprotocol/ui`: HTML tool UIs in a sandboxed iframe, `ui://` resources, since 26 January 2026) | Tasks for slow tools (transcription, sync); MCP Apps later, to show tool results as cards |
| SDKs | Tier 1 SDKs updated for 2026-07-28: TypeScript, Python, Go, C#; Rust in beta | The hub is Node.js on the TypeScript SDK, like Files' and Voice Memos' services |

The spec's own security advice for tools matches what we want anyway: a
human in the loop who can deny calls, visible indicators when a tool runs,
confirmation for sensitive operations, showing tool inputs before the call,
timeouts, rate limits and an audit log.

### How other mobile systems expose app actions

| System | Mechanism | Who may call | Notes |
| --- | --- | --- | --- |
| **Android** | **AppFunctions** (Android 16+): Kotlin functions marked `@AppFunction` in an `AppFunctionService`; the Jetpack library generates an XML schema that the OS indexes | Callers holding `EXECUTE_APP_FUNCTIONS` (agents, assistants such as Gemini). During the experimental phase only a few apps and system agents get the whole pipeline | Google calls them "the mobile equivalent of tools within MCP", running locally in the app. Jetpack library in alpha (1.0.0-alpha10 in July 2026, *per a secondary source*); Gemini integration in private preview |
| **iOS / macOS** | **App Intents**. WWDC26 added app schemas, entity schemas (app content in the Spotlight semantic index, for Siri's personal context) and a View Annotations API (on-screen awareness) | Siri, Shortcuts, Spotlight | The Foundation Models framework gives apps the on-device model and, per Apple's WWDC26 guide, other providers too |
| **Legacy webOS** | Just Type's `universalSearch` in `appinfo.json` (actions and db8 searches), app launch params, and Luna services with a permission check on the caller | Just Type and apps allowed by the service | Phoenix already implements these ([APP-RUNTIME.md](APP-RUNTIME.md#just-type)) |

The lesson: both big platforms put **a declaration in the app package**,
**an OS index**, and **a privileged caller permission** in front of the
functions. Phoenix does the same, with MCP as the wire format, and gets a
head start from what webOS apps already declare.

## Part 1: the MCP layer

### Architecture

```
                MCP clients
   +--------------+   +---------------------+   +-----------------------+
   | Assistant    |   | phoenix-mcp (stdio) |   | Claude Code / Desktop |
   | service      |   | in Terminal, or     |   | on the user's Mac     |
   | (on device)  |   | over SSH from a Mac |   | (Streamable HTTP, LAN)|
   +------+-------+   +----------+----------+   +-----------+-----------+
          | Luna rpc             | Unix socket              | HTTPS + OAuth
          v                      v                          v
   +--------------------------------------------------------------------+
   |  org.webosphoenix.mcp  (the hub, Node.js, TypeScript MCP SDK)      |
   |                                                                    |
   |  transports -> client identity -> policy engine -> tool router     |
   |                 (appId / token)   grants, confirm,   |             |
   |                                   rate limit, taint, |             |
   |                                   audit log          |             |
   |  registry: OS tools + app manifests + universalSearch-derived      |
   +------+-------------------+--------------------+--------------------+
          |                   |                    |
          v                   v                    v
   Luna services         db8 (resources,      app pages (web apps that
   (SAM, settings,       read with the        register tools through
   wifi, telephony,      hub's own            window.phoenixMcp while
   audio, files, ...)    permissions)         they run)
          |
          v
   shell: popup alert / dashboard / banner for confirmations and progress
```

**Why one hub, not an MCP server per app.** Clients would otherwise need to
find and connect to dozens of servers, each app would have to implement MCP
and its own security, and the user would have no single place to see and
revoke what an AI may do. The hub is also the only component that needs the
broad Luna permissions; apps keep theirs.

### The hub service: `org.webosphoenix.mcp`

- **Language and runtime**: Node.js with `webos-service`, started on demand
  by OSE's `run-js-service` and installed by `tools/install-rootfs.py`, the
  same as `apps/files/service` and `apps/voicememos/service`. MCP logic uses
  the official TypeScript SDK (Tier 1 for 2026-07-28). OSE 2.27 upgraded
  Node.js to 20.12.2; the version in 2.28 and the SDK's minimum Node
  version are *unverified*.
- **Luna API** (ACG group `mcp.client`, `trustLevel` `oem` for system
  clients):
  - `rpc {message}`: one MCP JSON-RPC request in, one result out (with
    `subscribe: true`, progress notifications arrive as extra replies,
    then the final result). This is the stdio framing carried in Luna
    messages, as the spec suggests for custom transports.
  - `listen {types}`: the `subscriptions/listen` stream (tool list changes
    as apps are installed, resource updates from db8 watches).
  - `grants`, `setGrant`, `auditLog`, `pair`, `revoke`: for Settings.
- **The registry** is rebuilt when apps are installed or removed (SAM's
  app list subscription) from: the OS tool set (below), each app's `mcp`
  manifest, Phoenix overlay manifests for original apps, and tools derived
  from `universalSearch`.
- **Simulator**: a block "MCP" in `runtime/phoenix-runtime.js` answers the
  same Luna methods against the simulated services, like every other
  Phoenix service. `phoenix-sim --mcp-stdio` bridges stdin/stdout to it, so
  Claude Code on a Mac can drive the simulator; that is also how we test the
  hub end to end.

### OS tools

Tool names use dots (allowed by the spec): `os.<area>.<verb>`. Every tool has
a **risk class**, assigned by the hub, that decides the default policy.

| Risk class | Meaning | Default for the assistant | Default for a remote client |
| --- | --- | --- | --- |
| `read` | Reads non-personal state (battery, Wi-Fi status, app list) | Allow | Allow after pairing |
| `personal-read` | Reads personal data (contacts, messages, calendar, location, files) | Ask once per data class | Ask once per data class |
| `local-write` | Changes something on the device that is easy to undo (open an app, set volume, create a task) | Allow, show in the dashboard | Ask once per tool |
| `settings` | Changes a setting or radio (Wi-Fi, Bluetooth, airplane mode, brightness) | Allow for "on"; ask for "off" of a radio the client is connected through | Ask once per tool |
| `outbound` | Sends something off the device or to a person (SMS, email, call, post to a URL) | **Confirm every time** (can be relaxed per recipient, never for new recipients) | Confirm every time |
| `destructive` | Deletes or overwrites user data, uninstalls, factory reset | **Confirm every time**; factory reset is not a tool | Confirm every time |
| `developer` | Shell commands, installing packages, reading system logs | Not available unless Developer Mode is on; then confirm every time | Same |

| Area | Tools (first set) | Backed by | Risk |
| --- | --- | --- | --- |
| Apps | `os.apps.list`, `os.apps.launch {appId, params}`, `os.apps.close`, `os.apps.running` | SAM `com.webos.applicationManager` (`listApps`, `launch`, `close`, `running`) | read, local-write |
| Cards | `os.cards.list`, `os.cards.focus`, `os.cards.minimize` | the shell (a small Luna API on the compositor side, M1 work) | read, local-write |
| Notifications | `os.notifications.list`, `os.notifications.post {title, message}`, `os.notifications.dismiss` | `com.webos.notification` and the shell's notification model | personal-read, local-write |
| Settings | `os.settings.get {key}`, `os.settings.set {key, value}` for an allow-list of keys (brightness, screen timeout, volume, rotation lock, wallpaper, time format) | `com.webos.settingsservice`, system service `setPreferences`, `com.webos.service.audio` | read, settings |
| Radios | `os.wifi.status`, `os.wifi.setEnabled`, `os.wifi.scan`, `os.wifi.connect {ssid}` (known networks only), `os.bluetooth.*`, `os.airplane.set` | `com.webos.service.wifi`, `bluetooth2`, `connectionmanager` | read, settings |
| db8 | `os.db.find {kind, where, limit}` on kinds the client was granted; no `put` or `del` (writes go through app tools) | `com.palm.db` | personal-read |
| Activities | `os.activities.list`, `os.reminders.create {when, text}` | `com.palm.activitymanager` (as Tasks' reminders) | read, local-write |
| Files | `os.files.list`, `os.files.read {path, maxBytes}`, `os.files.write` (under `/media/internal` only), `os.files.remove` | `org.webosphoenix.filemanager` | personal-read, local-write, destructive |
| Media | `os.media.play`, `pause`, `next`, `nowPlaying`, `os.volume.set` | Music's service, `com.webos.service.audio` | read, local-write |
| Telephony | `os.phone.call {number}`, `os.phone.hangup`, `os.sms.send {to, text}`, `os.calls.recent` | `com.palm.telephony`, `org.webosports.service.messaging` ([APP-RUNTIME.md](APP-RUNTIME.md#phone-and-messaging)) | outbound, personal-read |
| Location | `os.location.get {accuracy}` | `com.webos.service.location` | personal-read |
| Device | `os.device.info`, `os.battery.status`, `os.screenshot` (returns an image of the front card) | system service `deviceInfo`, `com.palm.power` | read, personal-read (screenshot) |
| Developer | `os.shell.exec {command, timeout}` | the Terminal's PTY service ([TERMINAL.md](TERMINAL.md)) | developer |

Not tools, on purpose: factory reset, changing the passcode, reading the
key store, turning Developer Mode on, granting permissions, and anything in
Settings > Assistant itself. An AI must not be able to widen its own access.

### Per-app tools: the `mcp` section of `appinfo.json`

Apps declare tools, resources and prompts next to the `universalSearch` and
`phoenix` fields they already have. Three kinds of handler cover every app
Phoenix runs:

```json
"mcp": {
    "tools": [
        {
            "name": "create_task",
            "title": "New task",
            "description": "Create a task in a list, optionally with a due date and a reminder.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "title": { "type": "string" },
                    "due": { "type": "string", "format": "date-time" },
                    "list": { "type": "string", "description": "List name; the default list if omitted" }
                },
                "required": ["title"],
                "additionalProperties": false
            },
            "risk": "local-write",
            "handler": { "luna": "luna://org.webosphoenix.tasks.service/createTask" }
        },
        {
            "name": "show_task",
            "description": "Open a task in the Tasks app.",
            "inputSchema": { "type": "object", "properties": { "taskId": { "type": "string" } }, "required": ["taskId"] },
            "risk": "local-write",
            "handler": { "launch": { "params": { "taskId": "{taskId}" } } }
        },
        {
            "name": "selected_text",
            "description": "The text selected in the front Tasks card.",
            "inputSchema": { "type": "object", "additionalProperties": false },
            "risk": "personal-read",
            "handler": { "page": true }
        }
    ],
    "resources": [
        {
            "uriTemplate": "phoenix://tasks/{_id}",
            "name": "Tasks",
            "mimeType": "application/json",
            "db8": { "kind": "com.palm.task:1", "fields": ["title", "due", "completed", "notes"] },
            "risk": "personal-read"
        }
    ],
    "prompts": [
        { "name": "plan_my_day", "title": "Plan my day", "description": "Today's tasks and events, ordered by time and priority" }
    ]
}
```

| Handler | How the hub runs it | For |
| --- | --- | --- |
| `luna` | Calls the Luna method with the arguments as its payload, **as the app** (the hub asks luna-service2 to check the app's own ACG permissions for that method, so declaring a tool cannot reach more than the app can) *(how to call on behalf of an app in luna-service2 is unverified; fall back to an allow-list of the app's own service names)* | Apps with a Luna service (Files, Voice Memos, DAV, Tasks) |
| `launch` | Launches the app, or relaunches it, with the params (placeholders filled from the arguments), and returns once the card is up | Every app that takes launch params, including the original apps |
| `page` | Sends the call to the app's running page through `window.phoenixMcp` (see below) and waits for its answer; if the app is not running, the tool is listed but reports "open the app first" | Web apps and PWAs whose logic lives in the page |

The hub checks every manifest when it loads it: schemas must be valid
JSON Schema 2020-12, names must follow the spec's character rules, the tool
is exposed to clients as `<appId>.<name>` (so `org.webosphoenix.tasks.create_task`),
and `risk` can be raised but never lowered below what the hub infers from
the handler (a `luna` handler that calls telephony is `outbound` whatever
the manifest says).

**The page API.** `runtime/phoenix-runtime.js` (in the simulator) and a
small injected script on the device add:

```ts
window.phoenixMcp.registerTool("selected_text", async (args, ctx) => {
    return { content: [{ type: "text", text: getSelection().toString() }] };
});
```

It only accepts names the app's manifest declares, so a page cannot invent
tools at runtime. `@phoenix/luna` gets a typed wrapper
(`useMcpTool(name, handler)` in `@phoenix/luna/react`).

**Original webOS apps.** `third_party` stays unmodified, as elsewhere in
Phoenix. Their manifests are overlay files,
`compat/rootfs/usr/share/phoenix/mcp/<appId>.json`, with `launch` and
`luna` handlers against what the apps and their services already accept
(for example Email's compose params, as Voice Memos already uses them to
share, and the calendar and contacts db8 kinds as resources). The exact
launch params of each original app have to be catalogued from their
sources; we have not done that yet.

**Tools for free from Just Type.** Every `universalSearch.action` becomes a
tool (`new_voice_memo {text}` from Voice Memos' "New Voice Memo") and every
`dbsearch` a search tool (`search_voice_memos {query}`) with the same db8
query and display fields, marked `personal-read`. Apps can turn this off
with `"mcp": {"fromUniversalSearch": false}`.

### Resources and prompts

- **Resources** are db8 records and files, addressed `phoenix://<area>/<id>`
  (`phoenix://contacts/...`, `phoenix://calendar/...`,
  `phoenix://messages/<thread>`), plus `file:///media/internal/...` for
  files. The hub reads db8 **with its own permissions** and returns only the
  fields a manifest lists, so a client never gets whole records it did not
  ask for (no `_rev`, sync ids or account credentials). Resource templates
  let clients read one record without listing all of them.
- **Data classes** group resources for grants: Contacts, Calendar, Messages,
  Email, Call log, Location, Photos, Files, Notes and memos, Tasks,
  Health (later). The user grants a class, not a kind.
- **Prompts** are user-invoked templates, not tools. Phoenix shows them in
  Just Type's Quick Actions ("Plan my day", "Summarize unread email") and in
  the assistant card's menu.

### Transports

| Transport | Who uses it | Identity | Default |
| --- | --- | --- | --- |
| **Luna** (`org.webosphoenix.mcp/rpc`) | The assistant service, other on-device apps and services | The caller's app or service id from luna-service2, checked by ACG (`mcp.client` group) | On, for system apps only |
| **Unix socket** `/run/phoenix/mcp.sock` + the `phoenix-mcp` program (stdio framing) | Command-line clients on the device; **a Mac over SSH**: `ssh phone phoenix-mcp` | The Unix user (peer credentials); over SSH, the SSH key | On when Developer Mode is on |
| **Streamable HTTP** `https://<device>.local:8443/mcp` | Claude Code, Claude Desktop (through a local bridge) or any MCP client on the LAN | OAuth 2.1 access token from pairing | Off; turned on per pairing |

**The SSH route is the first remote route to build.** Claude Code, Claude
Desktop and most MCP clients can start a stdio server from a command line,
and the command can be `ssh`. It needs no TLS certificates, no OAuth and no
new listener; authorization is the user's SSH key, which Developer Mode
already asks for ([TERMINAL.md](TERMINAL.md#security-model)). In the
stdio case the spec says to take credentials from the environment, which
is what this is.

**Streamable HTTP on the LAN** follows the spec: `Origin` validation, the
required headers, 2026-07-28 and 2025-11-25 clients, OAuth 2.1:

1. Settings > Assistant > Connected computers > **Pair a computer** shows
   a QR code and a URL containing the device's `.local` name, its TLS
   certificate fingerprint (self-signed; the client pins it), and a
   one-time pairing code.
2. The client finds the phone's Protected Resource Metadata and
   authorization server (the phone itself, a small OAuth 2.1 server inside
   the hub), registers (Client ID Metadata Document, pre-registration from
   the QR code, or Dynamic Client Registration for older clients) and opens
   the authorization URL with PKCE and the `resource` parameter.
3. The authorization page in the Mac's browser says "Approve on your
   phone" and shows a four-digit code; the phone shows a popup alert with
   the client's name, the same code and the scopes (data classes and risk
   classes) with checkboxes. Approve, and the browser is redirected with
   the code and `iss`.
4. Tokens are short-lived (1 hour) with a refresh token; the phone keeps
   only their hashes. Revoking the computer in Settings kills both.

Caveats: Claude Desktop's own remote connectors are added through claude.ai
and reached from Anthropic's cloud, so a LAN-only server needs a local
bridge or the stdio route there *(unverified; check when building)*. A
self-signed certificate means clients must support fingerprint pinning or
the user installs a local CA; the SSH route avoids both.

### Permission model

A **grant** is (client, target, decision), where the target is a tool, a
data class or a risk class, and the decision is **Allow**, **Ask every
time** or **Deny**. The most specific grant wins; defaults come from the
risk table above.

```
tools/call arrives
  -> identify client (Luna caller id | Unix peer | OAuth token)
  -> tool known and visible to this client? (tools/list is filtered per client)
  -> validate arguments against inputSchema
  -> rate limit (per client, per risk class)
  -> taint check (see Safety): does untrusted content in this turn
     force a confirmation?
  -> grant: Allow | Ask | Deny
       Ask -> confirmation UI on the phone -> Approve / Deny / timeout (60 s)
  -> run the handler with a timeout (15 s default, Tasks extension for longer)
  -> validate structuredContent against outputSchema
  -> audit log entry
  -> result
```

**Confirmation UI, in the webOS idiom:**

| Situation | UI |
| --- | --- |
| A tool needs approval and the user is looking at the phone | A **popup alert** (the small window at the bottom of a phone, the corner of a tablet, like an incoming call or a calendar alarm): the client's icon and name, one plain sentence ("Send a text to Mom: 'Running 10 minutes late'"), the exact arguments behind a "Details" row, and **Allow** / **Don't allow**, with "Always allow for Mom" where the grant can be relaxed |
| The screen is off or locked | The alert shows over the lock screen like a call, with the phone's `showAlertsWhenLocked` preference; `outbound` and `destructive` actions also need the device unlocked |
| The assistant or a remote client is working in the background | A **dashboard** entry ("Assistant: 3 steps, 1 waiting for you"), tapped to open the assistant card; a Stop button in the dashboard's drop-down cancels the run |
| An action finished | A **banner** ("Wi-Fi turned on", "Text sent to Mom"), and the dashboard entry updates |
| A remote computer is connected | A persistent dashboard entry and a status bar icon while an MCP HTTP or SSH client is active, like the legacy USB-connected notice |

**Audit log**: db8 kind `org.webosphoenix.mcp.audit:1` (time, client, tool,
arguments summary, decision, result status), readable only by the hub and
Settings. Settings > Assistant > Activity lists it by day; entries older
than 30 days are deleted (configurable 7 to 365). Message bodies and file
contents are not logged, only their size.

**Rate limits** (token buckets per client): `read` 60/min, `personal-read`
30/min, `local-write` 30/min, `settings` 10/min, `outbound` 5 per 10 min,
`destructive` 5 per 10 min. Exceeding one returns a tool error the model
can read, and three in a row pause the client until the user resumes it
from the dashboard.

### Sandboxing

- The hub holds broad Luna permissions, so it is the component to protect.
  It runs as its own service user where OSE allows (*which user OSE runs
  JS services as is unverified*), and its ACG role lists only the
  services it wraps.
- The policy engine is the only path to a handler. There is no generic
  "call any Luna method" tool.
- App manifests are data. The hub never evaluates code from them, and
  `page` handlers run in the app's own page and process.
- The OAuth server, TLS listener and SSH route are off until the user turns
  them on, and the LAN listener only answers on the LAN interface.
- Tool results are sanitized (length limits, stripped control characters)
  before the hub returns them.

### Just Type

- **Ask the assistant**: a row at the bottom of Just Type's results, next
  to the web search engines ("Ask Assistant about 'wifi off at 11'"),
  added as a Phoenix entry in the simulated `com.palm.universalsearch`
  list. Tapping it opens the assistant card with the text.
- **Quick Actions from MCP prompts**: "Plan my day" and app prompts appear
  in Quick Actions.
- **Direct commands**: when the local model is on, Just Type can show a
  best-guess action inline as the user types ("Turn off Wi-Fi", "Text Mom
  ..."), computed only on Enter or after a pause, and always as a
  suggestion to tap, never run by itself.
- The tools derived from `universalSearch` keep Just Type and MCP in step:
  what an app offers one, it offers the other.

## Part 2: the on-device assistant

### Pieces

| Piece | What |
| --- | --- |
| `org.webosphoenix.assistant` (service) | Node.js Luna service: the agent loop, provider adapters, conversation store, memory, routing. An MCP client of the hub over Luna |
| Assistant app (`apps/assistant`, React + TypeScript) | The card: conversation, voice button, tool activity, settings shortcut. Draws with `@phoenix/ui` |
| `org.webosphoenix.llm` (service) | llama.cpp's `llama-server` on 127.0.0.1 (or a Unix socket), started on demand by systemd and stopped after 5 idle minutes to give the RAM back. OpenAI-compatible, so the assistant treats it like any provider |
| `org.webosphoenix.transcriber` | Exists (Voice Memos). The assistant uses it for push-to-talk |
| Settings > Assistant | Part 3 |

### Entry points

| Entry point | How | Notes |
| --- | --- | --- |
| The launcher and quick launch | Assistant icon | A normal card |
| Just Type | "Ask Assistant" row, prompts in Quick Actions | See above |
| Gesture | Press and hold in the gesture area for 0.6 s, then speak or type | Must not clash with the wave launcher (slow swipe up and hold) or the tap; *to be tried on a device* |
| Hardware | Long press of a headset's button; long press of the power key (off by default) | Through the keys module ([HARDWARE.md](HARDWARE.md#hardware-abstraction-plan)) |
| Voice | Push-to-talk first (the mic button in the card and in Just Type). A wake word later | See Voice |
| Notifications | An "Ask Assistant" action on message and email notifications ("Reply", "Summarize"), once notification actions exist (M4 item) | The notification's content is untrusted (Safety) |
| Share | "Share to Assistant" from Photos, Files, Web | The shared item is untrusted |

### The agent loop

```
user turn (text or transcript)
  -> router picks a model (local or a provider, see Routing)
  -> build context: system prompt, the user's memories, recent turns,
     tool list (filtered: only tools this client may use, and at most
     ~40 of them, chosen by the request's topic to fit small models)
  -> model call (streaming)
       text -> show in the card
       tool call -> hub (policy, confirmation, audit) -> result
                 -> mark result trusted/untrusted -> back to the model
  -> stop when the model answers without a tool call,
     or after 12 tool calls, or 2 minutes, or the user taps Stop
  -> store the turn (text, tool calls, results summary)
```

- **Plan first for voice and background runs.** When the assistant runs
  without the card in front, it asks the model for the list of tool calls
  up front, shows the plan in the dashboard ("Turn on Wi-Fi, then open
  Music"), and runs only that plan. This is the plan-then-execute pattern
  from the prompt-injection literature, and it also makes background runs
  easier to follow.
- **Small models get help.** Tools are grouped by area, and a local model
  first chooses an area, then sees only that area's tools. Arguments are
  generated with grammar-constrained decoding (llama.cpp supports JSON
  Schema grammars) so a 1B to 4B model produces valid calls.

### On-device models per device class

Q4 GGUF sizes are about 0.6 GB per billion parameters plus a few hundred MB
of KV cache and runtime for a 4k context. Decode speed on phones is mostly
limited by memory bandwidth. Measured numbers are cited; the rest are
**estimates to replace with measurements** (a `tools/bench-llm.sh` run on
each reference device is part of phase A2).

| Device class ([HARDWARE.md](HARDWARE.md)) | RAM | Local model that fits | Speed | Verdict |
| --- | --- | --- | --- | --- |
| Raspberry Pi 4 (Cortex-A72) | 4 to 8 GB | 0.6B to 1B | 1 to 2 tokens/s for 1B to 3B (SitePoint, measured) | Too slow for chat; command parsing only with a 0.6B to 1B model. Use a LAN or cloud model |
| qemux86-64 emulator | host's | any | host's CPU | Development only |
| Pixel 3a (Snapdragon 670) | 4 GB | 1B to 2B | estimate 4 to 8 tokens/s for 1B | Commands and short answers |
| PinePhone Pro (RK3399S) | 4 GB | 1B | estimate 2 to 5 tokens/s | Commands only; battery cost high |
| OnePlus 6 / 6T, Poco F1, SHIFT6mq (Snapdragon 845) | 6 to 8 GB | 2B to 4B | estimate 8 to 15 tokens/s for 2B, 3 to 6 for 4B | Usable offline assistant with a 2B model |
| Fairphone 4/5, Pixel 6a/7 (Halium) | 6 to 8 GB | 2B to 4B | estimate 8 to 20 tokens/s on CPU | Good. NPUs (Hexagon, Tensor TPU) are not reachable from our Linux stack today (*llama.cpp has a Hexagon backend for Android; on Halium, unverified*) |
| Surface Go and x86 tablets | 4 to 8 GB | 2B to 4B | estimate 5 to 15 tokens/s | Usable |

For comparison, a Raspberry Pi 5 does 12 to 18 tokens/s with a 1.1B model
and 4 to 6 with a 3B model (measured, secondary sources), and Qualcomm's
OpenCL backend for Adreno GPUs in llama.cpp targets Adreno 800-series and
X-series GPUs, not the Adreno 6xx in our first phones.

**Candidate models** (all open weights; check each model card before
shipping one, as for the Whisper model in [LEGAL.md](LEGAL.md)):

| Model | Sizes | Licence | Notes |
| --- | --- | --- | --- |
| **Qwen3.5** small (March 2026) | 0.8B, 2B, 4B, 9B | Apache-2.0 | Tool use, thinking and non-thinking modes, multimodal. **Default candidate**: 0.8B for the Pi and command parsing, 2B for phones |
| **Gemma 4** E2B, E4B (April 2026) | ~2B and ~4B effective | Apache-2.0 (a change from Gemma 3's own terms) | Built for phones; Google's own runtime is LiteRT-LM. Good second choice |
| Phi-4-mini | 3.8B | MIT (*per the model card, unverified here*) | Strong reasoning for its size |
| Llama 3.2 | 1B, 3B | Llama 3.2 Community License (not OSI open source, has an acceptable use policy) | Widely tested for tool calling; do not ship by default, let users download it |

Models are **not in the image** (hundreds of MB to GB). Settings downloads
one on request, over Wi-Fi, from Hugging Face, and checks its SHA-256
against a list shipped with Phoenix.

**Runtime choice: llama.cpp.**

| Runtime | Licence | Fit for Phoenix |
| --- | --- | --- |
| **llama.cpp** (`llama-server`) | MIT | **Chosen.** Plain C/C++, builds with Yocto like the `whisper-cpp` recipe (same ggml), CPU NEON everywhere, Vulkan and OpenCL backends to try on GPUs, OpenAI-compatible server with tool calls and JSON Schema grammars, GGUF models for every candidate. Daily builds (b11239 on 28 September 2026) |
| ExecuTorch (1.0 in October 2025, 1.4 now per PyPI) | BSD-3-Clause | ARM64 Linux supported; strong on Android/iOS and NPUs through vendor delegates. More build machinery, per-model export step. Revisit for NPUs |
| LiteRT-LM (Google) | Apache-2.0 | Linux and Raspberry Pi CLI and Python API; best path for Gemma. A second backend if Gemma 4 becomes the default |
| ONNX Runtime GenAI (0.17, September 2026) | MIT | Good on Windows and DirectML/QNN; less natural on our Yocto ARM Linux |
| MLC LLM | Apache-2.0 | Compiles per device (Vulkan, OpenCL, WebGPU). Powerful, but a compiler toolchain per target model is heavy for a volunteer project |

### Voice

- **Push-to-talk now**: record 16 kHz WAV (Voice Memos' code), send it to
  `org.webosphoenix.transcriber`, show the text, run it. whisper.cpp's
  `base.en` on a Snapdragon 845 should take one to three seconds for a
  short command (*estimate*); `tiny.en` halves that. The transcript goes
  into the text field first so the user can fix it; a setting runs it
  directly.
- **Wake word: "Hey Phoenix" (built 8 October 2026, in the simulator).**
  - **Choice.** whisper is not a wake-word engine; openWakeWord's code is
    Apache-2.0 but its pre-trained models are CC BY-NC-SA 4.0 and training
    our own needs its NC-licensed negative feature set and a GPU, so it was
    left out. Chosen: **Vosk** (Kaldi; library Apache-2.0) with its **small
    English model `vosk-model-small-en-us-0.15` (40 MB, Apache-2.0** per
    alphacephei.com/vosk/models) and a grammar of the phrase and `[unk]`.
    "Hey Phoenix" is kept: four syllables, a rare word, already in the
    model's vocabulary.
  - **How** (`services/wakeword`, `phoenix-wakeword`, plain C++17, libvosk
    loaded at run time): a gate decodes only while there is sound over the
    room's floor; the grammar spotter hears the phrase; each candidate is
    checked by decoding that stretch again against words that sound like
    it ("Felix", "Phoebe", "hay"...), and the phrase must win. The shell's
    Dictation pipes the microphone to it while it stands by.
  - **Measured** (x86 Xeon 2.8 GHz, one core; 8 October 2026). Test speech
    from espeak-ng and two multi-speaker Piper voices (LibriTTS-R 904
    speakers, VCTK 109; used only to measure, not shipped), real speech
    from LibriSpeech dev-clean (CC BY 4.0, 5.4 h, not shipped):

    | Set | Result |
    | --- | --- |
    | "Hey Phoenix", Piper voices (240 clips) | 236 heard (98.3%) |
    | "Hey Phoenix", espeak-ng voices (160) | 115 heard (72%; its robotic variants) |
    | "Hey Phoenix, <request>" in one breath (100) | 93 heard |
    | Near misses ("Hey Felix", "I flew to Phoenix", "Say Phoenix", "Hey Siri"... 26 phrases, 416 clips) | 18 accepted (4.3%); 12 of them "Hey, fee nicks", which is the phrase. Without the check: 87 (21%) |
    | Piper "Hey Phoenix" with white noise at 10 / 5 dB SNR | 90% / 63% |
    | ... with other speech (babble) at 10 / 5 dB | 63% / 32% |
    | LibriSpeech dev-clean, 5.4 h of continuous speech | **0 false accepts** (3 candidates, all turned down by the check) |
    | CPU, continuous speech | 0.027 of one core (2.7%) |
    | CPU, a quiet room (10 min) | 0.04 s in all (the gate decodes nothing) |
    | Memory / start | 150 MB resident; 0.55 s to load |

    On a phone-class ARM core (Cortex-A55/A76) expect several times the CPU
    figure while people talk (*estimate*, not measured: no ARM device
    here), and next to nothing in quiet. Real human recordings of the
    phrase were not available; the Piper voices stand in for them. Weak
    spots: competing speech, and the 150 MB.
  - **The flow.** Settings > Assistant > Listen for "Hey Phoenix" (off by
    default) -> a chime (`listen.wav`) and a tap of the motor, the screen
    on, the assistant's view listening (the bird follows the loudness) ->
    the recording ends after a second of quiet -> whisper.cpp (its prompt
    made of the contacts' names, as Voice Dial does) -> the command ->
    the answer spoken (Voice replies, on by default) -> a read-back ("Call
    Marcus Reyes?") listens for Yes / No / Send / Cancel without the wake
    word; otherwise the view closes after 4 s idle. "Hey Phoenix, <request>"
    in one breath works (the recording starts just before the phrase; the
    phrase is dropped from the transcript). The microphone button stays
    push-to-talk. Listening pauses while the view is open, while anything
    is spoken, during a call and while one rings.
  - **Locked.** "When the screen is off or locked" (off by default): over
    the lock screen (nothing of the apps blurred behind it) the service
    runs only what shows nothing private and sends nothing (timers, alarms,
    toggles, media, volume, weather, sums, time...; `ask {locked}`); for
    the rest it says "Unlock your phone first" and the shell asks again
    once unlocked (within two minutes).
  - **Privacy.** Nothing leaves the phone; the spotter keeps the last few
    seconds in memory only. The status bar shows a microphone whenever it
    is open: faint while standing by, orange while recording.
  - **On a device**: meta-phoenix's `libvosk` (Alpha Cephei's prebuilt
    library; a from-source recipe with Kaldi, OpenFST and OpenBLAS is to
    do) and `vosk-model-small-en-us` (in `/usr/share/phoenix/wakeword/`),
    `phoenix-wakeword` installed with `phoenix-shell`, and
    `PhoenixViewsRoot.qml` sets `wakeWordCommand` (written 8 October 2026;
    not yet run on hardware). The microphone is the shell's Qt Multimedia
    input (PulseAudio on OSE, as dictation uses); with the screen off the
    shell process must keep
    running and audio stay open (OSE's audiod/PulseAudio input while
    suspended is unverified), and a DSP/low-power hotword path would be the
    next step for battery.
- **Speaking answers**: OSE's `com.webos.service.tts` is a Google Cloud
  client (its meta-webos recipe builds against googleapis and gRPC), so
  Phoenix runs a speech program: Flite in the image, espeak-ng or Piper
  by choice (see "What's installed where"; Piper's phonemizer is
  espeak-ng's library, GPL-3.0, even in the original MIT `rhasspy/piper`).
- OSE's `com.webos.service.ai.voice` is a Google Assistant client with
  cloud recognition. Phoenix does not use it.

### Routing between local and cloud

The user picks a **mode** in Settings: **On device only**, **Prefer on
device**, or **Prefer cloud** (default when a provider is set up; On device
only otherwise).

| Request | Prefer on device | Prefer cloud |
| --- | --- | --- |
| Short command that maps to one or two tools ("Wi-Fi off", "timer 10 minutes") | Local | Local if a local model is installed (faster, private), else cloud |
| Question or multi-step task | Local; offer "Ask <provider>" if the local answer is low-confidence or the local model gives up | Cloud |
| Involves a data class the provider is not allowed to see | Local | Local, and say why |
| No network | Local | Local, with a banner "Offline: using the on-device model" |
| Local model not installed or too slow on this device class | Cloud (with a one-time notice) | Cloud |

"Allowed to see" is per provider and per data class (Settings, Part 3). The
router checks before any content leaves the device, and the card shows a
small label on each answer: "On device", "Home server (Ollama)",
"Anthropic".

### Memory and context

| What | Where | Retention | Who sees it |
| --- | --- | --- | --- |
| Conversations | db8 `org.webosphoenix.assistant.conversation:1` | 30 days by default (1 day to forever, or "don't keep") | The assistant; sent to a provider only as part of that conversation |
| Memories ("my partner is Sam", "I prefer metric") | db8 `org.webosphoenix.assistant.memory:1` | Until deleted | Listed in Settings > Assistant > Memories, editable. The assistant proposes a memory and the user confirms ("Remember this?"); nothing is remembered silently |
| Personal data (contacts, messages, ...) | Where it already is | Not copied | Read on demand through the hub, per grant; tool results are kept in the conversation only as a short summary |
| Screen content | Not read by default | | An explicit "Ask about this screen" action takes a screenshot of the front card for that one turn |

There is no background indexing of the user's data for the assistant in
this plan. A local semantic index (embeddings of notes and email for "find
the email about the boiler") is an open question, not a default.

### Safety

**The threat.** An assistant that can read untrusted content (web pages,
email, messages, files), can see private data, and can send data out has
all three parts of what Simon Willison calls the "lethal trifecta" (*not
re-checked for this plan*): an attacker writes instructions into an email,
and the model follows them. No model is reliably immune, so the defences
are architectural, following *Design Patterns for Securing LLM Agents
against Prompt Injections* (Beurer-Kellner et al., June 2025) and
DeepMind's CaMeL (*Defeating Prompt Injections by Design*, March 2025).

| Defence | How |
| --- | --- |
| **Trust labels** | The hub labels each tool result `trusted` (OS state, the user's own settings) or `untrusted` (message and email bodies, web pages, file contents, notification text, anything from another person). The label travels with the content in the conversation |
| **Taint rule** | After untrusted content enters a turn, every `local-write`, `settings`, `outbound`, `destructive` and `developer` call in that turn needs a confirmation, even if pre-approved. `outbound` calls whose recipient or URL did not come from the user's own words or their contacts are **blocked**, not just confirmed |
| **Quarantined reading** | Summarizing or extracting from untrusted content ("what does this email say") goes to a separate model call **with no tools**, whose output comes back as data (the dual-LLM pattern). The planning model sees the summary labelled untrusted |
| **Plan-then-execute** | Voice and background runs fix their tool calls before reading untrusted data (above) |
| **No silent exfiltration** | The assistant card does not load remote images or follow links in model output; links are shown as text with the domain highlighted and open only on tap. `os.files.read` results never go to a URL tool in the same turn without a confirmation |
| **Show the arguments** | Every confirmation shows the exact recipient, text and target, not the model's description of them |
| **Allow and deny lists** | Per tool, per recipient (numbers and addresses), per domain for anything that fetches or posts; a global "never" list (emergency numbers are callable only by the user, not by a tool; payment and banking apps have no tools unless they declare them and the user enables them) |
| **Limits** | Rate limits, 12 tool calls and 2 minutes per turn, Stop in the dashboard |
| **Tests** | A red-team suite in CI: sample emails, SMS and pages with injected instructions, run against the simulator with a scripted model and with real small models, checking that the taint rule blocks or asks every time |

What this does not solve: a user who approves a malicious action because
the confirmation looked routine. Confirmations must stay rare enough to be
read, which is why reads and easy-to-undo local actions do not ask.

### UI

- **The assistant card**: a conversation drawn like a Messaging thread
  (the user's words right, the assistant's left), with tool steps as small
  grey rows ("Turned on Wi-Fi", "Read 3 unread emails") that expand to show
  arguments and results. A text field and a mic button in the command menu.
  The app menu has New conversation, Conversations, Memories, and
  Preferences (which opens Settings > Assistant).
- **While listening**: a banner-height strip with a level meter over the
  current card, or in the dashboard when the screen is off.
- **While working in the background**: a dashboard entry with the step list
  and Stop.
- **Confirmations**: popup alerts (above).
- **Answers to voice requests** arrive as a banner, and as speech when TTS
  is on.
- **MCP Apps** (later): a tool that returns a `ui://` resource is shown as
  a small card in the conversation, in a sandboxed web view, following the
  extension's rules.

## Part 3: Bring your own LLM

### Settings > Assistant

A new launch point in `apps/settings` (one pane per launch point, like the
others), drawn with the same Enyo 1.0 art:

```
Assistant
 [ Assistant                       ON ]
 Mode              Prefer cloud  >
 ---- Models ----------------------------
 On device          Qwen3.5 2B (1.3 GB)  >
 Anthropic          claude-...           >
 Home server        Ollama, qwen3:8b     >
 + Add a model provider
 ---- Privacy ---------------------------
 What providers may see                 >
 Conversations      Keep 30 days        >
 Memories                               >
 Activity                               >
 ---- Connections -----------------------
 Connected computers                    >
 ---- Usage -----------------------------
 This month  Anthropic 412k tokens, about $1.90
             Home server 1.2M tokens
```

### Providers

| Provider type | Endpoint and API | Setup | Model list |
| --- | --- | --- | --- |
| **Anthropic** | Messages API (`/v1/messages`), streaming, tool use | API key | `GET /v1/models` |
| **OpenAI** | **Responses API** (`/v1/responses`). OpenAI recommends it for new projects, and from GPT-5.4 Chat Completions does not support tool calls with reasoning turned on | API key, optional organization | `GET /v1/models` |
| **Google** | Gemini API (`generateContent`, function calling) | API key | models list |
| **OpenAI-compatible** | `/v1/chat/completions` with `tools` (the dialect Ollama, LM Studio, llama.cpp's server and vLLM share); `/v1/responses` where the server has it (Ollama: stateless only) | Base URL, optional key; "Find on my network" looks for Ollama (port 11434) and LM Studio (1234) on the LAN (*default ports from their docs; confirm*) | `GET /v1/models` |
| **On device** | `org.webosphoenix.llm` (llama.cpp's OpenAI-compatible server) | Download a model | Installed models |

The adapters are small TypeScript modules in the assistant service, one per
API shape (Messages, Responses, Chat Completions, Gemini), each mapping
MCP tool definitions to the provider's tool format and back. Provider SDKs
are not required; `fetch` with streaming is enough and keeps the service
small. Model ids are **never hard-coded in the UI**; they come from the
provider's model list, with the user's choice saved.

Per provider the user sets: the model for conversation, an optional
cheaper model for quick tasks, a monthly token or spending cap, and which
data classes it may see.

### API keys

- Keys live in the **Phoenix key store**, `org.webosphoenix.service.keystore`,
  the same one Synergy needs ([SYNERGY.md](SYNERGY.md#29-where-credentials-live)):
  OSE publishes no key manager, so Phoenix provides one that implements the
  legacy `com.palm.keymanager` calls. webOS-ports' Node.js keymanager
  (Apache-2.0) is a candidate to reuse. Keys are encrypted with a device key
  (TPM or TEE where there is one, else a file readable only by the key
  store's user).
- Only the assistant service can read provider keys (key store ACL by
  caller id). The Settings page can write and delete a key but only shows
  its last four characters.
- Keys never go into the conversation, the audit log, crash reports or MCP
  results. Per the MCP spec, the hub never asks for a key through a form
  elicitation.
- In the simulator the key store is simulated in localStorage (clearly
  marked), and calls to cloud providers go through `tools/serve-rootfs.py`'s
  proxy (browsers block cross-origin calls, as with DAV). On a device the
  service calls providers directly.

### Usage and cost

- Token counts come from each response's `usage` fields and are kept per
  provider per day in db8.
- Cost is an **estimate** from a price table shipped with Phoenix and
  editable by the user, because prices change more often than releases.
  Labelled "about".
- Caps: at 80% a banner; at 100% the provider is paused until the next
  month or until the user raises the cap, and the router falls back to the
  local model.

### Offline fallback

With no network (or a provider down, or a cap reached): the on-device model
if one is installed, otherwise the assistant says it is offline and offers
the direct commands Just Type can still do without a model (open apps,
toggles). Queued requests are not replayed later without the user asking.

### Privacy notice

Shown when the user adds a cloud provider, and always available from the
provider's page, in plain words:

- what is sent (your messages to the assistant, the content of tools it
  reads for you, for the data classes you allow), and what is never sent
  (keys, the audit log, data classes you did not allow);
- that the provider's own terms and retention apply, with a link;
- that "On device" and a server on your own network keep everything local.

### Features by provider

| Feature | On device (2B) | LAN (Ollama etc.) | Anthropic / OpenAI / Google |
| --- | --- | --- | --- |
| Direct commands (toggles, open, timers) | Yes | Yes | Yes |
| Multi-step tasks with tools | Simple ones | Depends on the model | Yes |
| Summarize email, messages, web pages | Short ones | Yes | Yes |
| Drafting replies | Basic | Yes | Yes |
| Images ("what is in this photo") | With a multimodal model (Qwen3.5, Gemma 4), slow | Model dependent | Yes |
| Works offline | Yes | On the same network | No |
| Data stays on the device | Yes | Stays in your home | No |
| Cost | Battery | Your server | Per token |

## Roadmap

Sizes: **S** up to 2 weeks, **M** 2 to 6 weeks, **L** more than 6 weeks,
for one contributor.

| Phase | What | Size | Depends on |
| --- | --- | --- | --- |
| **P0** | This plan agreed; manifest schema and tool list frozen as `docs/spec/mcp-manifest.md` | S | |
| **P1** | Hub with read-only OS tools, Luna transport, registry, audit log; simulated in the runtime; `phoenix-sim --mcp-stdio`; tests driving it with the TypeScript SDK's client | M | |
| **P2** | Write tools, the policy engine and grants, popup alert confirmations and the dashboard entry in the shell; `appinfo.json` `mcp` sections for Phoenix apps; `universalSearch`-derived tools; overlay manifests for the original apps | M | Popup alerts and dashboards in the shell on OSE (M1) |
| **P3** | `phoenix-mcp` stdio program and the Unix socket; the SSH route documented for Claude Code and Claude Desktop | S | Developer Mode and SSH ([TERMINAL.md](TERMINAL.md)) |
| **P4** | Streamable HTTP, TLS, pairing and the OAuth 2.1 server | M to L | P2 |
| **A1** | Assistant app and service with cloud and OpenAI-compatible providers; Settings > Assistant; key store | M | Key store (shared with Synergy) |
| **A2** | `llama-cpp` recipe, `org.webosphoenix.llm`, model downloads, `bench-llm` on each reference device, the router | M | Reference devices (M3) for real numbers |
| **A3** | Push-to-talk, Just Type entry, gesture, notification actions | M | `whisper-cpp` recipe built; notification actions (M4) |
| **A4** | Safety hardening: trust labels and taint rule end to end, quarantined reading, red-team suite in CI | M | P2, A1 |
| **A5** | Wake word (own model), TTS, MCP Apps cards, local semantic search | L | A3 |

Build P1, P2 and A1 in the simulator first, as every Phoenix app has been;
the device work waits for the M1 shell on OSE.

## Risks

| Risk | Mitigation |
| --- | --- |
| MCP keeps changing (the 2026-07-28 revision removed sessions and deprecated sampling) | Keep the MCP code in one module on the official SDK; support one previous revision |
| Prompt injection leads to a harmful action | The Safety section; confirmations cannot be turned off for `outbound` and `destructive` |
| The hub becomes a confused deputy with broad permissions | One policy path, per-app `luna` handlers limited to the app's own services, no generic Luna tool |
| Local models too slow on the first devices | Cloud and LAN providers first; local only where measured to be usable |
| RAM pressure: a 2B model plus Chromium on a 4 GB phone | Start the model on demand and stop it when idle; refuse to load when free memory is low |
| Battery drain from local inference or a wake word | Both off by default; measure |
| OSE is quiet (no release since March 2025) | Nothing here depends on OSE changes beyond what HARDWARE.md already covers |
| Provider APIs change (models renamed, tools moved to newer endpoints) | Adapters per API shape, model lists read at runtime |
| Legal: model licences and acceptable use policies | Ship no model in the image; list licences in the download screen; Apache-2.0 or MIT models as defaults |

## Open questions for you

1. **Default model mode**: should a fresh install have the assistant off
   until the user sets it up, or on with the local model where the device
   can run one?
2. **Which cloud providers at first**: Anthropic, OpenAI, Google and
   OpenAI-compatible all in A1, or start with Anthropic plus
   OpenAI-compatible (which covers Ollama and LM Studio)?
3. **Remote control from your Mac**: is the SSH route (`ssh phone
   phoenix-mcp`, Developer Mode only) enough for you, or do you want the
   LAN HTTP server with QR pairing early?
4. **The gesture**: press and hold in the gesture area, or something else
   (a double tap, a long press on the power key)? *Proposed (29 September
   2026): hold in the gesture area asks the assistant while the keyboard is
   down; while it is up, hold and slide moves the text cursor
   ([spec/GAPS.md](spec/GAPS.md) V4).*
5. **Wake word**: wanted at all? It needs our own trained model and costs
   battery.
6. **Memory**: is "the assistant proposes, you confirm" right, or do you
   want it to remember nothing between conversations by default?
7. **Local semantic search** over email, notes and messages: worth the
   storage and battery, or leave it out?
8. **Shell access for AI clients** (`os.shell.exec` in Developer Mode):
   include it, or never expose a shell through MCP?
9. **A home relay**: you prefer LAMP. Would you want an optional PHP/MySQL
   companion on your own server (for example to reach the phone's MCP from
   outside the LAN, or to keep conversation history), or should everything
   stay on the phone?

## Sources

Accessed 28 September 2026 unless noted.

- MCP versioning, current revision 2026-07-28: <https://modelcontextprotocol.io/specification/versioning>
- MCP 2026-07-28 changelog (sessions removed, MRTR, `server/discover`, deprecations): <https://modelcontextprotocol.io/specification/2026-07-28/changelog>
- MCP 2026-07-28 release post (Tier 1 SDKs, extensions): <https://blog.modelcontextprotocol.io/posts/2026-07-28/>; release candidate (21 May 2026): <https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/>
- Transports overview and Streamable HTTP: <https://modelcontextprotocol.io/specification/2026-07-28/basic/transports>, <https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http>
- Authorization: <https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization>
- Tools: <https://modelcontextprotocol.io/specification/2026-07-28/server/tools>
- Elicitation: <https://modelcontextprotocol.io/specification/2026-07-28/client/elicitation>
- MCP Apps (26 January 2026): <https://blog.modelcontextprotocol.io/posts/2026-01-26-mcp-apps/>, <https://modelcontextprotocol.io/seps/1865-mcp-apps-interactive-user-interfaces-for-mcp>
- Android AppFunctions: <https://developer.android.com/ai/appfunctions>; Android Developers Blog (February 2026): <https://android-developers.googleblog.com/2026/02/the-intelligent-os-making-ai-agents.html>; Jetpack release list: <https://developer.android.com/jetpack/androidx/releases/appfunctions>
- Apple WWDC26 Apple Intelligence guide (App Intents, schemas, View Annotations, Foundation Models): <https://developer.apple.com/wwdc26/guides/apple-intelligence/>
- llama.cpp releases (b11239, 28 September 2026): <https://github.com/ggml-org/llama.cpp/releases>; OpenCL backend for Adreno (IWOCL 2026 slides): <https://www.iwocl.org/wp-content/uploads/IWOCL-2026-Wang-Llamacpp.pdf>
- ExecuTorch 1.0: <https://pytorch.org/blog/introducing-executorch-1-0/>; releases: <https://github.com/pytorch/executorch/releases>
- LiteRT-LM: <https://ai.google.dev/edge/litert-lm/overview>
- ONNX Runtime GenAI (0.17.0 on PyPI): <https://pypi.org/project/onnxruntime-genai/>
- MLC LLM: <https://llm.mlc.ai/>
- Gemma 4 under Apache-2.0: <https://opensource.googleblog.com/2026/03/gemma-4-expanding-the-gemmaverse-with-apache-20.html>
- Qwen3.5 small models (2 March 2026, Apache-2.0): <https://artificialanalysis.ai/articles/qwen3-5-small-models> (secondary)
- Raspberry Pi 4 and 5 llama.cpp speeds: <https://www.sitepoint.com/llms-raspberry-pi-edge/>, <https://www.stratosphereips.org/blog/2025/6/5/how-well-do-llms-perform-on-a-raspberry-pi-5> (secondary)
- Design Patterns for Securing LLM Agents against Prompt Injections (June 2025): <https://arxiv.org/abs/2506.08837>; CaMeL, Defeating Prompt Injections by Design (March 2025): <https://arxiv.org/abs/2503.18813>
- OpenAI, migrating to the Responses API (GPT-5.4 tool-calling note): <https://developers.openai.com/api/docs/guides/migrate-to-responses>
- Ollama OpenAI compatibility: <https://docs.ollama.com/api/openai-compatibility>; LM Studio: <https://lmstudio.ai/docs/developer/openai-compat>
- openWakeWord (code Apache-2.0, models CC BY-NC-SA 4.0): <https://github.com/dscripka/openWakeWord>
- webOS OSE LS2 API index (no key manager; `com.webos.service.tts`, `ai.voice`, `devmode`): <https://www.webosose.org/docs/reference/ls2-api/ls2-api-index/>; `ai.voice`: <https://www.webosose.org/docs/reference/ls2-api/com-webos-service-ai-voice/>
- webOS OSE 2.27.0 release notes (Node.js 20.12.2): <https://www.webosose.org/about/release-notes/webos-ose-2-27-0-release-notes/>
- webOS-ports keymanager (Apache-2.0, Node.js): <https://github.com/webOS-ports/keymanager>
