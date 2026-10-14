<?php
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// bin/updates.php against a feed in a temporary folder: php tests/run.php

declare(strict_types=1);

$feed = sys_get_temp_dir() . '/phoenix-updates-' . getmypid();
putenv("UPDATES_FEED=$feed");
$bin = escapeshellarg(dirname(__DIR__) . '/bin/updates.php');
$failed = 0;

function run(string $args, ?int &$code = null): string
{
    global $bin;
    exec("php $bin $args 2>&1", $out, $code);
    return implode("\n", $out);
}
function check(string $what, bool $ok): void
{
    global $failed;
    echo ($ok ? 'ok   ' : 'FAIL ') . $what . "\n";
    if (!$ok) $failed++;
}
function feedOf(string $compatible, string $channel = 'stable'): ?array
{
    global $feed;
    $f = "$feed/$compatible/$channel.json";
    return is_file($f) ? json_decode((string) file_get_contents($f), true) : null;
}

// A bundle (RAUC is not installed here: the manifest is not compared).
$bundle = "$feed-bundle.raucb";
file_put_contents($bundle, str_repeat("\x00\x01bundle", 100));

run("publish " . escapeshellarg($bundle) . " --compatible phoenix-pinephonepro --version 1.1.0 --build 110 --note 'Faster cards' --note 'New Marketplace' --date 2026-10-01", $code);
$f = feedOf('phoenix-pinephonepro');
check('publish writes the channel', $code === 0 && $f !== null);
check('the release', $f['format'] === 1 && $f['compatible'] === 'phoenix-pinephonepro' && $f['channel'] === 'stable'
    && $f['release']['version'] === '1.1.0' && $f['release']['build'] === 110 && $f['release']['date'] === '2026-10-01'
    && $f['release']['notes'] === ['Faster cards', 'New Marketplace'] && $f['release']['name'] === 'webOS Phoenix');
check('the bundle, its size and SHA-256', $f['release']['url'] === 'phoenix-1.1.0-110.raucb'
    && $f['release']['size'] === 800 && $f['release']['sha256'] === hash_file('sha256', $bundle)
    && hash_file('sha256', "$feed/phoenix-pinephonepro/phoenix-1.1.0-110.raucb") === hash_file('sha256', $bundle));

$out = run("publish " . escapeshellarg($bundle) . " --compatible phoenix-pinephonepro --version 1.0.9 --build 109", $code);
check('an older build is refused', $code !== 0 && str_contains($out, 'higher build number'));
$out = run("publish " . escapeshellarg($bundle) . " --compatible 'bad/../name' --version 1 --build 1", $code);
check('names are checked', $code !== 0);
$out = run("publish " . escapeshellarg($bundle) . " --compatible phoenix-pinephonepro --version 1.2.0 --build 12x", $code);
check('builds are whole numbers', $code !== 0 && str_contains($out, 'whole number'));
run("publish " . escapeshellarg($bundle) . " --compatible phoenix-pinephonepro --version 1.2.0-beta1 --build 115 --channel beta", $code);
check('channels are separate', $code === 0 && feedOf('phoenix-pinephonepro', 'beta')['release']['build'] === 115
    && feedOf('phoenix-pinephonepro')['release']['build'] === 110);
run("publish " . escapeshellarg($bundle) . " --compatible phoenix-pinephonepro --version 1.3.0-dev.7 --build 130 --channel dev --rollout 25 --seed n7", $code);
$d = feedOf('phoenix-pinephonepro', 'dev')['release'] ?? [];
check('the dev channel, with a staged rollout', $code === 0 && $d['build'] === 130 && $d['rollout'] === ['percent' => 25, 'seed' => 'n7']);
$out = run("publish " . escapeshellarg($bundle) . " --compatible phoenix-pinephonepro --version 1.3.1 --build 131 --channel dev --rollout 120", $code);
check('a rollout is a percentage', $code !== 0 && str_contains($out, 'percentage'));
$out = run("publish " . escapeshellarg($bundle) . " --compatible phoenix-pinephonepro --version 1.3.1 --build 131 --channel nightly", $code);
check('channels are stable, beta and dev', $code !== 0);

run('withdraw --compatible phoenix-pinephonepro', $code);
$f = feedOf('phoenix-pinephonepro');
check('withdraw leaves no release', $code === 0 && $f['release'] === null && $f['withdrawn']['build'] === 110);
$out = run("publish " . escapeshellarg($bundle) . " --compatible phoenix-pinephonepro --version 1.1.0 --build 110", $code);
check('a withdrawn build is not published again', $code !== 0);

run('simulator --version 0.2.0 --build 2 --note Hello', $code);
$f = feedOf('phoenix-sim');
$m = (string) file_get_contents("$feed/phoenix-sim/" . $f['release']['url']);
check("the simulator's stand-in bundle", $code === 0 && $m === "[update]\ncompatible=phoenix-sim\nversion=0.2.0\nbuild=2\n"
    && $f['release']['sha256'] === hash('sha256', $m));
check('show lists them', str_contains(run('show'), 'phoenix-sim'));

// Release notes (docs/APP-STORE.md "Update logs"): the release's entry of the system's notes.
$notes = "$feed-notes.json";
file_put_contents($notes, json_encode(['format' => 1, 'versions' => [
    ['version' => '2.0.0', 'date' => '2026-11-02', 'summary' => 'Faster cards.', 'new' => ['Cards open faster.'],
     'fixed' => ['The clock keeps time after a restart.']],
    ['version' => '1.9.0', 'date' => '2026-10-14', 'summary' => 'The first release.', 'new' => ['Cards.'], 'known' => ['No calls yet.']]]]));
run("publish " . escapeshellarg($bundle) . " --compatible phoenix-pinetab2 --version 2.0.0 --build 200 --release-notes " . escapeshellarg($notes), $code);
$r = feedOf('phoenix-pinetab2')['release'] ?? [];
check('--release-notes: the version\'s entry is the release\'s releaseNotes', $code === 0 && ($r['releaseNotes'] ?? null) === [
    'version' => '2.0.0', 'date' => '2026-11-02', 'summary' => 'Faster cards.', 'new' => ['Cards open faster.'], 'improved' => [],
    'fixed' => ['The clock keeps time after a restart.'], 'known' => []]);
check('... and its lines the notes, for older readers, when no --note is given',
    ($r['notes'] ?? null) === ['Faster cards.', 'Cards open faster.', 'The clock keeps time after a restart.']);
run("publish " . escapeshellarg($bundle) . " --compatible phoenix-pinetab2 --version 1.9.0 --build 201 --channel beta --note 'Our own words' --release-notes " . escapeshellarg($notes), $code);
$r = feedOf('phoenix-pinetab2', 'beta')['release'] ?? [];
check('... the --note lines stay the notes when given', $code === 0 && $r['notes'] === ['Our own words'] && $r['releaseNotes']['known'] === ['No calls yet.']);
$out = run("publish " . escapeshellarg($bundle) . " --compatible phoenix-pinetab2 --version 2.1.0 --build 210 --release-notes " . escapeshellarg($notes), $code);
check('... a version the notes do not have is refused', $code !== 0 && str_contains($out, 'has no notes for 2.1.0'));
file_put_contents($notes, json_encode(['format' => 1, 'versions' => [
    ['version' => '2.1.0', 'date' => '2026-11-09', 'rebuild' => true, 'summary' => 'Faster cards.', 'new' => ['Cards open faster.']]]]));
$out = run("publish " . escapeshellarg($bundle) . " --compatible phoenix-pinetab2 --version 2.1.0 --build 210 --release-notes " . escapeshellarg($notes), $code);
check('... and notes the rules refuse, with their message', $code !== 0
    && str_contains($out, "-notes.json: versions[0].rebuild: the system's release notes have no rebuild"));
// The checkout's own: the file product.json names, its newest version the product's.
$repo = dirname(__DIR__, 3);
$product = json_decode((string) file_get_contents("$repo/product.json"), true);
run('simulator --version ' . escapeshellarg($product['version']) . ' --build 300 --channel dev --release-notes '
    . escapeshellarg("$repo/{$product['releaseNotes']}"), $code);
$sim = feedOf('phoenix-sim', 'dev')['release'] ?? [];
require_once "$repo/server/marketplace/src/CheckFailed.php";
require_once "$repo/server/marketplace/src/Changelog.php";
$own = Phoenix\Marketplace\Changelog::problems(json_decode((string) file_get_contents("$repo/{$product['releaseNotes']}")), $product['version'], true);
check("the checkout's release notes ({$product['releaseNotes']}) pass the rules and start at product.json's version ({$product['version']})"
      . ($own ? ': ' . $own[0] : ''), !$own && $code === 0 && ($sim['releaseNotes']['version'] ?? null) === $product['version']);

exec('rm -rf ' . escapeshellarg($feed) . ' ' . escapeshellarg($bundle) . ' ' . escapeshellarg($notes));
echo $failed ? "$failed failed\n" : "all passed\n";
exit($failed ? 1 : 0);
