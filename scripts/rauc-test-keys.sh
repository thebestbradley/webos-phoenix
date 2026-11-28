#!/bin/sh
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# Make RAUC's TEST keys: a test CA, which test images trust (their keyring,
# /etc/rauc/keyring.pem), and a development signing certificate it issued,
# which signs test bundles (meta-phoenix/dynamic-layers/rauc/recipes-core/
# bundles/phoenix-bundle.bb). docs/PLATFORM.md 7.2: "a separate development
# CA for test images and CI".
#
# THE PRIVATE KEYS ARE PUBLIC: they are in this repository, so anyone can
# sign a bundle that an image with this keyring installs. They are for test
# images only. A release image trusts the owner's release CA instead
# (PHOENIX_RAUC_KEYRING; docs/PRE-IMAGE-CHECKLIST.md U3), and a release
# bundle is re-signed with the owner's key (`rauc resign`).
#
#   scripts/rauc-test-keys.sh [DIR]     DIR: meta-phoenix/files/rauc/test
#
# Needs OpenSSL 3 (on a Mac, Homebrew's: PATH or OPENSSL=). Run it again
# only to replace the keys: images built with the old CA then refuse
# bundles signed with the new certificate.

set -eu

REPO_DIR=$(cd "$(dirname "$0")/.." && pwd)
DIR=${1:-"$REPO_DIR/meta-phoenix/files/rauc/test"}
OPENSSL=${OPENSSL:-openssl}
if ! "$OPENSSL" version | grep -q '^OpenSSL 3'; then
    echo "rauc-test-keys: needs OpenSSL 3 (set OPENSSL=)" >&2
    exit 2
fi
DAYS=7300   # 20 years: RAUC checks the validity at install time

mkdir -p "$DIR"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

cat > "$work/signer.ext" <<'EOF'
basicConstraints = critical, CA:false
keyUsage = critical, digitalSignature
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid
EOF

# The CA.
"$OPENSSL" req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes \
    -keyout "$work/ca.key.pem" -out "$DIR/ca.cert.pem" -days "$DAYS" -sha256 \
    -subj "/O=webOS Phoenix/CN=webOS Phoenix TEST CA (insecure: the key is public)" \
    -addext "basicConstraints=critical,CA:true" -addext "keyUsage=critical,keyCertSign,cRLSign"
# The development signing certificate.
"$OPENSSL" req -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes \
    -keyout "$DIR/development-1.key.pem" -out "$work/development-1.csr.pem" \
    -subj "/O=webOS Phoenix/CN=webOS Phoenix TEST development-1 (insecure: the key is public)"
"$OPENSSL" x509 -req -in "$work/development-1.csr.pem" -CA "$DIR/ca.cert.pem" -CAkey "$work/ca.key.pem" \
    -CAserial "$work/ca.srl" -CAcreateserial -out "$DIR/development-1.cert.pem" -days "$DAYS" -sha256 -extfile "$work/signer.ext"
# The CA's own key is not kept: a new signing certificate means a new CA.
"$OPENSSL" verify -CAfile "$DIR/ca.cert.pem" "$DIR/development-1.cert.pem"
chmod 0644 "$DIR"/*.pem
echo "rauc-test-keys: $DIR (ca.cert.pem, development-1.cert.pem, development-1.key.pem)"
