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

## Playing the god

Your believers in every people give **Faith** as the weeks pass; the **Gacha** button at the top shows your Faith and the price of the next pull and turns green when you can afford one. A pull gives 3 random abilities (Common grey, Rare blue, Epic violet, Legendary gold) as charges in your inventory. Tap a charge, then **Use**: the hexes or peoples you may target glow on the map; tap one (or pick a people in the list), see the area it covers, and **Confirm**. Biome Shift asks whether the land turns wetter or drier. An invalid target says why and costs no charge. Running effects show in the hex info, the peoples list and the leader panel with the years left; burning hexes show flames on the map, and new rivers, lakes and changed land appear in the map once it rests.

## Saving

There is one saved world. The game saves it on its own when the app goes to the background and every 2 minutes while the game runs; when you open the app again, the saved world continues where you left it and starts running on your first tap. The **Menu** button on the map pauses the game and shows the saved world's age and save time, with **Save** (overwrites the saved world), **Load** (asks first: unsaved progress is lost) and **New World** (**Save & New World**, **New World** without saving, or **Cancel**). After a new world, the first autosave asks **Overwrite saved world?**; **Keep old save** leaves the saved world alone and turns autosave off for this world until you press Save. A saved world from another game version, or a damaged one, isn't loaded: a short message says so and a new world starts (the old file stays until the next save replaces it).

## Performance test

Every push to a feature branch runs the map benchmark on Android emulators (job `benchmark`; the release notes show the results) in ten scenarios in parallel (young worlds; worlds after 300 simulated years; those with every settlement a big city; those after every settlement but the capitals rose up; those with trade everywhere; those with all borders open and free trade between all peoples; those with seats of government, government buildings and soldiers everywhere; those with three rebellions and two blocks of allies at war, 32 army markers and at least 6 siege frames on the map; those where the god cast charges of all 25 abilities and keeps fires burning, biomes shifting and rivers springing during the swipes; those where the autosave runs over and over during the swipes and the save is loaded back once per world): 5 random worlds at zoom ×2, 80 swipes each at 1500 pt/s in all 8 directions; every swipe needs ≥ 60 fps and no frame over 25 ms. A change is only done when all pass; see `AGENTS.md`. The **Bench** button in the app runs the young scenario on the phone, a long press the aged one.

## Structure

```
src/
  bench/       mandatory map performance benchmark
  sim/         simulation core, plain TypeScript (no React): hex grid, noise, world generation
    society/   inhabitants, civilizations and culture; one tick = one week
  map/         Skia map rendering: pre-recorded pictures, vector biome icons, territories, pan/zoom/tap
  state/       stores that hold simulation state outside React, game clock
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
npx tsx tools/renderWorld.ts out 1 --years=150      # simulate 150 years, draw civilizations
```
