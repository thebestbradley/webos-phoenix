<?php
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Writes small .ipk packages (ar of debian-binary, control.tar.gz,
// data.tar.gz), for the simulator's sample catalog and the tests. Real
// driver packages come from the OpenEmbedded build (meta-phoenix,
// phoenix-driver-feed).

declare(strict_types=1);

namespace Phoenix\Drivers;

final class PackageWriter
{
    /** @param array<string, string> $files path => contents; @param array<string, string> $scripts */
    public static function ipk(string $name, string $version, string $arch, array $files, array $scripts = [], string $description = 'Driver package'): string
    {
        $control = "Package: $name\nVersion: $version\nArchitecture: $arch\nMaintainer: webOS Phoenix\nDescription: $description\n";
        return self::ar([
            'debian-binary' => "2.0\n",
            'control.tar.gz' => gzencode(self::tar(['control' => $control] + $scripts), 9),
            'data.tar.gz' => gzencode(self::tar($files), 9),
        ]);
    }

    private static function ar(array $members): string
    {
        $out = "!<arch>\n";
        foreach ($members as $n => $data) {
            $out .= str_pad($n, 16) . str_pad('0', 12) . str_pad('0', 6) . str_pad('0', 6) . str_pad('100644', 8) . str_pad((string) strlen($data), 10) . "`\n";
            $out .= $data . (strlen($data) % 2 ? "\n" : '');
        }
        return $out;
    }

    // ustar, with fixed times and owners so the same files make the same bytes.
    private static function tar(array $files): string
    {
        $out = '';
        foreach ($files as $path => $data) {
            $path = "./$path";
            if (strlen($path) > 99) {
                throw new \InvalidArgumentException("Path too long for the sample writer: $path");
            }
            $h = str_pad($path, 100, "\0") . sprintf('%07o', 0644) . "\0" . sprintf('%07o', 0) . "\0" . sprintf('%07o', 0) . "\0"
                . sprintf('%011o', strlen($data)) . "\0" . sprintf('%011o', 1767225600) . "\0" . str_repeat(' ', 8) . '0'
                . str_repeat("\0", 100) . "ustar\0" . '00' . str_pad('root', 32, "\0") . str_pad('root', 32, "\0") . str_repeat("\0", 183);
            $sum = array_sum(array_map('ord', str_split($h)));
            $h = substr_replace($h, sprintf('%06o', $sum) . "\0 ", 148, 8);
            $out .= $h . $data . str_repeat("\0", (512 - strlen($data) % 512) % 512);
        }
        return $out . str_repeat("\0", 1024);
    }
}
