<?php
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Front controller, for PHP's built-in server (bin/serve.sh) and for Apache
// or nginx with PHP-FPM (send every request here): the published catalog
// under /v1/ (static files from the data folder), the system update feed
// under /updates/ (com.palm.update's, server/updates), the API under /api/,
// a small admin page at /admin.

declare(strict_types=1);

require __DIR__ . '/../src/bootstrap.php';

use Phoenix\Marketplace\App;

$config = marketplace_config();
$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';

if (preg_match('#^/v1/(icons|screenshots)/copy/([^/]+)$#', $path, $m)) {
    // An app's icon or screenshot from its site, copied here (Catalog::mediaCopy).
    $copy = (new App($config))->catalog->mediaCopy($m[1] === 'icons' ? 'icon' : 'screenshot', $m[2]);
    if ($copy === null) {
        http_response_code(404);
        header('Content-Type: text/plain');
        echo "not found\n";
        return;
    }
    [$type, $bytes, $kept] = $copy;
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
              'svg' => 'image/svg+xml', 'png' => 'image/png'];
    header('Content-Type: ' . ($types[pathinfo($file, PATHINFO_EXTENSION)] ?? 'application/octet-stream'));
    header('Content-Length: ' . filesize($file));
    header('Cache-Control: no-cache');
    header('Access-Control-Allow-Origin: *');
    readfile($file);
    return;
}

// The system update feed: <compatible>/<channel>.json and the bundles.
if (str_starts_with($path, '/updates/')) {
    $rel = substr($path, 9);
    $root = realpath($config['updates']);
    $file = $root ? realpath($root . '/' . $rel) : false;
    if ($rel === '' || !$file || !str_starts_with($file, $root . '/') || !is_file($file)) {
        http_response_code(404);
        header('Content-Type: text/plain');
        echo "not found\n";
        return;
    }
    $json = pathinfo($file, PATHINFO_EXTENSION) === 'json';
    header('Content-Type: ' . ($json ? 'application/json' : 'application/octet-stream'));
    header('Content-Length: ' . filesize($file));
    // A channel's file changes with each release; a bundle never does.
    header('Cache-Control: ' . ($json ? 'no-cache' : 'max-age=31536000, immutable'));
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
    // The query, with note=... repeated into notes (PHP's own parsing keeps the last).
    $query = ['notes' => []];
    foreach (explode('&', (string) ($_SERVER['QUERY_STRING'] ?? '')) as $pair) {
        if ($pair === '') continue;
        [$k, $v] = array_map('urldecode', explode('=', $pair, 2) + [1 => '']);
        if ($k === 'note') $query['notes'][] = $v;
        else $query[$k] = $v;
    }
    [$status, $out] = $app->api->handle($_SERVER['REQUEST_METHOD'] ?? 'GET', $path, (string) file_get_contents('php://input'), $auth, $query);
    http_response_code($status);
    header('Content-Type: application/json');
    echo json_encode($out, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE), "\n";
    return;
}

header('Content-Type: text/plain');
echo $config['name'] . "\n\nCatalog: /v1/index.json (signed: /v1/index.json.sig, key: /v1/key.json)\nSystem updates: /updates/<device>/<channel>.json\nAPI: /api/\nAdmin: /admin\n";
