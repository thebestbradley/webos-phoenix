<?php
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The driver catalog's tool (docs/DRIVERS.md):
//
//   php bin/drivers.php init
//       makes the catalog's Ed25519 key (data/signing.key) and prints the
//       public key to pin in /etc/palm/hardware/catalog.json
//   php bin/drivers.php add MANIFEST.json [--reviewed]
//       checks a driver manifest and the .ipk files next to it (docs/DRIVERS.md,
//       "What is checked"), copies the packages in and keeps the entry;
//       --reviewed: a person read its install scripts (or the service)
//   php bin/drivers.php remove ID
//   php bin/drivers.php publish [--days N]
//       writes and signs public/v1/drivers.json (a new build; expires in N
//       days, 30 by default)
//   php bin/drivers.php show
//   php bin/drivers.php verify DIR [--key BASE64]
//       checks a published catalog's signature (with its key.json's key if
//       no --key)
//   php bin/drivers.php reports
//       the devices the opt-in hardware reports name that no entry is for
//       yet, most reported first
//   php bin/drivers.php sample
//       the simulator's sample catalog (sample/): its packages made from
//       sample/manifests, signed with the sample key the simulator pins

declare(strict_types=1);

require __DIR__ . '/../src/bootstrap.php';

use Phoenix\Drivers\Catalog;
use Phoenix\Drivers\PackageWriter;
use Phoenix\Marketplace\CheckFailed;
use Phoenix\Marketplace\Signer;

function fail(string $msg): never
{
    fwrite(STDERR, "drivers: $msg\n");
    exit(1);
}

$argv0 = array_slice($argv, 1);
$cmd = array_shift($argv0) ?? 'help';
$opts = [];
$args = [];
for ($i = 0; $i < count($argv0); $i++) {
    if (str_starts_with($argv0[$i], '--')) {
        $k = substr($argv0[$i], 2);
        $opts[$k] = in_array($k, ['reviewed'], true) ? true : ($argv0[++$i] ?? fail("--$k needs a value"));
    } else {
        $args[] = $argv0[$i];
    }
}

$catalog = new Catalog(drivers_data(), drivers_name());

try {
    switch ($cmd) {
    case 'init':
        $signer = new Signer($catalog->data);
        echo 'Key:         ' . base64_encode($signer->public) . "\n";
        echo 'Fingerprint: ' . $signer->fingerprint() . "\n";
        echo "Pin the key in services/hardware/etc/palm/hardware/catalog.json. Keep a copy of {$catalog->data}/signing.key somewhere safe.\n";
        break;
    case 'add':
        $e = $catalog->add($args[0] ?? fail('add MANIFEST.json'), !empty($opts['reviewed']));
        echo "Added {$e['id']}: " . implode(', ', array_map(fn ($p) => "{$p['name']} {$p['version']} ({$p['arch']})", $e['packages'])) . "\n";
        echo "Run `publish` to put it in the catalog.\n";
        break;
    case 'remove':
        echo $catalog->remove($args[0] ?? fail('remove ID')) ? "Removed. Run `publish`.\n" : "No such entry.\n";
        break;
    case 'publish':
        $idx = $catalog->publish(new Signer($catalog->data), (int) ($opts['days'] ?? 30));
        echo "Build {$idx['build']}: " . count($idx['drivers']) . " drivers, expires {$idx['expires']}\n";
        break;
    case 'show':
        foreach ($catalog->entries() as $e) {
            printf("%-28s %-9s %s%s\n", $e['id'], $e['kind'], $e['title'], $e['optional'] ? ' (optional)' : '');
        }
        break;
    case 'verify':
        $dir = rtrim($args[0] ?? fail('verify DIR'), '/');
        $key = $opts['key'] ?? (json_decode((string) @file_get_contents("$dir/key.json"), true)['key'] ?? fail("No key.json in $dir; give --key"));
        $idx = Catalog::verify($dir, $key);
        echo "Good signature: build {$idx['build']}, " . count($idx['drivers']) . " drivers, expires {$idx['expires']}\n";
        break;
    case 'reports':
        foreach ($catalog->unmatched() as [$id, $n, $fw]) {
            printf("%5d  %s%s\n", $n, $id, $fw ? '  (firmware: ' . implode(', ', $fw) . ')' : '');
        }
        break;
    case 'sample':
        sample();
        break;
    default:
        fwrite(STDERR, "usage: drivers.php init | add MANIFEST [--reviewed] | remove ID | publish [--days N] | show | verify DIR [--key K] | reports | sample\n");
        exit($cmd === 'help' ? 0 : 1);
    }
} catch (CheckFailed $e) {
    fail($e->getMessage());
}

// The simulator's sample catalog: each sample/manifests/*.json is a driver
// manifest whose "samplePackages" say what to put in its packages (small
// stand-ins, not the real firmware). Signed with sample/signing.key, which
// signs nothing else: only the simulator trusts it.
function sample(): void
{
    $root = dirname(__DIR__) . '/sample';
    $work = sys_get_temp_dir() . '/phoenix-drivers-sample-' . bin2hex(random_bytes(4));
    mkdir($work, 0700, true);
    $cat = new Catalog($root, 'Phoenix Drivers (sample)');
    foreach (glob("$root/entries/*.json") ?: [] as $old) {
        unlink($old);
    }
    foreach (glob("$root/public/v1/packages/*.ipk") ?: [] as $old) {
        unlink($old);
    }
    foreach (glob("$root/manifests/*.json") as $file) {
        $m = json_decode((string) file_get_contents($file), true) ?: fail("$file is not JSON");
        $m['packages'] = [];
        foreach ($m['samplePackages'] as $p) {
            $name = "{$p['name']}_{$p['version']}_{$p['arch']}.ipk";
            file_put_contents("$work/$name", PackageWriter::ipk($p['name'], $p['version'], $p['arch'], $p['files'], $p['scripts'] ?? [], $m['title']));
            $m['packages'][] = $name;
        }
        if (isset($m['license']['textFile'])) {
            copy(dirname($file) . '/' . basename($m['license']['textFile']), "$work/" . basename($m['license']['textFile']));
        }
        unset($m['samplePackages']);
        file_put_contents("$work/" . basename($file), json_encode($m));
        $e = $cat->add("$work/" . basename($file));
        echo "  {$e['id']}\n";
    }
    $idx = $cat->publish(new Signer($root), 3650);
    array_map('unlink', glob("$work/*"));
    rmdir($work);
    echo "Sample catalog: build {$idx['build']}, " . count($idx['drivers']) . " drivers in $root/public/v1\n";
}
