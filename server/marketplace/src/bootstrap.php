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
    ];
}
