#!/usr/bin/env bash
# Builds a test APK for a change that doesn't touch native code: the JS bundle
# of the current checkout, made exactly like the Gradle release build makes
# it (unminified Metro bundle compiled by hermesc with the same flags, so the
# result is byte-identical), swapped into an APK that was built natively for
# the same native fingerprint (see the `test-apk` job in android-build.yml).
#
# Usage: scripts/swap-js-bundle.sh <base.apk> <out.apk>
# Env: ANDROID_HOME, EXPO_PUBLIC_* variables baked into the bundle.
# The result is signed with a throwaway debug key; publish-apk.sh re-signs it.
set -euo pipefail

BASE="$1"
OUT="$2"
WORK="$(mktemp -d)"

npx expo export:embed --platform android --dev false --reset-cache --entry-file index.ts \
  --bundle-output "$WORK/index.android.bundle" --assets-dest "$WORK/res" \
  --sourcemap-output "$WORK/index.android.bundle.packager.map" --minify false
# Images and other assets the JS imports go into Android resources, which this
# swap doesn't update. There are none yet; fail loudly once there are.
if [ -n "$(find "$WORK/res" -type f 2>/dev/null)" ]; then
  echo "::error::The JS bundle has assets ($WORK/res); extend scripts/swap-js-bundle.sh to swap them too."
  exit 1
fi
node_modules/hermes-compiler/hermesc/linux64-bin/hermesc -w -emit-binary -max-diagnostic-width=80 \
  -out "$WORK/index.android.bundle.hbc" "$WORK/index.android.bundle" -O -output-source-map

# Copy every entry with its own compression, replacing the bundle and dropping
# the old v1 signature files (the new signature replaces them).
python3 - "$BASE" "$WORK/index.android.bundle.hbc" "$WORK/unsigned.apk" <<'EOF'
import re, sys, zipfile
base, bundle, out = sys.argv[1:]
signature = re.compile(r'^META-INF/([^/]+\.(SF|RSA|DSA|EC)|MANIFEST\.MF)$', re.I)
with open(bundle, 'rb') as f:
    code = f.read()
replaced = False
with zipfile.ZipFile(base) as zin, zipfile.ZipFile(out, 'w') as zout:
    for info in zin.infolist():
        if signature.match(info.filename):
            continue
        if info.filename == 'assets/index.android.bundle':
            zout.writestr(info, code)
            replaced = True
        else:
            zout.writestr(info, zin.read(info))
if not replaced:
    sys.exit('The base APK has no assets/index.android.bundle')
EOF

BUILD_TOOLS=$(ls -d "$ANDROID_HOME"/build-tools/* | sort -V | tail -n 1)
# Page-align stored native libraries (16 KB pages on newer devices).
"$BUILD_TOOLS/zipalign" -f -P 16 4 "$WORK/unsigned.apk" "$WORK/aligned.apk" \
  || "$BUILD_TOOLS/zipalign" -f -p 4 "$WORK/unsigned.apk" "$WORK/aligned.apk"
keytool -genkeypair -keystore "$WORK/debug.keystore" -storepass android -keypass android \
  -alias androiddebugkey -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Android Debug,O=Android,C=US" > /dev/null
"$BUILD_TOOLS/apksigner" sign --ks "$WORK/debug.keystore" --ks-pass pass:android --key-pass pass:android \
  --ks-key-alias androiddebugkey --out "$OUT" "$WORK/aligned.apk"
rm -rf "$WORK"
echo "Swapped the JS bundle into $OUT"
