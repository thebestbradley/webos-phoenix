<?php
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The catalog: apps, their releases, reviews, reports and opt-outs, and the
// static signed index devices read (docs/APP-STORE.md 3.4):
//
//   <data>/public/v1/key.json        {"key": base64 public key, "name", "fingerprint"}
//   <data>/public/v1/index.json      every listed app (kind pwa, or ipk with
//                                    an approved release), newest release each
//   <data>/public/v1/index.json.sig  base64 Ed25519 signature of index.json
//   <data>/public/v1/packages/       approved .ipk files
//
// Each publish is a new build number; the index expires after 14 days, so
// a mirror cannot serve an old one forever, and devices refuse a build
// older than one they have seen.

declare(strict_types=1);

namespace Phoenix\Marketplace;

final class Catalog
{
    public const EXPIRES_DAYS = 14;

    public function __construct(private Db $db, private Signer $signer, private array $config)
    {
    }

    private function publicDir(): string
    {
        return $this->config['data'] . '/public/v1';
    }

    private function uploadDir(): string
    {
        return $this->config['data'] . '/uploads';
    }

    // ---- Apps ------------------------------------------------------------------------

    public static function validId(string $id): bool
    {
        return (bool) preg_match('/^[A-Za-z0-9]+([._-][A-Za-z0-9]+)+$/', $id) && strlen($id) <= 128;
    }

    /** A developer's new web app (a site with a manifest): pending until an admin approves it. */
    public function submitPwa(array $owner, array $p): array
    {
        $id = (string) ($p['id'] ?? '');
        $manifest = (string) ($p['manifest'] ?? '');
        if (!self::validId($id) || str_starts_with($id, 'org.webosphoenix.')) {
            throw new CheckFailed('id: an app id in your own reverse-DNS namespace (com.example.app)');
        }
        if (!preg_match('#^https://#i', $manifest)) {
            throw new CheckFailed('manifest: the https:// address of the site\'s web app manifest');
        }
        if ($this->db->one('SELECT id FROM apps WHERE id = ?', [$id])) {
            throw new CheckFailed("There is already an app with the id $id");
        }
        $origin = parse_url($manifest, PHP_URL_SCHEME) . '://' . parse_url($manifest, PHP_URL_HOST)
            . (parse_url($manifest, PHP_URL_PORT) ? ':' . parse_url($manifest, PHP_URL_PORT) : '');
        $this->insertApp($id, 'pwa', $owner['id'], $p, 'pending', ['manifest' => $manifest, 'origin' => $origin, 'curated' => 0]);
        return $this->app($id);
    }

    /** A developer's .ipk: checked now, reviewed by an admin. A first upload makes the app (pending). */
    public function submitPackage(array $owner, string $bytes, array $p = []): array
    {
        $pkg = Ipk::check($bytes);
        $id = $pkg['appId'];
        if (str_starts_with($id, 'org.webosphoenix.')) {
            throw new CheckFailed('org.webosphoenix.* ids are Phoenix\'s own');
        }
        $app = $this->db->one('SELECT * FROM apps WHERE id = ?', [$id]);
        if ($app && (int) $app['owner_id'] !== (int) $owner['id']) {
            throw new CheckFailed("The app $id belongs to another developer");
        }
        if ($app && $app['kind'] !== 'ipk') {
            throw new CheckFailed("$id is listed as a web app");
        }
        $dup = $this->db->one("SELECT id FROM releases WHERE app_id = ? AND version = ? AND state != 'rejected'", [$id, $pkg['version']]);
        if ($dup) {
            throw new CheckFailed("Version {$pkg['version']} of $id was uploaded already");
        }
        if (!$app) {
            $p += ['title' => $pkg['appinfo']['title'] ?? $id, 'developer' => $pkg['appinfo']['vendor'] ?? $owner['name'],
                   'summary' => $pkg['control']['Description'] ?? ''];
            $this->insertApp($id, 'ipk', $owner['id'], $p, 'pending', []);
        }
        $file = sprintf('%s_%s_all.ipk', $id, preg_replace('/[^A-Za-z0-9.+~-]/', '_', $pkg['version']));
        @mkdir($this->uploadDir(), 0700, true);
        file_put_contents($this->uploadDir() . '/' . $file, $bytes);
        $this->db->run('INSERT INTO releases (app_id, version, file, size, sha256, state, notes, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [$id, $pkg['version'], $file, strlen($bytes), hash('sha256', $bytes), 'pending', '', Db::now()]);
        return ['app' => $this->app($id), 'release' => $this->db->one('SELECT * FROM releases WHERE id = ?', [$this->db->lastId()])];
    }

    private function insertApp(string $id, string $kind, ?int $ownerId, array $p, string $status, array $extra): void
    {
        $cats = array_values(array_filter((array) ($p['categories'] ?? []), 'is_string'));
        $this->db->run(
            'INSERT INTO apps (id, kind, owner_id, title, developer_name, developer_url, summary, description, categories, icon,
              screenshots, license, homepage, donation, featured, manifest, origin, version, status, curated, created, updated)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [$id, $kind, $ownerId, mb_substr((string) ($p['title'] ?? $id), 0, 80), mb_substr((string) ($p['developer'] ?? ''), 0, 80),
             (string) ($p['developerUrl'] ?? ''), mb_substr((string) ($p['summary'] ?? ''), 0, 300), (string) ($p['description'] ?? ''),
             json_encode(array_slice($cats, 0, 5)), (string) ($p['icon'] ?? ''), json_encode(array_values((array) ($p['screenshots'] ?? []))),
             (string) ($p['license'] ?? ''), (string) ($p['homepage'] ?? ''), (string) ($p['donation'] ?? ''), !empty($p['featured']) ? 1 : 0,
             $extra['manifest'] ?? '', $extra['origin'] ?? '', (string) ($p['version'] ?? '1.0.0'), $status, $extra['curated'] ?? 0,
             Db::now(), Db::now()]
        );
    }

    public function app(string $id): ?array
    {
        $a = $this->db->one('SELECT * FROM apps WHERE id = ?', [$id]);
        if (!$a) {
            return null;
        }
        $a['categories'] = json_decode($a['categories'] ?: '[]', true);
        $a['screenshots'] = json_decode($a['screenshots'] ?: '[]', true);
        $a['featured'] = (bool) $a['featured'];
        $a['curated'] = (bool) $a['curated'];
        $a['rating'] = $this->rating($id);
        $a['releases'] = $this->db->all("SELECT id, version, size, sha256, state, created, decided FROM releases WHERE app_id = ? ORDER BY id DESC", [$id]);
        return $a;
    }

    private function rating(string $id): ?array
    {
        $r = $this->db->one('SELECT AVG(stars) AS stars, COUNT(*) AS n FROM reviews WHERE app_id = ? AND hidden = 0', [$id]);
        return $r && (int) $r['n'] > 0 ? ['stars' => round((float) $r['stars'], 1), 'count' => (int) $r['n']] : null;
    }

    // ---- Decisions (admins) ------------------------------------------------------------

    public function setStatus(string $id, string $status): void
    {
        if (!in_array($status, ['listed', 'pulled', 'pending'], true) || !$this->db->run('UPDATE apps SET status = ?, updated = ? WHERE id = ?', [$status, Db::now(), $id])) {
            throw new CheckFailed("No app $id");
        }
    }

    public function decideRelease(int $rid, bool $approve, array $reviewer, string $notes = ''): array
    {
        $r = $this->db->one('SELECT * FROM releases WHERE id = ?', [$rid]);
        if (!$r || $r['state'] !== 'pending') {
            throw new CheckFailed("No pending release $rid");
        }
        $this->db->run('UPDATE releases SET state = ?, notes = ?, reviewer_id = ?, decided = ? WHERE id = ?',
            [$approve ? 'approved' : 'rejected', $notes, $reviewer['id'], Db::now(), $rid]);
        if ($approve) {
            @mkdir($this->publicDir() . '/packages', 0755, true);
            copy($this->uploadDir() . '/' . $r['file'], $this->publicDir() . '/packages/' . $r['file']);
            // An approved first release lists the app.
            $this->db->run("UPDATE apps SET status = 'listed', version = ?, updated = ? WHERE id = ? AND status = 'pending'",
                [$r['version'], Db::now(), $r['app_id']]);
            $this->db->run('UPDATE apps SET version = ?, updated = ? WHERE id = ?', [$r['version'], Db::now(), $r['app_id']]);
        }
        return $this->db->one('SELECT * FROM releases WHERE id = ?', [$rid]);
    }

    // ---- Reviews, reports, opt-outs ---------------------------------------------------------

    public function review(array $account, string $appId, int $stars, string $text): array
    {
        if (!$this->db->one("SELECT id FROM apps WHERE id = ? AND status = 'listed'", [$appId])) {
            throw new CheckFailed("No app $appId");
        }
        if ($stars < 1 || $stars > 5) {
            throw new CheckFailed('stars: 1 to 5');
        }
        $text = mb_substr(trim($text), 0, 2000);
        if ($this->db->one('SELECT id FROM reviews WHERE app_id = ? AND account_id = ?', [$appId, $account['id']])) {
            $this->db->run('UPDATE reviews SET stars = ?, text = ?, created = ? WHERE app_id = ? AND account_id = ?',
                [$stars, $text, Db::now(), $appId, $account['id']]);
        } else {
            $this->db->run('INSERT INTO reviews (app_id, account_id, stars, text, created) VALUES (?, ?, ?, ?, ?)',
                [$appId, $account['id'], $stars, $text, Db::now()]);
        }
        return ['rating' => $this->rating($appId)];
    }

    public function reviews(string $appId): array
    {
        return $this->db->all('SELECT r.id, r.stars, r.text, r.created, a.name FROM reviews r JOIN accounts a ON a.id = r.account_id
                               WHERE r.app_id = ? AND r.hidden = 0 ORDER BY r.id DESC LIMIT 100', [$appId]);
    }

    public function report(string $appId, string $kind, string $text, string $contact): int
    {
        if (!in_array($kind, ['abuse', 'malware', 'legal', 'broken'], true)) {
            throw new CheckFailed('kind: abuse, malware, legal or broken');
        }
        $this->db->run('INSERT INTO reports (app_id, kind, text, contact, state, created) VALUES (?, ?, ?, ?, ?, ?)',
            [$appId, $kind, mb_substr($text, 0, 4000), mb_substr($contact, 0, 190), 'open', Db::now()]);
        return $this->db->lastId();
    }

    /** A site asks not to be listed (curated web apps: Phoenix picks, sites opt out). */
    public function optOut(string $origin, string $contact, string $text): int
    {
        $o = parse_url($origin);
        if (empty($o['scheme']) || empty($o['host'])) {
            throw new CheckFailed('origin: the site\'s address, https://example.com');
        }
        $origin = strtolower($o['scheme'] . '://' . $o['host'] . (isset($o['port']) ? ':' . $o['port'] : ''));
        $this->db->run('INSERT INTO optouts (origin, contact, text, state, created) VALUES (?, ?, ?, ?, ?)',
            [$origin, mb_substr($contact, 0, 190), mb_substr($text, 0, 4000), 'open', Db::now()]);
        return $this->db->lastId();
    }

    /** An admin accepts an opt-out: the curated listings on that origin are pulled. */
    public function acceptOptOut(int $id): int
    {
        $o = $this->db->one("SELECT * FROM optouts WHERE id = ? AND state = 'open'", [$id]);
        if (!$o) {
            throw new CheckFailed("No open opt-out $id");
        }
        $this->db->run("UPDATE optouts SET state = 'accepted' WHERE id = ?", [$id]);
        return $this->db->run("UPDATE apps SET status = 'pulled', updated = ? WHERE kind = 'pwa' AND curated = 1 AND LOWER(origin) = ?",
            [Db::now(), $o['origin']]);
    }

    // ---- The curated web apps -----------------------------------------------------------------

    /** catalog/curated-pwas.json (bin/probe-pwas.py) into the catalog, listed; opted-out origins stay out. */
    public function seedCurated(string $file): int
    {
        $list = json_decode((string) file_get_contents($file), true)['apps'] ?? [];
        $optedOut = array_column($this->db->all("SELECT origin FROM optouts WHERE state = 'accepted'"), 'origin');
        $n = 0;
        foreach ($list as $e) {
            if (in_array(strtolower($e['origin']), $optedOut, true)) {
                continue;
            }
            $row = ['title' => $e['title'], 'developer' => $e['developer'] ?? '', 'summary' => $e['summary'] ?? '',
                    'categories' => $e['categories'] ?? [], 'icon' => $e['icon'] ?? '', 'featured' => !empty($e['featured']),
                    'homepage' => $e['origin'] . '/'];
            if ($this->db->one('SELECT id FROM apps WHERE id = ?', [$e['id']])) {
                $this->db->run('UPDATE apps SET title = ?, developer_name = ?, summary = ?, categories = ?, icon = ?, featured = ?,
                                manifest = ?, origin = ?, updated = ? WHERE id = ? AND curated = 1',
                    [$row['title'], $row['developer'], $row['summary'], json_encode($row['categories']), $row['icon'],
                     $row['featured'] ? 1 : 0, $e['manifest'], $e['origin'], Db::now(), $e['id']]);
            } else {
                $this->insertApp($e['id'], 'pwa', null, $row, 'listed', ['manifest' => $e['manifest'], 'origin' => $e['origin'], 'curated' => 1]);
            }
            $n++;
        }
        return $n;
    }

    // ---- Publishing ---------------------------------------------------------------------------

    public function publish(): array
    {
        $apps = [];
        $categories = [];
        foreach ($this->db->all("SELECT id FROM apps WHERE status = 'listed' ORDER BY featured DESC, title") as $row) {
            $a = $this->app($row['id']);
            $e = [
                'id' => $a['id'], 'kind' => $a['kind'], 'title' => $a['title'],
                'developer' => array_filter(['name' => $a['developer_name'], 'url' => $a['developer_url']]),
                'summary' => $a['summary'], 'description' => (string) $a['description'], 'categories' => $a['categories'],
                'icon' => $a['icon'], 'screenshots' => $a['screenshots'], 'license' => $a['license'], 'homepage' => $a['homepage'],
                'donation' => $a['donation'], 'featured' => $a['featured'], 'rating' => $a['rating'], 'version' => $a['version'],
            ];
            if ($a['kind'] === 'pwa') {
                $e['pwa'] = ['manifest' => $a['manifest'], 'origin' => $a['origin']];
            } else {
                $r = $this->db->one("SELECT * FROM releases WHERE app_id = ? AND state = 'approved' ORDER BY id DESC", [$a['id']]);
                if (!$r) {
                    continue;
                }
                $e['version'] = $r['version'];
                $e['release'] = ['url' => $this->config['base_url'] . 'packages/' . rawurlencode($r['file']), 'size' => (int) $r['size'],
                                 'sha256' => $r['sha256']];
            }
            foreach ($a['categories'] as $c) {
                $categories[$c] = true;
            }
            $apps[] = $e;
        }
        $last = $this->db->one('SELECT MAX(build) AS b FROM index_builds');
        $build = (int) ($last['b'] ?? 0) + 1;
        $now = time();
        $index = [
            'version' => 1, 'build' => $build, 'generated' => gmdate('Y-m-d\TH:i:s\Z', $now),
            'expires' => gmdate('Y-m-d\TH:i:s\Z', $now + self::EXPIRES_DAYS * 86400),
            'source' => ['id' => 'phoenix', 'name' => $this->config['name']],
            'categories' => array_keys($categories), 'apps' => $apps,
        ];
        $json = json_encode($index, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) . "\n";
        $dir = $this->publicDir();
        @mkdir($dir, 0755, true);
        // The signature first, then the index: a reader never sees an index without its signature.
        file_put_contents("$dir/index.json.sig.new", base64_encode($this->signer->sign($json)) . "\n");
        file_put_contents("$dir/index.json.new", $json);
        rename("$dir/index.json.sig.new", "$dir/index.json.sig");
        rename("$dir/index.json.new", "$dir/index.json");
        file_put_contents("$dir/key.json", json_encode(['key' => base64_encode($this->signer->public), 'name' => $this->config['name'],
                                                         'fingerprint' => $this->signer->fingerprint()], JSON_UNESCAPED_SLASHES) . "\n");
        $this->db->run('INSERT INTO index_builds (build, generated, sha256) VALUES (?, ?, ?)', [$build, $index['generated'], hash('sha256', $json)]);
        return ['build' => $build, 'apps' => count($apps)];
    }
}
