<?php
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// An update log: an app's changelog.json (beside its appinfo.json, in the
// .ipk too) and the system's release-notes.json (the same format, without
// "rebuild"). The catalog reads a package's log on upload (Ipk::check),
// keeps it with the release and serves "whatsNew" (the listed version's
// entry, in the index) and "versionHistory" (every entry, in the detail);
// server/updates takes a release's notes from release-notes.json. The rules
// are phoenix-default-apps' tools/lib/changelog.mjs, checked in the same
// order with the same messages; both run the same cases
// (tests/changelog-cases.json, a copy of that repository's
// tools/changelog-cases.json):
//
//   {"format": 1,
//    "unreleased": {"new": [], "improved": [], "fixed": [], "known": []},   never shipped
//    "versions": [{"version": "2.1.0", "date": "2026-11-02", "summary": "One sentence.",
//                  "new": [...], "improved": [...], "fixed": [...], "known": [...]},
//                 {"version": "2.0.0", "date": "2026-10-12", "rebuild": true,
//                  "replaces": "Tasks 1.0 (webOS 3.0.5)", "summary": "...", "new": [...]}]}
//
//   1. A JSON object; "format" 1; no top-level field but format, unreleased and versions.
//   2. "unreleased", when there: an object of new, improved, fixed and known lists.
//   3. "versions": at least one entry; each an object with no unknown field, a version
//      (x.y.z), a date (YYYY-MM-DD, a real day), a summary (one sentence, at most 140
//      characters), rebuild (true, only on the last entry; never in the system's notes),
//      replaces (only on the rebuild), the lists (items of at most 200 characters), at
//      least one item in new, improved or fixed; each version strictly lower than the one
//      above it, its date not later.
//   4. With an expected version (the package's, the system's): the first entry's.
//
// Text is plain and user-facing: no Markdown or HTML, commit hashes, issue numbers,
// file paths, internal names (app or service ids, code identifiers) or AI models'
// names. The patterns are JavaScript's (ASCII \w, \d and \b; JavaScript's \s), written
// out so PCRE reads them the same.
//
// The document is checked as json_decode gives it without $associative (objects as
// stdClass), so an object and a list stay apart as they do in JavaScript.

declare(strict_types=1);

namespace Phoenix\Marketplace;

final class Changelog
{
    public const FORMAT = 1;
    /** The lists an entry (and unreleased) holds, in the order they are shown. */
    public const KINDS = ['new', 'improved', 'fixed', 'known'];
    public const SUMMARY_MAX = 140;
    public const ITEM_MAX = 200;
    public const REPLACES_MAX = 140;

    private const TOP_FIELDS = ['format', 'unreleased', 'versions'];
    private const ENTRY_FIELDS = ['version', 'date', 'summary', 'rebuild', 'replaces', 'new', 'improved', 'fixed', 'known'];

    // JavaScript's classes, for PCRE in UTF-8 mode (where \w, \d, \s and \b are Unicode's).
    private const W = 'A-Za-z0-9_';
    private const S = '\t\n\x{0B}\f\r \x{A0}\x{1680}\x{2000}-\x{200A}\x{2028}\x{2029}\x{202F}\x{205F}\x{3000}\x{FEFF}';
    private const B = '(?:(?<=[A-Za-z0-9_])(?![A-Za-z0-9_])|(?<![A-Za-z0-9_])(?=[A-Za-z0-9_]))';

    /** [major, minor, patch] of an x.y.z version, or null. */
    public static function parseVersion(mixed $v): ?array
    {
        if (!is_string($v) || !preg_match('/^(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})$/D', $v, $m)) {
            return null;
        }
        return [(int) $m[1], (int) $m[2], (int) $m[3]];
    }

    /** <0, 0, >0 as version $a is lower than, the same as or higher than $b (both x.y.z). */
    public static function compareVersions(string $a, string $b): int
    {
        $x = self::parseVersion($a);
        $y = self::parseVersion($b);
        if (!$x || !$y) {
            throw new \InvalidArgumentException('not a version: ' . ($x ? $b : $a));
        }
        return ($x[0] <=> $y[0]) ?: (($x[1] <=> $y[1]) ?: ($x[2] <=> $y[2]));
    }

    /** A real day written YYYY-MM-DD. */
    public static function isDate(mixed $s): bool
    {
        return is_string($s) && preg_match('/^([0-9]{4})-([0-9]{2})-([0-9]{2})$/D', $s, $m)
            && checkdate((int) $m[2], (int) $m[3], (int) $m[1]);
    }

    /** The first problem with a piece of user-facing text at $path, or null (changelog.mjs textProblem). */
    public static function textProblem(mixed $s, string $path, int $max, bool $sentence = true, bool $oneSentence = false): ?string
    {
        $w = self::W;
        $sp = self::S;
        $b = self::B;
        if (!is_string($s)) {
            return "$path: must be text";
        }
        $trimmed = (string) preg_replace("/^[$sp]+|[$sp]+$/uD", '', $s);
        if ($trimmed === '') {
            return "$path: is empty";
        }
        if ($s !== $trimmed) {
            return "$path: has spaces at its start or end";
        }
        if (preg_match('/[\x00-\x1F\x7F]/', $s)) {
            return "$path: must be one line";
        }
        $length = mb_strlen($s, 'UTF-8');
        if ($length > $max) {
            return "$path: is $length characters long; at most $max";
        }
        $markdown = ['/\*\*|__|`|~~/u', '/\]\(/u', "/^(#{1,6}[$sp]|[-*+>][$sp]|[0-9]+[.)][$sp])/u",
                     "/(^|[^{$w}*])\\*[^$sp*][^*]*\\*($|[^{$w}*])/uD"];
        foreach ($markdown as $re) {
            if (preg_match($re, $s)) {
                return "$path: has Markdown";
            }
        }
        if (preg_match('/<\/?[A-Za-z!][^<>]*>/u', $s) || preg_match('/&([A-Za-z]+|#[0-9]+|#x[0-9A-Fa-f]+);/u', $s)) {
            return "$path: has HTML";
        }
        if (preg_match_all("/{$b}[0-9a-f]{7,40}{$b}/u", $s, $hex)) {
            foreach ($hex[0] as $run) {
                if (preg_match('/[0-9]/', $run) && preg_match('/[a-f]/', $run)) {
                    return "$path: has a commit hash";
                }
            }
        }
        if (preg_match("/(^|[^{$w}&])#[0-9]+{$b}/u", $s)) {
            return "$path: has an issue number";
        }
        // Web addresses are left aside for the path and name checks.
        $words = (string) preg_replace("/{$b}https?:\\/\\/[^$sp]+/iu", ' ', $s);
        $paths = ["/(^|[$sp(\"'])(~|\\.{1,2})?\\/[{$w}.-]+/u",
                  "/[{$w}.-]+\\/[{$w}.-]+\\/[{$w}.-]*/u",
                  "/{$b}[{$w}-]+\\.(tsx?|jsx?|mjs|cjs|json|css|less|md|html?|py|php|sh|cpp|qml|ya?ml){$b}/iu"];
        foreach ($paths as $re) {
            if (preg_match($re, $words)) {
                return "$path: has a file path";
            }
        }
        $internal = ["/{$b}(com|org|net|io)\\.[a-z0-9-]+\\.[A-Za-z0-9-]/u",      // an app or service id
                     "/{$b}luna:\\/\\//iu",                                    // a service address
                     "/{$b}[a-z]{2,}[A-Z][a-z]/u",                             // camelCase (webOS, iPhone are not)
                     "/{$b}[a-z][a-z0-9]*_[a-z0-9_]*[a-z0-9]{$b}/u",           // snake_case
                     "/{$b}[{$w}]+\\(\\)/u"];                                  // a function: open()
        foreach ($internal as $re) {
            if (preg_match($re, $words)) {
                return "$path: has an internal name";
            }
        }
        if (preg_match("/{$b}(claude|chatgpt|gpt-?[0-9][{$w}.]*|gemini|llama|copilot|mistral|grok){$b}/iu", $s)) {
            return "$path: names an AI model";
        }
        if ($sentence && !preg_match("/[.!?][\"'\\x{201D}\\x{2019})]*$/uD", $s)) {
            return "$path: must end with . ! or ?";
        }
        if ($oneSentence && preg_match("/[.!?][\"'\\x{201D}\\x{2019})]*[$sp]+[A-Z]/u", $s)) {
            return "$path: must be one sentence";
        }
        return null;
    }

    /**
     * Every problem with a log, in the order of the checks (the first is the message a reader
     * that stops at one gives). $doc as json_decode gives it without $associative. $version: the
     * version its first entry must be. $system: the system's release notes (no rebuild).
     *
     * @return string[]
     */
    public static function problems(mixed $doc, ?string $version = null, bool $system = false): array
    {
        if (!$doc instanceof \stdClass) {
            return ['changelog: must be a JSON object'];
        }
        $out = [];
        $format = $doc->format ?? null;
        if ($format !== self::FORMAT && $format !== (float) self::FORMAT) {
            $out[] = 'format: must be 1';
        }
        foreach (self::unknownKeys($doc, self::TOP_FIELDS) as $k) {
            $out[] = "$k: not a field of a changelog";
        }
        if (property_exists($doc, 'unreleased')) {
            $u = $doc->unreleased;
            if (!$u instanceof \stdClass) {
                $out[] = 'unreleased: must be an object';
            } else {
                foreach (self::unknownKeys($u, self::KINDS) as $k) {
                    $out[] = "unreleased.$k: not a field of unreleased";
                }
                foreach (self::KINDS as $kind) {
                    array_push($out, ...self::listProblems($u, $kind, "unreleased.$kind"));
                }
            }
        }
        $versions = $doc->versions ?? null;
        if (!is_array($versions)) {
            $out[] = 'versions: must be a list';
            return $out;
        }
        if (!$versions) {
            $out[] = 'versions: must list at least one version';
            return $out;
        }
        $last = count($versions) - 1;
        foreach ($versions as $i => $e) {
            $at = "versions[$i]";
            if (!$e instanceof \stdClass) {
                $out[] = "$at: must be an object";
                continue;
            }
            foreach (self::unknownKeys($e, self::ENTRY_FIELDS) as $k) {
                $out[] = "$at.$k: not a field of a version";
            }
            if (!self::parseVersion($e->version ?? null)) {
                $out[] = "$at.version: must be a version such as 1.2.3";
            }
            if (!self::isDate($e->date ?? null)) {
                $out[] = "$at.date: must be a date such as 2026-10-14";
            }
            if (!is_string($e->summary ?? null)) {
                $out[] = "$at.summary: must be a sentence";
            } elseif ($p = self::textProblem($e->summary, "$at.summary", self::SUMMARY_MAX, true, true)) {
                $out[] = $p;
            }
            $rebuild = property_exists($e, 'rebuild') ? $e->rebuild : null;
            if (property_exists($e, 'rebuild')) {
                if ($system) {
                    $out[] = "$at.rebuild: the system's release notes have no rebuild";
                } elseif ($rebuild !== true) {
                    $out[] = "$at.rebuild: must be true when it is there";
                } elseif ($i !== $last) {
                    $out[] = "$at.rebuild: only the last (oldest) version can be the rebuild";
                }
            }
            if (property_exists($e, 'replaces')) {
                if ($rebuild !== true) {
                    $out[] = "$at.replaces: only the rebuild names what it replaces";
                } elseif ($p = self::textProblem($e->replaces, "$at.replaces", self::REPLACES_MAX, false)) {
                    $out[] = $p;
                }
            }
            foreach (self::KINDS as $kind) {
                array_push($out, ...self::listProblems($e, $kind, "$at.$kind"));
            }
            $count = fn (string $k): int => is_array($e->$k ?? null) ? count($e->$k) : 0;
            if ($count('new') + $count('improved') + $count('fixed') === 0) {
                $out[] = "$at: lists nothing new, improved or fixed";
            }
            $above = $i > 0 ? $versions[$i - 1] : null;
            if ($above instanceof \stdClass) {
                if (self::parseVersion($e->version ?? null) && self::parseVersion($above->version ?? null)) {
                    $c = self::compareVersions($e->version, $above->version);
                    if ($c === 0) {
                        $out[] = "$at.version: {$e->version} is listed twice";
                    } elseif ($c > 0) {
                        $out[] = "$at.version: {$e->version} must be lower than {$above->version} above it";
                    }
                }
                if (self::isDate($e->date ?? null) && self::isDate($above->date ?? null) && strcmp($e->date, $above->date) > 0) {
                    $out[] = "$at.date: {$e->date} is later than {$above->date} above it";
                }
            }
        }
        $first = $versions[0];
        if ($version !== null && $first instanceof \stdClass && is_string($first->version ?? null) && $first->version !== $version) {
            $out[] = "versions[0].version: {$first->version} does not match the version $version";
        }
        return $out;
    }

    /**
     * A log's JSON text, checked: the log as it ships (without "unreleased"), as arrays. Throws
     * CheckFailed with the first problem, prefixed by $name (changelog.json, release-notes.json).
     */
    public static function parse(string $json, ?string $version = null, bool $system = false, string $name = 'changelog.json'): array
    {
        $doc = json_decode(preg_replace('/^\xEF\xBB\xBF/', '', $json));
        if ($doc === null && json_last_error() !== JSON_ERROR_NONE) {
            throw new CheckFailed("$name is not valid JSON");
        }
        $problems = self::problems($doc, $version, $system);
        if ($problems) {
            throw new CheckFailed("$name: {$problems[0]}");
        }
        $out = json_decode(json_encode($doc), true);
        unset($out['unreleased']);
        return $out;
    }

    /** One entry as the catalog and the system serve it: the lists always there, rebuild and replaces when set. */
    public static function entry(array $e, bool $withRebuild = true): array
    {
        $out = ['version' => $e['version'], 'date' => $e['date'], 'summary' => $e['summary']];
        foreach (self::KINDS as $k) {
            $out[$k] = array_values($e[$k] ?? []);
        }
        if ($withRebuild && !empty($e['rebuild'])) {
            $out['rebuild'] = true;
            if (isset($e['replaces'])) {
                $out['replaces'] = $e['replaces'];
            }
        }
        return $out;
    }

    /** "whatsNew": the listed (top) version's entry, {version, date, summary, new, improved, fixed, known}. */
    public static function whatsNew(array $log): array
    {
        return self::entry($log['versions'][0], false);
    }

    /** "versionHistory": every entry, newest first. */
    public static function history(array $log): array
    {
        return array_map(fn ($e) => self::entry($e), $log['versions']);
    }

    /** $o's keys that are not $allowed, in code point order. */
    private static function unknownKeys(\stdClass $o, array $allowed): array
    {
        $keys = array_values(array_filter(array_map('strval', array_keys(get_object_vars($o))), fn ($k) => !in_array($k, $allowed, true)));
        sort($keys, SORT_STRING);
        return $keys;
    }

    /** The problems with $o's list $kind at $path (absent is fine). */
    private static function listProblems(\stdClass $o, string $kind, string $path): array
    {
        if (!property_exists($o, $kind)) {
            return [];
        }
        $list = $o->$kind;
        if (!is_array($list)) {
            return ["$path: must be a list"];
        }
        $out = [];
        foreach ($list as $i => $item) {
            if ($p = self::textProblem($item, "{$path}[$i]", self::ITEM_MAX)) {
                $out[] = $p;
            }
        }
        return $out;
    }
}
