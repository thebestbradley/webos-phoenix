<?php
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The system update feed com.palm.update reads (services/updates): one JSON
// file per device type and channel, next to its bundles, in a folder any web
// server can serve (here data/feed, or $UPDATES_FEED; src/UpdateFeed.php
// writes it, as the catalog server does: server/marketplace serves its own
// at /updates/ and publishes with its admin API):
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
//                                [--channel stable|beta|dev] [--name NAME]
//                                [--rollout PERCENT [--seed TEXT]]
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

require dirname(__DIR__) . '/src/UpdateFeed.php';

use Phoenix\Updates\UpdateFeed;

function fail(string $msg): never
{
    fwrite(STDERR, "updates: $msg\n");
    exit(1);
}

function feed(): UpdateFeed
{
    $dir = getenv('UPDATES_FEED') ?: dirname(__DIR__) . '/data/feed';
    if (!is_dir($dir) && !mkdir($dir, 0755, true)) fail("Cannot make $dir");
    return new UpdateFeed($dir);
}

/** --key value options (--note repeats); the rest are arguments. */
function options(array $argv): array
{
    $opts = ['notes' => []];
    $args = [];
    for ($i = 0; $i < count($argv); $i++) {
        if (str_starts_with($argv[$i], '--')) {
            $k = substr($argv[$i], 2);
            $v = $argv[++$i] ?? fail("--$k needs a value");
            if ($k === 'note') $opts['notes'][] = $v;
            else $opts[$k] = $v;
        } else {
            $args[] = $argv[$i];
        }
    }
    return [$opts, $args];
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

[$o, $args] = options(array_slice($argv, 1));
$cmd = array_shift($args) ?? 'help';

try {
    switch ($cmd) {
        case 'publish':
            $bundle = $args[0] ?? fail('publish BUNDLE: the .raucb file');
            if (!is_file($bundle)) fail("No such file: $bundle");
            $compatible = UpdateFeed::checkName('--compatible', $o['compatible'] ?? fail('--compatible is required'));
            $rel = UpdateFeed::release($o);
            $info = rauc_info($bundle);
            if ($info !== null && ($info['compatible'] !== $compatible || $info['version'] !== $rel['version']
                    || (string) $info['build'] !== (string) $rel['build']))
                fail("The bundle says {$info['compatible']} {$info['version']} build {$info['build']}");
            echo feed()->publish($compatible, $rel, (string) file_get_contents($bundle), "phoenix-{$rel['version']}-{$rel['build']}.raucb"), "\n";
            if ($info === null) echo "(RAUC is not installed here: the bundle's manifest was not compared)\n";
            break;

        case 'simulator':
            $rel = UpdateFeed::release($o);
            echo feed()->publish('phoenix-sim', $rel, UpdateFeed::simulatorBundle($rel), "phoenix-sim-{$rel['version']}-{$rel['build']}.raucb"), "\n";
            break;

        case 'withdraw':
            $compatible = $o['compatible'] ?? fail('--compatible is required');
            echo feed()->withdraw($compatible, $o['channel'] ?? 'stable'), "\n";
            break;

        case 'show':
            foreach (feed()->all($o['compatible'] ?? null) as $feed) {
                $r = $feed['release'];
                printf("%-24s %-7s %s\n", $feed['compatible'], $feed['channel'], $r ? "{$r['version']} (build {$r['build']}, {$r['size']} bytes)" : 'none');
            }
            break;

        default:
            fwrite(STDERR, "usage: php bin/updates.php publish|simulator|withdraw|show (see the top of this file)\n");
            exit($cmd === 'help' ? 0 : 1);
    }
} catch (\InvalidArgumentException | \RuntimeException $e) {
    fail($e->getMessage());
}
