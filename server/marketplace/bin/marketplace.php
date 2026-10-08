<?php
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Running the catalog service:
//
//   php bin/marketplace.php init              database, signing key, the curated
//                                             web apps, an admin, a first publish
//   php bin/marketplace.php seed [FILE]       the curated web apps again
//                                             (catalog/curated-pwas.json, the
//                                             whole list: the ones it no longer
//                                             has are set gone); FILE only adds
//                                             and updates the ones it has
//   php bin/marketplace.php publish           sign and write the catalog
//   php bin/marketplace.php admin NAME EMAIL  an admin account; prints its token
//   php bin/marketplace.php queue             what waits for review
//   php bin/marketplace.php approve N | reject N [notes]   a release
//   php bin/marketplace.php key               the public key and its fingerprint

declare(strict_types=1);

require __DIR__ . '/../src/bootstrap.php';

use Phoenix\Marketplace\App;

$app = new App(marketplace_config());
$cmd = $argv[1] ?? 'help';
$curated = dirname(__DIR__) . '/catalog/curated-pwas.json';

switch ($cmd) {
    case 'init':
        $n = $app->catalog->seedCurated($curated);
        echo "Curated web apps: $n\n";
        if (!$app->db->one("SELECT id FROM accounts WHERE role = 'admin'")) {
            $a = $app->api->createAccount('Admin', 'admin@localhost.localdomain', 'admin');
            $file = $app->config['data'] . '/admin.token';
            $old = umask(0077);
            file_put_contents($file, $a['token'] . "\n");
            umask($old);
            echo "Admin token: in $file\n";
        }
        $p = $app->catalog->publish();
        echo "Published build {$p['build']}: {$p['apps']} apps\n";
        echo "Key fingerprint: " . $app->signer->fingerprint() . "\n";
        break;
    case 'seed':
        echo 'Curated web apps: ' . $app->catalog->seedCurated($argv[2] ?? $curated, !isset($argv[2])) . "\n";
        break;
    case 'publish':
        $p = $app->catalog->publish();
        echo "Published build {$p['build']}: {$p['apps']} apps\n";
        break;
    case 'admin':
        $a = $app->api->createAccount($argv[2] ?? 'Admin', $argv[3] ?? 'admin@localhost.localdomain', 'admin');
        echo $a['token'], "\n";
        break;
    case 'queue':
        echo json_encode($app->api->handle('GET', '/api/admin/queue', '', 'Bearer ' . trim((string) @file_get_contents($app->config['data'] . '/admin.token')))[1],
            JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES), "\n";
        break;
    case 'approve':
    case 'reject':
        $admin = $app->db->one("SELECT * FROM accounts WHERE role = 'admin' ORDER BY id");
        $r = $app->catalog->decideRelease((int) ($argv[2] ?? 0), $cmd === 'approve', $admin, $argv[3] ?? '');
        $p = $app->catalog->publish();
        echo "Release {$r['id']}: {$r['state']}. Published build {$p['build']}\n";
        break;
    case 'key':
        echo base64_encode($app->signer->public), "\n", $app->signer->fingerprint(), "\n";
        break;
    default:
        fwrite(STDERR, "usage: php bin/marketplace.php init|seed|publish|admin|queue|approve|reject|key\n");
        exit(2);
}
