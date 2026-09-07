package main

// Cross-language proof: signs a manifest with the REAL private key using the
// same Node crypto the deploy script uses, then verifies it in Go with the
// production public key. Skipped automatically when bun or the key are
// absent (e.g. CI on another machine).

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestNodeSignatureVerifiesInGo(t *testing.T) {
	keyPath := filepath.Join(os.Getenv("USERPROFILE"), "Documents", "sharknote-keystore-backup", "update-sign-key.pem")
	if _, err := os.Stat(keyPath); err != nil {
		t.Skip("signing key not present on this machine")
	}
	nodeScript := `
const { createPrivateKey, sign } = require("crypto");
const { readFileSync } = require("fs");
const key = createPrivateKey(readFileSync(process.argv[1], "utf8"));
const m = { version: "1.9.1", url: "/sharknote-setup.exe", sha256: "f00d".padEnd(64, "0"), notes: "" };
const canonical = Buffer.from([m.version, m.url, m.sha256, m.notes].join("\n"), "utf8");
m.sig = sign(null, canonical, key).toString("hex");
console.log(JSON.stringify(m));
`
	out, err := exec.Command("bun", "-e", nodeScript, keyPath).Output()
	if err != nil {
		t.Skip("bun not available:", err)
	}
	var mf updateManifest
	if err := json.Unmarshal(out, &mf); err != nil {
		t.Fatal("bad JSON from node:", err)
	}
	if err := verifyManifestSig(&mf); err != nil {
		t.Fatalf("real node signature rejected by go: %v", err)
	}
	t.Log("node-signed manifest verified with the embedded production key")

	tampered := mf
	tampered.SHA256 = strings.Repeat("9", 64)
	if verifyManifestSig(&tampered) == nil {
		t.Fatal("tampered manifest passed verification")
	}
}
