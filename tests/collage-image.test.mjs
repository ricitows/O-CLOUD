import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { composeCollage, hasVisibleCollageContent } from '../src/lib/images/collage-image.ts';

async function samplePhoto(category, color) {
  const detail = await sharp({ create: { width: 14, height: 18, channels: 4, background: color } }).png().toBuffer();
  const overlays = [{ input: detail, left: 33, top: 36 }];
  if (color === '#ffffff') {
    const seam = await sharp({ create: { width: 6, height: 10, channels: 4, background: '#39333a' } }).png().toBuffer();
    overlays.push({ input: seam, left: 37, top: 40 });
  }
  const bytes = await sharp({ create: { width: 80, height: 100, channels: 4, background: '#ffffff' } })
    .composite(overlays).jpeg().toBuffer();
  return { garment: { category, subcategory: null }, bytes, transparent: false };
}

test('composes a visible PNG and keeps all placements inside the editorial canvas', async () => {
  const photos = [
    await samplePhoto('Parte superior', '#793c59'),
    await samplePhoto('Parte inferior', '#263b66'),
    await samplePhoto('Calzado', '#6b5138'),
  ];
  const result = await composeCollage(photos);
  const metadata = await sharp(result.png).metadata();

  assert.equal(metadata.format, 'png');
  assert.equal(result.width, 1200);
  assert.equal(result.height, 1600);
  assert.equal(metadata.width, 1200);
  assert.equal(metadata.height, 1600);
  assert.ok(result.png.length > 0);
  assert.equal(result.placements.length, photos.length);
  for (const placement of result.placements) {
    assert.ok(placement.left >= 0 && placement.top >= 0);
    assert.ok(placement.width > 0 && placement.height > 0);
    assert.ok(placement.left + placement.width <= result.width);
    assert.ok(placement.top + placement.height <= result.height);
  }
  assert.equal(await hasVisibleCollageContent(result.png, result.width, result.height), true);

  const noShoes = await composeCollage(photos.slice(0, 2));
  const noShoesMetadata = await sharp(noShoes.png).metadata();
  assert.equal(noShoesMetadata.width, 1200);
  assert.equal(noShoesMetadata.height, 1200);
  for (const placement of noShoes.placements) {
    assert.ok(placement.left + placement.width <= noShoes.width);
    assert.ok(placement.top + placement.height <= noShoes.height);
  }
});

test('rejects an all-white canvas but accepts white areas with visible garment detail', async () => {
  const blank = await sharp({ create: { width: 1200, height: 1200, channels: 4, background: '#ffffff' } }).png().toBuffer();
  assert.equal(await hasVisibleCollageContent(blank, 1200, 1200), false);

  const photo = await samplePhoto('Parte superior', '#ffffff');
  const composed = await composeCollage([photo]);
  assert.equal(await hasVisibleCollageContent(composed.png, composed.width, composed.height), true);
});
