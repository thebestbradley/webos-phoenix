<?php
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Reads an uploaded .ipk (ar of debian-binary, control.tar.gz, data.tar.gz)
// and runs the automatic checks of docs/APP-STORE.md 3.4 before a human
// reviews it: one web app, under usr/palm/applications/<id>/, its
// appinfo.json valid and saying the same id and version as the control
// file, no maintainer scripts, no services, no files elsewhere, no
// symlinks, under the size limit. The device runs the same checks again
// (apps/marketplace/service/packagesservice.js). A Synergy connector (a
// service in the app's service/ folder) passes only with $connectors, and
// then Connector::checkIpk has the last word (Catalog::submitPackage).

declare(strict_types=1);

namespace Phoenix\Marketplace;

final class Ipk
{
    public const MAX_SIZE = 64 * 1024 * 1024;
    private const SCRIPTS = ['preinst', 'postinst', 'prerm', 'postrm', 'pmPostInstall.script', 'pmPreRemove.script'];

    /**
     * $connectors: a package with a service in its app's service/ folder is a connector
     * ('connector' => true), for Connector::checkIpk; without it, it is refused.
     *
     * @return array{control: array, appinfo: array, appId: string, version: string, files: string[], connector: bool}
     */
    public static function check(string $bytes, bool $connectors = false): array
    {
        if (strlen($bytes) > self::MAX_SIZE) {
            throw new CheckFailed('The package is larger than 64 MB');
        }
        $ar = self::readAr($bytes);
        if (!isset($ar['control.tar.gz'], $ar['data.tar.gz'])) {
            throw new CheckFailed('Not an .ipk package (no control.tar.gz or data.tar.gz)');
        }
        $control = self::readTar(self::gunzip($ar['control.tar.gz']));
        $data = self::readTar(self::gunzip($ar['data.tar.gz']));
        if (!isset($control['control'])) {
            throw new CheckFailed('The package has no control file');
        }
        foreach (array_keys($control) as $name) {
            if (in_array($name, self::SCRIPTS, true)) {
                throw new CheckFailed("The package has a maintainer script ($name); scripts are not allowed");
            }
        }
        $fields = self::parseControl($control['control']['data']);
        $apps = [];
        foreach ($data as $path => $f) {
            if ($f['type'] === 'link') {
                throw new CheckFailed("The package has a link ($path)");
            }
            if (preg_match('#^usr/palm/applications/([^/]+)/appinfo\.json$#', $path, $m)) {
                $apps[] = $m[1];
            }
        }
        if (count($apps) !== 1) {
            throw new CheckFailed('The package must hold exactly one app');
        }
        $appId = $apps[0];
        $dir = "usr/palm/applications/$appId/";
        $connector = false;
        foreach ($data as $path => $f) {
            if ($f['type'] === 'file' && !str_starts_with($path, $dir)) {
                throw new CheckFailed("The package puts a file outside its app ($path)");
            }
            // A Synergy connector carries its Node.js service in the app's
            // service/ folder (docs/SYNERGY-CONNECTORS.md 3.1): not a web app.
            // Connectors are checked by Connector::checkIpk (phase C4).
            if ($f['type'] === 'file' && ($path === $dir . 'service/package.json' || str_starts_with($path, $dir . 'service/sysbus/'))) {
                if (!$connectors) {
                    throw new CheckFailed('The package has a background service (service/): a Synergy connector, which this catalog does not take');
                }
                $connector = true;
            }
        }
        $info = json_decode(preg_replace('/^\xEF\xBB\xBF/', '', $data[$dir . 'appinfo.json']['data']), true);
        if (!is_array($info)) {
            throw new CheckFailed('appinfo.json is not valid JSON');
        }
        if (($info['id'] ?? '') !== $appId || ($fields['Package'] ?? '') !== $appId) {
            throw new CheckFailed("The app id ($appId), appinfo.json's id and the control file's Package must be the same");
        }
        if (!preg_match('/^[A-Za-z0-9]+([._-][A-Za-z0-9]+)+$/', $appId)) {
            throw new CheckFailed("Not a valid app id: $appId");
        }
        if (($info['type'] ?? 'web') !== 'web') {
            throw new CheckFailed('Only web apps are accepted for now (appinfo.json type "web")');
        }
        $version = (string) ($info['version'] ?? $fields['Version'] ?? '');
        if ($version === '' || ($fields['Version'] ?? '') !== $version) {
            throw new CheckFailed('appinfo.json and the control file must give the same version');
        }
        if (($fields['Architecture'] ?? '') !== 'all') {
            throw new CheckFailed('Only packages for any architecture ("Architecture: all") are accepted');
        }
        return ['control' => $fields, 'appinfo' => $info, 'appId' => $appId, 'version' => $version,
                'files' => array_keys(array_filter($data, fn ($f) => $f['type'] === 'file')), 'connector' => $connector];
    }

    // readAr, readTar and parseControl are also server/drivers' .ipk reader.
    public static function readAr(string $b): array
    {
        if (substr($b, 0, 8) !== "!<arch>\n") {
            throw new CheckFailed('Not an .ipk package (no ar header)');
        }
        $out = [];
        $pos = 8;
        while ($pos + 60 <= strlen($b)) {
            $name = rtrim(trim(substr($b, $pos, 16)), '/');
            $size = (int) trim(substr($b, $pos + 48, 10));
            if (substr($b, $pos + 58, 2) !== "`\n") {
                throw new CheckFailed('Damaged .ipk package (ar)');
            }
            $out[$name] = substr($b, $pos + 60, $size);
            $pos += 60 + $size + ($size % 2);
        }
        return $out;
    }

    private static function gunzip(string $b): string
    {
        $out = @gzdecode($b);
        if ($out === false) {
            throw new CheckFailed('Damaged .ipk package (gzip)');
        }
        return $out;
    }

    /** @return array<string, array{type: string, data?: string}> */
    public static function readTar(string $b): array
    {
        $out = [];
        $pos = 0;
        $long = null;
        while ($pos + 512 <= strlen($b)) {
            $h = substr($b, $pos, 512);
            if (trim($h, "\0") === '') {
                break;
            }
            $name = rtrim(substr($h, 0, 100), "\0");
            $size = octdec(trim(rtrim(substr($h, 124, 12), "\0")) ?: '0');
            $type = $h[156] === "\0" ? '0' : $h[156];
            $prefix = rtrim(substr($h, 345, 155), "\0");
            $body = substr($b, $pos + 512, (int) $size);
            $pos += 512 + (int) (ceil($size / 512) * 512);
            if ($type === 'L') {
                $long = rtrim($body, "\0");
                continue;
            }
            if ($type === 'x') {
                if (preg_match('/\d+ path=([^\n]*)\n/', $body, $m)) {
                    $long = $m[1];
                }
                continue;
            }
            if ($type === 'g') {
                continue;
            }
            $path = $long ?? ($prefix !== '' ? "$prefix/$name" : $name);
            $long = null;
            $path = ltrim(preg_replace('#^\./#', '', $path), '/');
            if (str_contains("/$path/", '/../')) {
                throw new CheckFailed("The package has a path with .. ($path)");
            }
            if ($type === '0' || $type === '7') {
                $out[$path] = ['type' => 'file', 'data' => $body];
            } elseif ($type === '1' || $type === '2') {
                $out[$path] = ['type' => 'link'];
            }
        }
        return $out;
    }

    public static function parseControl(string $text): array
    {
        $out = [];
        $key = null;
        foreach (preg_split('/\r?\n/', $text) as $line) {
            if ($key !== null && preg_match('/^\s/', $line)) {
                $out[$key] .= "\n" . trim($line);
            } elseif (preg_match('/^([A-Za-z0-9-]+):\s*(.*)$/', $line, $m)) {
                $key = $m[1];
                $out[$key] = $m[2];
            }
        }
        return $out;
    }
}
