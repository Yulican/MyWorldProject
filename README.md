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

Every pushed branch is built by GitHub Actions ([`.github/workflows/android-build.yml`](.github/workflows/android-build.yml)): `main` gets the phone APK, every other branch a test APK that also runs the performance test below. The APK is published as a pre-release named `Build: <branch>` under the repository's **Releases**; open it on the phone and install the APK. The build label at the bottom of the home screen shows which branch and commit is installed. Deleting a branch removes its release.

To keep builds fast, CI compiles native code for 64-bit ARM phones only (`arm64-v8a`), plus `x86_64` for the emulator on test builds, and commits that only touch `Design Documents/`, Markdown files or `LICENSE` don't trigger a build. Local builds are unaffected and still include all CPU types.

Builds are signed with the project keystore from the repository secrets `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD` and `ANDROID_KEY_ALIAS`, so new builds install over old ones and keep save data. Without the secrets the APK is debug-signed.

## Performance test

Every push to a feature branch runs the map benchmark on an Android emulator (job `test`; the release notes show the result): 5 random worlds at zoom ×2, 80 swipes each at 1500 pt/s in all 8 directions; every swipe needs ≥ 60 fps and no frame over 25 ms. A change is only done when it passes; see `AGENTS.md`. The **Bench** button in the app runs the same test on the phone.

## Structure

```
src/
  bench/       mandatory map performance benchmark
  sim/         simulation core, plain TypeScript (no React): hex grid, noise, world generation
  map/         Skia map rendering: pre-recorded pictures, vector biome icons, pan/zoom/tap
  state/       stores that hold simulation state outside React
  components/  reusable UI building blocks
  context/     UI state (AppContext)
  hooks/       custom hooks
  screens/     screens
  theme/       colors, spacing
tools/         dev tools (world preview PNGs)
Design Documents/
  sim-prototyp/  performance prototype of the simulation core (placeholder rules)
```

```bash
npm test                 # simulation tests (Node)
npm run world:preview    # renders worlds to world-previews/*.png with stats
npx tsx tools/renderWorld.ts out 1 2 3 --size=128   # specific seeds and size
```
