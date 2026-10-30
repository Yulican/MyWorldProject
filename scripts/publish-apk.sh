#!/usr/bin/env bash
# Signs a release APK with the project keystore and publishes it as the
# pre-release build-<branch>, replacing the previous one.
#
# Usage: scripts/publish-apk.sh <apk>
# Env: GITHUB_REF_NAME, GITHUB_SHA, GH_TOKEN, COMMIT_MESSAGE, and optionally
# KEYSTORE_BASE64, KEYSTORE_PASSWORD, KEY_ALIAS (without them the APK stays
# debug-signed). NOTES_EXTRA is appended to the release notes.
set -euo pipefail

APK="$1"
TAG="build-$GITHUB_REF_NAME"
# The commit in the name keeps file names unique: re-downloading a name that
# is already on the phone makes the browser ask to download it again and
# leaves two APKs behind.
OUT="MyWorld-${GITHUB_REF_NAME//\//-}-${GITHUB_SHA::7}.apk"

# Re-sign with the project keystore so new builds install over old ones
# (keeps save games).
if [ -z "${KEYSTORE_BASE64:-}" ]; then
  echo "::warning::No keystore secrets set - APK is debug-signed. Installing it over a build with a different signature requires uninstalling first."
  cp "$APK" "$OUT"
else
  echo "$KEYSTORE_BASE64" | base64 -d > release.keystore
  BUILD_TOOLS=$(ls -d "$ANDROID_HOME"/build-tools/* | sort -V | tail -n 1)
  "$BUILD_TOOLS/zipalign" -f -p 4 "$APK" aligned.apk
  "$BUILD_TOOLS/apksigner" sign --ks release.keystore --ks-pass env:KEYSTORE_PASSWORD \
    --ks-key-alias "$KEY_ALIAS" --out "$OUT" aligned.apk
  rm release.keystore aligned.apk
fi

gh release delete "$TAG" --cleanup-tag --yes || true
gh release create "$TAG" "$OUT" \
  --prerelease \
  --target "$GITHUB_SHA" \
  --title "Build: $GITHUB_REF_NAME" \
  --notes "Branch \`$GITHUB_REF_NAME\` at ${GITHUB_SHA::7}: ${COMMIT_MESSAGE:-}${NOTES_EXTRA:-}"
