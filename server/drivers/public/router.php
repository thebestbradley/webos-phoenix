<?php
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The driver catalog over HTTP, for PHP's built-in server (bin/serve.sh) or
// behind any web server: GET /v1/... serves the published catalog (static
// files; a plain web server or mirror can serve them instead), POST
// /v1/report takes an opt-in hardware report (IDs only; nothing about who
// sent it is kept).

declare(strict_types=1);

require __DIR__ . '/../src/bootstrap.php';

use Phoenix\Drivers\Catalog;
use Phoenix\Marketplace\CheckFailed;

$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$catalog = new Catalog(drivers_data(), drivers_name());

if ($path === '/v1/report') {
    header('Content-Type: application/json');
    if ($method !== 'POST') {
        http_response_code(405);
        echo '{"error":"POST a report"}';
        return true;
    }
    try {
        $catalog->addReport((string) file_get_contents('php://input'));
        http_response_code(201);
        echo '{"ok":true}';
    } catch (CheckFailed $e) {
        http_response_code(400);
        echo json_encode(['error' => $e->getMessage()]);
    }
    return true;
}

$public = realpath($catalog->data . '/public');
$file = $public ? realpath($public . $path) : false;
if ($method === 'GET' && $file && str_starts_with($file, $public . '/') && is_file($file)) {
    $types = ['json' => 'application/json', 'sig' => 'text/plain', 'ipk' => 'application/vnd.debian.binary-package'];
    header('Content-Type: ' . ($types[pathinfo($file, PATHINFO_EXTENSION)] ?? 'application/octet-stream'));
    header('Content-Length: ' . filesize($file));
    readfile($file);
    return true;
}
http_response_code(404);
echo "Not found\n";
return true;
