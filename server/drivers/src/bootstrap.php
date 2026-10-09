<?php
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The Phoenix driver catalog (docs/DRIVERS.md): plain PHP 8 with libsodium,
// no database. It uses the Marketplace's .ipk reader and Ed25519 signer
// (server/marketplace/src). Configuration from the environment:
//
//   DRIVERS_DATA   data folder (default: server/drivers/data): the signing
//                  key, the reviewed entries, the published catalog
//                  (public/v1) and the hardware reports
//   DRIVERS_NAME   the catalog's name (default: Phoenix Drivers)

declare(strict_types=1);

spl_autoload_register(function (string $class): void {
    foreach (['Phoenix\\Drivers\\' => __DIR__, 'Phoenix\\Marketplace\\' => dirname(__DIR__, 2) . '/marketplace/src'] as $prefix => $dir) {
        if (str_starts_with($class, $prefix)) {
            $file = $dir . '/' . substr($class, strlen($prefix)) . '.php';
            if (is_file($file)) {
                require $file;
            }
        }
    }
});

function drivers_data(): string
{
    return rtrim(getenv('DRIVERS_DATA') ?: dirname(__DIR__) . '/data', '/');
}

function drivers_name(): string
{
    return getenv('DRIVERS_NAME') ?: 'Phoenix Drivers';
}
