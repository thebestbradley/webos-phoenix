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
//                                             and updates the ones it has. Also
//                                             checks catalog/accounts.json, the
//                                             account types each publish reads
//   php bin/marketplace.php publish           sign and write the catalog
//   php bin/marketplace.php admin NAME EMAIL  an admin account; prints its token
//   php bin/marketplace.php queue             what waits for review
//   php bin/marketplace.php approve N | reject N [notes]   a release
//   php bin/marketplace.php key               the public key and its fingerprint
//   php bin/marketplace.php developer         a development catalog's (MARKETPLACE_DEV)
//                                             local developer: its token, in
//                                             data/developer.token (made the first
//                                             time), which `phoenix-connector
//                                             publish --local` uses
//   php bin/marketplace.php upload [--phoenix] [--listing LISTING.json] FILE.ipk
//                                             a package, as that developer (on a
//                                             development catalog: approved and
//                                             published at once); --phoenix: one
//                                             of the packages Phoenix hosts itself
//                                             (the connectors it comes with, the
//                                             open-source web apps and the 2.0
//                                             apps of bin/web-apps.py), as the
//                                             admin, approved at once; --listing:
//                                             what the index says of it
//                                             (Catalog::applyListing), and a
//                                             version uploaded already with the
//                                             same bytes is kept as it is
//   php bin/marketplace.php listing ID LISTING.json
//                                             an app's listing again, published
//   php bin/marketplace.php versions          {app id: its newest approved version},
//                                             JSON (bin/web-apps.py fill)

declare(strict_types=1);

require __DIR__ . '/../src/bootstrap.php';

use Phoenix\Marketplace\App;

$app = new App(marketplace_config());
$cmd = $argv[1] ?? 'help';
$curated = dirname(__DIR__) . '/catalog/curated-pwas.json';

/**
 * A development catalog's local developer (the simulator's, `phoenix-connector publish --local`'s):
 * the account whose token is in data/developer.token, made when there is none (or it is not
 * this database's). Its packages are approved at once (MARKETPLACE_DEV).
 */
function local_developer(App $app): array
{
    if (!$app->config['dev']) {
        fwrite(STDERR, "Only on a development catalog (MARKETPLACE_DEV=1, as bin/serve.sh runs it)\n");
        exit(2);
    }
    $file = $app->config['data'] . '/developer.token';
    $token = trim((string) @file_get_contents($file));
    $a = $token !== '' ? $app->db->one('SELECT * FROM accounts WHERE token_hash = ?', [hash('sha256', $token)]) : null;
    if (!$a) {
        $made = $app->api->createAccount('Local developer', 'developer@localhost.localdomain', 'developer');
        $token = $made['token'];
        @mkdir($app->config['data'], 0700, true);
        $old = umask(0077);
        file_put_contents($file, $token . "\n");
        umask($old);
        $a = $app->db->one('SELECT * FROM accounts WHERE id = ?', [$made['id']]);
    }
    return $a + ['token' => $token];
}

switch ($cmd) {
    case 'init':
        $n = $app->catalog->seedCurated($curated);
        echo "Curated web apps: $n\n";
        echo 'Account types: ' . count($app->catalog->accountTypes()) . "\n";
        if (!$app->db->one("SELECT id FROM accounts WHERE role = 'admin'")) {
            $a = $app->api->createAccount('Admin', 'admin@localhost.localdomain', 'admin');
            $file = $app->config['data'] . '/admin.token';
            $old = umask(0077);
            file_put_contents($file, $a['token'] . "\n");
            umask($old);
            echo "Admin token: in $file\n";
        }
        $p = $app->catalog->publish();
        echo "Published build {$p['build']}: {$p['apps']} apps, {$p['accounts']} account types\n";
        echo "Key fingerprint: " . $app->signer->fingerprint() . "\n";
        break;
    case 'seed':
        echo 'Curated web apps: ' . $app->catalog->seedCurated($argv[2] ?? $curated, !isset($argv[2])) . "\n";
        // The account types are not kept in the database: each publish reads them from
        // catalog/accounts.json. Checked here, so a bad edit shows before the publish.
        echo 'Account types: ' . count($app->catalog->accountTypes()) . "\n";
        break;
    case 'publish':
        $p = $app->catalog->publish();
        echo "Published build {$p['build']}: {$p['apps']} apps, {$p['accounts']} account types\n";
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
    case 'developer':
        echo local_developer($app)['token'], "\n";
        break;
    case 'upload':
        $args = array_slice($argv, 2);
        $phoenix = false;
        $listingFile = null;
        while ($args && str_starts_with($args[0], '--')) {
            $opt = array_shift($args);
            if ($opt === '--phoenix') {
                $phoenix = true;
            } elseif ($opt === '--listing' && $args) {
                $listingFile = array_shift($args);
            } else {
                $args = [];
            }
        }
        $bytes = @file_get_contents($args[0] ?? '');
        $listing = $listingFile === null ? null : json_decode((string) @file_get_contents($listingFile), true);
        if (!is_string($bytes) || ($listingFile !== null && !is_array($listing)) || ($listingFile !== null && !$phoenix)) {
            fwrite(STDERR, "usage: php bin/marketplace.php upload [--phoenix [--listing LISTING.json]] FILE.ipk\n");
            exit(2);
        }
        if ($phoenix) {
            // A package Phoenix hosts, as the catalog's first admin (the one init made):
            // approved at once, as an admin's decision.
            $owner = $app->db->one("SELECT * FROM accounts WHERE role = 'admin' ORDER BY id");
            try {
                $pkg = \Phoenix\Marketplace\Ipk::check($bytes, true);
                $same = $app->db->one("SELECT * FROM releases WHERE app_id = ? AND version = ? AND state != 'rejected'", [$pkg['appId'], $pkg['version']]);
                if ($same && $listing !== null && $same['sha256'] === hash('sha256', $bytes)) {
                    // This version is there already (a re-run): only its listing again.
                    $r = ['app' => $app->catalog->app($pkg['appId']), 'release' => $same];
                } else {
                    $r = $app->catalog->submitPackage($owner, $bytes);
                    if ($r['release']['state'] === 'pending') {
                        $r['release'] = $app->catalog->decideRelease((int) $r['release']['id'], true, $owner, 'Hosted by Phoenix (upload --phoenix)');
                    }
                }
                if ($listing !== null) {
                    $r['app'] = $app->catalog->applyListing($pkg['appId'], $listing, dirname(realpath($listingFile)));
                }
                $r['publish'] = $app->catalog->publish();
                $status = 200;
            } catch (\Phoenix\Marketplace\CheckFailed $e) {
                [$status, $r] = [400, ['error' => $e->getMessage()]];
            }
        } else {
            [$status, $r] = $app->api->handle('POST', '/api/apps/packages', $bytes, 'Bearer ' . local_developer($app)['token']);
        }
        if ($status !== 200) {
            fwrite(STDERR, "Refused: {$r['error']}\n");
            exit(1);
        }
        echo "{$r['app']['id']} {$r['release']['version']}: {$r['release']['state']}"
            . (isset($r['publish']) ? ". Published build {$r['publish']['build']}" : '') . "\n";
        break;
    case 'listing':
        $listing = json_decode((string) @file_get_contents($argv[3] ?? ''), true);
        if (!isset($argv[2]) || !is_array($listing)) {
            fwrite(STDERR, "usage: php bin/marketplace.php listing ID LISTING.json\n");
            exit(2);
        }
        try {
            $a = $app->catalog->applyListing($argv[2], $listing, dirname(realpath($argv[3])));
        } catch (\Phoenix\Marketplace\CheckFailed $e) {
            fwrite(STDERR, "Refused: {$e->getMessage()}\n");
            exit(1);
        }
        $p = $app->catalog->publish();
        echo "{$a['id']}: listed. Published build {$p['build']}\n";
        break;
    case 'key':
        echo base64_encode($app->signer->public), "\n", $app->signer->fingerprint(), "\n";
        break;
    case 'versions':
        $out = [];
        foreach ($app->db->all("SELECT app_id, version FROM releases WHERE state = 'approved' ORDER BY id") as $r) {
            $out[$r['app_id']] = $r['version'];
        }
        echo json_encode((object) $out, JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT), "\n";
        break;
    default:
        fwrite(STDERR, "usage: php bin/marketplace.php init|seed|publish|admin|queue|approve|reject|key|developer|upload|listing|versions|availability\n");
        exit(2);
}
