#!/bin/sh
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# The Phoenix driver catalog on this computer: PHP's built-in server
# (http://127.0.0.1:8090/v1/). DRIVERS_DATA=sample serves the simulator's
# sample catalog.
#
#   server/drivers/bin/serve.sh [port]

set -e
cd "$(dirname "$0")/.."
PORT="${1:-8090}"
echo "Phoenix driver catalog at http://127.0.0.1:$PORT/v1/ (reports: POST /v1/report)"
exec php -S "127.0.0.1:$PORT" public/router.php
