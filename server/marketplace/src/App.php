<?php
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The service's parts, wired from the configuration.

declare(strict_types=1);

namespace Phoenix\Marketplace;

final class App
{
    public Db $db;
    public Signer $signer;
    public Catalog $catalog;
    public Api $api;

    public function __construct(public array $config)
    {
        $this->db = new Db($config);
        $this->db->migrate();
        $this->signer = new Signer($config['data']);
        $this->catalog = new Catalog($this->db, $this->signer, $config);
        $this->api = new Api($this->db, $this->catalog);
    }
}
