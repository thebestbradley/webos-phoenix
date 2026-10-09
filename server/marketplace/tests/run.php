<?php
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The catalog service's tests, against SQLite in a temporary folder:
//
//   php server/marketplace/tests/run.php
//
// Packages are made here with PHP's own tar (PharData) and an ar writer, so
// the .ipk reader is checked against an independent writer; the device's
// side (verifying what is signed here) is in
// apps/marketplace/service/service.test.ts.

declare(strict_types=1);

require __DIR__ . '/../src/bootstrap.php';

use Phoenix\Marketplace\App;

$failures = 0;
function check(bool $ok, string $what): void
{
    global $failures;
    echo ($ok ? 'ok   ' : 'FAIL ') . $what . "\n";
    if (!$ok) {
        $failures++;
    }
}

$tmp = sys_get_temp_dir() . '/phoenix-marketplace-test-' . bin2hex(random_bytes(4));
mkdir($tmp);
putenv("MARKETPLACE_DATA=$tmp/data");
putenv('MARKETPLACE_DSN');
putenv('MARKETPLACE_BASE_URL=http://127.0.0.1:9999/v1/');
// Pictures copied from the sites (Catalog::mediaCopy) come from here, not the network.
$iconReply = null;
$iconFetched = [];
$app = new App(['media_fetch' => function (string $url, int $max) use (&$iconReply, &$iconFetched) {
    $iconFetched[] = $url;
    return $iconReply;
}] + marketplace_config());
$api = $app->api;
$call = function (string $method, string $path, $body = null, ?string $token = null) use ($api): array {
    return $api->handle($method, $path, is_string($body) ? $body : json_encode($body ?? []), $token ? "Bearer $token" : null);
};

// ---- An .ipk, made with PharData (tar) and a small ar writer ----------------------
function ar(array $members): string
{
    $out = "!<arch>\n";
    foreach ($members as $name => $data) {
        $out .= str_pad($name, 16) . str_pad('0', 12) . str_pad('0', 6) . str_pad('0', 6) . str_pad('100644', 8) . str_pad((string) strlen($data), 10) . "`\n";
        $out .= $data . (strlen($data) % 2 ? "\n" : '');
    }
    return $out;
}
function targz(string $dir, array $files): string
{
    $tar = "$dir.tar";
    @unlink($tar);
    @unlink("$tar.gz");
    $p = new PharData($tar);
    foreach ($files as $path => $data) {
        $p->addFromString($path, $data);
    }
    $p->compress(Phar::GZ);
    $bytes = (string) file_get_contents("$tar.gz");
    unset($p);
    @unlink($tar);
    @unlink("$tar.gz");
    return $bytes;
}
function ipk(string $tmp, string $id, string $version, array $extraData = [], array $extraControl = [], array $info = []): string
{
    static $n = 0;
    $n++;
    $control = targz("$tmp/c$n", ['control' => "Package: $id\nVersion: $version\nArchitecture: all\nDescription: Test\n"] + $extraControl);
    $data = targz("$tmp/d$n", [
        "usr/palm/applications/$id/appinfo.json" => json_encode($info + ['id' => $id, 'version' => $version, 'type' => 'web', 'title' => 'Test App', 'main' => 'index.html']),
        "usr/palm/applications/$id/index.html" => '<h1>Hi</h1>',
    ] + $extraData);
    return ar(['debian-binary' => "2.0\n", 'control.tar.gz' => $control, 'data.tar.gz' => $data]);
}

// ---- Accounts --------------------------------------------------------------------
[$s, $dev] = $call('POST', '/api/accounts', ['name' => 'Dana Dev', 'email' => 'dana@example.com', 'role' => 'developer']);
[$s2, $user] = $call('POST', '/api/accounts', ['name' => 'Uma User', 'email' => 'uma@example.com']);
[$s3] = $call('POST', '/api/accounts', ['name' => 'Eve', 'email' => 'eve@example.com', 'role' => 'admin']);
check($s === 200 && strlen($dev['token']) === 48 && $user['role'] === 'user' && $s3 === 403, 'accounts: developers and users register; nobody registers as admin');
check(!$app->db->one('SELECT id FROM accounts WHERE token_hash = ?', [$dev['token']]), 'only a hash of the token is kept');
$admin = $api->createAccount('Admin', 'admin@example.com', 'admin')['token'];

// ---- Curated web apps, then a first publish ------------------------------------------------
$curated = $app->catalog->seedCurated(dirname(__DIR__) . '/catalog/curated-pwas.json');
check($curated >= 20, "the curated web apps are listed ($curated)");
$pub = $app->catalog->publish();
$index = file_get_contents("$tmp/data/public/v1/index.json");
$sig = base64_decode(trim(file_get_contents("$tmp/data/public/v1/index.json.sig")));
$key = base64_decode(json_decode(file_get_contents("$tmp/data/public/v1/key.json"), true)['key']);
check(sodium_crypto_sign_verify_detached($sig, $index, $key), 'the index is signed with the published key');
$idx = json_decode($index, true);
check($idx['version'] === 1 && $idx['build'] === $pub['build'] && count($idx['apps']) === $curated && strtotime($idx['expires']) > time() + 13 * 86400,
      'version 1, a build number, every listed app, expiring in 14 days');
$x = array_values(array_filter($idx['apps'], fn ($a) => $a['id'] === 'org.webosphoenix.pwa.x'))[0] ?? null;
check($x && $x['kind'] === 'pwa' && str_starts_with($x['pwa']['manifest'], 'https://x.com/') && $x['pwa']['origin'] === 'https://x.com',
      'a curated web app: its manifest and origin');
$xName = basename((string) $x['icon']);
check(!isset($x['iconGenerated']) && str_starts_with($x['icon'], 'http://127.0.0.1:9999/v1/icons/copy/org.webosphoenix.pwa.x-'),
      '... with its own icon, served by the catalog (a copy of the site\'s)');
// The copy: fetched from the site the first time, kept; served as the image it is.
$png = "\x89PNG\r\n\x1a\n" . str_repeat("\0", 24);
$iconReply = $png;
$c1 = $app->catalog->mediaCopy('icon', $xName);
$c2 = $app->catalog->mediaCopy('icon', $xName);
check($c1 === ['image/png', $png, true] && $c2 === $c1 && count($iconFetched) === 1
      && $iconFetched[0] === $app->catalog->app('org.webosphoenix.pwa.x')['icon'] && is_file("$tmp/data/public/v1/icons/copy/$xName.png"),
      'an icon copy is fetched from the site once and kept');
// A site that answers with something else: the initials stand in, not kept, and the site is not asked again at once.
$mName = basename((string) (array_values(array_filter($idx['apps'], fn ($a) => $a['id'] === 'org.webosphoenix.pwa.mastodon'))[0]['icon'] ?? ''));
$iconReply = '<html>not an image</html>';
$m1 = $app->catalog->mediaCopy('icon', $mName);
$m2 = $app->catalog->mediaCopy('icon', $mName);
check($m1[0] === 'image/svg+xml' && str_contains($m1[1], '>M</text>') && $m1[2] === false && $m2 === $m1 && count($iconFetched) === 2,
      'an icon the site does not give: the initials meanwhile, tried again later');
check($app->catalog->mediaCopy('icon', 'org.webosphoenix.pwa.x-000000000000') === null && $app->catalog->mediaCopy('icon', '../index.json') === null
      && $app->catalog->mediaCopy('icon', 'com.example.none-' . substr(sha1('x'), 0, 12)) === null, 'only the copies the index names');
check(Phoenix\Marketplace\Catalog::imageType("GIF89a...") === 'gif' && Phoenix\Marketplace\Catalog::imageType('<svg onload="x">') === null,
      'icons are images by their own bytes; no SVG from a site');
// A good manifest whose icons are all broken (the probe's iconGenerated): listed, with an icon made here.
foreach (['org.webosphoenix.pwa.groundnews' => 'GN', 'org.webosphoenix.pwa.nytgames' => 'NYT', 'org.webosphoenix.pwa.formula1' => 'F1'] as $gid => $letters) {
    $g = array_values(array_filter($idx['apps'], fn ($a) => $a['id'] === $gid))[0] ?? null;
    $file = "$tmp/data/public/v1/icons/$gid.svg";
    $svg = is_file($file) ? file_get_contents($file) : '';
    check($g && ($g['iconGenerated'] ?? false) === true && $g['icon'] === "http://127.0.0.1:9999/v1/icons/$gid.svg"
          && str_contains($svg, ">$letters</text>") && str_starts_with($svg, '<svg ') && !str_contains($svg, '<script'),
          "$gid: listed with a generated icon ($letters), published with the catalog");
}
$light = Phoenix\Marketplace\Catalog::generatedIcon('ab', '#ffeb3b');
$dark = Phoenix\Marketplace\Catalog::generatedIcon('', '#000000', 'Wordle <&>');
$bad = Phoenix\Marketplace\Catalog::generatedIcon('x"><script>', 'red');
check(str_contains($light, '>AB</text>') && str_contains($light, 'fill="#1a1a1a"') && str_contains($dark, '>W</text>')
      && str_contains($dark, 'fill="#ffffff"') && !str_contains($bad, '<script') && str_contains($bad, 'fill="#37474f"'),
      'a generated icon: up to three letters, dark on a light colour, escaped, a default colour');

// ---- A developer's package ------------------------------------------------------------------
[$s, $r] = $call('POST', '/api/apps/packages', ipk($tmp, 'com.example.notes', '1.0.0'));
check($s === 401, 'uploading needs an account');
[$s, $r] = $call('POST', '/api/apps/packages', ipk($tmp, 'com.example.notes', '1.0.0'), $user['token']);
check($s === 403, '... a developer account');
[$s, $r] = $call('POST', '/api/apps/packages', ipk($tmp, 'com.example.notes', '1.0.0'), $dev['token']);
check($s === 200 && $r['release']['state'] === 'pending' && $r['app']['status'] === 'pending', 'a package passes the checks and waits for review');
$rid = (int) $r['release']['id'];
[$s, $r] = $call('POST', '/api/apps/packages', ipk($tmp, 'com.example.notes', '1.0.0'), $dev['token']);
check($s === 400 && str_contains($r['error'], 'uploaded already'), 'the same version twice is refused');
$bad = [
    ['scripts', ipk($tmp, 'com.example.a', '1.0', [], ['postinst' => "#!/bin/sh\nrm -rf /\n"]), 'maintainer script'],
    ['outside', ipk($tmp, 'com.example.b', '1.0', ['etc/evil.conf' => 'x']), 'outside its app'],
    ['native', ipk($tmp, 'com.example.c', '1.0', [], [], ['type' => 'pdk']), 'Only web apps'],
    ['our ids', ipk($tmp, 'org.webosphoenix.fake', '1.0'), 'Phoenix'],
    ['not a package', '<html>no</html>', 'Not an .ipk'],
];
foreach ($bad as [$what, $bytes, $why]) {
    [$s, $r] = $call('POST', '/api/apps/packages', $bytes, $dev['token']);
    check($s === 400 && str_contains($r['error'], $why), "refused: $what ($r[error])");
}
[$s] = $call('GET', '/api/apps/com.example.notes');
check($s === 404, 'a pending app is not public');

// ---- Review -----------------------------------------------------------------------------------
[$s] = $call('POST', "/api/admin/releases/$rid/approve", [], $dev['token']);
check($s === 403, 'only admins decide');
[$s, $r] = $call('GET', '/api/admin/queue', null, $admin);
check($s === 200 && count($r['releases']) === 1, 'the queue has the release');
[$s, $r] = $call('POST', "/api/admin/releases/$rid/approve", [], $admin);
check($s === 200 && $r['release']['state'] === 'approved' && $r['publish']['build'] === $pub['build'] + 1, 'approving publishes a new build');
$idx = json_decode(file_get_contents("$tmp/data/public/v1/index.json"), true);
$notes = array_values(array_filter($idx['apps'], fn ($a) => $a['id'] === 'com.example.notes'))[0] ?? null;
$file = "$tmp/data/public/v1/packages/com.example.notes_1.0.0_all.ipk";
check($notes && $notes['kind'] === 'ipk' && $notes['release']['url'] === 'http://127.0.0.1:9999/v1/packages/com.example.notes_1.0.0_all.ipk'
      && is_file($file) && $notes['release']['sha256'] === hash_file('sha256', $file) && $notes['release']['size'] === filesize($file),
      'the approved package is published with its size and SHA-256');
[$s, $r] = $call('POST', '/api/apps/packages', ipk($tmp, 'com.example.notes', '1.1.0'), $dev['token']);
$rid2 = (int) $r['release']['id'];
[$s, $r] = $call('POST', "/api/admin/releases/$rid2/reject", ['notes' => 'crashes on start'], $admin);
check($r['release']['state'] === 'rejected' && $r['release']['notes'] === 'crashes on start', 'a rejected update keeps the old one listed');
$idx = json_decode(file_get_contents("$tmp/data/public/v1/index.json"), true);
$notes = array_values(array_filter($idx['apps'], fn ($a) => $a['id'] === 'com.example.notes'))[0] ?? null;
check($notes['version'] === '1.0.0', '... at 1.0.0');
[$s, $other] = $call('POST', '/api/accounts', ['name' => 'Mallory', 'email' => 'm@example.com', 'role' => 'developer']);
[$s, $r] = $call('POST', '/api/apps/packages', ipk($tmp, 'com.example.notes', '2.0.0'), $other['token']);
check($s === 400 && str_contains($r['error'], 'another developer'), 'nobody else can upload to an app');

// ---- A developer's web app ----------------------------------------------------------------------
[$s, $r] = $call('POST', '/api/apps', ['kind' => 'pwa', 'id' => 'com.example.weather', 'manifest' => 'http://weather.example.com/m.json'], $dev['token']);
check($s === 400, 'a web app needs an https manifest');
[$s, $r] = $call('POST', '/api/apps', ['kind' => 'pwa', 'id' => 'com.example.weather', 'manifest' => 'https://weather.example.com/m.json',
                                       'title' => 'Weather', 'categories' => ['Weather']], $dev['token']);
check($s === 200 && $r['app']['status'] === 'pending' && $r['app']['origin'] === 'https://weather.example.com', 'a web app submission waits for review');
[$s] = $call('POST', '/api/admin/apps/com.example.weather/list', [], $admin);
[$s, $r] = $call('GET', '/api/apps/com.example.weather');
check($s === 200 && $r['app']['status'] === 'listed', 'an admin lists it');

// ---- Reviews -------------------------------------------------------------------------------------
[$s] = $call('POST', '/api/apps/com.example.notes/reviews', ['stars' => 5, 'text' => 'Great']);
check($s === 401, 'reviews need an account');
$call('POST', '/api/apps/com.example.notes/reviews', ['stars' => 5, 'text' => 'Great'], $user['token']);
[$s, $r] = $call('POST', '/api/apps/com.example.notes/reviews', ['stars' => 3, 'text' => 'OK after all'], $user['token']);
$call('POST', '/api/apps/com.example.notes/reviews', ['stars' => 4], $dev['token']);
check($r['rating'] === ['stars' => 3.0, 'count' => 1], 'one review per account; a second one replaces it');
[$s, $r] = $call('GET', '/api/apps/com.example.notes/reviews');
check(count($r['reviews']) === 2 && $r['reviews'][0]['name'] === 'Dana Dev', 'the reviews, newest first');
[$s, $r] = $call('POST', '/api/apps/com.example.notes/reviews', ['stars' => 9], $user['token']);
check($s === 400, 'stars are 1 to 5');
$app->catalog->publish();
$idx = json_decode(file_get_contents("$tmp/data/public/v1/index.json"), true);
$notes = array_values(array_filter($idx['apps'], fn ($a) => $a['id'] === 'com.example.notes'))[0] ?? null;
check($notes['rating'] === ['stars' => 3.5, 'count' => 2], 'the index carries the average');

// ---- Opt-outs and reports --------------------------------------------------------------------------
[$s, $r] = $call('POST', '/api/optout', ['origin' => 'https://x.com/home', 'contact' => 'legal@x.example', 'text' => 'Please remove']);
check($s === 200, 'a site asks not to be listed');
[$s, $q] = $call('GET', '/api/admin/queue', null, $admin);
check(count($q['optouts']) === 1 && $q['optouts'][0]['origin'] === 'https://x.com', '... the request is queued with its origin');
[$s, $r] = $call('POST', '/api/admin/optouts/' . $q['optouts'][0]['id'] . '/accept', [], $admin);
$idx = json_decode(file_get_contents("$tmp/data/public/v1/index.json"), true);
check($r['pulled'] === 1 && !array_filter($idx['apps'], fn ($a) => $a['id'] === 'org.webosphoenix.pwa.x'), 'accepting it pulls the listing');
$app->catalog->seedCurated(dirname(__DIR__) . '/catalog/curated-pwas.json');
$row = $app->db->one('SELECT status FROM apps WHERE id = ?', ['org.webosphoenix.pwa.x']);
check($row['status'] === 'pulled', '... and seeding the curated list again does not bring it back');
$list = json_decode(file_get_contents(dirname(__DIR__) . '/catalog/curated-pwas.json'), true);
$gone = array_shift($list['apps']);
if ($gone['id'] === 'org.webosphoenix.pwa.x') {
    $gone = array_shift($list['apps']);
}
file_put_contents("$tmp/fewer.json", json_encode($list));
$st = fn (string $id) => $app->db->one('SELECT status FROM apps WHERE id = ?', [$id])['status'];
$app->catalog->seedCurated("$tmp/fewer.json");
check($st($gone['id']) === 'listed', 'seeding a few curated web apps leaves the others listed');
$app->catalog->seedCurated("$tmp/fewer.json", true);
check($st($gone['id']) === 'gone' && $st('org.webosphoenix.pwa.x') === 'pulled',
      'seeding the whole list: a curated web app it no longer has is not listed (a pulled one stays pulled)');
$app->catalog->seedCurated(dirname(__DIR__) . '/catalog/curated-pwas.json', true);
check($st($gone['id']) === 'listed' && $st('org.webosphoenix.pwa.x') === 'pulled', '... and is listed again when the list has it back');
[$s] = $call('POST', '/api/reports', ['appId' => 'com.example.notes', 'kind' => 'malware', 'text' => 'mines coins']);
[$s2] = $call('POST', '/api/reports', ['appId' => 'com.example.notes', 'kind' => 'meh']);
check($s === 200 && $s2 === 400, 'reports of a known kind are taken');

// ---- Builds only go up ------------------------------------------------------------------------------
$b1 = $app->catalog->publish()['build'];
$b2 = $app->catalog->publish()['build'];
check($b2 === $b1 + 1, 'every publish is a new build');

// ---- Screenshots on other sites: copies too ------------------------------------------------------
$shot = 'https://shots.example.com/one.png';
$app->db->run('UPDATE apps SET screenshots = ? WHERE id = ?', [json_encode([$shot]), 'org.webosphoenix.pwa.devdocs']);
$app->catalog->publish();
$dd = array_values(array_filter(json_decode(file_get_contents("$tmp/data/public/v1/index.json"), true)['apps'],
                                fn ($a) => $a['id'] === 'org.webosphoenix.pwa.devdocs'))[0];
$shotName = basename($dd['screenshots'][0]);
check(str_starts_with($dd['screenshots'][0], 'http://127.0.0.1:9999/v1/screenshots/copy/org.webosphoenix.pwa.devdocs-'),
      'a screenshot on another site is named as the catalog\'s copy');
$iconReply = null;
check($app->catalog->mediaCopy('screenshot', $shotName) === null, '... one that cannot be had is not there (the gallery leaves it out)');
$app->db->run('UPDATE apps SET screenshots = ? WHERE id = ?', [json_encode(['https://shots.example.com/two.png']), 'org.webosphoenix.pwa.devdocs']);
$iconReply = $png;
$two = $app->catalog->mediaCopy('screenshot', 'org.webosphoenix.pwa.devdocs-' . substr(sha1('https://shots.example.com/two.png'), 0, 12));
check($two === ['image/png', $png, true] && end($iconFetched) === 'https://shots.example.com/two.png', '... one that comes is kept and served');

// ---- Fetching the copies: only public sites (SafeFetch) ---------------------------------------------
use Phoenix\Marketplace\SafeFetch;
$refused = ['127.0.0.1', '127.255.0.9', '10.1.2.3', '172.16.5.4', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1',
            '100.127.255.255', '0.0.0.0', '224.0.0.1', '239.255.255.250', '240.0.0.1', '255.255.255.255', '192.0.2.7', '198.18.0.1',
            '::', '::1', '::127.0.0.1', '::ffff:127.0.0.1', '::ffff:8.8.8.8', '64:ff9b::a00:1', '2002:a00:1::', 'fc00::1', 'fd12:3456::1',
            'fe80::1', 'febf::1', 'ff02::1', '2001:db8::1', '2001::1', 'not-an-ip'];
$public = ['8.8.8.8', '1.1.1.1', '100.63.255.255', '100.128.0.1', '172.32.0.1', '192.169.0.1', '93.184.216.34', '2606:4700::1111', '2a00:1450::1'];
$bad = array_filter($refused, fn ($ip) => SafeFetch::isPublic($ip));
$good = array_filter($public, fn ($ip) => !SafeFetch::isPublic($ip));
check(!$bad && !$good, 'SafeFetch: loopback, private, link-local, shared, multicast, reserved and IPv4-in-IPv6 addresses are refused ('
      . implode(' ', $bad) . ') and public ones taken (' . implode(' ', $good) . ')');
$dns = ['meta.example' => ['169.254.169.254'], 'mixed.example' => ['93.184.216.34', '10.0.0.5'], 'ok.example' => ['93.184.216.34'],
        'ok6.example' => ['2606:4700::1111'], 'v6local.example' => ['fd00::1']];
$f = new SafeFetch(false, fn (string $h) => $dns[$h] ?? []);
$planRefused = [];
foreach (['http://ok.example/i.png', 'https://u:p@ok.example/i.png', 'ftp://ok.example/i.png', 'https://10.0.0.1/i.png', 'https://[::1]/i.png',
          'https://[::ffff:127.0.0.1]/i.png', 'https://169.254.169.254/latest/meta-data/', 'https://meta.example/i.png',
          'https://mixed.example/i.png', 'https://v6local.example/i.png', 'https://none.example/i.png', 'http://127.0.0.1/i.png'] as $u) {
    if ($f->plan($u) !== null) {
        $planRefused[] = $u;
    }
}
check(!$planRefused, 'SafeFetch: http, credentials, other schemes, internal addresses and names that resolve to one (any of their addresses) are refused ('
      . implode(' ', $planRefused) . ')');
check(SafeFetch::pin((array) $f->plan('https://ok.example/i.png')) === 'ok.example:443:93.184.216.34'
      && SafeFetch::pin((array) $f->plan('https://ok6.example:8443/i.png')) === 'ok6.example:8443:[2606:4700::1111]',
      'SafeFetch: a public site\'s request is pinned to the address checked');

// A site on this computer, which only the explicit local mode (the simulator's, the tests') reaches.
$sock = stream_socket_server('tcp://127.0.0.1:0');
$port = (int) substr(strrchr(stream_socket_get_name($sock, false), ':'), 1);
fclose($sock);
file_put_contents("$tmp/site.php", '<?php
$p = parse_url($_SERVER["REQUEST_URI"], PHP_URL_PATH);
$png = "\x89PNG\r\n\x1a\n" . str_repeat("\0", 24);
if ($p === "/icon.png") { header("Content-Type: image/png"); echo $png; return; }
if ($p === "/big.png") { header("Content-Type: image/png"); echo $png . str_repeat("\0", 3 * 1024 * 1024); return; }
$to = ["/to-metadata" => "http://169.254.169.254/latest/meta-data/", "/to-private-name" => "http://inside.example:' . $port . '/icon.png",
       "/to-relative" => "/icon.png", "/loop" => "/loop", "/to-https-local" => "https://127.0.0.1:' . $port . '/icon.png"];
if (isset($to[$p])) { header("Location: " . $to[$p], true, 302); return; }
http_response_code(404);');
$site = proc_open(['php', '-S', "127.0.0.1:$port", "$tmp/site.php"], [1 => ['file', '/dev/null', 'w'], 2 => ['file', '/dev/null', 'w']], $pipes);
for ($i = 0; $i < 50 && !@fsockopen('127.0.0.1', $port); $i++) {
    usleep(100000);
}
$lookups = [];
$resolver = function (string $h) use (&$lookups) {
    $lookups[] = $h;
    // Rebinding: the first answer is the allowed one, any later one an internal address.
    if ($h === 'rebind.example') {
        return count(array_keys($lookups, 'rebind.example')) === 1 ? ['127.0.0.1'] : ['10.0.0.1'];
    }
    return $h === 'inside.example' ? ['10.0.0.9'] : [];
};
$local = new SafeFetch(true, $resolver);
$base = "http://127.0.0.1:$port";
check($local->get("$base/icon.png", 1 << 20) === $png, 'SafeFetch local mode: the local test site is reached');
check((new SafeFetch(false, $resolver))->get("$base/icon.png", 1 << 20) === null, '... and only in local mode');
$got = $local->get("http://rebind.example:$port/icon.png", 1 << 20);
check($got === $png && count(array_keys($lookups, 'rebind.example')) === 1,
      'SafeFetch: the connection goes to the address checked, looked up once (a name only the check resolves; rebinding answers later go unasked)');
check($local->get("$base/to-metadata", 1 << 20) === null && str_contains($local->refused, '169.254.169.254'),
      'SafeFetch: a redirect to the cloud metadata address is refused (' . $local->refused . ')');
check($local->get("$base/to-private-name", 1 << 20) === null && str_contains($local->refused, '10.0.0.9'),
      'SafeFetch: a redirect to a name that resolves to a private address is refused (' . $local->refused . ')');
check($local->get("$base/to-relative", 1 << 20) === $png, 'SafeFetch: a redirect on the same site is followed, and checked again');
check($local->get("$base/loop", 1 << 20) === null && $local->refused === 'too many redirects', 'SafeFetch: three redirects at most');
check($local->get("$base/big.png", 1 << 20) === null && str_contains($local->refused, 'larger than'), 'SafeFetch: no more than the size allowed');
check($local->get('http://10.0.0.1/i.png', 1 << 20) === null && $local->get('https://[fe80::1]/i.png', 1 << 20) === null,
      'SafeFetch local mode: still nothing internal besides 127.0.0.1');
proc_terminate($site);

exec('rm -rf ' . escapeshellarg($tmp));
echo $failures ? "\n$failures failed\n" : "\nall passed\n";
exit($failures ? 1 : 0);
