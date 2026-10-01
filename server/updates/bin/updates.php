<?php
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The system update feed com.palm.update reads (services/updates): one JSON
// file per device type and channel, next to its bundles, in a folder any web
// server can serve (here data/feed, or $UPDATES_FEED):
//
//   <feed>/<compatible>/<channel>.json   {"format": 1, "compatible", "channel",
//                                         "release": {name, version, build, date,
//                                         notes, url, size, sha256}}
//   <feed>/<compatible>/<bundle>.raucb
//
// The feed is not signed: the bundles are (RAUC checks them against the
// keyring in the running system), and the device installs only a bundle
// newer than what it runs.
//
//   php bin/updates.php publish BUNDLE --compatible C --version V --build N
//                                [--channel stable|beta] [--name NAME]
//                                [--date YYYY-MM-DD] [--note TEXT]...
//       copies the bundle in and makes it the channel's release; with RAUC
//       installed here, the bundle's own manifest must say the same
//   php bin/updates.php simulator --version V --build N [--channel C] [--note TEXT]...
//       the same for the simulator: its stand-in bundle (the manifest only),
//       compatible "phoenix-sim"
//   php bin/updates.php withdraw --compatible C [--channel C]
//       no release on the channel (devices close its alerts)
//   php bin/updates.php show [--compatible C]

declare(strict_types=1);

const CHANNELS = ['stable', 'beta'];

function feed_dir(): string
{
    $dir = getenv('UPDATES_FEED') ?: dirname(__DIR__) . '/data/feed';
    if (!is_dir($dir) && !mkdir($dir, 0755, true)) fail("Cannot make $dir");
    return $dir;
}

function fail(string $msg): never
{
    fwrite(STDERR, "updates: $msg\n");
    exit(1);
}

/** --key value options (--note repeats); the rest are arguments. */
function options(array $argv): array
{
    $opts = ['note' => []];
    $args = [];
    for ($i = 0; $i < count($argv); $i++) {
        if (str_starts_with($argv[$i], '--')) {
            $k = substr($argv[$i], 2);
            $v = $argv[++$i] ?? fail("--$k needs a value");
            if ($k === 'note') $opts['note'][] = $v;
            else $opts[$k] = $v;
        } else {
            $args[] = $argv[$i];
        }
    }
    return [$opts, $args];
}

function check_name(string $what, string $v): string
{
    if (!preg_match('/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/', $v)) fail("$what: letters, digits, '.', '_' and '-' only");
    return $v;
}

function release_from(array $o): array
{
    $version = check_name('--version', $o['version'] ?? fail('--version is required'));
    $build = $o['build'] ?? fail('--build is required');
    if (!ctype_digit($build) || (int) $build < 1) fail('--build: a whole number, 1 or more');
    $channel = $o['channel'] ?? 'stable';
    if (!in_array($channel, CHANNELS, true)) fail('--channel: ' . implode(' or ', CHANNELS));
    $date = $o['date'] ?? gmdate('Y-m-d');
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) fail('--date: YYYY-MM-DD');
    return ['name' => $o['name'] ?? 'webOS Phoenix', 'version' => $version, 'build' => (int) $build,
            'date' => $date, 'notes' => $o['note'], 'channel' => $channel];
}

/** RAUC's view of the bundle (signature checked), when RAUC is installed here. */
function rauc_info(string $bundle): ?array
{
    $rauc = trim((string) shell_exec('command -v rauc 2>/dev/null'));
    if ($rauc === '') return null;
    exec(escapeshellarg($rauc) . ' info --output-format=json ' . escapeshellarg($bundle) . ' 2>&1', $out, $code);
    if ($code !== 0) fail('RAUC refuses the bundle: ' . end($out));
    return json_decode(implode("\n", $out), true);
}

function write_release(string $compatible, array $rel, string $bundleBytes, string $bundleName): string
{
    $dir = feed_dir() . '/' . $compatible;
    if (!is_dir($dir) && !mkdir($dir, 0755, true)) fail("Cannot make $dir");
    $channel = $rel['channel'];
    $feedFile = "$dir/$channel.json";
    $old = is_file($feedFile) ? json_decode((string) file_get_contents($feedFile), true) : null;
    $last = max((int) ($old['release']['build'] ?? 0), (int) ($old['withdrawn']['build'] ?? 0));
    if ($last >= $rel['build'])
        fail("The $channel channel has had build $last; a release needs a higher build number");
    file_put_contents("$dir/$bundleName.part", $bundleBytes);
    rename("$dir/$bundleName.part", "$dir/$bundleName");
    unset($rel['channel']);
    $rel['url'] = $bundleName;
    $rel['size'] = strlen($bundleBytes);
    $rel['sha256'] = hash('sha256', $bundleBytes);
    $feed = ['format' => 1, 'compatible' => $compatible, 'channel' => $channel, 'release' => $rel];
    file_put_contents("$feedFile.part", json_encode($feed, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . "\n");
    rename("$feedFile.part", $feedFile);
    return $feedFile;
}

[$o, $args] = options(array_slice($argv, 1));
$cmd = array_shift($args) ?? 'help';

switch ($cmd) {
    case 'publish':
        $bundle = $args[0] ?? fail('publish BUNDLE: the .raucb file');
        if (!is_file($bundle)) fail("No such file: $bundle");
        $compatible = check_name('--compatible', $o['compatible'] ?? fail('--compatible is required'));
        $rel = release_from($o);
        $info = rauc_info($bundle);
        if ($info !== null && ($info['compatible'] !== $compatible || $info['version'] !== $rel['version']
                || (string) $info['build'] !== (string) $rel['build']))
            fail("The bundle says {$info['compatible']} {$info['version']} build {$info['build']}");
        $name = check_name('bundle name', "phoenix-{$rel['version']}-{$rel['build']}.raucb");
        echo write_release($compatible, $rel, (string) file_get_contents($bundle), $name), "\n";
        if ($info === null) echo "(RAUC is not installed here: the bundle's manifest was not compared)\n";
        break;

    case 'simulator':
        $rel = release_from($o);
        $manifest = "[update]\ncompatible=phoenix-sim\nversion={$rel['version']}\nbuild={$rel['build']}\n";
        echo write_release('phoenix-sim', $rel, $manifest, "phoenix-sim-{$rel['version']}-{$rel['build']}.raucb"), "\n";
        break;

    case 'withdraw':
        $compatible = check_name('--compatible', $o['compatible'] ?? fail('--compatible is required'));
        $channel = $o['channel'] ?? 'stable';
        if (!in_array($channel, CHANNELS, true)) fail('--channel: ' . implode(' or ', CHANNELS));
        $file = feed_dir() . "/$compatible/$channel.json";
        $feed = is_file($file) ? json_decode((string) file_get_contents($file), true) : null;
        if (!$feed) fail("Nothing published for $compatible on $channel");
        // The build stays known, so a later release must still be higher.
        $feed['withdrawn'] = $feed['release'];
        $feed['release'] = null;
        file_put_contents($file, json_encode($feed, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . "\n");
        echo "$file\n";
        break;

    case 'show':
        foreach (glob(feed_dir() . '/' . ($o['compatible'] ?? '*') . '/*.json') as $f) {
            $feed = json_decode((string) file_get_contents($f), true);
            $r = $feed['release'];
            printf("%-24s %-7s %s\n", $feed['compatible'], $feed['channel'], $r ? "{$r['version']} (build {$r['build']}, {$r['size']} bytes)" : 'none');
        }
        break;

    default:
        fwrite(STDERR, "usage: php bin/updates.php publish|simulator|withdraw|show (see the top of this file)\n");
        exit($cmd === 'help' ? 0 : 1);
}
