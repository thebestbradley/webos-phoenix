<?php
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Fetching a picture an app's listing names (its icon, its screenshots) on
// another site, for the catalog's own copy (Catalog::mediaCopy). The
// addresses come from developers, so the catalog server must not be made to
// fetch from its own network for them (server-side request forgery):
//
// - https only; plain http and the loopback address only where the
//   configuration allows them explicitly (MARKETPLACE_FETCH_LOCAL=1: the
//   simulator's and the tests' local sites), and nothing else then either;
// - the host's addresses are looked up here and every one must be a public
//   unicast address: no loopback, private (RFC 1918), link-local
//   (169.254/16, the cloud metadata service's), shared (100.64/10),
//   multicast, reserved, documentation or unspecified ones, nor their IPv6
//   kin (::1, fc00::/7, fe80::/10, ff00::/8) or an IPv4 address carried in
//   IPv6 (mapped, compatible, NAT64, 6to4);
// - the connection goes to the address that was checked (CURLOPT_RESOLVE),
//   so a second lookup cannot answer differently (DNS rebinding);
// - redirects are followed here, at most three, each checked the same way;
// - at most a given size, 8 seconds, no credentials in the address.
//
// With MARKETPLACE_FETCH_PROXY (an egress proxy the operator trusts) the
// proxy makes the connections and resolves the names; the checks above are
// still made on this side.

declare(strict_types=1);

namespace Phoenix\Marketplace;

final class SafeFetch
{
    public const MAX_REDIRECTS = 3;

    /** IPv4 ranges that are not public unicast addresses: [network, prefix]. */
    private const BLOCKED_V4 = [
        ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
        ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
        ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
    ];

    /** IPv6 ranges likewise (the IPv4-carrying ones included). */
    private const BLOCKED_V6 = [
        ['::', 96],             // unspecified, loopback and IPv4-compatible
        ['::ffff:0:0', 96],     // IPv4-mapped
        ['64:ff9b::', 96], ['64:ff9b:1::', 48],     // NAT64
        ['100::', 64],          // discard
        ['2001::', 23],         // IETF protocol assignments (Teredo among them)
        ['2001:db8::', 32],     // documentation
        ['2002::', 16],         // 6to4
        ['fc00::', 7],          // unique local
        ['fe80::', 10],         // link-local
        ['fec0::', 10],         // site-local (deprecated)
        ['ff00::', 8],          // multicast
    ];

    /** Every address of $host, as the fetch would see them. */
    private \Closure $resolve;

    /** The last refusal's reason (for the tests and the log). */
    public string $refused = '';

    /**
     * $allowLocal: plain http to the loopback address 127.0.0.1 is allowed (and only that besides
     * public https). $resolve: host => addresses, for the tests; the system's resolver otherwise.
     */
    public function __construct(private bool $allowLocal = false, ?callable $resolve = null, private ?string $proxy = null,
                                private int $timeout = 8)
    {
        $this->resolve = \Closure::fromCallable($resolve ?? [self::class, 'systemResolve']);
    }

    public static function fromConfig(array $config): self
    {
        return new self(!empty($config['fetch_local']), $config['fetch_resolve'] ?? null, $config['fetch_proxy'] ?? null);
    }

    /** Whether $ip (v4 or v6) is a public unicast address. */
    public static function isPublic(string $ip): bool
    {
        $bin = @inet_pton($ip);
        if ($bin === false) {
            return false;
        }
        foreach (strlen($bin) === 4 ? self::BLOCKED_V4 : self::BLOCKED_V6 as [$net, $prefix]) {
            if (self::inRange($bin, (string) inet_pton($net), $prefix)) {
                return false;
            }
        }
        return true;
    }

    private static function inRange(string $ip, string $net, int $prefix): bool
    {
        $bytes = intdiv($prefix, 8);
        if (strncmp($ip, $net, $bytes) !== 0) {
            return false;
        }
        $bits = $prefix % 8;
        if ($bits === 0) {
            return true;
        }
        $mask = (0xff << (8 - $bits)) & 0xff;
        return (ord($ip[$bytes]) & $mask) === (ord($net[$bytes]) & $mask);
    }

    /** The system's addresses for $host (A and AAAA). */
    public static function systemResolve(string $host): array
    {
        $v4 = @gethostbynamel($host) ?: [];
        $v6 = array_column(@dns_get_record($host, DNS_AAAA) ?: [], 'ipv6');
        return array_values(array_unique(array_merge($v4, $v6)));
    }

    /**
     * Where a request for $url may go: ['host', 'port', 'ip', 'scheme'], or null (the reason in
     * $refused). The host is looked up once, here; the request connects to that address.
     */
    public function plan(string $url): ?array
    {
        $u = parse_url($url);
        $scheme = strtolower((string) ($u['scheme'] ?? ''));
        $host = strtolower(trim((string) ($u['host'] ?? ''), '[]'));
        if (!$u || $host === '' || isset($u['user']) || isset($u['pass'])) {
            return $this->refuse("not an address: $url");
        }
        if ($scheme !== 'https' && !($scheme === 'http' && $this->allowLocal)) {
            return $this->refuse("not https: $url");
        }
        $port = (int) ($u['port'] ?? ($scheme === 'https' ? 443 : 80));
        $ips = @inet_pton($host) !== false ? [$host] : ($this->resolve)($host);
        if (!$ips) {
            return $this->refuse("$host has no address");
        }
        foreach ($ips as $ip) {
            $local = $this->allowLocal && $ip === '127.0.0.1';
            if (!$local && !self::isPublic((string) $ip)) {
                return $this->refuse("$host is at $ip, not a public address");
            }
            if (!$local && $scheme !== 'https') {
                return $this->refuse("not https: $url");
            }
        }
        return ['scheme' => $scheme, 'host' => $host, 'port' => $port, 'ip' => (string) $ips[0]];
    }

    private function refuse(string $why): ?array
    {
        $this->refused = $why;
        return null;
    }

    /** The CURLOPT_RESOLVE entry that pins a planned request to its checked address. */
    public static function pin(array $plan): string
    {
        $ip = str_contains($plan['ip'], ':') ? '[' . $plan['ip'] . ']' : $plan['ip'];
        return $plan['host'] . ':' . $plan['port'] . ':' . $ip;
    }

    /** $url's body (status 200, at most $maxBytes), or null (why in $refused). */
    public function get(string $url, int $maxBytes): ?string
    {
        $this->refused = '';
        if (!function_exists('curl_init')) {
            return $this->refuse('PHP has no curl');
        }
        for ($hop = 0; $hop <= self::MAX_REDIRECTS; $hop++) {
            $plan = $this->plan($url);
            if ($plan === null) {
                return null;
            }
            $body = '';
            $location = null;
            $tooBig = false;
            $c = curl_init($url);
            $proto = $plan['scheme'] === 'https' ? CURLPROTO_HTTPS : CURLPROTO_HTTP;
            curl_setopt_array($c, [
                CURLOPT_RESOLVE => [self::pin($plan)],
                CURLOPT_FOLLOWLOCATION => false,
                CURLOPT_PROTOCOLS => $proto,
                CURLOPT_CONNECTTIMEOUT => 4,
                CURLOPT_TIMEOUT => $this->timeout,
                CURLOPT_USERAGENT => 'PhoenixMarketplace/1 (media copy)',
                // Decoded as a browser would: some CDNs send a picture gzipped unasked.
                CURLOPT_ENCODING => '',
                CURLOPT_PROXY => $this->proxy ?? '',
                CURLOPT_NOPROXY => $this->proxy ? '' : '*',
                CURLOPT_HEADERFUNCTION => function ($ch, string $line) use (&$location): int {
                    if (stripos($line, 'location:') === 0) {
                        $location = trim(substr($line, 9));
                    }
                    return strlen($line);
                },
                CURLOPT_WRITEFUNCTION => function ($ch, string $chunk) use (&$body, &$tooBig, $maxBytes): int {
                    if (strlen($body) + strlen($chunk) > $maxBytes) {
                        $tooBig = true;
                        return 0;   // stops the transfer
                    }
                    $body .= $chunk;
                    return strlen($chunk);
                },
            ]);
            $ok = curl_exec($c) !== false;
            $status = (int) curl_getinfo($c, CURLINFO_RESPONSE_CODE);
            if ($tooBig) {
                return $this->refuse("larger than $maxBytes bytes: $url");
            }
            if (!$ok) {
                return $this->refuse(curl_error($c) . ": $url");
            }
            if ($status >= 300 && $status < 400 && $location !== null) {
                $url = self::absolute($location, $url);
                continue;
            }
            return $status === 200 ? $body : $this->refuse("status $status: $url");
        }
        return $this->refuse('too many redirects');
    }

    /** $ref against the address it came from. */
    public static function absolute(string $ref, string $base): string
    {
        if (preg_match('#^[a-z][a-z0-9+.-]*:#i', $ref)) {
            return $ref;
        }
        $b = parse_url($base);
        $origin = $b['scheme'] . '://' . (str_contains($b['host'], ':') ? '[' . $b['host'] . ']' : $b['host'])
            . (isset($b['port']) ? ':' . $b['port'] : '');
        if (str_starts_with($ref, '//')) {
            return $b['scheme'] . ':' . $ref;
        }
        if (str_starts_with($ref, '/')) {
            return $origin . $ref;
        }
        $dir = preg_replace('#/[^/]*$#', '/', $b['path'] ?? '/');
        return $origin . $dir . $ref;
    }
}
