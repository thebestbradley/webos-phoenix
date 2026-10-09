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

    // ---- Icons copied from the sites ----------------------------------------------------------

    /** The images a copied icon may be, by their first bytes: extension => content type. */
    private const ICON_TYPES = ['png' => 'image/png', 'jpg' => 'image/jpeg', 'gif' => 'image/gif',
                                'webp' => 'image/webp', 'ico' => 'image/x-icon'];
    private const ICON_MAX_BYTES = 2 * 1024 * 1024;

    /**
     * Where the catalog serves its copy of an app's icon that lives on another site (a curated web
     * app's, as bin/probe-pwas.py found it). Devices then ask the catalog, not the site: an icon
     * shows wherever the catalog is reachable (phoenix-sim's local catalog included), a device's
     * browsing tells the sites nothing, and a site renaming its hashed icon file breaks no list.
     * The name changes with the address, so a new icon is a new copy.
     */
    public function iconCopyUrl(string $id, string $src): string
    {
        return $this->config['base_url'] . 'icons/copy/' . self::iconCopyName($id, $src);
    }

    private static function iconCopyName(string $id, string $src): string
    {
        return preg_replace('/[^A-Za-z0-9._-]/', '_', $id) . '-' . substr(sha1($src), 0, 12);
    }

    /** An app's icon as the index gives it: a copy here for one on another site. */
    private function publishedIcon(array $a): string
    {
        $src = (string) $a['icon'];
        $own = str_starts_with($src, $this->config['base_url']);
        return !$own && preg_match('#^https?://#i', $src) ? $this->iconCopyUrl($a['id'], $src) : $src;
    }

    /**
     * The icon at icons/copy/$name: [content type, bytes, kept], or null for no such icon. The
     * first request fetches it from the app's site and keeps it (a PNG, JPEG, GIF, WebP or ICO by
     * its own bytes, at most 2 MB). One that cannot be had is tried again after an hour; meanwhile
     * the app's initials stand in, not kept, so a list never shows an empty square.
     */
    public function iconCopy(string $name): ?array
    {
        if (!preg_match('/^([A-Za-z0-9._-]+)-([0-9a-f]{12})$/', $name, $m)) {
            return null;
        }
        $a = $this->db->one('SELECT id, title, icon FROM apps WHERE id = ?', [$m[1]]);
        if (!$a || self::iconCopyName($a['id'], (string) $a['icon']) !== $name) {
            return null;
        }
        $dir = $this->publicDir() . '/icons/copy';
        foreach (self::ICON_TYPES as $ext => $type) {
            if (is_file("$dir/$name.$ext")) {
                return [$type, (string) file_get_contents("$dir/$name.$ext"), true];
            }
        }
        $failed = "$dir/$name.failed";
        if (!is_file($failed) || filemtime($failed) < time() - 3600) {
            $fetch = $this->config['icon_fetch'] ?? [self::class, 'fetchIcon'];
            $bytes = $fetch((string) $a['icon']);
            $ext = is_string($bytes) && strlen($bytes) <= self::ICON_MAX_BYTES ? self::iconType($bytes) : null;
            @mkdir($dir, 0755, true);
            if ($ext !== null) {
                file_put_contents("$dir/$name.$ext", $bytes);
                @unlink($failed);
                return [self::ICON_TYPES[$ext], $bytes, true];
            }
            touch($failed);
        }
        return ['image/svg+xml', self::generatedIcon('', '', (string) $a['title']), false];
    }

    /** The image type of $bytes (an ICON_TYPES extension), or null for anything else. */
    public static function iconType(string $bytes): ?string
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

    /** An icon's bytes from its site (http or https, a few redirects, 8 s), or null. */
    public static function fetchIcon(string $url): ?string
    {
        if (!preg_match('#^https?://#i', $url)) {
            return null;
        }
        if (function_exists('curl_init')) {
            $c = curl_init($url);
            curl_setopt_array($c, [CURLOPT_RETURNTRANSFER => true, CURLOPT_FOLLOWLOCATION => true, CURLOPT_MAXREDIRS => 3,
                CURLOPT_CONNECTTIMEOUT => 4, CURLOPT_TIMEOUT => 8, CURLOPT_USERAGENT => 'PhoenixMarketplace/1 (icon copy)',
                CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS, CURLOPT_REDIR_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
                CURLOPT_MAXFILESIZE => self::ICON_MAX_BYTES,
                // Decoded as a browser would: some CDNs send an icon gzipped unasked (Duolingo's).
                CURLOPT_ENCODING => '']);
            $body = curl_exec($c);
            $ok = is_string($body) && curl_getinfo($c, CURLINFO_RESPONSE_CODE) === 200;
            return $ok ? $body : null;
        }
        $ctx = stream_context_create(['http' => ['timeout' => 8, 'max_redirects' => 3, 'ignore_errors' => false,
                                                 'user_agent' => 'PhoenixMarketplace/1 (icon copy)']]);
        $body = @file_get_contents($url, false, $ctx, 0, self::ICON_MAX_BYTES + 1);
        return is_string($body) ? $body : null;
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
                'icon' => $this->publishedIcon($a), 'screenshots' => $a['screenshots'], 'license' => $a['license'], 'homepage' => $a['homepage'],
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
