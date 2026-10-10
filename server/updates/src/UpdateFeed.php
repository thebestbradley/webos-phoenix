<?php
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The system update feed com.palm.update reads (services/updates): one JSON
// file per device type and channel, next to its bundles, in a folder a web
// server serves:
//
//   <feed>/<compatible>/<channel>.json   {"format": 1, "compatible", "channel",
//                                         "release": {name, version, build, date,
//                                         notes, url, size, sha256}}
//   <feed>/<compatible>/<bundle>.raucb
//
// The feed is not signed: the bundles are (RAUC checks them against the
// keyring in the running system), and the device installs only a bundle
// newer than what it runs. Written by bin/updates.php and by the catalog
// server (server/marketplace: /updates/, its admin API), the same way.

declare(strict_types=1);

namespace Phoenix\Updates;

final class UpdateFeed
{
    public const CHANNELS = ['stable', 'beta'];

    public function __construct(public readonly string $dir)
    {
    }

    /** Letters, digits, '.', '_' and '-' (a compatible, a version, a file name). */
    public static function checkName(string $what, string $v): string
    {
        if (!preg_match('/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/', $v)) {
            throw new \InvalidArgumentException("$what: letters, digits, '.', '_' and '-' only");
        }
        return $v;
    }

    public static function checkChannel(string $channel): string
    {
        if (!in_array($channel, self::CHANNELS, true)) {
            throw new \InvalidArgumentException('channel: ' . implode(' or ', self::CHANNELS));
        }
        return $channel;
    }

    /**
     * A release from what was asked: version, build (required), channel
     * (stable), name ("webOS Phoenix"), date (today), notes (lines).
     */
    public static function release(array $o): array
    {
        $version = self::checkName('version', (string) ($o['version'] ?? throw new \InvalidArgumentException('version is required')));
        $build = (string) ($o['build'] ?? throw new \InvalidArgumentException('build is required'));
        if (!ctype_digit($build) || (int) $build < 1) {
            throw new \InvalidArgumentException('build: a whole number, 1 or more');
        }
        $channel = self::checkChannel((string) ($o['channel'] ?? 'stable'));
        $date = (string) ($o['date'] ?? gmdate('Y-m-d'));
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
            throw new \InvalidArgumentException('date: YYYY-MM-DD');
        }
        $notes = $o['notes'] ?? [];
        if (!is_array($notes) || array_filter($notes, fn ($n) => !is_string($n) || mb_strlen($n) > 500)) {
            throw new \InvalidArgumentException('notes: a list of lines');
        }
        $name = (string) ($o['name'] ?? 'webOS Phoenix');
        if (trim($name) === '' || mb_strlen($name) > 80) {
            throw new \InvalidArgumentException('name: up to 80 characters');
        }
        return ['name' => $name, 'version' => $version, 'build' => (int) $build,
                'date' => $date, 'notes' => array_values($notes), 'channel' => $channel];
    }

    private function mkdir(string $d): void
    {
        if (!is_dir($d) && !mkdir($d, 0755, true) && !is_dir($d)) {
            throw new \RuntimeException("Cannot make $d");
        }
    }

    private function feedFile(string $compatible, string $channel): string
    {
        return $this->dir . '/' . self::checkName('compatible', $compatible) . '/' . self::checkChannel($channel) . '.json';
    }

    public function read(string $compatible, string $channel): ?array
    {
        $f = $this->feedFile($compatible, $channel);
        return is_file($f) ? json_decode((string) file_get_contents($f), true) : null;
    }

    private function write(string $file, array $feed): void
    {
        file_put_contents("$file.part", json_encode($feed, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . "\n");
        rename("$file.part", $file);
    }

    /**
     * The channel's release from now on: the bundle copied in (as
     * $bundleName), its size and SHA-256 in the feed. Its build must be
     * higher than any the channel has had. Returns the feed file.
     */
    public function publish(string $compatible, array $rel, string $bundleBytes, string $bundleName): string
    {
        self::checkName('compatible', $compatible);
        self::checkName('bundle name', $bundleName);
        if ($bundleBytes === '') {
            throw new \InvalidArgumentException('The bundle is empty');
        }
        $channel = self::checkChannel($rel['channel'] ?? 'stable');
        $dir = $this->dir . '/' . $compatible;
        $this->mkdir($dir);
        $feedFile = "$dir/$channel.json";
        $old = is_file($feedFile) ? json_decode((string) file_get_contents($feedFile), true) : null;
        $last = max((int) ($old['release']['build'] ?? 0), (int) ($old['withdrawn']['build'] ?? 0));
        if ($last >= $rel['build']) {
            throw new \InvalidArgumentException("The $channel channel has had build $last; a release needs a higher build number");
        }
        file_put_contents("$dir/$bundleName.part", $bundleBytes);
        rename("$dir/$bundleName.part", "$dir/$bundleName");
        unset($rel['channel']);
        $rel['url'] = $bundleName;
        $rel['size'] = strlen($bundleBytes);
        $rel['sha256'] = hash('sha256', $bundleBytes);
        $this->write($feedFile, ['format' => 1, 'compatible' => $compatible, 'channel' => $channel, 'release' => $rel]);
        return $feedFile;
    }

    /** No release on the channel (devices close its alerts); its build stays known. */
    public function withdraw(string $compatible, string $channel): string
    {
        $file = $this->feedFile($compatible, $channel);
        $feed = is_file($file) ? json_decode((string) file_get_contents($file), true) : null;
        if (!$feed || !$feed['release']) {
            throw new \InvalidArgumentException("Nothing published for $compatible on $channel");
        }
        $feed['withdrawn'] = $feed['release'];
        $feed['release'] = null;
        $this->write($file, $feed);
        return $file;
    }

    /** Every channel's feed: [{compatible, channel, release, withdrawn?}]. */
    public function all(?string $compatible = null): array
    {
        $out = [];
        foreach (glob($this->dir . '/' . ($compatible !== null ? self::checkName('compatible', $compatible) : '*') . '/*.json') ?: [] as $f) {
            $feed = json_decode((string) file_get_contents($f), true);
            if (is_array($feed) && ($feed['format'] ?? 0) === 1) {
                $out[] = $feed;
            }
        }
        usort($out, fn ($a, $b) => [$a['compatible'], $a['channel']] <=> [$b['compatible'], $b['channel']]);
        return $out;
    }

    /** The simulator's stand-in bundle (its manifest only; compatible "phoenix-sim"). */
    public static function simulatorBundle(array $rel): string
    {
        return "[update]\ncompatible=phoenix-sim\nversion={$rel['version']}\nbuild={$rel['build']}\n";
    }
}
