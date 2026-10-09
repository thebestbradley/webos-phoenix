<?php
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The driver catalog (docs/DRIVERS.md): driver manifests checked and kept,
// their packages checked and copied next to the catalog, and the signed
// index org.webosphoenix.hardware reads (services/hardware/lib/drivers.js):
//
//   <data>/entries/<id>.json        a reviewed driver: its manifest, with
//                                   each package's name, version, arch,
//                                   kernel, size, installedSize, sha256
//   <data>/public/v1/drivers.json   the index ("format": 1)
//   <data>/public/v1/drivers.json.sig, key.json
//   <data>/public/v1/packages/      the .ipk files
//   <data>/reports.jsonl            the opt-in hardware reports (IDs only)
//
// Signed with the Marketplace's Signer (Ed25519, libsodium): the same trust
// model, a separate key. The key is pinned in the system image
// (/etc/palm/hardware/catalog.json), not trusted on first use.

declare(strict_types=1);

namespace Phoenix\Drivers;

use Phoenix\Marketplace\CheckFailed;
use Phoenix\Marketplace\Ipk;
use Phoenix\Marketplace\Signer;

final class Catalog
{
    public const KINDS = ['firmware', 'module', 'service'];
    public const AFTER = ['reload', 'rebind', 'reboot', 'none'];
    public const CATEGORIES = ['wifi', 'bluetooth', 'graphics', 'camera', 'audio', 'input', 'sensors', 'storage', 'modem', 'network', 'usb', 'other'];
    public const BUSES = ['pci', 'usb', 'sdio', 'of', 'acpi', 'i2c', 'spi', 'platform', 'hid', 'dmi', 'serio', 'input'];
    private const REPORT_BUSES = ['pci', 'usb', 'sdio', 'of', 'acpi', 'i2c', 'spi', 'platform', 'hid'];
    public const MAX_PACKAGE = 256 * 1024 * 1024;
    private const SCRIPTS = ['preinst', 'postinst', 'prerm', 'postrm'];

    public function __construct(public readonly string $data, public readonly string $name = 'Phoenix Drivers')
    {
    }

    private function dir(string $sub): string
    {
        $d = "$this->data/$sub";
        if (!is_dir($d) && !mkdir($d, 0755, true)) {
            throw new \RuntimeException("Cannot make $d");
        }
        return $d;
    }

    // ---- Packages ---------------------------------------------------------------------

    /** An .ipk's control fields and files, whatever it is compressed with (gzip, xz, zstd: OE writes xz). */
    public static function readPackage(string $bytes): array
    {
        if (strlen($bytes) > self::MAX_PACKAGE) {
            throw new CheckFailed('The package is larger than 256 MB');
        }
        $ar = Ipk::readAr($bytes);
        $member = function (string $stem) use ($ar): array {
            foreach (['gz', 'xz', 'zst'] as $ext) {
                if (isset($ar["$stem.tar.$ext"])) {
                    return Ipk::readTar(self::decompress($ar["$stem.tar.$ext"], $ext));
                }
            }
            throw new CheckFailed("Not an .ipk package (no $stem.tar.gz, .xz or .zst)");
        };
        $control = $member('control');
        $data = $member('data');
        if (!isset($control['control']['data'])) {
            throw new CheckFailed('The package has no control file');
        }
        $fields = Ipk::parseControl($control['control']['data']);
        foreach (['Package', 'Version', 'Architecture'] as $f) {
            if (($fields[$f] ?? '') === '') {
                throw new CheckFailed("The control file has no $f");
            }
        }
        $scripts = [];
        foreach (self::SCRIPTS as $s) {
            if (isset($control[$s]['data'])) {
                $scripts[$s] = $control[$s]['data'];
            }
        }
        return ['control' => $fields, 'scripts' => $scripts, 'files' => $data];
    }

    private static function decompress(string $b, string $ext): string
    {
        if ($ext === 'gz') {
            $out = @gzdecode($b);
        } else {
            $out = self::pipe($ext === 'xz' ? ['xz', '-dc'] : ['zstd', '-dc'], $b);
        }
        if ($out === false || $out === null) {
            throw new CheckFailed("Damaged .ipk package ($ext)");
        }
        return $out;
    }

    private static function pipe(array $cmd, string $in): ?string
    {
        $p = @proc_open($cmd, [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes);
        if (!is_resource($p)) {
            throw new CheckFailed("Cannot run {$cmd[0]} to read the package");
        }
        fwrite($pipes[0], $in);
        fclose($pipes[0]);
        $out = stream_get_contents($pipes[1]);
        fclose($pipes[1]);
        fclose($pipes[2]);
        return proc_close($p) === 0 ? $out : null;
    }

    /**
     * The automatic review of a package for a kind of driver (docs/DRIVERS.md,
     * "What is checked"). Returns the package's catalog record.
     */
    public static function checkPackage(string $bytes, string $kind, bool $reviewed = false): array
    {
        $pkg = self::readPackage($bytes);
        $c = $pkg['control'];
        if (!preg_match('/^[a-z0-9][a-z0-9.+-]*$/', $c['Package'])) {
            throw new CheckFailed("Not a valid package name: {$c['Package']}");
        }
        $kernel = null;
        $installed = 0;
        foreach ($pkg['files'] as $path => $f) {
            $installed += strlen($f['data'] ?? '');
            $ok = match ($kind) {
                'firmware' => (bool) preg_match('#^(lib/firmware/|usr/share/(doc|licenses)/)#', $path),
                'module' => (bool) preg_match('#^(lib/modules/[^/]+/|etc/(modprobe|modules-load)\.d/[^/]+\.conf$|usr/share/(doc|licenses)/)#', $path),
                default => !preg_match('#^(etc/(passwd|shadow|group|sudoers)|boot/)#', $path),
            };
            if (!$ok) {
                throw new CheckFailed("A $kind package cannot put a file at /$path");
            }
            if (preg_match('#^lib/modules/([^/]+)/#', $path, $m)) {
                if ($kernel !== null && $kernel !== $m[1]) {
                    throw new CheckFailed('The package has modules for more than one kernel');
                }
                $kernel = $m[1];
            }
        }
        foreach ($pkg['scripts'] as $name => $text) {
            // Kernel module packages run depmod (OE's kernel-module-split); nothing else runs without a person reading it.
            $lines = array_filter(array_map('trim', explode("\n", $text)), fn ($l) => $l !== '' && $l[0] !== '#');
            $onlyDepmod = $kind === 'module' && $lines && !array_filter($lines, fn ($l) =>
                !preg_match('/^(set -e|if \[ -z "\$D" \]; then|if \[ x"\$D" = "x" \]; then|fi|else|then|:|depmod -a( \S+)?|update-modules \|\| true|exit 0|\S*depmod\S* -a .*)$/', $l));
            if (!$onlyDepmod && !$reviewed) {
                throw new CheckFailed("The package has a $name script; a person has to read it first (add --reviewed)");
            }
        }
        if ($kind === 'service' && !$reviewed) {
            throw new CheckFailed('A service package runs programs as the system; a person has to review it first (add --reviewed)');
        }
        return [
            'name' => $c['Package'], 'version' => $c['Version'], 'arch' => $c['Architecture'], 'kernel' => $kernel,
            'size' => strlen($bytes), 'installedSize' => $installed, 'sha256' => hash('sha256', $bytes),
            'files' => array_keys($pkg['files']),
        ];
    }

    // ---- Manifests --------------------------------------------------------------------

    /**
     * A driver manifest (docs/DRIVERS.md, "The manifest") and its packages'
     * bytes (file name => bytes) -> the catalog entry. Throws CheckFailed.
     */
    public static function check(array $m, array $packages, bool $reviewed = false): array
    {
        $id = (string) ($m['id'] ?? '');
        if (!preg_match('/^[a-z0-9]+([._-][a-z0-9]+)*$/', $id) || strlen($id) > 80) {
            throw new CheckFailed("id: lower-case letters, digits, '.', '_' and '-' ($id)");
        }
        $kind = $m['kind'] ?? '';
        if (!in_array($kind, self::KINDS, true)) {
            throw new CheckFailed('kind: ' . implode(', ', self::KINDS));
        }
        $title = trim((string) ($m['title'] ?? ''));
        if ($title === '' || mb_strlen($title) > 120) {
            throw new CheckFailed('title: required, at most 120 characters');
        }
        $lic = $m['license'] ?? null;
        if (!is_array($lic) || trim((string) ($lic['id'] ?? '')) === '' || trim((string) ($lic['name'] ?? '')) === '') {
            throw new CheckFailed('license: {id, name, text, url, free, redistributable}');
        }
        if (($lic['redistributable'] ?? null) !== true) {
            throw new CheckFailed('Phoenix only distributes drivers and firmware whose licence allows it (license.redistributable must be true)');
        }
        if (($lic['free'] ?? null) !== true && trim((string) ($lic['text'] ?? '')) === '') {
            throw new CheckFailed('license.text: a licence that is not a free licence is shown to the user in full before installing');
        }
        $match = $m['match'] ?? [];
        $firmware = $m['firmware'] ?? [];
        if (!is_array($match) || !is_array($firmware) || (!$match && !$firmware)) {
            throw new CheckFailed('match or firmware: what hardware the driver is for');
        }
        foreach ($match as $p) {
            $bus = explode(':', (string) $p)[0];
            if (!is_string($p) || !in_array($bus, self::BUSES, true) || strlen($p) > 200 || strlen($p) <= strlen($bus) + 1) {
                throw new CheckFailed("match: a modalias pattern (pci:..., usb:..., of:..., acpi:...), not " . json_encode($p));
            }
            if (preg_match('/^(pci|usb|sdio):\*?$/', $p) || $p === "$bus:*") {
                throw new CheckFailed("match: $p matches every device on the bus");
            }
        }
        foreach ($firmware as $f) {
            if (!is_string($f) || $f === '' || $f[0] === '/' || str_contains("/$f/", '/../')) {
                throw new CheckFailed('firmware: file names under /lib/firmware, as the driver asks for them');
            }
        }
        $modules = $m['modules'] ?? [];
        foreach ($modules as $mod) {
            if (!is_string($mod) || !preg_match('/^[A-Za-z0-9_-]+$/', $mod)) {
                throw new CheckFailed('modules: kernel module names');
            }
        }
        $after = $m['after'] ?? 'reload';
        if (!in_array($after, self::AFTER, true)) {
            throw new CheckFailed('after: ' . implode(', ', self::AFTER));
        }
        $category = $m['category'] ?? 'other';
        if (!in_array($category, self::CATEGORIES, true)) {
            throw new CheckFailed('category: ' . implode(', ', self::CATEGORIES));
        }
        foreach (['source', 'homepage'] as $k) {
            if (isset($m[$k]) && !preg_match('#^https?://#', (string) $m[$k])) {
                throw new CheckFailed("$k: a web address");
            }
        }
        if (!$packages) {
            throw new CheckFailed('packages: at least one .ipk');
        }
        $records = [];
        $files = [];
        foreach ($packages as $bytes) {
            $r = self::checkPackage($bytes, $kind, $reviewed);
            $files = array_merge($files, $r['files']);
            unset($r['files']);
            $records[] = $r;
        }
        if ($kind === 'firmware') {
            // Each name (or glob, "iwlwifi-*.ucode") is in a package, compressed or not.
            foreach ($firmware as $fw) {
                if (!array_filter($files, fn ($f) => (bool) preg_match('#^lib/firmware/(.+?)(\.xz|\.zst)?$#', $f, $mm) && fnmatch($fw, $mm[1], FNM_NOESCAPE))) {
                    throw new CheckFailed("firmware: no package has lib/firmware/$fw");
                }
            }
        }
        return [
            'id' => $id, 'kind' => $kind, 'title' => $title, 'summary' => (string) ($m['summary'] ?? ''),
            'description' => (string) ($m['description'] ?? ''), 'category' => $category,
            'match' => array_values($match), 'firmware' => array_values($firmware), 'modules' => array_values($modules),
            'optional' => (bool) ($m['optional'] ?? false), 'after' => $after,
            'license' => ['id' => (string) $lic['id'], 'name' => (string) $lic['name'], 'text' => (string) ($lic['text'] ?? ''),
                          'url' => (string) ($lic['url'] ?? ''), 'free' => ($lic['free'] ?? false) === true, 'redistributable' => true],
            'source' => (string) ($m['source'] ?? ''), 'homepage' => (string) ($m['homepage'] ?? ''),
            'maintainer' => is_array($m['maintainer'] ?? null) ? array_intersect_key($m['maintainer'], ['name' => 1, 'email' => 1]) : null,
            'packages' => $records,
        ];
    }

    /** Checks a manifest file and its packages, copies the packages in and keeps the entry. */
    public function add(string $manifestFile, bool $reviewed = false): array
    {
        $m = json_decode((string) @file_get_contents($manifestFile), true);
        if (!is_array($m)) {
            throw new CheckFailed("$manifestFile is not a JSON manifest");
        }
        $base = dirname($manifestFile);
        if (isset($m['license']['textFile'])) {
            $m['license']['text'] = (string) @file_get_contents("$base/" . basename((string) $m['license']['textFile']));
        }
        $bytes = [];
        foreach ((array) ($m['packages'] ?? []) as $f) {
            $path = "$base/" . basename((string) $f);
            if (!is_file($path)) {
                throw new CheckFailed("packages: $f is not next to the manifest");
            }
            $bytes[] = (string) file_get_contents($path);
        }
        // The licence text from a file in one of the packages (linux-firmware's
        // licence packages: lib/firmware/LICENCE.rtlwifi_firmware.txt).
        if (isset($m['license']['textInPackage'])) {
            $want = ltrim((string) $m['license']['textInPackage'], '/');
            foreach ($bytes as $b) {
                $files = self::readPackage($b)['files'];
                if (isset($files[$want]['data'])) {
                    $m['license']['text'] = $files[$want]['data'];
                }
            }
            if (($m['license']['text'] ?? '') === '') {
                throw new CheckFailed("license.textInPackage: no package has /$want");
            }
        }
        $entry = self::check($m, $bytes, $reviewed);
        $out = $this->dir('public/v1/packages');
        foreach ($entry['packages'] as $i => &$p) {
            $file = "{$p['name']}_{$p['version']}_{$p['arch']}.ipk";
            file_put_contents("$out/$file", $bytes[$i]);
            $p['url'] = "packages/$file";
        }
        unset($p);
        file_put_contents($this->dir('entries') . "/{$entry['id']}.json", json_encode($entry, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) . "\n");
        return $entry;
    }

    public function remove(string $id): bool
    {
        $f = "$this->data/entries/" . basename($id) . '.json';
        return is_file($f) && unlink($f);
    }

    /** @return array<int, array> the kept entries, by id */
    public function entries(): array
    {
        $out = [];
        foreach (glob("$this->data/entries/*.json") ?: [] as $f) {
            $e = json_decode((string) file_get_contents($f), true);
            if (is_array($e)) {
                $out[] = $e;
            }
        }
        usort($out, fn ($a, $b) => strcmp($a['id'], $b['id']));
        return $out;
    }

    // ---- The index ----------------------------------------------------------------------

    /** Writes and signs drivers.json, a build newer than the last. */
    public function publish(Signer $signer, int $days = 30, ?\DateTimeImmutable $now = null): array
    {
        $now ??= new \DateTimeImmutable('now', new \DateTimeZone('UTC'));
        $dir = $this->dir('public/v1');
        $last = json_decode((string) @file_get_contents("$dir/drivers.json"), true);
        $index = [
            'format' => 1, 'build' => (int) ($last['build'] ?? 0) + 1,
            'generated' => $now->format('Y-m-d\TH:i:s\Z'), 'expires' => $now->modify("+$days days")->format('Y-m-d\TH:i:s\Z'),
            'source' => ['id' => 'phoenix-drivers', 'name' => $this->name],
            'drivers' => array_map(function ($e) {
                unset($e['maintainer']);
                return $e;
            }, $this->entries()),
        ];
        $json = json_encode($index, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        file_put_contents("$dir/drivers.json.new", $json);
        file_put_contents("$dir/drivers.json.sig.new", base64_encode($signer->sign($json)) . "\n");
        file_put_contents("$dir/key.json", json_encode(['key' => base64_encode($signer->public), 'name' => $this->name]) . "\n");
        // The signature first: a reader never sees a new index with an old signature for long.
        rename("$dir/drivers.json.sig.new", "$dir/drivers.json.sig");
        rename("$dir/drivers.json.new", "$dir/drivers.json");
        return $index;
    }

    /** Checks a published catalog's signature against a key (base64). */
    public static function verify(string $dir, string $keyB64): array
    {
        $json = (string) @file_get_contents("$dir/drivers.json");
        $sig = base64_decode(trim((string) @file_get_contents("$dir/drivers.json.sig")), true);
        $key = base64_decode($keyB64, true);
        if ($json === '' || $sig === false || $key === false || strlen($key) !== SODIUM_CRYPTO_SIGN_PUBLICKEYBYTES
            || strlen($sig) !== SODIUM_CRYPTO_SIGN_BYTES || !sodium_crypto_sign_verify_detached($sig, $json, $key)) {
            throw new CheckFailed("$dir/drivers.json is not signed with that key");
        }
        return json_decode($json, true);
    }

    // ---- Hardware reports ------------------------------------------------------------------

    /**
     * A report from a device, kept only if it is IDs and nothing else
     * (services/hardware/hardwareservice.js reportOf). No address or time
     * finer than the day is kept with it.
     */
    public function addReport(string $body, ?\DateTimeImmutable $now = null): array
    {
        if (strlen($body) > 32768) {
            throw new CheckFailed('The report is too large');
        }
        $r = json_decode($body, true);
        if (!is_array($r) || ($r['format'] ?? null) !== 1 || !is_array($r['devices'] ?? null) || count($r['devices']) > 64) {
            throw new CheckFailed('Not a format 1 hardware report');
        }
        $devices = [];
        foreach ($r['devices'] as $d) {
            $bus = $d['bus'] ?? '';
            if (!in_array($bus, self::REPORT_BUSES, true) || !is_array($d['ids'] ?? null) || count($d['ids']) > 16) {
                throw new CheckFailed('A report device is a bus and its IDs');
            }
            $ids = [];
            foreach ($d['ids'] as $id) {
                if (!is_string($id) || strlen($id) > 200 || explode(':', $id)[0] !== $bus || !preg_match('/^[A-Za-z0-9:,._()<>*+\-\/ ]+$/', $id)) {
                    throw new CheckFailed('A report has something that is not a device ID');
                }
                $ids[] = $id;
            }
            $fw = [];
            foreach ((array) ($d['firmwareMissing'] ?? []) as $f) {
                if (!is_string($f) || !preg_match('#^[A-Za-z0-9._+\-/]{1,160}$#', $f) || str_contains($f, '..')) {
                    throw new CheckFailed('A report has something that is not a firmware file name');
                }
                $fw[] = $f;
            }
            $devices[] = ['bus' => $bus, 'ids' => $ids, 'firmwareMissing' => $fw];
        }
        $arch = preg_match('/^[a-z0-9_]{1,20}$/', (string) ($r['arch'] ?? '')) ? $r['arch'] : 'unknown';
        $kernel = preg_match('/^[0-9.]{1,20}$/', (string) ($r['kernel'] ?? '')) ? $r['kernel'] : '';
        $now ??= new \DateTimeImmutable('now', new \DateTimeZone('UTC'));
        $rec = ['day' => $now->format('Y-m-d'), 'arch' => $arch, 'kernel' => $kernel, 'devices' => $devices];
        $this->dir('.');
        file_put_contents("$this->data/reports.jsonl", json_encode($rec, JSON_UNESCAPED_SLASHES) . "\n", FILE_APPEND | LOCK_EX);
        return $rec;
    }

    /** The reported devices no catalog entry is for yet, most reported first: [[id, count, firmware], ...]. */
    public function unmatched(): array
    {
        $patterns = [];
        $firmware = [];
        foreach ($this->entries() as $e) {
            foreach ($e['match'] as $p) {
                $patterns[] = $p;
            }
            foreach ($e['firmware'] as $f) {
                $firmware[$f] = true;
            }
        }
        $count = [];
        $fwOf = [];
        foreach (@file("$this->data/reports.jsonl", FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [] as $line) {
            $r = json_decode($line, true);
            foreach ($r['devices'] ?? [] as $d) {
                $key = $d['ids'][0] ?? null;
                if ($key === null) {
                    continue;
                }
                $known = array_filter($d['ids'], fn ($id) => array_filter($patterns, fn ($p) => fnmatch($p, $id, FNM_NOESCAPE)))
                    || array_filter($d['firmwareMissing'], fn ($f) => isset($firmware[$f]));
                if ($known) {
                    continue;
                }
                $count[$key] = ($count[$key] ?? 0) + 1;
                $fwOf[$key] = array_values(array_unique(array_merge($fwOf[$key] ?? [], $d['firmwareMissing'])));
            }
        }
        arsort($count);
        $out = [];
        foreach ($count as $id => $n) {
            $out[] = [$id, $n, $fwOf[$id]];
        }
        return $out;
    }
}
