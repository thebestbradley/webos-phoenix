<?php
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The catalog's Ed25519 key (libsodium): made once, kept in the data folder
// (readable by the server only). Devices pin its public key the first time
// they add the catalog. Keep a copy of signing.key somewhere safe: a new key
// means every device has to trust the catalog again.

declare(strict_types=1);

namespace Phoenix\Marketplace;

final class Signer
{
    private string $secret;
    public string $public;

    public function __construct(string $dataDir)
    {
        $file = $dataDir . '/signing.key';
        if (!is_file($file)) {
            @mkdir($dataDir, 0700, true);
            $pair = sodium_crypto_sign_keypair();
            $old = umask(0077);
            file_put_contents($file, base64_encode(sodium_crypto_sign_secretkey($pair)));
            umask($old);
        }
        $this->secret = base64_decode(trim((string) file_get_contents($file)), true) ?: '';
        if (strlen($this->secret) !== SODIUM_CRYPTO_SIGN_SECRETKEYBYTES) {
            throw new \RuntimeException("$file is not an Ed25519 secret key");
        }
        $this->public = sodium_crypto_sign_publickey_from_secretkey($this->secret);
    }

    public function sign(string $data): string
    {
        return sodium_crypto_sign_detached($data, $this->secret);
    }

    // As the device shows it (lib/catalog.js fingerprint).
    public function fingerprint(): string
    {
        return strtoupper(implode(' ', str_split(substr(hash('sha256', $this->public), 0, 32), 4)));
    }
}
