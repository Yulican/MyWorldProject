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
