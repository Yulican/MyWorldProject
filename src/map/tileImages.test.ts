import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SkImage } from '@shopify/react-native-skia';
import { TileImages, type TileRequest } from './tileImages';

// TileImages with fake images: which tiles it renders, and when.

const fakeImage = (): SkImage => ({ width: () => 10, height: () => 10, dispose: () => {} }) as unknown as SkImage;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const req = (chunk: number): TileRequest => ({ chunk, tier: 0, distance: chunk }) as TileRequest;

function layer(look: Map<number, number>) {
  const rendered: number[] = [];
  const tiles = new TileImages(
    (chunk) => {
      rendered.push(chunk);
      return fakeImage();
    },
    (chunk) => look.get(chunk) ?? 0,
    [1],
    () => {},
  );
  return { tiles, rendered };
}

test('outdated tiles are redone only while the map rests', async () => {
  const look = new Map<number, number>();
  const { tiles, rendered } = layer(look);
  tiles.want([req(1), req(2)]);
  await wait(60);
  assert.deepEqual(rendered.sort(), [1, 2]);
  rendered.length = 0;
  tiles.setResting(false);
  look.set(1, 5);
  tiles.invalidate();
  tiles.want([req(1), req(2)]);
  await wait(60);
  assert.deepEqual(rendered, [], 'nothing while moving: the old image stays');
  assert.ok(tiles.get(1, 0), 'the old image is still there');
  tiles.setResting(true);
  await wait(60);
  assert.deepEqual(rendered, [1], 'only the tile that looks different');
  tiles.dispose();
});

test('tiles out of view keep their image through a change and are checked when wanted again', async () => {
  const look = new Map<number, number>();
  const { tiles, rendered } = layer(look);
  tiles.want([req(1), req(2), req(3)]);
  await wait(60);
  rendered.length = 0;
  tiles.want([req(1)]);
  look.set(2, 7);
  tiles.invalidate();
  assert.ok(tiles.get(2, 0), 'kept while out of view');
  tiles.setResting(false);
  tiles.want([req(1), req(2), req(3)]);
  await wait(60);
  assert.deepEqual(rendered, [], 'shown with the old image while the map moves');
  tiles.setResting(true);
  await wait(60);
  assert.deepEqual(rendered, [2], 'only the changed one, once the map rests');
  tiles.dispose();
});

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

test('many map mode switches and moves keep the cache bounded and free every dropped image once', async () => {
  // Images of 10x10 px (400 bytes): a budget of 8 tiles.
  let live = 0;
  let doubleFree = 0;
  const counted = (): SkImage => {
    live++;
    let freed = false;
    return {
      width: () => 10,
      height: () => 10,
      dispose: () => {
        if (freed) doubleFree++;
        freed = true;
        live--;
      },
    } as unknown as SkImage;
  };
  let mode = 0;
  const tiles = new TileImages(counted, (chunk) => chunk * 31 + mode, [1, 2], () => {}, 8 * 400);
  for (let step = 0; step < 40; step++) {
    // A view of 4 tiles moving across 200 chunks, at alternating tiers; every 5th step a mode switch changes every tile.
    const first = (step * 5) % 200;
    tiles.want([0, 1, 2, 3].map((i) => ({ chunk: first + i, tier: step % 2, distance: i }) as TileRequest));
    if (step % 5 === 4) {
      mode++;
      tiles.invalidate();
    }
    await wait(80);
  }
  // Tiles drawn within the last second are evicted once that second is over, then freed a second later.
  await wait(2500);
  // Beyond the budget only tiles of the view and those drawn within the last second may stay.
  assert.ok(live <= 8 + 8, `live images bounded: ${live}`);
  tiles.dispose();
  await wait(1100);
  assert.equal(live, 0, 'all images freed after dispose');
  assert.equal(doubleFree, 0, 'no image freed twice');
});
