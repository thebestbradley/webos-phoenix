#!/bin/sh
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# `apt-get update` on GitHub's Ubuntu runners, without the image's
# packages.microsoft.com source. That repository answered 403 on 27 November
# 2026 ("is no longer signed"), and apt-get update fails on one bad source,
# which stopped every job that installs a package. Phoenix installs nothing
# from it: every package the workflows ask for is Ubuntu's.
set -eu
for f in /etc/apt/sources.list.d/*; do
	[ -f "$f" ] || continue
	if grep -q 'packages\.microsoft\.com' "$f"; then
		echo "apt-update: dropping $f (packages.microsoft.com)"
		sudo rm -f "$f"
	fi
done
sudo apt-get update
