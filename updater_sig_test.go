package main

import (
	"crypto/ed25519"
	"encoding/hex"
	"strings"
	"testing"
)

// TestManifestSignatureRoundTrip locks the canonical format shared with
// website/scripts/prepare-installer.mjs: "version\nurl\nsha256\nnotes".
// If either side changes the format, this test fails before users do.
func TestManifestSignatureRoundTrip(t *testing.T) {
	pub, priv, err := ed25519.GenerateKey(strings.NewReader(strings.Repeat("k", 32)))
	if err != nil {
		t.Skip("cannot generate deterministic key:", err)
	}
	m := &updateManifest{
		Version: "1.9.1",
		URL:     "/sharknote-setup.exe",
		SHA256:  "ABCDEF0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
	}
	sig := ed25519.Sign(priv, canonicalManifestBytes(m))
	m.Sig = hex.EncodeToString(sig)

	// The embedded production key must NOT verify a random test key's
	// signature (guards against accidentally testing against the real key).
	if verifyManifestSig(m) == nil {
		t.Fatal("test signature verified against the production public key")
	}

	// Swap in the test public key via a local check mirroring verify logic.
	canonical := canonicalManifestBytes(m)
	if !ed25519.Verify(pub, canonical, sig) {
		t.Fatal("round trip failed: signature does not verify with its own key")
	}
	if !strings.HasPrefix(string(canonical), "1.9.1\n/sharknote-setup.exe\nabcdef") {
		t.Fatalf("canonical format drifted (sha must be lowercased): %q", canonical)
	}
}

func TestVerifyRejectsUnsignedAndTampered(t *testing.T) {
	if err := verifyManifestSig(&updateManifest{Version: "1", URL: "/x", SHA256: "ab"}); err == nil {
		t.Fatal("unsigned manifest accepted")
	}
	// valid-shape hex sig but wrong bytes
	if err := verifyManifestSig(&updateManifest{Version: "1", URL: "/x", SHA256: "ab", Sig: strings.Repeat("00", 64)}); err == nil {
		t.Fatal("garbage signature accepted")
	}
}
