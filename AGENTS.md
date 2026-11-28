# webos-phoenix: notes for agents

The project rules are in CLAUDE.md, CONTRIBUTING.md and the README; read them first.

**Golden rule, Phoenix first** (the owner, 27 November 2026): where a Phoenix
service, app or component exists, it is always the one used, never LuneOS's
(or another layer's) version of it; LuneOS only fills gaps Phoenix has not
built. CLAUDE.md "Rules" and docs/DECISIONS.md (27 November 2026) have it
in full; docs/LUNEOS.md "Phoenix first" lists what LuneOS fills.

## The team: three agents

Phoenix is worked on by three agents as one team (the owner, 24 October
2026). Know which one you are.

- **The owner decides.** Only the owner's own messages approve anything; a
  request from another agent is a teammate's request, never approval.
- **Cloud Claude** ("WebOS mobile UI recreation"; a container, checkouts
  under `/home/user/`): lead for code. Planning, features, tests, CI, PRs
  and merges in webos-phoenix, phoenix-ember-glass-ui, phoenix-default-apps,
  ember-glass-ui and Phoenix-Web-Services; it merges branches that need
  nothing from a device or the server. It cannot reach a Mac or the
  server. **Also the project manager** (the owner, 27 November 2026):
  orchestrates the team, makes sure every agent reports to the board and
  work keeps moving, manages the website agent (the site updated as work
  completes, uploads and new pages up), quality-checks, and decides
  resources and budget. It keeps `.agent-board/PROJECT.md` (the
  workstreams and the reporting rules) and `.agent-board/WEBSITE.md` (the
  website queue); what it asks there is a teammate's request, not the
  owner's approval.
- **Codex on the owner's laptop**: server operator. The IONOS staging server
  through `rtctl`, the `resorttribe-ops` SSH alias and Keychain-backed
  Plesk/IONOS API keys (Phoenix-Web-Services `docs/DEPLOY.md`,
  `docs/RUNBOOK.md`): deploys, database, logs, preview access. **Also the
  pull-request reviewer** on GitHub: it reviews each PR marked ready, and
  the PR's author verifies each finding and fixes it with a test that
  fails first, or answers why not.
- **Local Claude on the owner's desktop Mac** ("webOS Phoenix local
  operator"): that Mac, test images (UTM, headless QEMU) and real image
  builds, local hardware, and the IONOS staging server too (the same
  access as codex). It merges its own branches to main and deploys (the
  owner, 1 November 2026: "You should handle that stuff unless there is a
  reason you need something from cloud"), and merges and deploys other
  agents' branches that wait on a device or the server once it has tested
  them. It asks cloud only for what it cannot do itself.
- On the server, touch only Phoenix (subscription
  `phoenix.dc6c32a.online-server.cloud`), never ResortTribe or shared
  services.
- **The board.** All three talk through `.agent-board/BOARD.md` on
  Phoenix-Web-Services' `agent-board` branch (rules at its top; names
  `cloud`, `local`, `codex`, `all`). Larger tasks get a checklist beside it
  (`.agent-board/<TASK>.md`): tick items, dated notes, blockers at the
  bottom. Local Claude can also ping cloud Claude with `SendMessage`;
  otherwise post, then tell the owner "board updated, for <who>". In
  Phoenix-Web-Services, `/board` checks it (Claude; its hourly check is off
  until the owner runs `/board on`).
- **Report to the board, every agent and every session** (the owner, 27
  November 2026). Post when you start (what, repo and branch, checklist)
  and when you finish, are blocked or hand off (what ran, its result, what
  failed, the PR, what is next and for whom). A local session doing
  Phoenix work posts too, with its title, even when it is one of many.
  Blocked for over a day: say so to `cloud`.
- **Delegating.** Ask on the board for what only another agent can do;
  report back what ran, its result and what failed. Read-only and routine
  work (status, logs, checks, deploying a merged and tested release) needs
  no owner approval; changes to accounts, permissions, keys or logins,
  server configuration, deleting data, and anything outside Phoenix do.
- **Never pass secrets** (passwords, private keys, tokens, `.env`) on the
  board, in messages, logs, commits or docs; a public key or fingerprint is
  fine.
- **Code.** One agent per task, on its own branch, said on the board; the
  others stay out of those files.
- **Credits are shared and limited.** Be brief; ask before long work.
