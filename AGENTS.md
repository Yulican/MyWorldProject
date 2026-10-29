This is an Expo/React Native mobile game (Android only), a sandbox god game. Prioritize mobile performance. The game design lives in `Design Documents/` (German) and must be kept up to date when design decisions change. Game text is English.

## Project architecture

- The simulation core is plain TypeScript with no React or React Native imports. It is deterministic per seed, stores data in flat typed arrays and will later be ported to C++ via JSI, so keep it port-friendly.
- Simulation state lives outside React. React Context only holds UI-related state.
- The map renders compact per-hex snapshots, not individual inhabitants.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

## Commands

Use `bunx` instead of `npx` if the project uses bun (`bun.lock` present).

```bash
npx expo install <package>  # ALWAYS use instead of npm/yarn/pnpm/bun add — resolves SDK-compatible versions
npx expo start              # start the dev server
npx expo lint               # lint
npm run typecheck           # app + tests/tools
npm test                    # simulation and map logic tests (Node)
npm run world:preview       # render generated worlds to PNG to check the generator
npx expo-doctor             # diagnose dependency and config issues
npx expo install --fix      # fix incompatible package versions
```

Run typecheck and tests before declaring any task done.

## Navigation

- The app currently has a single screen rendered from `App.tsx` (`src/screens/`). No router is set up yet; decide on one when a second screen is needed.

## Builds and testing

- Every change happens on its own branch. Pushing a branch makes GitHub Actions (`.github/workflows/android-build.yml`) build a signed release APK and publish it as the pre-release `build-<branch>`; the user installs that on their phone to test.
- CI builds native code for `arm64-v8a` only (passed as `-PreactNativeArchitectures=arm64-v8a`). Don't hard-code CPU architectures in `app.json` or config plugins; when adding a native library, make sure it supports arm64-v8a.
- Commits that only touch `Design Documents/`, `*.md` or `LICENSE` don't trigger a build. To get an APK anyway, run the workflow manually (`workflow_dispatch`).
- EAS is not used for builds.

## Rules

- The `android/` directory is generated (Continuous Native Generation). Never create or edit it by hand — configure native behavior in `app.json` and config plugins.
- Expo Go only includes its bundled native modules. After adding a library with native code, the app needs a development build: `npx expo run:android` locally, or `eas build --profile development --platform android`.
- Prefer recommended Expo modules over third-party libraries, and check your available skills before adding dependencies. Docs: https://docs.expo.dev/versions/latest/index.md
