<?php
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The catalog: apps, their releases, reviews, reports and opt-outs, and the
// static signed index devices read (docs/APP-STORE.md 3.4):
//
//   <data>/public/v1/key.json        {"key": base64 public key, "name", "fingerprint"}
//   <data>/public/v1/index.json      every listed app (kind pwa, or ipk with
//                                    an approved release), newest release each,
//                                    and the account types (catalog/accounts.json)
//   <data>/public/v1/index.json.sig  base64 Ed25519 signature of index.json
//   <data>/public/v1/packages/       approved .ipk files
//   <data>/public/v1/icons/accounts/ the account types' icons
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

    /** The checkout the account types' icons are copied from. */
    private function repo(): string
    {
        return $this->config['repo'] ?? dirname(__DIR__, 3);
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

    /**
     * A developer's .ipk: checked now, reviewed by an admin. A first upload makes the app (pending).
     * A Synergy connector (a service in its app) is kind "connector": it must pass the connector
     * rules (Connector::checkIpk) and say what Connections shows (catalog.json, connectorTypes).
     * On a development catalog (MARKETPLACE_DEV: serve.sh, the simulator's) the release is
     * approved at once ('approved' in the result: publish then).
     */
    public function submitPackage(array $owner, string $bytes, array $p = []): array
    {
        $pkg = Ipk::check($bytes, true);
        $id = $pkg['appId'];
        // Phoenix's own packages (the connectors it comes with, firstPartyPackages) are an admin's.
        $phoenix = ($owner['role'] ?? '') === 'admin';
        if (str_starts_with($id, 'org.webosphoenix.') && !$phoenix) {
            throw new CheckFailed('org.webosphoenix.* ids are Phoenix\'s own');
        }
        $kind = $pkg['connector'] ? 'connector' : 'ipk';
        if ($pkg['connector']) {
            $this->checkConnectorPackage($bytes, $phoenix ? ['org.webosphoenix', 'com.webosphoenix'] : []);
        }
        $app = $this->db->one('SELECT * FROM apps WHERE id = ?', [$id]);
        if ($app && (int) $app['owner_id'] !== (int) $owner['id']) {
            throw new CheckFailed("The app $id belongs to another developer");
        }
        if ($app && $app['kind'] !== $kind) {
            throw new CheckFailed($app['kind'] === 'pwa' ? "$id is listed as a web app" : "$id is listed as " . ($app['kind'] === 'connector' ? 'a connector' : 'an app'));
        }
        $dup = $this->db->one("SELECT id FROM releases WHERE app_id = ? AND version = ? AND state != 'rejected'", [$id, $pkg['version']]);
        if ($dup) {
            throw new CheckFailed("Version {$pkg['version']} of $id was uploaded already");
        }
        if (!$app) {
            $p += ['title' => $pkg['appinfo']['title'] ?? $id, 'developer' => $pkg['appinfo']['vendor'] ?? $owner['name'],
                   'summary' => $pkg['control']['Description'] ?? ''];
            $this->insertApp($id, $kind, $owner['id'], $p, 'pending', []);
        }
        $file = sprintf('%s_%s_all.ipk', $id, preg_replace('/[^A-Za-z0-9.+~-]/', '_', $pkg['version']));
        @mkdir($this->uploadDir(), 0700, true);
        file_put_contents($this->uploadDir() . '/' . $file, $bytes);
        $this->db->run('INSERT INTO releases (app_id, version, file, size, sha256, state, notes, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [$id, $pkg['version'], $file, strlen($bytes), hash('sha256', $bytes), 'pending', '', Db::now()]);
        $release = $this->db->one('SELECT * FROM releases WHERE id = ?', [$this->db->lastId()]);
        if (!empty($this->config['dev'])) {
            $release = $this->decideRelease((int) $release['id'], true, $owner, 'Approved on upload: a development catalog (MARKETPLACE_DEV)');
        }
        return ['app' => $this->app($id), 'release' => $release];
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
        if ($status === 'listed') {
            $this->copyMedia($id);
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
            $this->copyMedia($r['app_id']);
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

    /**
     * catalog/curated-pwas.json (bin/probe-pwas.py) into the catalog, listed; opted-out origins stay
     * out. With $whole (the file is the whole list), a curated web app it no longer has (its
     * manifest gone) is set 'gone', not listed; a later list that has it back lists it again. One
     * an admin pulled stays pulled.
     */
    public function seedCurated(string $file, bool $whole = false): int
    {
        $list = json_decode((string) file_get_contents($file), true)['apps'] ?? [];
        $optedOut = array_column($this->db->all("SELECT origin FROM optouts WHERE state = 'accepted'"), 'origin');
        $n = 0;
        foreach ($list as $e) {
            if (in_array(strtolower($e['origin']), $optedOut, true)) {
                continue;
            }
            $icon = $e['icon'] ?? '';
            // A good manifest whose icons are all broken (the probe's
            // iconGenerated): an icon made here, served with the catalog.
            if (!empty($e['iconGenerated']) && is_array($e['iconGenerated'])) {
                $icon = $this->writeGeneratedIcon($e['id'], (string) ($e['iconGenerated']['text'] ?? ''),
                                                  (string) ($e['iconGenerated']['color'] ?? ''), $e['title']);
            }
            $row = ['title' => $e['title'], 'developer' => $e['developer'] ?? '', 'summary' => $e['summary'] ?? '',
                    'categories' => $e['categories'] ?? [], 'icon' => $icon, 'featured' => !empty($e['featured']),
                    'homepage' => $e['origin'] . '/'];
            if ($this->db->one('SELECT id FROM apps WHERE id = ?', [$e['id']])) {
                $this->db->run("UPDATE apps SET title = ?, developer_name = ?, summary = ?, categories = ?, icon = ?, featured = ?,
                                manifest = ?, origin = ?, updated = ?, status = CASE WHEN status = 'gone' THEN 'listed' ELSE status END
                                WHERE id = ? AND curated = 1",
                    [$row['title'], $row['developer'], $row['summary'], json_encode($row['categories']), $row['icon'],
                     $row['featured'] ? 1 : 0, $e['manifest'], $e['origin'], Db::now(), $e['id']]);
            } else {
                $this->insertApp($e['id'], 'pwa', null, $row, 'listed', ['manifest' => $e['manifest'], 'origin' => $e['origin'], 'curated' => 1]);
            }
            $n++;
        }
        if ($whole) {
            $ids = array_column($list, 'id');
            foreach ($this->db->all("SELECT id FROM apps WHERE kind = 'pwa' AND curated = 1 AND status = 'listed'") as $r) {
                if (!in_array($r['id'], $ids, true)) {
                    $this->db->run("UPDATE apps SET status = 'gone', updated = ? WHERE id = ?", [Db::now(), $r['id']]);
                }
            }
        }
        return $n;
    }

    // ---- Generated icons ----------------------------------------------------------------------

    /** Where a generated icon is published (under the catalog's own URL). */
    public function generatedIconUrl(string $id): string
    {
        return $this->config['base_url'] . 'icons/' . preg_replace('/[^A-Za-z0-9._-]/', '_', $id) . '.svg';
    }

    /**
     * An icon for a site whose manifest's icons are all broken: its initials
     * (the probe's, e.g. "GN", "NYT", "F1"; else the title's first letter) in
     * white, or near black on a light colour, on a rounded square of $color
     * (the manifest's theme_color, as the probe found it). A plain SVG with no
     * scripts or outside references.
     */
    public static function generatedIcon(string $text, string $color, string $title = ''): string
    {
        $text = mb_strtoupper(trim($text) !== '' ? mb_substr(trim($text), 0, 3) : mb_substr(trim($title), 0, 1)) ?: '?';
        if (!preg_match('/^#[0-9a-fA-F]{6}$/', $color)) {
            $color = '#37474f';
        }
        [$r, $g, $b] = array_map('hexdec', str_split(substr($color, 1), 2));
        // Relative luminance (WCAG): light colours get dark letters.
        $lin = fn ($c) => ($c /= 255) <= 0.03928 ? $c / 12.92 : (($c + 0.055) / 1.055) ** 2.4;
        $light = 0.2126 * $lin($r) + 0.7152 * $lin($g) + 0.0722 * $lin($b) > 0.4;
        $ink = $light ? '#1a1a1a' : '#ffffff';
        $size = [1 => 120, 2 => 104, 3 => 80][mb_strlen($text)];
        $t = htmlspecialchars($text, ENT_XML1 | ENT_QUOTES, 'UTF-8');
        return '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">'
            . '<rect x="8" y="8" width="240" height="240" rx="52" fill="' . strtolower($color) . '"/>'
            . '<text x="128" y="128" dy="0.35em" text-anchor="middle" font-family="Open Sans, Helvetica, Arial, sans-serif"'
            . ' font-weight="700" font-size="' . $size . '" fill="' . $ink . '">' . $t . '</text></svg>' . "\n";
    }

    /** Write $id's generated icon into the published files; its URL. */
    private function writeGeneratedIcon(string $id, string $text, string $color, string $title): string
    {
        $dir = $this->publicDir() . '/icons';
        @mkdir($dir, 0755, true);
        file_put_contents("$dir/" . preg_replace('/[^A-Za-z0-9._-]/', '_', $id) . '.svg', self::generatedIcon($text, $color, $title));
        return $this->generatedIconUrl($id);
    }

    // ---- Pictures copied from the sites -------------------------------------------------------

    /** The images a copy may be, by their first bytes: extension => content type. */
    private const IMAGE_TYPES = ['png' => 'image/png', 'jpg' => 'image/jpeg', 'gif' => 'image/gif',
                                 'webp' => 'image/webp', 'ico' => 'image/x-icon'];
    /** What each kind of copy is called in the published files, and how big one may be. */
    private const COPIES = ['icon' => ['icons/copy', 2 * 1024 * 1024], 'screenshot' => ['screenshots/copy', 8 * 1024 * 1024]];

    /**
     * Where the catalog serves its copy of a picture of app $id's ('icon' or 'screenshot') that
     * lives on another site (a curated web app's icon as bin/probe-pwas.py found it, a developer's
     * screenshots). Devices then ask the catalog, not the site: the pictures show wherever the
     * catalog is reachable (phoenix-sim's local catalog included), a device's browsing tells the
     * sites nothing, and a site renaming a hashed file breaks no listing. The name changes with
     * the address, so a new picture is a new copy.
     */
    public function copyUrl(string $kind, string $id, string $src): string
    {
        return $this->config['base_url'] . self::COPIES[$kind][0] . '/' . self::copyName($id, $src);
    }

    private static function copyName(string $id, string $src): string
    {
        return preg_replace('/[^A-Za-z0-9._-]/', '_', $id) . '-' . substr(sha1($src), 0, 12);
    }

    /** Whether $src is a picture on another site, which the index names as the catalog's copy. */
    private function isOutside(string $src): bool
    {
        return (bool) preg_match('#^https?://#i', $src) && !str_starts_with($src, $this->config['base_url']);
    }

    /** An app's icon as the index gives it. */
    private function publishedIcon(array $a): string
    {
        $src = (string) $a['icon'];
        return $this->isOutside($src) ? $this->copyUrl('icon', $a['id'], $src) : $src;
    }

    /** An app's screenshots as the index gives them. */
    private function publishedScreenshots(array $a): array
    {
        return array_map(fn ($src) => is_string($src) && $this->isOutside($src) ? $this->copyUrl('screenshot', $a['id'], $src) : $src,
                         (array) $a['screenshots']);
    }

    /**
     * The picture at <kind's folder>/$name: [content type, bytes, kept], or null for none. The
     * first request fetches it from its site (SafeFetch: https to public addresses only) and keeps
     * it (a PNG, JPEG, GIF, WebP or ICO by its own bytes, never an SVG from a site). One that cannot
     * be had is tried again after an hour; meanwhile an icon is the app's initials, not kept, so a
     * list never shows an empty square, and a screenshot is not there (the gallery leaves it out).
     */
    public function mediaCopy(string $kind, string $name): ?array
    {
        if (!isset(self::COPIES[$kind]) || !preg_match('/^([A-Za-z0-9._-]+)-([0-9a-f]{12})$/', $name, $m)) {
            return null;
        }
        $a = $this->db->one('SELECT id, title, icon, screenshots FROM apps WHERE id = ?', [$m[1]]);
        if (!$a) {
            return null;
        }
        $sources = $kind === 'icon' ? [(string) $a['icon']] : (array) json_decode($a['screenshots'] ?: '[]', true);
        $src = null;
        foreach ($sources as $s) {
            if (is_string($s) && $this->isOutside($s) && self::copyName($a['id'], $s) === $name) {
                $src = $s;
            }
        }
        if ($src === null) {
            return null;
        }
        [$folder, $max] = self::COPIES[$kind];
        $dir = $this->publicDir() . '/' . $folder;
        foreach (self::IMAGE_TYPES as $ext => $type) {
            if (is_file("$dir/$name.$ext")) {
                return [$type, (string) file_get_contents("$dir/$name.$ext"), true];
            }
        }
        $failed = "$dir/$name.failed";
        if (!is_file($failed) || filemtime($failed) < time() - 3600) {
            $bytes = isset($this->config['media_fetch']) ? ($this->config['media_fetch'])($src, $max)
                                                        : SafeFetch::fromConfig($this->config)->get($src, $max);
            $ext = is_string($bytes) && strlen($bytes) <= $max ? self::imageType($bytes) : null;
            @mkdir($dir, 0755, true);
            if ($ext !== null) {
                file_put_contents("$dir/$name.$ext", $bytes);
                @unlink($failed);
                return [self::IMAGE_TYPES[$ext], $bytes, true];
            }
            touch($failed);
        }
        return $kind === 'icon' ? ['image/svg+xml', self::generatedIcon('', '', (string) $a['title']), false] : null;
    }

    /** Copies an app's pictures now (an admin listing it), so a device's first look waits on nothing. */
    private function copyMedia(string $id): void
    {
        $a = $this->app($id);
        if (!$a) {
            return;
        }
        if ($this->isOutside((string) $a['icon'])) {
            $this->mediaCopy('icon', self::copyName($id, (string) $a['icon']));
        }
        foreach ($a['screenshots'] as $s) {
            if (is_string($s) && $this->isOutside($s)) {
                $this->mediaCopy('screenshot', self::copyName($id, $s));
            }
        }
    }

    /** The image type of $bytes (an IMAGE_TYPES extension), or null for anything else. */
    public static function imageType(string $bytes): ?string
    {
        return match (true) {
            str_starts_with($bytes, "\x89PNG\r\n\x1a\n") => 'png',
            str_starts_with($bytes, "\xff\xd8\xff") => 'jpg',
            str_starts_with($bytes, 'GIF87a'), str_starts_with($bytes, 'GIF89a') => 'gif',
            str_starts_with($bytes, 'RIFF') && substr($bytes, 8, 4) === 'WEBP' => 'webp',
            str_starts_with($bytes, "\x00\x00\x01\x00") => 'ico',
            default => null,
        };
    }

    // ---- Account types (the Marketplace's Connections view) -------------------------------------

    /** The values each account type's fields may take (docs/SYNERGY-CONNECTORS.md 2.1). */
    public const ACCOUNT_ENUMS = [
        'direction' => ['two-way', 'read-only', 'write-only'],
        'auth.type' => ['password', 'app-password', 'oauth', 'api-key', 'none'],
        'auth.registration' => ['none', 'required'],
        'server' => ['user', 'fixed', 'discovered'],
        'privacy.phoenixServers' => ['none', 'push-relay', 'token-relay'],
        'push' => ['poll', 'unifiedpush', 'relay'],
        'status' => ['stable', 'beta', 'experimental'],
    ];

    /**
     * The account types in $file (catalog/accounts.json), checked, as the index gives them, with
     * where each icon is copied from: [[entry, iconFrom | null], ...]. A bad entry throws
     * CheckFailed, naming it, so a publish never writes half a list. Phase C0 lists the built-in
     * types only; connector packages (builtin false) come with phase C4.
     */
    public function accountTypes(?string $file = null): array
    {
        $file ??= $this->config['accounts'] ?? dirname(__DIR__) . '/catalog/accounts.json';
        $list = json_decode((string) @file_get_contents($file), true);
        if (!is_array($list) || !isset($list['accounts']) || !is_array($list['accounts']) || !array_is_list($list['accounts'])) {
            throw new CheckFailed("$file: not a list of account types ({\"accounts\": [...]})");
        }
        $out = [];
        $seen = [];
        foreach ($list['accounts'] as $i => $e) {
            $id = is_array($e) && is_string($e['templateId'] ?? null) ? $e['templateId'] : "#$i";
            try {
                $checked = $this->accountType(is_array($e) ? $e : []);
            } catch (CheckFailed $x) {
                throw new CheckFailed("account type $id: " . $x->getMessage());
            }
            if (isset($seen[$id])) {
                throw new CheckFailed("account type $id: listed twice");
            }
            $seen[$id] = true;
            $out[] = $checked;
        }
        return $out;
    }

    /**
     * One account type, checked: [entry as published, iconFrom | null]. $fromPackage: a connector
     * package's (connectorTypes): builtin false, its icon written from the package, not iconFrom.
     */
    private function accountType(array $e, bool $fromPackage = false): array
    {
        $fields = ['templateId', 'title', 'provider', 'icon', 'iconFrom', 'summary', 'capabilities', 'protocols', 'auth', 'server',
                   'privacy', 'push', 'status', 'package', 'help', 'signUp', 'featured'];
        if ($extra = array_diff(array_keys($e), $fields)) {
            throw new CheckFailed('unknown fields: ' . implode(', ', $extra));
        }
        $text = function (string $k, int $max) use ($e): string {
            if (!is_string($e[$k] ?? null) || trim($e[$k]) === '' || mb_strlen($e[$k]) > $max) {
                throw new CheckFailed("$k: a text of 1 to $max characters");
            }
            return $e[$k];
        };
        $oneOf = function (string $name, $v): string {
            if (!is_string($v) || !in_array($v, self::ACCOUNT_ENUMS[$name], true)) {
                throw new CheckFailed("$name: one of " . implode(', ', self::ACCOUNT_ENUMS[$name]));
            }
            return $v;
        };
        if (!is_string($e['templateId'] ?? null) || !self::validId($e['templateId'])) {
            throw new CheckFailed('templateId: a template id (reverse-DNS, as com.example.account)');
        }
        $caps = [];
        if (!is_array($e['capabilities'] ?? null) || !$e['capabilities'] || !array_is_list($e['capabilities'])) {
            throw new CheckFailed('capabilities: at least one {capability, direction?}');
        }
        foreach ($e['capabilities'] as $c) {
            // The template's own names (capabilityProviders[].capability): CONTACTS, MAIL, ...
            if (!is_array($c) || array_diff(array_keys($c), ['capability', 'direction'])
                || !is_string($c['capability'] ?? null) || !preg_match('/^[A-Z][A-Z0-9_]*(\.[A-Z0-9_]+)*$/', $c['capability'])) {
                throw new CheckFailed('capabilities: {capability: an upper-case name as the template has it, direction?}');
            }
            $caps[] = ['capability' => $c['capability']] + (isset($c['direction']) ? ['direction' => $oneOf('direction', $c['direction'])] : []);
        }
        $protocols = $e['protocols'] ?? null;
        if (!is_array($protocols) || !array_is_list($protocols)
            || array_filter($protocols, fn ($p) => !is_string($p) || !preg_match('/^[a-z0-9][a-z0-9.+-]{0,39}$/', $p))) {
            throw new CheckFailed('protocols: a list of lower-case protocol names ("caldav", "imap")');
        }
        $auth = $e['auth'] ?? null;
        $privacy = $e['privacy'] ?? null;
        $package = $e['package'] ?? null;
        if (!is_array($auth) || array_diff(array_keys($auth), ['type', 'registration'])) {
            throw new CheckFailed('auth: {type, registration}');
        }
        if (!is_array($privacy) || array_diff(array_keys($privacy), ['dataGoesTo', 'e2ee', 'phoenixServers'])
            || !is_string($privacy['dataGoesTo'] ?? null) || trim($privacy['dataGoesTo']) === '' || mb_strlen($privacy['dataGoesTo']) > 200
            || !is_bool($privacy['e2ee'] ?? null)) {
            throw new CheckFailed('privacy: {dataGoesTo: a text, e2ee: true or false, phoenixServers}');
        }
        if (!is_array($package) || array_diff(array_keys($package), ['id', 'builtin', 'preinstalled'])
            || !is_string($package['id'] ?? null) || !self::validId($package['id'])) {
            throw new CheckFailed('package: {id: the providing app or service, builtin, preinstalled?}');
        }
        // Here (catalog/accounts.json): built in (part of the system, never removed: the generic
        // logins), or a first-party connector package Phoenix comes with (builtin false,
        // preinstalled true: removable, installed again from the catalog; the package is uploaded
        // as Phoenix's own, firstPartyPackages). A developer's connector lists its own (catalog.json).
        $preinstalled = $package['preinstalled'] ?? false;
        if (!is_bool($preinstalled) || ($preinstalled && ($package['builtin'] ?? null) !== false)) {
            throw new CheckFailed('package: preinstalled is true or false, and only for a package (builtin: false)');
        }
        if ($fromPackage ? (($package['builtin'] ?? null) !== false || $preinstalled)
                         : (($package['builtin'] ?? null) !== true && !$preinstalled)) {
            throw new CheckFailed($fromPackage ? 'package: a connector package\'s (builtin: false)'
                : 'package: built in (builtin: true), or a connector package Phoenix comes with (builtin: false, preinstalled: true); '
                  . 'any other connector package lists its own (catalog.json)');
        }
        // The icon: a file under the published icons/accounts/, copied from iconFrom (a file in
        // this checkout), or an https:// address.
        $icon = $e['icon'] ?? null;
        $from = $e['iconFrom'] ?? null;
        if (is_string($icon) && preg_match('#^https://[^\s]+$#i', $icon)) {
            if ($from !== null) {
                throw new CheckFailed('iconFrom: only for an icon published here (icons/accounts/...)');
            }
        } elseif (!is_string($icon) || !preg_match('#^icons/accounts/[A-Za-z0-9][A-Za-z0-9._-]*\.png$#', $icon)) {
            throw new CheckFailed('icon: icons/accounts/<name>.png (published here) or an https:// address');
        } elseif ($fromPackage) {
            // Written from the package's own template icon (connectorTypes).
        } elseif (!is_string($from) || str_contains($from, '..') || str_starts_with($from, '/')
                  || !is_file($this->repo() . '/' . $from)
                  || self::imageType((string) file_get_contents($this->repo() . '/' . $from)) !== 'png') {
            throw new CheckFailed('iconFrom: a PNG in this checkout, by its path from the top (apps/dav/...)');
        }
        if (isset($e['help']) && (!is_string($e['help']) || !preg_match('#^https://[^\s]{1,490}$#i', $e['help']))) {
            throw new CheckFailed('help: an https:// address');
        }
        // Where a person without an account gets one (docs/SYNERGY-SDK.md "Sign-up link"): https only.
        if (array_key_exists('signUp', $e) && !Connector::isHttps($e['signUp'])) {
            throw new CheckFailed('signUp: an https:// address');
        }
        if (isset($e['featured']) && !is_bool($e['featured'])) {
            throw new CheckFailed('featured: true or false');
        }
        $entry = [
            'templateId' => $e['templateId'], 'title' => $text('title', 80), 'provider' => $text('provider', 80),
            'icon' => str_starts_with($icon, 'icons/') ? $this->config['base_url'] . $icon : $icon,
            'summary' => $text('summary', 300), 'capabilities' => $caps, 'protocols' => $protocols,
            'auth' => ['type' => $oneOf('auth.type', $auth['type'] ?? null), 'registration' => $oneOf('auth.registration', $auth['registration'] ?? null)],
            'server' => $oneOf('server', $e['server'] ?? null),
            'privacy' => ['dataGoesTo' => $privacy['dataGoesTo'], 'e2ee' => $privacy['e2ee'],
                          'phoenixServers' => $oneOf('privacy.phoenixServers', $privacy['phoenixServers'] ?? null)],
            'push' => $oneOf('push', $e['push'] ?? null), 'status' => $oneOf('status', $e['status'] ?? null),
            'package' => ['id' => $package['id'], 'builtin' => $package['builtin']] + ($preinstalled ? ['preinstalled' => true] : []),
        ];
        if (isset($e['help'])) {
            $entry['help'] = $e['help'];
        }
        if (isset($e['signUp'])) {
            $entry['signUp'] = $e['signUp'];
        }
        $entry['featured'] = !empty($e['featured']);
        return [$entry, str_starts_with($icon, 'icons/') && !$fromPackage ? [$from, $icon] : null];
    }

    // ---- Connector packages (docs/SYNERGY-CONNECTORS.md 2.2, phase C4) -------------------------
    //
    // A Synergy connector is an .ipk whose app carries a service (service/), its account
    // templates (public/accounts/<id>/<id>.json) and its kinds. The catalog takes one that passes
    // the connector rules (Connector::checkIpk, the same as `phoenix-connector validate`), lists it
    // in the index as kind "connector" (devices before C4 do not know the kind and leave it out),
    // and lists its account types in the index's "accounts" for Connections, with builtin false.
    // Devices install one only in Developer Mode until the connector trust tier (C5; the owner's
    // decision, SYNERGY-CONNECTORS.md 5). What Connections says of each type that the template
    // does not (its summary, where the data goes, how it signs in) is the developer's, in
    // catalog.json at the app's root:
    //
    //   {"accountTypes": [{"templateId", "summary", "auth": {type, registration}, "server",
    //     "privacy": {dataGoesTo, e2ee, phoenixServers}, "protocols"?, "push"?, "status"?,
    //     "help"?, "title"?, "provider"?, "capabilities"?, ...}]}
    //
    // with the same fields and rules as catalog/accounts.json's (accountType); title, provider
    // and capabilities default to the template's loc_name, the app's vendor and its capability
    // providers (readOnlyData: read-only), status to experimental, push to poll. The icon is the
    // template's own (loc_48x48, its @2x when there is one).

    /** A connector .ipk's checks: the connector rules, then its account types. Throws CheckFailed. */
    private function checkConnectorPackage(string $bytes, array $namespaces = []): array
    {
        $r = Connector::checkIpk($bytes, $namespaces);
        if ($r['errors']) {
            throw new CheckFailed("The connector does not pass the Marketplace's checks (phoenix-connector validate runs the same):\n  "
                                  . implode("\n  ", $r['errors']));
        }
        return $this->connectorTypes($bytes);
    }

    /** A connector package's account types: [[entry as published, icon PNG bytes], ...]. Throws CheckFailed. */
    public function connectorTypes(string $bytes): array
    {
        $ar = Ipk::readAr($bytes);
        $data = Ipk::readTar((string) @gzdecode($ar['data.tar.gz'] ?? ''));
        $appId = null;
        foreach (array_keys($data) as $path) {
            if (preg_match('#^usr/palm/applications/([^/]+)/appinfo\.json$#', (string) $path, $m)) {
                $appId = $m[1];
            }
        }
        if ($appId === null) {
            throw new CheckFailed('The package holds no app');
        }
        $dir = "usr/palm/applications/$appId/";
        $file = fn (string $rel): ?string => ($data[$dir . $rel]['type'] ?? '') === 'file' ? $data[$dir . $rel]['data'] : null;
        $json = fn (string $rel) => json_decode(preg_replace('/^\xEF\xBB\xBF/', '', (string) $file($rel)), true);
        $info = $json('appinfo.json');
        $meta = $json('catalog.json');
        if (!is_array($meta) || !is_array($meta['accountTypes'] ?? null) || !array_is_list($meta['accountTypes'])) {
            throw new CheckFailed('catalog.json: a connector says what Connections shows of its account types, '
                                  . '{"accountTypes": [{"templateId", "summary", "auth", "server", "privacy", ...}]} (docs/SYNERGY-SDK.md)');
        }
        $byId = [];
        foreach ($meta['accountTypes'] as $m) {
            if (!is_array($m) || !is_string($m['templateId'] ?? null)) {
                throw new CheckFailed('catalog.json: each account type names its templateId');
            }
            $byId[$m['templateId']] = $m;
        }
        $out = [];
        foreach (array_keys($data) as $path) {
            if (!preg_match('#^' . preg_quote($dir, '#') . 'public/accounts/([^/]+)/([^/]+)\.json$#', (string) $path, $pm) || $pm[1] !== $pm[2]) {
                continue;
            }
            $tpl = $json("public/accounts/{$pm[1]}/{$pm[1]}.json");
            foreach (is_array($tpl) && array_is_list($tpl) ? $tpl : [$tpl] as $t) {
                $tid = is_array($t) ? (string) ($t['templateId'] ?? '') : '';
                if (!isset($byId[$tid])) {
                    throw new CheckFailed("catalog.json: nothing for the template $tid (its summary, where its data goes, how it signs in)");
                }
                $m = $byId[$tid];
                unset($byId[$tid]);
                $caps = [];
                foreach ((array) ($t['capabilityProviders'] ?? []) as $cp) {
                    if (is_array($cp) && is_string($cp['capability'] ?? null) && !isset($caps[$cp['capability']])) {
                        $caps[$cp['capability']] = ['capability' => $cp['capability']] + (!empty($cp['readOnlyData']) ? ['direction' => 'read-only'] : []);
                    }
                }
                // The template's icon, at twice its size when the package has it.
                $png = null;
                foreach (['loc_48x48', 'loc_32x32'] as $k) {
                    $rel = $t['icon'][$k] ?? null;
                    if (!is_string($rel) || $png !== null) {
                        continue;
                    }
                    foreach ([preg_replace('/\.png$/', '@2x.png', $rel), $rel] as $try) {
                        $b = $file("public/accounts/$tid/$try");
                        if ($png === null && $b !== null && self::imageType($b) === 'png') {
                            $png = $b;
                        }
                    }
                }
                if ($png === null) {
                    throw new CheckFailed("the template $tid has no PNG icon (icon.loc_48x48) for Connections");
                }
                $e = ['templateId' => $tid, 'title' => $m['title'] ?? $t['loc_name'] ?? $tid, 'provider' => $m['provider'] ?? $info['vendor'] ?? $appId,
                      'icon' => "icons/accounts/$tid.png", 'summary' => $m['summary'] ?? null,
                      'capabilities' => $m['capabilities'] ?? array_values($caps), 'protocols' => $m['protocols'] ?? [],
                      'auth' => $m['auth'] ?? null, 'server' => $m['server'] ?? null, 'privacy' => $m['privacy'] ?? null,
                      'push' => $m['push'] ?? 'poll', 'status' => $m['status'] ?? 'experimental',
                      'package' => ['id' => $appId, 'builtin' => false]];
                // Any other field an account type has (help, ...) is checked as catalog/accounts.json's
                // are; only Phoenix features a type.
                $e = array_merge($e, array_diff_key($m, $e + ['featured' => 1]));
                try {
                    [$entry] = $this->accountType($e, true);
                } catch (CheckFailed $x) {
                    throw new CheckFailed("catalog.json, $tid: " . $x->getMessage());
                }
                $out[] = [$entry, $png];
            }
        }
        if ($byId) {
            throw new CheckFailed('catalog.json: no template ' . implode(', ', array_keys($byId)) . ' in the package');
        }
        if (!$out) {
            throw new CheckFailed('The connector has no account template');
        }
        return $out;
    }

    /**
     * The listed connectors' account types, from their newest approved release, each template
     * once and none of $taken's (the built-in ones). One that no longer passes is left out (logged).
     */
    private function listedConnectorTypes(array $taken): array
    {
        $out = [];
        $seen = array_fill_keys($taken, true);
        foreach ($this->db->all("SELECT id FROM apps WHERE kind = 'connector' AND status = 'listed' ORDER BY title") as $row) {
            $r = $this->db->one("SELECT * FROM releases WHERE app_id = ? AND state = 'approved' ORDER BY id DESC", [$row['id']]);
            $bytes = $r ? @file_get_contents($this->publicDir() . '/packages/' . $r['file']) : false;
            if (!is_string($bytes)) {
                continue;
            }
            try {
                $types = $this->connectorTypes($bytes);
            } catch (CheckFailed $e) {
                error_log("marketplace: the connector {$row['id']} is left out of Connections: " . $e->getMessage());
                continue;
            }
            foreach ($types as $t) {
                if (!isset($seen[$t[0]['templateId']])) {
                    $seen[$t[0]['templateId']] = true;
                    $out[] = $t;
                }
            }
        }
        return $out;
    }

    // ---- Publishing ---------------------------------------------------------------------------

    public function publish(): array
    {
        // The account types first: a bad catalog/accounts.json stops the publish, and the
        // index devices have stays as it was.
        $accountTypes = $this->accountTypes();
        // The connector packages' own (after the built-in ones, which they cannot replace).
        $connectorTypes = $this->listedConnectorTypes(array_column(array_column($accountTypes, 0), 'templateId'));
        $apps = [];
        $categories = [];
        foreach ($this->db->all("SELECT id FROM apps WHERE status = 'listed' ORDER BY featured DESC, title") as $row) {
            $a = $this->app($row['id']);
            $e = [
                'id' => $a['id'], 'kind' => $a['kind'], 'title' => $a['title'],
                'developer' => array_filter(['name' => $a['developer_name'], 'url' => $a['developer_url']]),
                'summary' => $a['summary'], 'description' => (string) $a['description'], 'categories' => $a['categories'],
                'icon' => $this->publishedIcon($a), 'screenshots' => $this->publishedScreenshots($a), 'license' => $a['license'], 'homepage' => $a['homepage'],
                'donation' => $a['donation'], 'featured' => $a['featured'], 'rating' => $a['rating'], 'version' => $a['version'],
            ];
            if ($a['kind'] === 'pwa') {
                $e['pwa'] = ['manifest' => $a['manifest'], 'origin' => $a['origin']];
                // Its icon made here (the site's are broken): devices install it.
                if ($a['icon'] === $this->generatedIconUrl($a['id'])) {
                    $e['iconGenerated'] = true;
                }
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
            'accounts' => array_merge(array_column($accountTypes, 0), array_column($connectorTypes, 0)),
        ];
        $json = json_encode($index, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) . "\n";
        $dir = $this->publicDir();
        @mkdir($dir, 0755, true);
        // The account types' icons, before the index that names them.
        foreach ($accountTypes as [, $copy]) {
            if ($copy) {
                @mkdir(dirname("$dir/{$copy[1]}"), 0755, true);
                copy($this->repo() . '/' . $copy[0], "$dir/{$copy[1]}");
            }
        }
        foreach ($connectorTypes as [$entry, $png]) {
            @mkdir("$dir/icons/accounts", 0755, true);
            file_put_contents("$dir/icons/accounts/{$entry['templateId']}.png", $png);
        }
        // The signature first, then the index: a reader never sees an index without its signature.
        file_put_contents("$dir/index.json.sig.new", base64_encode($this->signer->sign($json)) . "\n");
        file_put_contents("$dir/index.json.new", $json);
        rename("$dir/index.json.sig.new", "$dir/index.json.sig");
        rename("$dir/index.json.new", "$dir/index.json");
        file_put_contents("$dir/key.json", json_encode(['key' => base64_encode($this->signer->public), 'name' => $this->config['name'],
                                                         'fingerprint' => $this->signer->fingerprint()], JSON_UNESCAPED_SLASHES) . "\n");
        $this->db->run('INSERT INTO index_builds (build, generated, sha256) VALUES (?, ?, ?)', [$build, $index['generated'], hash('sha256', $json)]);
        return ['build' => $build, 'apps' => count($apps), 'accounts' => count($accountTypes) + count($connectorTypes)];
    }
}
