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

- Every change happens on its own branch with a descriptive name that says what the feature or fix is, in lowercase kebab-case with a type prefix, e.g. `feature/buildings`, `feature/settlement-satisfaction`, `fix/benchmark-frame-spikes`. No generic or generated names like `ccr-ba68a483-8xlwdq`; if your session hands you such a branch, ask the user before working on it under a different name. The name also names the test release (`build-<branch>`).
- Pushing a feature branch makes GitHub Actions (`.github/workflows/android-build.yml`) build one test APK (job `test-apk`), run the map benchmark with it on emulators (job `benchmark`, one per scenario in parallel) and publish the APK as the pre-release `build-<branch>` (job `test-release`, also when a benchmark fails); the user installs that on their phone to test. On `main`, job `release` builds the phone APK only.
- `test-apk` only rebuilds native code when the Expo native fingerprint changed (dependencies, `app.json`, config plugins). Otherwise it takes the cached native APK and swaps in the new JS bundle (`scripts/swap-js-bundle.sh`, byte-identical to a full build). If the JS ever imports images or other assets, that script fails on purpose and must learn to swap them.
- CI passes the CPU architectures as `-PreactNativeArchitectures`: `arm64-v8a` (phone) on `main`, `arm64-v8a,x86_64` (phone + emulator) on feature branches. Don't hard-code CPU architectures in `app.json` or config plugins; when adding a native library, make sure it supports arm64-v8a and x86_64.
- Commits that only touch `Design Documents/`, `*.md` or `LICENSE` don't trigger a build. To get an APK anyway, run the workflow manually (`workflow_dispatch`).
- EAS is not used for builds.

## Mandatory performance test

Every push to a feature branch runs the map benchmark in CI (job `benchmark` in `.github/workflows/android-build.yml`, rules in `src/bench/benchmark.ts`; the app starts it when opened with the link `myworld://benchmark?scenario=young|aged|cities|unrest`):

- 5 random worlds, zoom ×2, map speed 1500 pt/s, 10 swipes in each of the 8 directions (N, NE, E, SE, S, SW, W, NW) = 80 swipes per world, with the simulation running at its default speed and territories on the map.
- Four scenarios, run in parallel: `young` (new worlds), `aged` (each world simulated for 300 years first: many peoples, territories and roads), `cities` (aged, and every settlement a big city with ruins around it) and `unrest` (aged, and every settlement but the capitals rose up: the most peoples and borders).
- **Every single swipe** must reach **≥ 60 fps** and have **no frame over 25 ms**.

Rules for every agent and every change:

- Agents have no phone, and the APK is only built by a push, so pushing your own branch is how the test runs. After pushing, wait for both `benchmark` jobs.
- Never push while a pipeline run for the branch is still in progress, unless the user explicitly approves that push. A new push cancels the running run and makes the feedback loop longer. Commit locally, wait for the run to finish, then push.
- A task is not done, and its branch must not be merged into `main`, until the whole run passes (both `benchmark` jobs). If it fails, keep optimizing and push again; don't hand the task back as finished.
- Never weaken the thresholds, skip swipes or worlds, or disable the job to get it green. Only the user changes the rules.
- New features extend the benchmark (new scenarios in `src/bench/`); all scenarios must always pass.
- The failing swipes, their seeds and directions, and what else happened in the app during them, are in the job summaries and the `benchmark-results-<scenario>` artifacts. The **Bench** button in the app runs the young scenario on a phone, a long press the aged one.

## Rules

- Discuss every change to game logic (simulation rules, balancing, what the player sees happen) with the user before implementing it: describe the planned rule and its open details, and wait for the user's go. Pure bug fixes that restore agreed behavior, performance work and tooling don't need this.
- The `android/` directory is generated (Continuous Native Generation). Never create or edit it by hand — configure native behavior in `app.json` and config plugins.
- Expo Go only includes its bundled native modules. After adding a library with native code, the app needs a development build: `npx expo run:android` locally, or `eas build --profile development --platform android`.
- Prefer recommended Expo modules over third-party libraries, and check your available skills before adding dependencies. Docs: https://docs.expo.dev/versions/latest/index.md
