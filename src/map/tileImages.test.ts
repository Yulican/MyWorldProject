import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SkImage } from '@shopify/react-native-skia';
import { TileImages, type TileRequest } from './tileImages';

const image = () => ({ width: () => 8, height: () => 8, dispose() {} }) as unknown as SkImage;
const requests: TileRequest[] = Array.from({ length: 9 }, (_, i) => ({
  key: `0:${i}`,
  chunk: i,
  col: i,
  row: 0,
  offsetX: 0,
  distance: i,
  tier: 0,
}));

test('two layers never hand over new tiles in the same frame, and take turns', async () => {
  const slices: { layer: string; at: number }[] = [];
  const layer = (name: string) =>
    new TileImages(image, null, [1], () => slices.push({ layer: name, at: performance.now() }));
  const terrain = layer('terrain');
  const territory = layer('territory');
  terrain.want(requests);
  territory.want(requests);
  await new Promise((resolve) => setTimeout(resolve, 300));
  terrain.dispose();
  territory.dispose();
  // 9 tiles, 3 per slice: 3 slices per layer.
  assert.equal(slices.length, 6);
  for (let i = 1; i < slices.length; i++) {
    assert.notEqual(slices[i].layer, slices[i - 1].layer);
    assert.ok(slices[i].at - slices[i - 1].at >= 15, `slices ${i - 1} and ${i} too close`);
  }
});
