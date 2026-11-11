import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash, createPrivateKey, sign } from "node:crypto";
import { basename, join } from "node:path";
import { homedir } from "node:os";

// Prepares the deployable website in dist/:
//  1. copies the freshly built + signed installer as sharknote-setup.exe
//  2. copies the Android APK next to it when one was built
//  3. writes latest.json - the update manifest the desktop app polls
//     (version, download URL, the installer's SHA-256, and an Ed25519
//     signature over all of it). The app verifies the signature against a
//     public key baked into the exe, so a compromised website alone can
//     never push a malicious update.
//
// Runs the same way locally and in CI. In CI the signing key arrives as
// SHARKNOTE_UPDATE_SIGN_KEY (PEM text, or base64 of a PEM); locally it is
// read from the offline key file.

const LIVE_SITE = process.env.SHARKNOTE_LIVE_URL || "https://sharknote.pages.dev";
const KEY_ENV = "SHARKNOTE_UPDATE_SIGN_KEY";
const LOCAL_KEY_PATH = join(
  homedir(),
  "Documents",
  "sharknote-keystore-backup",
  "update-sign-key.pem"
);

const repoRoot = join(process.cwd(), "..");
const distDir = join(process.cwd(), "dist");
const binDir = join(repoRoot, "bin");

mkdirSync(distDir, { recursive: true });

// --- signing key -------------------------------------------------------------
function loadPrivateKey() {
  const fromEnv = process.env[KEY_ENV];
  if (fromEnv && fromEnv.trim()) {
    let pem = fromEnv.trim();
    if (!pem.includes("-----BEGIN")) {
      // base64-encoded PEM (how GitHub Actions stores it)
      pem = Buffer.from(pem, "base64").toString("utf8");
    }
    return createPrivateKey(pem);
  }
  if (existsSync(LOCAL_KEY_PATH)) {
    return createPrivateKey(readFileSync(LOCAL_KEY_PATH, "utf8"));
  }
  throw new Error(
    "No update signing key. Set " +
      KEY_ENV +
      " (PEM text or base64) or provide " +
      LOCAL_KEY_PATH
  );
}

// --- installer ---------------------------------------------------------------
const installerSrc =
  process.env.SHARKNOTE_INSTALLER || join(binDir, "sharknote-amd64-installer.exe");
const installerDest = join(distDir, "sharknote-setup.exe");

if (!existsSync(installerSrc)) {
  console.error("Installer not found at " + installerSrc);
  console.error("Build it first with: wails3 task package");
  process.exit(1);
}
copyFileSync(installerSrc, installerDest);
console.log("Installer copied to dist/sharknote-setup.exe");

// --- android apk -------------------------------------------------------------
// The Android app is built on its own schedule. Use a freshly built APK when
// one is in bin/, otherwise carry the published one forward so the site's
// download link keeps working.
function newestApk(dir) {
  if (!existsSync(dir)) return null;
  const apks = readdirSync(dir).filter((f) => f.endsWith(".apk"));
  if (!apks.length) return null;
  return apks
    .map((f) => join(dir, f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
}

const apkDest = join(distDir, "sharknote-android.apk");
const apkSource = process.env.SHARKNOTE_APK || newestApk(binDir);

if (apkSource && existsSync(apkSource)) {
  copyFileSync(apkSource, apkDest);
  console.log("APK copied to dist/sharknote-android.apk (" + basename(apkSource) + ")");
} else {
  const apkUrl = process.env.SHARKNOTE_APK_URL || LIVE_SITE + "/sharknote-android.apk";
  try {
    const res = await fetch(apkUrl, { redirect: "follow" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    writeFileSync(apkDest, Buffer.from(await res.arrayBuffer()));
    console.log("APK carried forward from " + apkUrl);
  } catch (err) {
    console.warn(
      "WARNING: no Android APK to publish (" + err.message + "). " +
        "The site's APK link will 404 until the next Android build."
    );
  }
}

// --- update manifest ---------------------------------------------------------
// Version comes straight from the Windows build metadata so the app, the
// installer and the manifest can never drift apart.
const info = JSON.parse(
  readFileSync(join(repoRoot, "build", "windows", "info.json"), "utf8")
);
const version = info.info["0000"].ProductVersion;

const exe = readFileSync(installerDest);
const sha256 = createHash("sha256").update(exe).digest("hex");
const url = "/sharknote-setup.exe";

const manifest = { version, url, sha256 };

// Ed25519 signature over the canonical bytes the Go updater rebuilds:
// "version\nurl\nsha256\nnotes" (notes empty here). Keep in sync with
// canonicalManifestBytes in updater.go.
manifest.sig = sign(null, Buffer.from(`${version}\n${url}\n${sha256}\n`, "utf8"), loadPrivateKey()).toString(
  "hex"
);

writeFileSync(
  join(distDir, "latest.json"),
  JSON.stringify(manifest, null, 2) + "\n"
);
console.log(`Update manifest written: v${version} (sha256 ${sha256.slice(0, 12)}..., signed)`);
