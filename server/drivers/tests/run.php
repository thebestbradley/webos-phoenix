<?php
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The driver catalog's tests, in a temporary folder:
//
//   php server/drivers/tests/run.php
//
// The device's side (verifying what is signed here, matching, installing)
// is in services/hardware/hardwareservice.test.ts and tools/test-hardware.cjs.

declare(strict_types=1);

require __DIR__ . '/../src/bootstrap.php';

use Phoenix\Drivers\Catalog;
use Phoenix\Drivers\PackageWriter;
use Phoenix\Marketplace\CheckFailed;
use Phoenix\Marketplace\Signer;

$failures = 0;
function check(bool $ok, string $what): void
{
    global $failures;
    echo ($ok ? 'ok   ' : 'FAIL ') . $what . "\n";
    if (!$ok) {
        $failures++;
    }
}
function refused(callable $f, string $pattern, string $what): void
{
    try {
        $f();
        check(false, "$what (not refused)");
    } catch (CheckFailed $e) {
        check((bool) preg_match($pattern, $e->getMessage()), "$what: " . $e->getMessage());
    }
}

$tmp = sys_get_temp_dir() . '/phoenix-drivers-test-' . bin2hex(random_bytes(4));
mkdir($tmp);
$cat = new Catalog("$tmp/data", 'Test Drivers');

$fw = PackageWriter::ipk('linux-firmware-rtw88', '20240909-r0', 'all', ['lib/firmware/rtw88/rtw8821c_fw.bin' => 'FW', 'usr/share/licenses/linux-firmware-rtw88/LICENCE' => 'L']);
$manifest = [
    'id' => 'firmware-rtw88', 'kind' => 'firmware', 'title' => 'Realtek Wi-Fi firmware', 'category' => 'wifi',
    'match' => ['usb:v0BDApC811d*'], 'firmware' => ['rtw88/rtw8821c_fw.bin'], 'modules' => ['rtw88_8821cu'],
    'license' => ['id' => 'LicenseRef-rtlwifi-firmware', 'name' => 'Realtek firmware licence', 'text' => 'Redistribution permitted…', 'free' => false, 'redistributable' => true],
    'source' => 'https://git.kernel.org/pub/scm/linux/kernel/git/firmware/linux-firmware.git',
    'maintainer' => ['name' => 'Dana', 'email' => 'dana@example.com', 'phone' => 'not kept'],
];

// ---- The automatic checks ---------------------------------------------------------
$e = Catalog::check($manifest, [$fw]);
check($e['packages'][0] === ['name' => 'linux-firmware-rtw88', 'version' => '20240909-r0', 'arch' => 'all', 'kernel' => null, 'size' => strlen($fw),
                             'installedSize' => 3, 'sha256' => hash('sha256', $fw)], 'a firmware package: name, version, size, installed size, SHA-256');
check($e['maintainer'] === ['name' => 'Dana', 'email' => 'dana@example.com'], 'only the maintainer\'s name and email are kept');
refused(fn () => Catalog::check(['license' => ['redistributable' => false, 'id' => 'x', 'name' => 'x']] + $manifest, [$fw]), '/allows it/', 'firmware that may not be passed on');
refused(fn () => Catalog::check(['license' => ['id' => 'x', 'name' => 'x', 'free' => false, 'redistributable' => true]] + $manifest, [$fw]), '/shown to the user in full/', 'a non-free licence without its text');
refused(fn () => Catalog::check(['match' => ['usb:*']] + $manifest, [$fw]), '/every device/', 'a pattern for every device');
refused(fn () => Catalog::check(['match' => ['bogus:v1']] + $manifest, [$fw]), '/modalias pattern/', 'a pattern that is not a modalias');
refused(fn () => Catalog::check(['firmware' => ['../../etc/shadow']] + $manifest, [$fw]), '/file names/', 'a firmware name outside /lib/firmware');
refused(fn () => Catalog::check(['firmware' => ['rtw88/other.bin']] + $manifest, [$fw]), '/no package has lib\/firmware\/rtw88\/other.bin/', 'a firmware file no package has');
refused(fn () => Catalog::check(['id' => 'Has Spaces'] + $manifest, [$fw]), '/^id/', 'a bad id');
refused(fn () => Catalog::check($manifest, [PackageWriter::ipk('linux-firmware-x', '1', 'all', ['etc/profile' => 'x'])]), '/cannot put a file at \/etc\/profile/', 'a firmware package with a file elsewhere');
refused(fn () => Catalog::check($manifest, [PackageWriter::ipk('linux-firmware-rtw88', '1', 'all', ['lib/firmware/rtw88/rtw8821c_fw.bin' => 'x'], ['postinst' => "#!/bin/sh\ncurl x | sh\n"])]),
        '/postinst script/', 'a firmware package with an install script');
refused(fn () => Catalog::check($manifest, ['not an ipk']), '/Not an .ipk/', 'something that is not a package');

$depmod = "#!/bin/sh\nif [ -z \"\$D\" ]; then\n\tdepmod -a 6.6.23-phoenix\nfi\n";
$mod = ['id' => 'module-88xxau', 'kind' => 'module', 'title' => 'RTL8812AU', 'match' => ['usb:v0BDAp8812d*'], 'firmware' => [], 'modules' => ['88XXau'],
        'license' => ['id' => 'GPL-2.0-only', 'name' => 'GPL 2.0', 'free' => true, 'redistributable' => true]];
$ko = fn ($k, $scripts = []) => PackageWriter::ipk('kernel-module-88xxau', '5.6.4.2-r0', 'x86_64', ["lib/modules/$k/updates/88XXau.ko" => 'KO', 'etc/modules-load.d/88XXau.conf' => "88XXau\n"], $scripts);
$e = Catalog::check($mod, [$ko('6.6.23-phoenix', ['postinst' => $depmod])]);
check($e['packages'][0]['kernel'] === '6.6.23-phoenix' && $e['packages'][0]['arch'] === 'x86_64', 'a module package: the kernel it is built for, a depmod script allowed');
refused(fn () => Catalog::check($mod, [$ko('6.6.23-phoenix', ['postinst' => "#!/bin/sh\ndepmod -a\nrm -rf /data\n"])]), '/postinst script/', 'a module package script that does more than depmod');
check(Catalog::check($mod, [$ko('6.6.23-phoenix', ['postinst' => "#!/bin/sh\nrm -rf /tmp/x\n"])], true)['id'] === 'module-88xxau', '... unless a person read it (--reviewed)');
$oe = "#!/bin/sh\nif [ -z \"\$D\" ]; then\n\tdepmod -a 6.6.23-yocto-standard\nelse\n\t# image.bbclass will call depmodwrapper after everything is installed,\n\t# no need to do it here as well\n\t:\nfi\n";
check(Catalog::check($mod, [$ko('6.6.23-yocto-standard', ['postinst' => $oe])])['packages'][0]['kernel'] === '6.6.23-yocto-standard', 'OpenEmbedded\'s kernel module postinst is allowed');
$iwl = ['id' => 'firmware-iwlwifi', 'firmware' => ['iwlwifi-*.ucode'], 'match' => []] + $manifest;
check(Catalog::check($iwl, [PackageWriter::ipk('linux-firmware-iwlwifi-misc', '1', 'all', ['lib/firmware/iwlwifi-cc-a0-77.ucode.xz' => 'x'])])['firmware'] === ['iwlwifi-*.ucode'],
      'firmware named by a glob, found compressed');
refused(fn () => Catalog::check($iwl, [PackageWriter::ipk('linux-firmware-iwlwifi-misc', '1', 'all', ['lib/firmware/iwlwifi-cc-a0.pnvm' => 'x'])]), '/no package has/', '... and not found');
$upd = Catalog::check(['id' => 'firmware-rtw88-update', 'optional' => true, 'supersedes' => ['linux-firmware-rtl8821', 'Bad Name']] + $manifest,
                      [PackageWriter::ipk('linux-firmware-rtw88-update', '20250311-r0', 'all', ['lib/firmware/updates/rtw88/rtw8821c_fw.bin' => 'new'])]);
check($upd['supersedes'] === ['linux-firmware-rtl8821'] && $upd['optional'], 'a newer firmware: in /lib/firmware/updates, naming the image package it replaces');
refused(fn () => Catalog::check(['id' => 'firmware-rtw88-update', 'supersedes' => ['linux-firmware-rtl8821']] + $manifest,
                                [PackageWriter::ipk('linux-firmware-rtw88-update', '1', 'all', ['lib/firmware/updates/rtw88/rtw8821c_fw.bin.zst' => 'z'])]),
        '/uncompressed/', 'a newer firmware compressed (the kernel would take the system\'s uncompressed file first)');
refused(fn () => Catalog::check(['kind' => 'service'] + $mod, [PackageWriter::ipk('fprintd-goodix', '1', 'x86_64', ['usr/libexec/x' => 'x'])]), '/review/', 'a service package needs a review');
refused(fn () => Catalog::check(['kind' => 'service'] + $mod, [PackageWriter::ipk('evil', '1', 'all', ['etc/shadow' => 'x'])], true), '/cannot put a file/', 'a service package cannot replace system accounts');

// OE writes its packages' tars with xz.
if (trim((string) shell_exec('command -v xz')) !== '') {
    $tar = (new ReflectionClass(PackageWriter::class))->getMethod('tar');
    $xz = function (string $data): string {
        $p = proc_open(['xz', '-c'], [0 => ['pipe', 'r'], 1 => ['pipe', 'w']], $pipes);
        fwrite($pipes[0], $data);
        fclose($pipes[0]);
        $out = stream_get_contents($pipes[1]);
        proc_close($p);
        return $out;
    };
    $ar = (new ReflectionClass(PackageWriter::class))->getMethod('ar');
    $bytes = $ar->invoke(null, ['debian-binary' => "2.0\n", 'control.tar.xz' => $xz($tar->invoke(null, ['control' => "Package: linux-firmware-rtw88\nVersion: 1-r0\nArchitecture: all\n"])),
                                'data.tar.xz' => $xz($tar->invoke(null, ['lib/firmware/rtw88/rtw8821c_fw.bin.xz' => 'FW']))]);
    check(Catalog::check($manifest, [$bytes])['packages'][0]['version'] === '1-r0', 'an OpenEmbedded package (xz, compressed firmware)');
} else {
    echo "skip an OpenEmbedded package (no xz here)\n";
}

// ---- Adding, publishing and verifying ------------------------------------------------------
mkdir("$tmp/in");
file_put_contents("$tmp/in/LICENCE.txt", "The full licence\n");
file_put_contents("$tmp/in/linux-firmware-rtw88.ipk", $fw);
file_put_contents("$tmp/in/fw.json", json_encode(['packages' => ['linux-firmware-rtw88.ipk']] + $manifest));
$added = $cat->add("$tmp/in/fw.json");
check($added['license']['text'] === 'Redistribution permitted…' && $added['packages'][0]['url'] === 'packages/linux-firmware-rtw88_20240909-r0_all.ipk',
      'add: the entry kept, its package copied next to the catalog');
check(file_get_contents("$tmp/data/public/v1/packages/linux-firmware-rtw88_20240909-r0_all.ipk") === $fw, 'add: the package is there byte for byte');
unset($manifest['license']['text']);
file_put_contents("$tmp/in/fw2.json", json_encode(['id' => 'firmware-two', 'license' => $manifest['license'] + ['textFile' => 'LICENCE.txt'], 'packages' => ['linux-firmware-rtw88.ipk']] + $manifest));
check($cat->add("$tmp/in/fw2.json")['license']['text'] === "The full licence\n", 'add: a licence text from a file next to the manifest');
refused(fn () => $cat->add("$tmp/in/missing.json"), '/not a JSON manifest/', 'add: no manifest');
// As phoenix-driver-feed writes them: the licence text in a licence package.
file_put_contents("$tmp/in/linux-firmware-rtl-license.ipk", PackageWriter::ipk('linux-firmware-rtl-license', '20240909-r0', 'all', ['lib/firmware/LICENCE.rtlwifi_firmware.txt' => "Copyright (c) 2010, Realtek\n"]));
file_put_contents("$tmp/in/fw3.json", json_encode(['id' => 'firmware-three', 'license' => $manifest['license'] + ['textInPackage' => '/lib/firmware/LICENCE.rtlwifi_firmware.txt'],
                                                  'packages' => ['linux-firmware-rtw88.ipk', 'linux-firmware-rtl-license.ipk']] + $manifest));
check($cat->add("$tmp/in/fw3.json")['license']['text'] === "Copyright (c) 2010, Realtek\n", 'add: a licence text from inside a package');
$cat->remove('firmware-three');
file_put_contents("$tmp/in/fw4.json", json_encode(['id' => 'firmware-four', 'license' => $manifest['license'] + ['textInPackage' => 'lib/firmware/NOPE'],
                                                  'packages' => ['linux-firmware-rtw88.ipk']] + $manifest));
refused(fn () => $cat->add("$tmp/in/fw4.json"), '/textInPackage/', 'add: a licence text no package has');

$signer = new Signer("$tmp/data");
$now = new DateTimeImmutable('2026-10-09T12:00:00Z');
$idx = $cat->publish($signer, 30, $now);
check($idx['build'] === 1 && $idx['expires'] === '2026-11-08T12:00:00Z' && count($idx['drivers']) === 2, 'publish: build 1, expires in 30 days');
check(!isset($idx['drivers'][0]['maintainer']), 'publish: the maintainer is not in the index');
$key = base64_encode($signer->public);
check(Catalog::verify("$tmp/data/public/v1", $key)['build'] === 1, 'publish: signed with the catalog\'s key');
check(json_decode(file_get_contents("$tmp/data/public/v1/key.json"), true)['key'] === $key, 'publish: key.json');
$cat->remove('firmware-two');
check($cat->publish($signer, 30, $now)['build'] === 2 && count($cat->entries()) === 1, 'remove, publish: build 2 without it');
file_put_contents("$tmp/data/public/v1/drivers.json", str_replace('Realtek', 'Evil', file_get_contents("$tmp/data/public/v1/drivers.json")));
refused(fn () => Catalog::verify("$tmp/data/public/v1", $key), '/not signed/', 'verify: a changed index');
refused(fn () => Catalog::verify("$tmp/data/public/v1", base64_encode(random_bytes(32))), '/not signed/', 'verify: another key');

// ---- Releases: built here, signed elsewhere, checked against the pinned key ------------------
$owner = "$tmp/usbkey";
$out = shell_exec('php ' . escapeshellarg(dirname(__DIR__) . '/bin/drivers.php') . ' keygen ' . escapeshellarg($owner) . ' 2>&1');
check(is_file("$owner/signing.key") && (fileperms("$owner/signing.key") & 0077) === 0 && str_contains((string) $out, 'Public key:'), 'keygen: a key only its owner can read');
$ownerKey = new Signer($owner);
$pub = base64_encode($ownerKey->public);
$cli = fn (string $args) => shell_exec('DRIVERS_DATA=' . escapeshellarg("$tmp/data") . ' php ' . escapeshellarg(dirname(__DIR__) . '/bin/drivers.php') . " $args 2>&1");
$out = $cli('build --out ' . escapeshellarg("$tmp/rel") . ' --build 202610091200 --public ' . escapeshellarg($pub));
check(str_contains((string) $out, 'Build 202610091200') && !is_file("$tmp/rel/drivers.json.sig"), 'build: the index, not signed');
$sig = trim((string) shell_exec('php ' . escapeshellarg(dirname(__DIR__) . '/bin/drivers.php') . ' sign ' . escapeshellarg("$tmp/rel/drivers.json") . ' --key ' . escapeshellarg($owner) . ' 2>/dev/null'));
check(strlen(base64_decode($sig)) === 64, 'sign: the signature, from the key on the owner\'s drive');
$bad = $cli('attach ' . escapeshellarg("$tmp/rel") . ' ' . escapeshellarg($sig) . ' --public ' . escapeshellarg(base64_encode($signer->public)));
check(str_contains((string) $bad, 'not signed') && !is_file("$tmp/rel/drivers.json.sig"), 'attach: refused with another key than the pinned one');
$good = $cli('attach ' . escapeshellarg("$tmp/rel") . ' ' . escapeshellarg($sig) . ' --public ' . escapeshellarg($pub));
check(str_contains((string) $good, 'Good signature') && Catalog::verify("$tmp/rel", $pub)['build'] === 202610091200, 'attach: the signature checks out and is published with it');
$next = new Signer("$tmp/nextkey");
$h = Catalog::handover($ownerKey, base64_encode($next->public), "$tmp/rel", $now);
$hj = (string) file_get_contents("$tmp/rel/key-handover.json");
check($h['from'] === $pub && sodium_crypto_sign_verify_detached(base64_decode(trim((string) file_get_contents("$tmp/rel/key-handover.json.sig"))), $hj, $ownerKey->public),
      'handover: the old key signs the new one in');
refused(fn () => Catalog::handover($ownerKey, $pub, "$tmp/rel"), '/another/', 'handover: not to the same key');
check(str_contains((string) shell_exec('php ' . escapeshellarg(dirname(__DIR__) . '/bin/drivers.php') . ' keygen ' . escapeshellarg($owner) . ' 2>&1'), 'exists already'), 'keygen: never over an existing key');

// ---- Hardware reports ---------------------------------------------------------------------
$rep = fn ($devices, $extra = []) => json_encode(['format' => 1, 'arch' => 'x86_64', 'kernel' => '6.6.23', 'devices' => $devices] + $extra);
$r = $cat->addReport($rep([['bus' => 'usb', 'ids' => ['usb:v1209p0001d0100dcFFdsc00dp00icFFisc00ip00in00'], 'firmwareMissing' => []]], ['hostname' => 'dana-laptop']), $now);
check($r === ['day' => '2026-10-09', 'arch' => 'x86_64', 'kernel' => '6.6.23', 'devices' => [['bus' => 'usb', 'ids' => ['usb:v1209p0001d0100dcFFdsc00dp00icFFisc00ip00in00'], 'firmwareMissing' => []]]],
      'a report: the IDs and the day only, nothing else it was sent');
$cat->addReport($rep([['bus' => 'usb', 'ids' => ['usb:v1209p0001d0100dcFFdsc00dp00icFFisc00ip00in00'], 'firmwareMissing' => []],
                      ['bus' => 'usb', 'ids' => ['usb:v0BDApC811d0200dc00dsc00dp00icFFiscFFipFFin00'], 'firmwareMissing' => ['rtw88/rtw8821c_fw.bin']],
                      ['bus' => 'pci', 'ids' => ['pci:v000014E4d00004331sv*'], 'firmwareMissing' => ['b43/ucode16_mimo.fw']]]), $now);
refused(fn () => $cat->addReport($rep([['bus' => 'usb', 'ids' => ['Dana\'s phone serial 12345']]])), '/not a device ID/', 'a report with a name in it');
refused(fn () => $cat->addReport($rep([['bus' => 'dmi', 'ids' => ['dmi:bvnLENOVO:pnThinkPad']]])), '/bus and its IDs/', 'a report with the machine\'s DMI');
refused(fn () => $cat->addReport($rep([['bus' => 'usb', 'ids' => ['usb:v1'], 'firmwareMissing' => ['../x']]])), '/firmware file/', 'a report with a path');
refused(fn () => $cat->addReport('{"format": 2}'), '/format 1/', 'not a report');
check(file_get_contents("$tmp/data/reports.jsonl") !== false && !str_contains(file_get_contents("$tmp/data/reports.jsonl"), 'dana'), 'reports are kept without who sent them');
check($cat->unmatched() === [['usb:v1209p0001d0100dcFFdsc00dp00icFFisc00ip00in00', 2, []], ['pci:v000014E4d00004331sv*', 1, ['b43/ucode16_mimo.fw']]],
      'reports: the devices no driver is for yet, most reported first (the Realtek one has its driver)');

// ---- The simulator's sample catalog verifies with its key ------------------------------------
$sample = dirname(__DIR__) . '/sample/public/v1';
$sampleKey = json_decode((string) file_get_contents("$sample/key.json"), true)['key'];
$sim = json_decode((string) file_get_contents(dirname(__DIR__) . '/sample/public/catalog-sim.json'), true);
check(($sim['sources'][0]['key'] ?? null) === $sampleKey, 'the simulator pins the sample catalog\'s key');
$s = Catalog::verify($sample, $sampleKey);
check(count($s['drivers']) >= 3, 'the sample catalog is signed');
foreach ($s['drivers'] as $d) {
    foreach ($d['packages'] as $p) {
        $bytes = (string) @file_get_contents("$sample/{$p['url']}");
        check(strlen($bytes) === $p['size'] && hash('sha256', $bytes) === $p['sha256'], "sample: {$p['url']} is the file the catalog signed");
    }
}

exec('rm -rf ' . escapeshellarg($tmp));
echo $failures ? "$failures FAILED\n" : "All passed\n";
exit($failures ? 1 : 0);
