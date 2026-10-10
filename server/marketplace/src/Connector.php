<?php
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The connector profile checks (docs/SYNERGY-CONNECTORS.md 2.2): what the
// Marketplace checks in a Synergy connector package before a human
// reviews it. The connector kit's `phoenix-connector validate`
// (apps/shared/connector-kit/src/tools/checks.ts) runs the same rules, so a
// developer sees what the Marketplace will say; both are tested on the
// same cases (tests/connector-cases.json). Each problem starts with its
// rule's code:
//
//   C1  appinfo.json: valid, a reverse-DNS id, type "web", a version
//   C2  at least one account template, public/accounts/<dir>/<dir>.json
//   C3  the template follows the accounts service's schema
//       (third_party/app-services/com.palm.service.accounts/schemas/template.json)
//   C4  templateId is its folder's name
//   C5  templateId, capability provider ids, the service and own kinds are
//       in the developer's namespace
//   C6  the template's icons are in the package
//   C7  the validator is the package's own service; a customUI page is
//       the package's own app and file
//   C8  capability providers: names, implementation and callbacks on the
//       package's own service, dbkinds the package's kinds
//   C9  one service in service/: package.json, sysbus files, a role that
//       calls only what a connector may (3.2 rule 10)
//   C10 kinds owned by the service; a capability's kinds extend its generic kind
//   C11 db8 permissions only on the package's own kinds (gap 4)
//   C12 no native code
//   C13 (checkIpk) the .ipk: files only under its app, no links, no
//       scripts, 64 MB at most, control file and appinfo.json agreeing
//   C14 share targets (appinfo.json "phoenix".shareTargets): each one a
//       connector's, written from its definition's share (no hand-written
//       ones), its template and service the package's, accepts and
//       audience well formed, types what accepts takes
//   C15 sharing reaches the service: <service>/share in an api.json group
//       the app's requiredPermissions name; the app's main page in the package
//   C16 the template's sign-up link (signUp: {url?, servers?: [{name, url}]}):
//       https addresses only
//
// Phase C4 (connector packages in the catalog) uses this; until then the
// catalog takes no connector (Catalog::publish, Ipk::check refuses services).

declare(strict_types=1);

namespace Phoenix\Marketplace;

final class Connector
{
    private const ID = '/^[A-Za-z0-9]+([._-][A-Za-z0-9]+)+$/';
    private const KIND_ID = '/^[A-Za-z0-9]+([._-][A-Za-z0-9]+)+:\d+$/';

    /** The generic kinds a capability's own kinds extend (3.2 rule 4). */
    public const GENERIC_KINDS = [
        'CONTACTS' => ['com.palm.contact:1'],
        'CALENDAR' => ['com.palm.calendar:1', 'com.palm.calendarevent:1'],
        'TASKS' => ['com.palm.tasklist:1', 'com.palm.task:1'],
        'MEMOS' => ['com.palm.note:1'],
        'MAIL' => ['com.palm.mail.account:1', 'com.palm.folder:1', 'com.palm.email:1'],
        'MESSAGING' => ['com.palm.message:1', 'com.palm.immessage:1', 'com.palm.imbuddystatus:1', 'com.palm.imloginstate:1'],
        'IM' => ['com.palm.message:1', 'com.palm.immessage:1', 'com.palm.imbuddystatus:1', 'com.palm.imloginstate:1'],
    ];

    /** The services a connector's service may call. */
    public const ALLOWED_OUTBOUND = ['com.palm.db', 'com.palm.tempdb', 'com.palm.activitymanager', 'com.palm.service.accounts',
                                     'org.webosphoenix.service.oauth', 'org.webosphoenix.service.keystore', 'org.webosphoenix.service.push',
                                     'com.webos.notification', 'org.webosports.service.messaging'];

    private const CALLBACKS = ['onCreate', 'onEnabled', 'onDelete', 'onCredentialsChanged', 'sync'];
    private const SYSBUS_REQUIRED = ['.service', '.role.json', '.api.json'];

    /**
     * @param array<string, string> $files the package's files by path in the app's folder
     * @param string[] $namespaces the developer's (default: the app id's first two labels)
     * @return array{errors: string[], warnings: string[], appId: string, version: string, service: string, templates: string[], kinds: string[]}
     */
    public static function check(array $files, array $namespaces = []): array
    {
        $errors = [];
        $warnings = [];
        $out = ['errors' => [], 'warnings' => [], 'appId' => '', 'version' => '', 'service' => '', 'templates' => [], 'kinds' => []];
        $json = function (string $path) use ($files) {
            if (!isset($files[$path])) {
                return [false, null];
            }
            $v = json_decode(preg_replace('/^\xEF\xBB\xBF/', '', $files[$path]), true);
            return [$v !== null || trim($files[$path]) === 'null', $v];
        };

        // C1
        [$ok, $info] = $json('appinfo.json');
        if (!$ok || !is_array($info) || array_is_list($info) && $info !== []) {
            $out['errors'] = ['C1 appinfo.json is missing or not valid JSON'];
            return $out;
        }
        $appId = (string) ($info['id'] ?? '');
        $out['appId'] = $appId;
        $out['version'] = (string) ($info['version'] ?? '');
        if (!preg_match(self::ID, $appId)) {
            $errors[] = "C1 appinfo.json: not a valid app id: $appId";
        }
        if (($info['type'] ?? 'web') !== 'web') {
            $errors[] = 'C1 appinfo.json: a connector\'s app is a web app (type "web")';
        }
        if ($out['version'] === '') {
            $errors[] = 'C1 appinfo.json: no version';
        }
        if (empty($info['phoenix']['hidden'])) {
            $warnings[] = 'C1 appinfo.json: a connector\'s app is usually hidden ("phoenix": {"hidden": true})';
        }
        if (!$namespaces) {
            $namespaces = [implode('.', array_slice(explode('.', $appId), 0, 2))];
        }
        $inNs = function (string $id) use ($namespaces): bool {
            foreach ($namespaces as $ns) {
                if ($id === $ns || str_starts_with($id, "$ns.")) {
                    return true;
                }
            }
            return false;
        };
        $nsText = implode(', ', $namespaces);

        // C12
        foreach ($files as $path => $bytes) {
            if (self::isNative((string) $path, $bytes)) {
                $errors[] = "C12 native code is not allowed: $path";
            }
        }

        // C9
        [$ok, $pkg] = $json('service/package.json');
        $service = $ok && is_array($pkg) ? (string) ($pkg['name'] ?? '') : '';
        $out['service'] = $service;
        if (!$ok) {
            $errors[] = 'C9 service/package.json is missing or not valid JSON';
        } elseif (!preg_match(self::ID, $service)) {
            $errors[] = 'C9 service/package.json: name must be the Luna service name';
        } else {
            if (!$inNs($service)) {
                $errors[] = "C5 the service $service is not in the namespace $nsText";
            }
            foreach (self::SYSBUS_REQUIRED as $suffix) {
                if (!isset($files["service/sysbus/$service$suffix"])) {
                    $errors[] = "C9 service/sysbus/$service$suffix is missing";
                }
            }
            [$rok, $role] = $json("service/sysbus/$service.role.json");
            if ($rok && is_array($role)) {
                $names = $role['allowedNames'] ?? [];
                if (count($names) !== 1 || $names[0] !== $service) {
                    $errors[] = "C9 the role's allowedNames must be [\"$service\"]";
                }
                foreach ($role['permissions'] ?? [] as $perm) {
                    foreach ($perm['outbound'] ?? [] as $o) {
                        if ($o !== $service && !in_array($o, self::ALLOWED_OUTBOUND, true)) {
                            $errors[] = "C9 the service may not call $o";
                        }
                    }
                }
            } elseif (isset($files["service/sysbus/$service.role.json"])) {
                $errors[] = 'C9 the role file is not valid JSON';
            }
        }
        $extra = [];
        foreach (array_keys($files) as $p) {
            if (preg_match('#^service/sysbus/.+\.role\.json$#', (string) $p) && $p !== "service/sysbus/$service.role.json") {
                $extra[] = $p;
            }
        }
        if ($extra) {
            $errors[] = 'C9 one service per connector: ' . implode(', ', $extra);
        }

        // C10
        $paths = array_map('strval', array_keys($files));
        sort($paths);
        $kinds = [];
        foreach ($paths as $p) {
            if (!preg_match('#^configuration/db/kinds/[^/]+$#', $p)) {
                continue;
            }
            [$kok, $k] = $json($p);
            if (!$kok || !is_array($k) || !preg_match(self::KIND_ID, (string) ($k['id'] ?? ''))) {
                $errors[] = "C10 $p: not a db8 kind";
                continue;
            }
            $id = (string) $k['id'];
            $kinds[$id] = $k;
            $out['kinds'][] = $id;
            if ($service !== '' && ($k['owner'] ?? null) !== $service) {
                $errors[] = "C10 the kind $id must be owned by $service";
            }
            $generic = self::genericPrefixOf($id);
            $ext = self::extendsOf($k);
            if ($generic !== null) {
                if (!in_array($generic, $ext, true)) {
                    $errors[] = "C10 the kind $id must extend $generic";
                }
            } elseif (!$inNs($id)) {
                $errors[] = "C5 the kind $id is not in the namespace $nsText";
            }
        }

        // C11
        foreach ($paths as $p) {
            if (!preg_match('#^configuration/db/permissions/[^/]+$#', $p)) {
                continue;
            }
            [$pok, $perm] = $json($p);
            if (!$pok) {
                $errors[] = "C11 $p: not valid JSON";
                continue;
            }
            $list = is_array($perm) && array_is_list($perm) ? $perm : [$perm];
            foreach ($list as $e) {
                if (!is_array($e) || ($e['type'] ?? null) !== 'db.kind' || !isset($kinds[(string) ($e['object'] ?? '')])) {
                    $errors[] = "C11 $p: a permission on " . (is_array($e) ? (string) ($e['object'] ?? '') : '') . ', not one of the package\'s kinds';
                }
            }
        }

        // C2 - C8
        $own = 0;
        foreach ($paths as $p) {
            if (!preg_match('#^public/accounts/([^/]+)/([^/]+)\.json$#', $p, $m)) {
                continue;
            }
            if ($m[1] !== $m[2]) {
                $warnings[] = "C4 $p is not read: a template is public/accounts/<id>/<id>.json";
                continue;
            }
            $own++;
            [$tok, $t] = $json($p);
            if (!$tok) {
                $errors[] = "C3 $p: not valid JSON";
                continue;
            }
            $list = is_array($t) && array_is_list($t) && $t !== [] ? $t : [$t];
            foreach ($list as $tpl) {
                self::checkTemplate($tpl, "public/accounts/{$m[1]}/", $m[1], $files, $appId, $service, $kinds, $inNs, $nsText, $errors, $warnings, $out);
            }
        }
        if (!$own) {
            $errors[] = 'C2 no account template (public/accounts/<templateId>/<templateId>.json)';
        }

        // C14, C15
        $targets = is_array($info['phoenix'] ?? null) ? ($info['phoenix']['shareTargets'] ?? null) : null;
        if ($targets !== null) {
            if (!is_array($targets) || !array_is_list($targets)) {
                $errors[] = 'C14 appinfo.json: shareTargets must be a list';
            } else {
                self::checkShareTargets($targets, $info, $files, $service, $out['templates'], $json, $errors);
            }
        }
        $out['errors'] = $errors;
        $out['warnings'] = $warnings;
        return $out;
    }

    /** An https:// address, as a sign-up link must be (signup.ts isHttps). */
    public static function isHttps($v): bool
    {
        return is_string($v) && strlen($v) <= 500 && preg_match('#^https://[^\s/?\#]+[^\s]*$#i', $v) === 1;
    }

    /** Problems with a template's signUp (signup.ts signUpProblems). */
    public static function signUpProblems($v): array
    {
        $s = is_string($v) ? ['url' => $v] : $v;
        if (!is_array($s) || ($s !== [] && array_is_list($s))) {
            return ['signUp: an https:// address, or {url?, servers?}'];
        }
        $out = [];
        if (!array_key_exists('url', $s) && !array_key_exists('servers', $s)) {
            $out[] = 'signUp: a url or servers';
        }
        if (array_key_exists('url', $s) && !self::isHttps($s['url'])) {
            $out[] = 'signUp.url: an https:// address';
        }
        if (array_key_exists('servers', $s)) {
            $list = $s['servers'];
            if (!is_array($list) || !array_is_list($list) || $list === [] || count($list) > 10) {
                $out[] = 'signUp.servers: a list of 1 to 10 {name, url}';
            } else {
                foreach ($list as $i => $x) {
                    if (!is_array($x) || !is_string($x['name'] ?? null) || trim($x['name']) === '' || mb_strlen($x['name']) > 80
                        || !self::isHttps($x['url'] ?? null)) {
                        $out[] = "signUp.servers[$i]: {name, url: an https:// address}";
                    }
                }
            }
        }
        foreach (array_keys($s) as $k) {
            if ($k !== 'url' && $k !== 'servers') {
                $out[] = "signUp.$k: not a field of signUp (url, servers)";
            }
        }
        return $out;
    }

    /** What a connector may say it takes, and the MIME types each kind is by default (share.ts). */
    public const SHARE_KINDS = ['text' => ['text/plain'], 'link' => ['text/uri-list'], 'image' => ['image/*'], 'video' => ['video/*'], 'file' => ['*/*']];
    private const MIME = '#^[a-z0-9][a-z0-9.+-]*/(\*|[a-z0-9][a-z0-9.+-]*)$#i';

    /** The MIME types a declaration takes (share.ts shareTypes). */
    public static function shareTypes(array $accepts): array
    {
        $out = [];
        foreach (self::SHARE_KINDS as $k => $default) {
            $l = $accepts[$k] ?? null;
            if ($l === null || $l === false) {
                continue;
            }
            $types = in_array($k, ['image', 'video', 'file'], true) && is_array($l) && is_array($l['mimeTypes'] ?? null) && $l['mimeTypes'] !== []
                ? $l['mimeTypes'] : $default;
            foreach ($types as $t) {
                if (!in_array($t, $out, true)) {
                    $out[] = $t;
                }
            }
        }
        return $out;
    }

    private static function positiveInt($v): bool
    {
        return is_int($v) && $v > 0;
    }

    /** The form of accepts (share.ts acceptsProblems). */
    public static function acceptsProblems($accepts): array
    {
        $kinds = array_keys(self::SHARE_KINDS);
        if (!is_array($accepts) || $accepts === [] || array_is_list($accepts)) {
            return ['accepts: what it takes, one or more of ' . implode(', ', $kinds)];
        }
        $out = [];
        foreach ($accepts as $k => $v) {
            if (!in_array($k, $kinds, true)) {
                $out[] = "accepts.$k: not one of " . implode(', ', $kinds);
                continue;
            }
            if ($v === true) {
                continue;
            }
            // {} decodes as [] here.
            if (!is_array($v) || ($v !== [] && array_is_list($v))) {
                $out[] = "accepts.$k: true or an object of limits";
                continue;
            }
            foreach (['max', 'maxBytes', 'maxLength'] as $n) {
                if (array_key_exists($n, $v) && !self::positiveInt($v[$n])) {
                    $out[] = "accepts.$k.$n: a whole number above 0";
                }
            }
            if (array_key_exists('mimeTypes', $v)) {
                $m = $v['mimeTypes'];
                if (!in_array($k, ['image', 'video', 'file'], true)) {
                    $out[] = "accepts.$k.mimeTypes: only for image, video and file";
                } elseif (!is_array($m) || $m === [] || !array_is_list($m)
                          || array_filter($m, fn ($t) => !is_string($t) || !preg_match(self::MIME, $t))) {
                    $out[] = "accepts.$k.mimeTypes: MIME types (image/png, image/*)";
                }
            }
            if (array_key_exists('altText', $v) && !is_bool($v['altText'])) {
                $a = $v['altText'];
                if (!is_array($a) || ($a !== [] && array_is_list($a)) || (array_key_exists('maxLength', $a) && !self::positiveInt($a['maxLength']))) {
                    $out[] = "accepts.$k.altText: true, or {maxLength}";
                }
            }
        }
        return $out;
    }

    /** The form of a share target's audience (share.ts audienceProblems). */
    public static function audienceProblems(array $c): array
    {
        if (!array_key_exists('audience', $c)) {
            return [];
        }
        $a = $c['audience'];
        if (!is_array($a) || !is_array($a['options'] ?? null) || $a['options'] === [] || !array_is_list($a['options'])) {
            return ['audience: {options: [{value, label, hint?}], default?}'];
        }
        $out = [];
        $values = [];
        foreach ($a['options'] as $i => $o) {
            if (!is_array($o) || !is_string($o['value'] ?? null) || $o['value'] === '' || !is_string($o['label'] ?? null) || $o['label'] === '') {
                $out[] = "audience.options[$i]: {value, label} strings";
            }
            $values[] = is_array($o) ? ($o['value'] ?? null) : null;
        }
        if (array_key_exists('default', $a) && !in_array($a['default'], $values, true)) {
            $out[] = "audience.default: one of the options' values";
        }
        if (array_key_exists('label', $a) && !is_string($a['label'])) {
            $out[] = 'audience.label: a string';
        }
        return $out;
    }

    private static function checkShareTargets(array $list, array $info, array $files, string $service, array $templates, callable $json,
                                              array &$errors): void
    {
        $sharing = false;
        foreach ($list as $i => $t) {
            $where = "C14 appinfo.json shareTargets[$i]";
            $c = is_array($t) ? ($t['connector'] ?? null) : null;
            if (!is_array($c) || ($c !== [] && array_is_list($c))) {
                $errors[] = "$where: a connector's share target is written from its definition's share (phoenix-connector pack), not by hand";
                continue;
            }
            $sharing = true;
            if (!is_string($t['label'] ?? null) || $t['label'] === '') {
                $errors[] = "$where: label must be a string";
            }
            if (!in_array($c['templateId'] ?? null, $templates, true)) {
                $errors[] = "$where: connector.templateId " . (is_string($c['templateId'] ?? null) ? $c['templateId'] : '')
                    . " is not one of the package's templates";
            }
            if (($c['service'] ?? null) !== $service) {
                $errors[] = "$where: connector.service must be " . ($service !== '' ? $service : "the package's service");
            }
            if (array_key_exists('accountLabel', $c) && !is_string($c['accountLabel'])) {
                $errors[] = "$where: connector.accountLabel must be a string";
            }
            $bad = array_merge(self::acceptsProblems($c['accepts'] ?? null), self::audienceProblems($c));
            foreach ($bad as $b) {
                $errors[] = "$where: connector.$b";
            }
            if (!$bad) {
                $want = self::shareTypes($c['accepts']);
                sort($want);
                $got = is_array($t['types'] ?? null) ? $t['types'] : [];
                sort($got);
                if ($want !== $got) {
                    $errors[] = "$where: types must be " . implode(', ', $want) . ' (what accepts takes)';
                }
            }
        }
        if (!$sharing || $service === '') {
            return;
        }
        [$aok, $api] = $json("service/sysbus/$service.api.json");
        $groups = [];
        if ($aok && is_array($api)) {
            foreach ($api as $g => $methods) {
                if (is_array($methods) && in_array("$service/share", $methods, true)) {
                    $groups[] = (string) $g;
                }
            }
        }
        $required = is_array($info['requiredPermissions'] ?? null) ? $info['requiredPermissions'] : [];
        if (!$groups) {
            $errors[] = "C15 the api.json must list $service/share (the compose page calls it)";
        } elseif (!array_intersect($groups, $required)) {
            $errors[] = "C15 appinfo.json requiredPermissions must name the group of $service/share (" . implode(', ', $groups) . ')';
        }
        $main = (string) ($info['main'] ?? 'index.html');
        if (!isset($files[$main])) {
            $errors[] = "C15 the app's main page $main is not in the package: the share sheet opens it to compose";
        }
    }

    private static function checkTemplate($tpl, string $dir, string $folder, array $files, string $appId, string $service, array $kinds,
                                          callable $inNs, string $nsText, array &$errors, array &$warnings, array &$out): void
    {
        if (!is_array($tpl) || (array_is_list($tpl) && $tpl !== [])) {
            $errors[] = "C3 $dir: a template is an object";
            return;
        }
        $id = $tpl['templateId'] ?? null;
        if (!is_string($id)) {
            $errors[] = "C3 $dir: templateId must be a string";
            return;
        }
        $out['templates'][] = $id;
        if ($id !== $folder) {
            $errors[] = "C4 the template $id is in the folder $folder";
        }
        if (!$inNs($id)) {
            $errors[] = "C5 the template $id is not in the namespace $nsText";
        }
        if (!is_string($tpl['loc_name'] ?? null)) {
            $errors[] = "C3 $id: loc_name must be a string";
        }
        $icons = [];
        $iconObject = function ($o, string $where) use (&$errors, &$icons): void {
            if ($o === null) {
                return;
            }
            if (!is_array($o) || (array_is_list($o) && $o !== [])) {
                $errors[] = "C3 $where: icon must be an object";
                return;
            }
            foreach (['loc_32x32', 'loc_48x48'] as $k) {
                if (!array_key_exists($k, $o)) {
                    continue;
                }
                if (!is_string($o[$k])) {
                    $errors[] = "C3 $where: icon.$k must be a string";
                } else {
                    $icons[] = $o[$k];
                }
            }
        };
        $iconObject($tpl['icon'] ?? null, $id);
        if (array_key_exists('signUp', $tpl)) {
            foreach (self::signUpProblems($tpl['signUp']) as $p) {
                $errors[] = "C16 $id: $p";
            }
        }
        if (array_key_exists('validator', $tpl) && !is_string($tpl['validator']) && !(is_array($tpl['validator']) && !(array_is_list($tpl['validator']) && $tpl['validator'] !== []))) {
            $errors[] = "C3 $id: validator must be a string or an object";
        }
        $cps = $tpl['capabilityProviders'] ?? null;
        if (!is_array($cps) || !array_is_list($cps)) {
            $errors[] = "C3 $id: capabilityProviders must be an array";
            return;
        }
        foreach ($cps as $i => $cp) {
            $where = "$id capabilityProviders[$i]";
            if (!is_array($cp)) {
                $errors[] = "C3 $where: an object";
                continue;
            }
            if (!is_string($cp['capability'] ?? null)) {
                $errors[] = "C3 $where: capability must be a string";
            }
            if (!is_string($cp['id'] ?? null)) {
                $errors[] = "C3 $where: id must be a string";
            }
            if (array_key_exists('loc_name', $cp) && !is_string($cp['loc_name'])) {
                $errors[] = "C3 $where: loc_name must be a string";
            }
            if (array_key_exists('implementation', $cp) && !is_string($cp['implementation'])) {
                $errors[] = "C3 $where: implementation must be a string";
            }
            $iconObject($cp['icon'] ?? null, $where);
        }

        // C6
        foreach ($icons as $rel) {
            if (!isset($files[$dir . $rel])) {
                $errors[] = "C6 $id: the icon $rel is not in the package";
            } elseif (str_ends_with($rel, '.png') && !isset($files[$dir . substr($rel, 0, -4) . '@2x.png'])) {
                $warnings[] = "C6 $id: no @2x variant of $rel";
            }
        }

        // C7
        $v = $tpl['validator'] ?? null;
        $address = is_string($v) ? $v : (is_array($v) ? ($v['address'] ?? null) : null);
        $svcText = $service !== '' ? $service : "the package's service";
        if ($address !== null && self::serviceOf($address) !== $service) {
            $errors[] = "C7 $id: the validator must be on $svcText";
        }
        if (is_array($v) && isset($v['customUI'])) {
            if (($v['customUI']['appId'] ?? null) !== $appId) {
                $errors[] = "C7 $id: the sign-in page (customUI) must be the package's own app, $appId";
            } elseif (!isset($files[(string) ($v['customUI']['name'] ?? '')])) {
                $errors[] = "C7 $id: the sign-in page " . ($v['customUI']['name'] ?? '') . ' is not in the app';
            }
        }

        // C8
        $seen = [];
        foreach ($cps as $cp) {
            if (!is_array($cp)) {
                continue;
            }
            $cpId = $cp['id'] ?? null;
            $where = "$id " . (is_string($cpId) ? $cpId : '?');
            if (is_string($cp['capability'] ?? null) && !preg_match('/^[A-Z][A-Z0-9_.]*$/', $cp['capability'])) {
                $errors[] = "C8 $where: capability names are upper case (CONTACTS, CALENDAR, ...)";
            }
            if (is_string($cpId)) {
                if (isset($seen[$cpId])) {
                    $errors[] = "C8 $where: listed twice";
                }
                $seen[$cpId] = true;
                if (!$inNs($cpId)) {
                    $errors[] = "C5 the capability provider $cpId is not in the namespace $nsText";
                }
            }
            if (self::serviceOf($cp['implementation'] ?? null) !== $service) {
                $errors[] = "C8 $where: implementation must be palm://" . ($service !== '' ? $service : '<the service>') . '/';
            }
            foreach (self::CALLBACKS as $cb) {
                if (array_key_exists($cb, $cp) && self::serviceOf($cp[$cb]) !== $service) {
                    $errors[] = "C8 $where: $cb must be on $svcText";
                }
            }
            $dbkinds = is_array($cp['dbkinds'] ?? null) ? $cp['dbkinds'] : [];
            $generics = self::GENERIC_KINDS[$cp['capability'] ?? ''] ?? null;
            foreach ($dbkinds as $k => $kind) {
                if (!is_string($kind) || !isset($kinds[$kind])) {
                    $errors[] = "C8 $where: dbkinds.$k " . (is_string($kind) ? $kind : '') . " is not one of the package's kinds";
                    continue;
                }
                if ($generics === null) {
                    $warnings[] = "C10 $where: " . ($cp['capability'] ?? '') . " has no generic kind yet (docs/SYNERGY-CONNECTORS.md 3.2 rule 4); $kind is the connector's own";
                    continue;
                }
                if (!array_intersect(self::extendsOf($kinds[$kind]), $generics)) {
                    $errors[] = "C10 $where: $kind must extend one of " . implode(', ', $generics);
                }
            }
        }
    }

    /** The checks of an .ipk: C13, then the profile on its app's files. */
    public static function checkIpk(string $bytes, array $namespaces = []): array
    {
        $errors = [];
        if (strlen($bytes) > Ipk::MAX_SIZE) {
            $errors[] = 'C13 the package is larger than 64 MB';
        }
        try {
            $ar = Ipk::readAr($bytes);
            if (!isset($ar['control.tar.gz'], $ar['data.tar.gz'])) {
                throw new CheckFailed('Not an .ipk package (no control.tar.gz or data.tar.gz)');
            }
            $control = Ipk::readTar(self::gunzip($ar['control.tar.gz']));
            $data = Ipk::readTar(self::gunzip($ar['data.tar.gz']));
        } catch (CheckFailed $e) {
            return ['errors' => array_merge($errors, ['C13 ' . $e->getMessage()]), 'warnings' => [], 'appId' => '', 'version' => '',
                    'service' => '', 'templates' => [], 'kinds' => [], 'control' => []];
        }
        foreach (['preinst', 'postinst', 'prerm', 'postrm', 'pmPostInstall.script', 'pmPreRemove.script'] as $s) {
            if (isset($control[$s])) {
                $errors[] = "C13 the package has a maintainer script ($s); scripts are not allowed";
            }
        }
        $fields = isset($control['control']['data']) ? Ipk::parseControl($control['control']['data']) : [];
        $apps = [];
        foreach ($data as $path => $f) {
            if ($f['type'] === 'link') {
                $errors[] = "C13 the package has a link ($path)";
            }
            if (preg_match('#^usr/palm/applications/([^/]+)/appinfo\.json$#', (string) $path, $m)) {
                $apps[] = $m[1];
            }
        }
        if (count($apps) !== 1) {
            return ['errors' => array_merge($errors, ['C13 the package must hold exactly one app']), 'warnings' => [], 'appId' => '',
                    'version' => '', 'service' => '', 'templates' => [], 'kinds' => [], 'control' => $fields];
        }
        $appId = $apps[0];
        $prefix = "usr/palm/applications/$appId/";
        $files = [];
        foreach ($data as $path => $f) {
            if ($f['type'] !== 'file') {
                continue;
            }
            if (!str_starts_with((string) $path, $prefix)) {
                $errors[] = "C13 the package puts a file outside its app ($path)";
            } else {
                $files[substr((string) $path, strlen($prefix))] = $f['data'];
            }
        }
        $r = self::check($files, $namespaces);
        if (($fields['Package'] ?? '') !== $appId) {
            $errors[] = 'C13 the control file\'s Package (' . ($fields['Package'] ?? '') . ") is not the app id $appId";
        }
        if ($r['version'] !== '' && ($fields['Version'] ?? '') !== $r['version']) {
            $errors[] = 'C13 appinfo.json and the control file must give the same version';
        }
        if (($fields['Architecture'] ?? '') !== 'all') {
            $errors[] = 'C13 only packages for any architecture ("Architecture: all")';
        }
        $r['errors'] = array_merge($errors, $r['errors']);
        $r['control'] = $fields;
        return $r;
    }

    private static function gunzip(string $b): string
    {
        $out = @gzdecode($b);
        if ($out === false) {
            throw new CheckFailed('Damaged .ipk package (gzip)');
        }
        return $out;
    }

    private static function isNative(string $path, string $b): bool
    {
        if (preg_match('/\.(node|so|dylib|dll|exe)$/i', $path) || preg_match('/\.so\.\d/', $path)) {
            return true;
        }
        if (str_starts_with($b, "\x7fELF")) {
            return true;
        }
        if (strlen($b) >= 4 && in_array(bin2hex(substr($b, 0, 4)), ['feedface', 'feedfacf', 'cefaedfe', 'cffaedfe', 'cafebabe'], true)) {
            return true;
        }
        // PE ("MZ"): a file without an extension, or a program's.
        return str_starts_with($b, 'MZ') && (preg_match('/\.(bin|exe|dll|sys)$/i', $path) || !preg_match('/\.[A-Za-z0-9]+$/', $path));
    }

    private static function serviceOf($address): ?string
    {
        return is_string($address) && preg_match('#^(?:palm|luna)://([^/]+)/?#', $address, $m) ? $m[1] : null;
    }

    /** The generic kind a legacy-style name extends: com.palm.contact.dav:1 -> com.palm.contact:1. */
    private static function genericPrefixOf(string $kind): ?string
    {
        foreach (self::GENERIC_KINDS as $list) {
            foreach ($list as $g) {
                if (str_starts_with($kind, preg_replace('/:\d+$/', '', $g) . '.')) {
                    return $g;
                }
            }
        }
        return null;
    }

    private static function extendsOf(array $kind): array
    {
        $e = $kind['extends'] ?? [];
        return is_array($e) ? array_values(array_filter($e, 'is_string')) : (is_string($e) ? [$e] : []);
    }
}
