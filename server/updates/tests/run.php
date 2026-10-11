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

run("publish " . escapeshellarg($bundle) . " --compatible phoenix-pinephone --version 1.1.0 --build 110 --note 'Faster cards' --note 'New Marketplace' --date 2026-10-01", $code);
$f = feedOf('phoenix-pinephone');
check('publish writes the channel', $code === 0 && $f !== null);
check('the release', $f['format'] === 1 && $f['compatible'] === 'phoenix-pinephone' && $f['channel'] === 'stable'
    && $f['release']['version'] === '1.1.0' && $f['release']['build'] === 110 && $f['release']['date'] === '2026-10-01'
    && $f['release']['notes'] === ['Faster cards', 'New Marketplace'] && $f['release']['name'] === 'webOS Phoenix');
check('the bundle, its size and SHA-256', $f['release']['url'] === 'phoenix-1.1.0-110.raucb'
    && $f['release']['size'] === 800 && $f['release']['sha256'] === hash_file('sha256', $bundle)
    && hash_file('sha256', "$feed/phoenix-pinephone/phoenix-1.1.0-110.raucb") === hash_file('sha256', $bundle));

$out = run("publish " . escapeshellarg($bundle) . " --compatible phoenix-pinephone --version 1.0.9 --build 109", $code);
check('an older build is refused', $code !== 0 && str_contains($out, 'higher build number'));
$out = run("publish " . escapeshellarg($bundle) . " --compatible 'bad/../name' --version 1 --build 1", $code);
check('names are checked', $code !== 0);
$out = run("publish " . escapeshellarg($bundle) . " --compatible phoenix-pinephone --version 1.2.0 --build 12x", $code);
check('builds are whole numbers', $code !== 0 && str_contains($out, 'whole number'));
run("publish " . escapeshellarg($bundle) . " --compatible phoenix-pinephone --version 1.2.0-beta1 --build 115 --channel beta", $code);
check('channels are separate', $code === 0 && feedOf('phoenix-pinephone', 'beta')['release']['build'] === 115
    && feedOf('phoenix-pinephone')['release']['build'] === 110);
run("publish " . escapeshellarg($bundle) . " --compatible phoenix-pinephone --version 1.3.0-dev.7 --build 130 --channel dev --rollout 25 --seed n7", $code);
$d = feedOf('phoenix-pinephone', 'dev')['release'] ?? [];
check('the dev channel, with a staged rollout', $code === 0 && $d['build'] === 130 && $d['rollout'] === ['percent' => 25, 'seed' => 'n7']);
$out = run("publish " . escapeshellarg($bundle) . " --compatible phoenix-pinephone --version 1.3.1 --build 131 --channel dev --rollout 120", $code);
check('a rollout is a percentage', $code !== 0 && str_contains($out, 'percentage'));
$out = run("publish " . escapeshellarg($bundle) . " --compatible phoenix-pinephone --version 1.3.1 --build 131 --channel nightly", $code);
check('channels are stable, beta and dev', $code !== 0);

run('withdraw --compatible phoenix-pinephone', $code);
$f = feedOf('phoenix-pinephone');
check('withdraw leaves no release', $code === 0 && $f['release'] === null && $f['withdrawn']['build'] === 110);
$out = run("publish " . escapeshellarg($bundle) . " --compatible phoenix-pinephone --version 1.1.0 --build 110", $code);
check('a withdrawn build is not published again', $code !== 0);

run('simulator --version 0.2.0 --build 2 --note Hello', $code);
$f = feedOf('phoenix-sim');
$m = (string) file_get_contents("$feed/phoenix-sim/" . $f['release']['url']);
check("the simulator's stand-in bundle", $code === 0 && $m === "[update]\ncompatible=phoenix-sim\nversion=0.2.0\nbuild=2\n"
    && $f['release']['sha256'] === hash('sha256', $m));
check('show lists them', str_contains(run('show'), 'phoenix-sim'));

exec('rm -rf ' . escapeshellarg($feed) . ' ' . escapeshellarg($bundle));
echo $failed ? "$failed failed\n" : "all passed\n";
exit($failed ? 1 : 0);
