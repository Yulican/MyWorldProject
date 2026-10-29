# MyWorldProject

A sandbox god game for Android. You are the god of a small tribe and can only influence the world indirectly: civilizations grow, migrate, trade and fight on their own, their prayers give you influence, and influence buys gacha abilities that nudge the world.

Design: [`Design Documents/Game Design Gott einer Zivilisation.docx`](Design%20Documents/) (German, kept up to date).

## Tech

- React Native with Expo (dev builds / prebuild), TypeScript strict, React Context + hooks
- Simulation core: TypeScript first, later ported to C++ via JSI. It lives outside React, is deterministic per seed and stores data in flat typed arrays.
- Map rendering: Skia (react-native-skia), hex grid

## Start

```bash
npm install
npm run android    # local dev build (needs Android SDK), or:
npx eas-cli@latest build --profile development --platform android
npm start          # Metro with dev client
npm run typecheck
```

`android/` is generated from `app.json` (Continuous Native Generation) and not committed.

## Test builds

Every pushed branch is built by GitHub Actions ([`.github/workflows/android-build.yml`](.github/workflows/android-build.yml)). The APK is published as a pre-release named `Build: <branch>` under the repository's **Releases**; open it on the phone and install the APK. The build label at the bottom of the home screen shows which branch and commit is installed. Deleting a branch removes its release.

Builds are signed with the project keystore from the repository secrets `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD` and `ANDROID_KEY_ALIAS`, so new builds install over old ones and keep save data. Without the secrets the APK is debug-signed.

## Structure

```
src/
  components/  reusable UI building blocks
  context/     UI state (AppContext)
  hooks/       custom hooks
  screens/     screens
  theme/       colors, spacing
  types/       shared types
  utils/       helpers
Design Documents/
  sim-prototyp/  performance prototype of the simulation core (placeholder rules)
```
