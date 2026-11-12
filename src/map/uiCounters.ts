import { makeMutable } from 'react-native-reanimated';

// Work counted on the UI thread, for the benchmark's worst-frame attribution
// (WorldMap: the frames of a swipe): tile pictures recorded (the view crossed
// a tile border or new tile images arrived, which the GPU uploads when first
// drawn) and army pictures swapped in.
export const uiTileDraws = makeMutable(0);
export const uiArmySwaps = makeMutable(0);
