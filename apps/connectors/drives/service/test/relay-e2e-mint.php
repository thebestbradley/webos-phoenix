<?php

// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// For relay-e2e.test.ts: in a Phoenix-Web-Services checkout (argv[1]) with
// a disposable database, a verified account, a registered device and a
// Phoenix access token (account scope) bound to it, as a device's sign-in
// leaves them. Prints {"token": "..."}.

use App\Models\Device;
use App\Models\User;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;

require $argv[1].'/vendor/autoload.php';
$app = require $argv[1].'/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();
$user = User::factory()->create(['email_verified_at' => now()]);
$device = Device::factory()->create(['user_id' => $user->id, 'name' => 'Relay E2E']);
Artisan::call('passport:client', ['--personal' => true, '--name' => 'relay-e2e', '--provider' => 'users', '--no-interaction' => true]);
$result = $user->createToken('relay-e2e', ['account']);
DB::table('oauth_access_tokens')->where('id', $result->token->id)->update(['device_id' => $device->id]);
echo json_encode(['token' => $result->accessToken]);
