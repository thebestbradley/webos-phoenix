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
$app = new App(marketplace_config());
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
[$s] = $call('POST', '/api/reports', ['appId' => 'com.example.notes', 'kind' => 'malware', 'text' => 'mines coins']);
[$s2] = $call('POST', '/api/reports', ['appId' => 'com.example.notes', 'kind' => 'meh']);
check($s === 200 && $s2 === 400, 'reports of a known kind are taken');

// ---- Builds only go up ------------------------------------------------------------------------------
$b1 = $app->catalog->publish()['build'];
$b2 = $app->catalog->publish()['build'];
check($b2 === $b1 + 1, 'every publish is a new build');

exec('rm -rf ' . escapeshellarg($tmp));
echo $failures ? "\n$failures failed\n" : "\nall passed\n";
exit($failures ? 1 : 0);
