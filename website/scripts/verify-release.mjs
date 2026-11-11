import { existsSync, readFileSync } from "node:fs";
import { createHash, createPublicKey, verify } from "node:crypto";
import { join } from "node:path";

// Guards the release before it is published.
//
//  - the manifest signature must verify against the public key that is
//    baked into the shipped exe (read from updater.go, so it can never
//    drift from the app)
//  - the manifest hash must match the installer that is being published
//  - the published version must match the version the app reports
//    (version.go) and the Windows build metadata (info.json), otherwise
//    an updated app keeps offering the same update forever
//  - the site itself must be present in the build output

const repoRoot = join(process.cwd(), "..");
const distDir = join(process.cwd(), "dist");

const fail = (msg) => {
  console.error("RELEASE CHECK FAILED: " + msg);
  process.exit(1);
};

const updaterGo = readFileSync(join(repoRoot, "updater.go"), "utf8");
const versionGo = readFileSync(join(repoRoot, "version.go"), "utf8");

const pubHex = (updaterGo.match(/updatePubKeyHex\s*=\s*"([0-9a-f]{64})"/) || [])[1];
if (!pubHex) fail("could not read updatePubKeyHex from updater.go");

const appVersion = (versionGo.match(/AppVersion\s*=\s*"([^"]+)"/) || [])[1];
if (!appVersion) fail("could not read AppVersion from version.go");

const info = JSON.parse(
  readFileSync(join(repoRoot, "build", "windows", "info.json"), "utf8")
);
const buildVersion = info.info["0000"].ProductVersion;

const manifestPath = join(distDir, "latest.json");
const installerPath = join(distDir, "sharknote-setup.exe");
const sitePath = join(distDir, "index.html");

if (!existsSync(manifestPath)) fail("dist/latest.json is missing");
if (!existsSync(installerPath)) fail("dist/sharknote-setup.exe is missing");
if (!existsSync(sitePath)) fail("dist/index.html is missing - the website did not build");

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

if (manifest.version !== appVersion) {
  fail(
    `manifest version ${manifest.version} != AppVersion ${appVersion} in version.go. ` +
      "The app would keep offering the same update forever. " +
      "Bump version.go, build/windows/info.json and build/windows/nsis/project.nsi together."
  );
}
if (manifest.version !== buildVersion) {
  fail(`manifest version ${manifest.version} != build metadata ${buildVersion} in build/windows/info.json`);
}

// The manifest hash must describe the installer that ships next to it.
const sha256 = createHash("sha256").update(readFileSync(installerPath)).digest("hex");
if (sha256 !== manifest.sha256) {
  fail(`manifest sha256 ${manifest.sha256} does not match the published installer (${sha256})`);
}

// Rebuild the canonical bytes exactly as canonicalManifestBytes in updater.go does.
const canonical = Buffer.from(
  `${manifest.version}\n${manifest.url}\n${manifest.sha256.toLowerCase()}\n${manifest.notes || ""}`,
  "utf8"
);
const publicKey = createPublicKey({
  key: Buffer.concat([
    Buffer.from("302a300506032b6570032100", "hex"),
    Buffer.from(pubHex, "hex"),
  ]),
  format: "der",
  type: "spki",
});

if (!verify(null, canonical, publicKey, Buffer.from(manifest.sig, "hex"))) {
  fail("the manifest signature does not verify against the key baked into the app");
}

console.log(
  `Release checks passed: v${manifest.version}, installer sha256 ${sha256.slice(0, 12)}..., signature valid.`
);
