// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// service.js on a device, with its files faked: node --test services/account/service.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
test('device() registers what the image files say, and leaves out what is not there (a VM image: no RAUC, no device-tree model)', async () => {
    const files = {
        '/etc/os-release': 'ID=luneos\nVERSION_ID=1.0\nBUILD_ID="20261126153551"\n',
        '/etc/buildinfo': 'MACHINE = phoenix-vm-arm64\nDATETIME = 20261126153551\n',
        '/usr/share/phoenix/product.json': '{"name": "webOS Phoenix", "version": "1.0.0"}',
    };
    let deps;
    const adapter = { SERVICE: 'org.webosphoenix.service.account', METHODS: [], createAccountService(d) { deps = d; return {}; } };
    const fakeFs = { readFileSync(file) { if (file in files) return files[file]; const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; } };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'service.js'), 'utf8'), {
        require(id) {
            return id === 'webos-service' ? class { register() {} } : id === './accountservice' ? adapter
                : id === '@phoenix/platform/src/device' ? {} : id === 'fs' ? fakeFs : id === './deviceinfo' ? require('./deviceinfo') : require(id);
        }
    });
    assert.deepEqual({ ...(await deps.device()) }, { compatible: 'phoenix-vm-arm64', name: 'Phoenix device', osVersion: '1.0.0', build: 20261126153551 });
});
