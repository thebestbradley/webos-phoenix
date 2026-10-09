<?php
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Front controller, for PHP's built-in server (bin/serve.sh) and for Apache
// or nginx with PHP-FPM (send every request here): the published catalog
// under /v1/ (static files from the data folder), the API under /api/, a
// small admin page at /admin.

declare(strict_types=1);

require __DIR__ . '/../src/bootstrap.php';

use Phoenix\Marketplace\App;

$config = marketplace_config();
$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';

if (str_starts_with($path, '/v1/icons/copy/')) {
    // An app's icon from its site, copied here (Catalog::iconCopy).
    $icon = (new App($config))->catalog->iconCopy(substr($path, strlen('/v1/icons/copy/')));
    if ($icon === null) {
        http_response_code(404);
        header('Content-Type: text/plain');
        echo "not found\n";
        return;
    }
    [$type, $bytes, $kept] = $icon;
    header('Content-Type: ' . $type);
    header('Content-Length: ' . strlen($bytes));
    header('Cache-Control: ' . ($kept ? 'max-age=86400' : 'no-cache'));
    header('X-Content-Type-Options: nosniff');
    header('Access-Control-Allow-Origin: *');
    echo $bytes;
    return;
}

if (str_starts_with($path, '/v1/')) {
    $rel = substr($path, 4);
    $file = realpath($config['data'] . '/public/v1/' . $rel);
    $root = realpath($config['data'] . '/public/v1');
    if ($rel === '' || !$file || !$root || !str_starts_with($file, $root . '/') || !is_file($file)) {
        http_response_code(404);
        header('Content-Type: text/plain');
        echo "not found\n";
        return;
    }
    $types = ['json' => 'application/json', 'sig' => 'text/plain', 'ipk' => 'application/vnd.debian.binary-package',
              'svg' => 'image/svg+xml'];
    header('Content-Type: ' . ($types[pathinfo($file, PATHINFO_EXTENSION)] ?? 'application/octet-stream'));
    header('Content-Length: ' . filesize($file));
    header('Cache-Control: no-cache');
    header('Access-Control-Allow-Origin: *');
    readfile($file);
    return;
}

if ($path === '/admin') {
    header('Content-Type: text/html; charset=utf-8');
    readfile(__DIR__ . '/admin.html');
    return;
}

if (str_starts_with($path, '/api/')) {
    $app = new App($config);
    $auth = $_SERVER['HTTP_AUTHORIZATION'] ?? null;
    [$status, $out] = $app->api->handle($_SERVER['REQUEST_METHOD'] ?? 'GET', $path, (string) file_get_contents('php://input'), $auth);
    http_response_code($status);
    header('Content-Type: application/json');
    echo json_encode($out, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE), "\n";
    return;
}

header('Content-Type: text/plain');
echo $config['name'] . "\n\nCatalog: /v1/index.json (signed: /v1/index.json.sig, key: /v1/key.json)\nAPI: /api/\nAdmin: /admin\n";
