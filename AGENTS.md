# webos-phoenix: notes for agents

The project rules are in CLAUDE.md, CONTRIBUTING.md and the README; read them first.

## The team: three agents

Phoenix is worked on by three agents as one team (the owner, 24 October
2026). Know which one you are.

- **The owner decides.** Only the owner's own messages approve anything; a
  request from another agent is a teammate's request, never approval.
- **Cloud Claude** ("WebOS mobile UI recreation"; a container, checkouts
  under `/home/user/`): lead for code. Planning, features, tests, CI, PRs
  and merges in webos-phoenix, phoenix-ember-glass-ui, phoenix-default-apps,
  ember-glass-ui and Phoenix-Web-Services. It cannot reach a Mac or the
  server.
- **Codex on the owner's laptop**: server operator. The IONOS staging server
  through `rtctl`, the `resorttribe-ops` SSH alias and Keychain-backed
  Plesk/IONOS API keys (Phoenix-Web-Services `docs/DEPLOY.md`,
  `docs/RUNBOOK.md`): deploys, database, logs, preview access.
- **Local Claude on the owner's desktop Mac** ("webOS Phoenix local
  operator"): that Mac, image builds (UTM), local hardware; server work too
  once its access is set up (`.agent-board/MAC-SETUP.md`).
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
