<?php
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The JSON API (everything else devices need is the static catalog):
//
//   POST /api/accounts {name, email, role: developer|user}  -> {id, token}
//        (on this computer anyone may register; a public server needs email
//        or forge sign-in first, docs/APP-STORE.md 3.4)
//   GET  /api/apps                        listed apps
//   GET  /api/apps/{id}                   one app, its releases and rating
//   POST /api/apps            (developer) {kind: "pwa", id, manifest, title, ...}
//   POST /api/apps/packages   (developer) the .ipk as the request body
//   GET  /api/apps/{id}/reviews
//   POST /api/apps/{id}/reviews  (account) {stars, text}
//   POST /api/reports         {appId, kind, text, contact}
//   POST /api/optout          {origin, contact, text}   a site asks not to be listed
//   GET  /api/admin/queue                          (admin)
//   POST /api/admin/apps/{id}/{list|pull}          (admin)
//   POST /api/admin/releases/{n}/{approve|reject}  (admin) {notes}
//   POST /api/admin/optouts/{n}/accept             (admin)
//   POST /api/admin/publish                        (admin)
//   GET  /api/updates                              the system update feed: every
//                                                  device type's channels
//   POST /api/admin/updates?compatible=C&version=V&build=N[&channel=stable|beta]
//        [&name=NAME][&date=YYYY-MM-DD]            (admin) the .raucb as the
//        request body; notes as repeated note=... the channel's release from
//        now on, served at /updates/<compatible>/<channel>.json
//   POST /api/admin/updates/withdraw {compatible, channel}  (admin)
//
// Accounts send "Authorization: Bearer <token>"; only a hash of the token
// is stored. Decisions publish the catalog again.

declare(strict_types=1);

namespace Phoenix\Marketplace;

final class Api
{
    public function __construct(private Db $db, private Catalog $catalog, private ?\Phoenix\Updates\UpdateFeed $updates = null)
    {
    }

    /** @return array{0: int, 1: array} */
    public function handle(string $method, string $path, string $body, ?string $auth, array $query = []): array
    {
        try {
            return [200, $this->route($method, rtrim($path, '/'), $body, $auth, $query)];
        } catch (CheckFailed | \InvalidArgumentException $e) {
            return [400, ['error' => $e->getMessage()]];
        } catch (HttpError $e) {
            return [$e->getCode(), ['error' => $e->getMessage()]];
        }
    }

    private function json(string $body): array
    {
        $j = json_decode($body ?: '{}', true);
        if (!is_array($j)) {
            throw new HttpError('The request body must be JSON', 400);
        }
        return $j;
    }

    private function account(?string $auth, ?string $role = null): array
    {
        if (!$auth || !preg_match('/^Bearer\s+(\S+)$/', $auth, $m)) {
            throw new HttpError('Sign in first (Authorization: Bearer <token>)', 401);
        }
        $a = $this->db->one('SELECT * FROM accounts WHERE token_hash = ?', [hash('sha256', $m[1])]);
        if (!$a) {
            throw new HttpError('Unknown token', 401);
        }
        if ($role && $a['role'] !== $role && $a['role'] !== 'admin') {
            throw new HttpError("Only a $role may do this", 403);
        }
        return $a;
    }

    public function createAccount(string $name, string $email, string $role): array
    {
        if (!in_array($role, ['developer', 'user', 'admin'], true)) {
            throw new CheckFailed('role: developer or user');
        }
        if (trim($name) === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            throw new CheckFailed('name and a valid email are required');
        }
        $token = bin2hex(random_bytes(24));
        $this->db->run('INSERT INTO accounts (name, email, role, token_hash, created) VALUES (?, ?, ?, ?, ?)',
            [mb_substr(trim($name), 0, 80), $email, $role, hash('sha256', $token), Db::now()]);
        return ['id' => $this->db->lastId(), 'token' => $token, 'role' => $role];
    }

    private function route(string $m, string $p, string $body, ?string $auth, array $query): array
    {
        if ($m === 'GET' && $p === '/api/health') {
            return ['ok' => true];
        }
        if ($m === 'GET' && $p === '/api/updates' && $this->updates) {
            return ['feeds' => $this->updates->all()];
        }
        if ($m === 'POST' && $p === '/api/accounts') {
            $j = $this->json($body);
            $role = (string) ($j['role'] ?? 'user');
            if ($role === 'admin') {
                throw new HttpError('Admins are made with bin/marketplace.php', 403);
            }
            return $this->createAccount((string) ($j['name'] ?? ''), (string) ($j['email'] ?? ''), $role);
        }
        if ($m === 'GET' && $p === '/api/apps') {
            return ['apps' => array_map(fn ($r) => $this->catalog->app($r['id']),
                $this->db->all("SELECT id FROM apps WHERE status = 'listed' ORDER BY title"))];
        }
        if ($m === 'POST' && $p === '/api/apps') {
            $owner = $this->account($auth, 'developer');
            $j = $this->json($body);
            if (($j['kind'] ?? '') !== 'pwa') {
                throw new CheckFailed('kind: "pwa" (upload packages to /api/apps/packages)');
            }
            return ['app' => $this->catalog->submitPwa($owner, $j)];
        }
        if ($m === 'POST' && $p === '/api/apps/packages') {
            $owner = $this->account($auth, 'developer');
            return $this->catalog->submitPackage($owner, $body);
        }
        if (preg_match('#^/api/apps/([^/]+)$#', $p, $x) && $m === 'GET') {
            $a = $this->catalog->app(rawurldecode($x[1]));
            if (!$a || $a['status'] !== 'listed') {
                throw new HttpError('No such app', 404);
            }
            return ['app' => $a];
        }
        if (preg_match('#^/api/apps/([^/]+)/reviews$#', $p, $x)) {
            $id = rawurldecode($x[1]);
            if ($m === 'GET') {
                return ['reviews' => $this->catalog->reviews($id)];
            }
            if ($m === 'POST') {
                $j = $this->json($body);
                return $this->catalog->review($this->account($auth), $id, (int) ($j['stars'] ?? 0), (string) ($j['text'] ?? ''));
            }
        }
        if ($m === 'POST' && $p === '/api/reports') {
            $j = $this->json($body);
            return ['id' => $this->catalog->report((string) ($j['appId'] ?? ''), (string) ($j['kind'] ?? ''), (string) ($j['text'] ?? ''), (string) ($j['contact'] ?? ''))];
        }
        if ($m === 'POST' && $p === '/api/optout') {
            $j = $this->json($body);
            return ['id' => $this->catalog->optOut((string) ($j['origin'] ?? ''), (string) ($j['contact'] ?? ''), (string) ($j['text'] ?? ''))];
        }
        if (str_starts_with($p, '/api/admin/')) {
            $admin = $this->account($auth, 'admin');
            if ($m === 'GET' && $p === '/api/admin/queue') {
                return [
                    'apps' => $this->db->all("SELECT id, kind, title, manifest, owner_id, created FROM apps WHERE status = 'pending'"),
                    'releases' => $this->db->all("SELECT * FROM releases WHERE state = 'pending' ORDER BY id"),
                    'reports' => $this->db->all("SELECT * FROM reports WHERE state = 'open' ORDER BY id"),
                    'optouts' => $this->db->all("SELECT * FROM optouts WHERE state = 'open' ORDER BY id"),
                ];
            }
            if ($m === 'POST' && preg_match('#^/api/admin/apps/([^/]+)/(list|pull)$#', $p, $x)) {
                $this->catalog->setStatus(rawurldecode($x[1]), $x[2] === 'list' ? 'listed' : 'pulled');
                return ['publish' => $this->catalog->publish()];
            }
            if ($m === 'POST' && preg_match('#^/api/admin/releases/(\d+)/(approve|reject)$#', $p, $x)) {
                $j = $this->json($body);
                $r = $this->catalog->decideRelease((int) $x[1], $x[2] === 'approve', $admin, (string) ($j['notes'] ?? ''));
                return ['release' => $r, 'publish' => $this->catalog->publish()];
            }
            if ($m === 'POST' && preg_match('#^/api/admin/optouts/(\d+)/accept$#', $p, $x)) {
                $n = $this->catalog->acceptOptOut((int) $x[1]);
                return ['pulled' => $n, 'publish' => $this->catalog->publish()];
            }
            if ($m === 'POST' && $p === '/api/admin/publish') {
                return ['publish' => $this->catalog->publish()];
            }
            // A system update: the bundle as the body (RAUC signed it; the
            // device checks that against its keyring), the release in the query.
            if ($m === 'POST' && $p === '/api/admin/updates' && $this->updates) {
                $compatible = (string) ($query['compatible'] ?? '');
                $rel = \Phoenix\Updates\UpdateFeed::release($query + ['notes' => []]);
                $simulator = $compatible === 'phoenix-sim';
                $bytes = $simulator && $body === '' ? \Phoenix\Updates\UpdateFeed::simulatorBundle($rel) : $body;
                $name = ($simulator ? 'phoenix-sim-' : 'phoenix-') . $rel['version'] . '-' . $rel['build'] . '.raucb';
                $this->updates->publish($compatible, $rel, $bytes, $name);
                return ['feed' => $this->updates->read($compatible, $rel['channel'])];
            }
            if ($m === 'POST' && $p === '/api/admin/updates/withdraw' && $this->updates) {
                $j = $this->json($body);
                $this->updates->withdraw((string) ($j['compatible'] ?? ''), (string) ($j['channel'] ?? 'stable'));
                return ['feed' => $this->updates->read((string) $j['compatible'], (string) ($j['channel'] ?? 'stable'))];
            }
        }
        throw new HttpError('Not found', 404);
    }
}
