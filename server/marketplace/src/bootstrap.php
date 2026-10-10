<?php
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Phoenix Marketplace's catalog service (docs/APP-STORE.md, 3.3-3.4):
// plain PHP 8 with PDO, MySQL/MariaDB in production and SQLite for running
// it on one computer. Configuration from the environment:
//
//   MARKETPLACE_DATA      data folder (default: server/marketplace/data):
//                         the SQLite database, the signing key, uploaded
//                         packages and the published catalog (public/v1)
//   MARKETPLACE_DSN       PDO DSN (default: sqlite:<data>/marketplace.sqlite),
//                         e.g. mysql:host=localhost;dbname=marketplace;charset=utf8mb4
//   MARKETPLACE_DB_USER, MARKETPLACE_DB_PASS
//   MARKETPLACE_BASE_URL  where devices read the catalog (default:
//                         http://127.0.0.1:8088/v1/)
//   MARKETPLACE_NAME      the catalog's name (default: Phoenix Marketplace)
//   MARKETPLACE_FETCH_LOCAL  1: copies of apps' pictures (SafeFetch) may come
//                         from http://127.0.0.1 too (the simulator's and the
//                         tests' local sites); never set on a server
//   MARKETPLACE_FETCH_PROXY  an egress proxy the operator trusts for those
//                         copies (it resolves the names; default: none)
//   MARKETPLACE_UPDATES   the system update feed it serves at /updates/
//                         (default: <data>/updates; server/updates/src/UpdateFeed.php)

declare(strict_types=1);

spl_autoload_register(function (string $class): void {
    $prefix = 'Phoenix\\Marketplace\\';
    if (str_starts_with($class, $prefix)) {
        $file = __DIR__ . '/' . substr($class, strlen($prefix)) . '.php';
        if (is_file($file)) {
            require $file;
        }
    }
});
// The system update feed (server/updates), which this server serves and publishes.
require_once dirname(__DIR__, 2) . '/updates/src/UpdateFeed.php';

function marketplace_config(): array
{
    $data = getenv('MARKETPLACE_DATA') ?: dirname(__DIR__) . '/data';
    return [
        'data' => rtrim($data, '/'),
        'dsn' => getenv('MARKETPLACE_DSN') ?: 'sqlite:' . rtrim($data, '/') . '/marketplace.sqlite',
        'db_user' => getenv('MARKETPLACE_DB_USER') ?: null,
        'db_pass' => getenv('MARKETPLACE_DB_PASS') ?: null,
        'base_url' => rtrim(getenv('MARKETPLACE_BASE_URL') ?: 'http://127.0.0.1:8088/v1/', '/') . '/',
        'name' => getenv('MARKETPLACE_NAME') ?: 'Phoenix Marketplace',
        'fetch_local' => getenv('MARKETPLACE_FETCH_LOCAL') === '1',
        'fetch_proxy' => getenv('MARKETPLACE_FETCH_PROXY') ?: null,
        'updates' => rtrim(getenv('MARKETPLACE_UPDATES') ?: rtrim($data, '/') . '/updates', '/'),
        // The account types (Connections) and the checkout their icons come from.
        'accounts' => dirname(__DIR__) . '/catalog/accounts.json',
        'repo' => dirname(__DIR__, 3),
    ];
}
