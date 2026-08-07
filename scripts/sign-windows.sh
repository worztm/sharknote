#!/usr/bin/env bash
# Signs the Windows binary and NSIS installer with the Sharknote
# code-signing certificate.
#
# The certificate was created with PowerShell (self-signed for now):
#   New-SelfSignedCertificate -Type CodeSigningCert -Subject "CN=Sharknote, O=Sharknote" \
#     -CertStoreLocation Cert:\CurrentUser\My -KeyUsage DigitalSignature \
#     -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.3")
#   Export-PfxCertificate -Cert $cert -FilePath sharknote-code-signing.pfx -Password ...
#
# IMPORTANT: SmartScreen / browser reputation warnings can only be fully
# removed by a certificate from a public CA (e.g. DigiCert, Sectigo, or
# Azure Trusted Signing). Until then this signature proves the file is
# the one built here and gives Windows a publisher name to show.
#
# Usage: scripts/sign-windows.sh [PATH_TO_PFX] [PFX_PASSWORD]
#   Defaults: $HOME/sharknote-signing/sharknote-code-signing.pfx / "sharknote-2026-signing"

set -euo pipefail
cd "$(dirname "$0")/.."

PFX="${1:-$HOME/sharknote-signing/sharknote-code-signing.pfx}"
PASS="${2:-sharknote-2026-signing}"
SIGN="build/tools/bin/osslsigncode.exe"
URL="https://sharknote.pages.dev"

[ -f "$PFX" ] || { echo "No certificate at $PFX"; exit 1; }
[ -f "$SIGN" ] || { echo "osslsigncode missing — download from https://github.com/mtrojnar/osslsigncode/releases into build/tools/bin/"; exit 1; }

sign_file() {
  local src="$1"
  local tmp="${src}.signed"
  "$SIGN" sign -pkcs12 "$PFX" -pass "$PASS" -n "Sharknote" -i "$URL" \
    -t "http://timestamp.digicert.com" -in "$src" -out "$tmp" 2>&1 | tail -1
  mv "$tmp" "$src"
  "$SIGN" verify -in "$src" 2>&1 | grep -E "Current message digest|Calculated message digest" || true
  echo "signed: $src"
}

sign_file bin/sharknote.exe
sign_file bin/sharknote-amd64-installer.exe
