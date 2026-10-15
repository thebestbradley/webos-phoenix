<?php
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Device classes, kinds of app and feeds (docs/APP-STORE.md 3.17): the one
// list is the device's own, apps/marketplace/service/lib/availability.json,
// so the catalog and devices never disagree on an id; a new class, kind or
// feed is an entry there.
//
//   - Each app has one kind, assigned when it is published (kindFor), which
//     the admin can replace, and the device classes it is offered on: its
//     package's (appinfo.json "phoenix": {"deviceClasses": [...]}), or the
//     admin's in their place; all when neither says.
//   - The admin switches a kind or a whole feed off per device class (off).
//   - The index says each entry's appKind and deviceClasses, and the
//     switches as "availability": {deviceClasses, appKinds, feeds, off:
//     {kinds: {kind: [class]}, feeds: {feed: [class]}}}; devices filter
//     (apps/marketplace/service/lib/availability.js).

declare(strict_types=1);

namespace Phoenix\Marketplace;

final class Availability
{
    private static ?array $lists = null;

    /** availability.json as the device's service has it. */
    public static function lists(?string $repo = null): array
    {
        if (self::$lists === null || $repo !== null) {
            $file = ($repo ?? dirname(__DIR__, 3)) . '/apps/marketplace/service/lib/availability.json';
            $j = json_decode((string) @file_get_contents($file), true);
            if (!is_array($j) || !isset($j['deviceClasses'], $j['appKinds'], $j['feeds'])) {
                throw new \RuntimeException("$file: the device classes, kinds and feeds are missing");
            }
            self::$lists = $j;
        }
        return self::$lists;
    }

    /** @return string[] */
    public static function ids(string $list): array
    {
        return array_column(self::lists()[$list], 'id');
    }

    /**
     * A list of device classes as a package or the admin gives it: the known ones in the
     * list's order. null for "all" (missing); anything else refused, saying so.
     */
    public static function classes(mixed $v, string $what): ?array
    {
        if ($v === null) {
            return null;
        }
        $known = self::ids('deviceClasses');
        if (!is_array($v) || !array_is_list($v) || !$v || array_filter($v, fn ($c) => !is_string($c) || !in_array($c, $known, true))) {
            throw new CheckFailed("$what: a list of device classes (" . implode(', ', $known) . ')');
        }
        return array_values(array_filter($known, fn ($c) => in_array($c, $v, true)));
    }

    /** A kind the list has, or refused. */
    public static function kind(mixed $v, string $what): string
    {
        $known = self::ids('appKinds');
        if (!is_string($v) || !in_array($v, $known, true)) {
            throw new CheckFailed("$what: one of " . implode(', ', $known));
        }
        return $v;
    }

    /**
     * The kind the catalog gives an app when it publishes it, by where it comes from (in this
     * order): a website (a PWA, Phoenix's curated ones too) is a web app; an id in Phoenix's
     * namespaces is Phoenix's own (its 1.0 and 2.0 apps, its connectors); an upload by a
     * developer to a development catalog is the local developer's (sideloaded); a package with a
     * service is native; the rest (a packaged web app, an open-source web app Phoenix hosts) are
     * web apps. "legacy" is the device's, for the App Museum's and Preware's apps, or the admin's.
     */
    public static function kindFor(string $id, string $packageKind, ?string $ownerRole, bool $devCatalog): string
    {
        if ($packageKind === 'pwa') {
            return 'web';
        }
        // Phoenix's namespace, and Palm's when Phoenix publishes it: the 2.0 apps that keep their
        // original ids (com.palm.app.calendar, ...) are Phoenix's rebuilt originals. Palm's ids from
        // anyone else are no proof of anything.
        if (preg_match('/^(org|com)\.webosphoenix\./', $id) || (str_starts_with($id, 'com.palm.') && $ownerRole === 'admin')) {
            return 'phoenix';
        }
        if ($devCatalog && $ownerRole === 'developer') {
            return 'local';
        }
        if ($packageKind === 'connector') {
            return 'native';
        }
        return 'web';
    }

    /**
     * The admin's switches, as stored: what is off where. Unknown ids (a list that lost one) are
     * left out.
     */
    public static function off(mixed $stored): array
    {
        $out = ['kinds' => [], 'feeds' => []];
        foreach (['kinds' => 'appKinds', 'feeds' => 'feeds'] as $part => $list) {
            foreach ((array) ($stored[$part] ?? []) as $id => $classes) {
                if (!in_array($id, self::ids($list), true) || !is_array($classes)) {
                    continue;
                }
                $cls = array_values(array_filter(self::ids('deviceClasses'), fn ($c) => in_array($c, $classes, true)));
                if ($cls) {
                    $out[$part][$id] = $cls;
                }
            }
        }
        return $out;
    }

    /** The admin's new switches, checked: {kinds: {kind: [class]}, feeds: {feed: [class]}}. */
    public static function checkOff(mixed $v): array
    {
        if (!is_array($v)) {
            throw new CheckFailed('off: {kinds: {kind: [classes]}, feeds: {feed: [classes]}}');
        }
        foreach (['kinds' => 'appKinds', 'feeds' => 'feeds'] as $part => $list) {
            foreach ((array) ($v[$part] ?? []) as $id => $classes) {
                if (!in_array($id, self::ids($list), true)) {
                    throw new CheckFailed("off.$part: $id is not one of " . implode(', ', self::ids($list)));
                }
                if ($classes !== [] && $classes !== null) {
                    self::classes($classes, "off.$part.$id");
                }
            }
        }
        return self::off($v);
    }
}
