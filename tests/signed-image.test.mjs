import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveSignedImageUrl,
  SIGNED_IMAGE_TTL_SECONDS,
  SIGNED_IMAGE_UNAVAILABLE_MESSAGE,
} from '../src/lib/images/signed-image.ts';
import { shouldRenewSignedImages } from '../src/lib/images/use-signed-image-renewal.ts';

test('signed image URL helper returns a valid private URL', async () => {
  const result = await resolveSignedImageUrl(async () => ({ data: { signedUrl: 'https://storage.test/signed' }, error: null }));
  assert.deepEqual(result, { url: 'https://storage.test/signed', error: null });
  assert.equal(SIGNED_IMAGE_TTL_SECONDS, 30 * 60);
});

test('signed image URL helper turns Storage errors into a controlled per-image fallback', async () => {
  const originalWarn = console.warn;
  console.warn = () => undefined;
  try {
    const result = await resolveSignedImageUrl(async () => ({ data: null, error: { statusCode: '404', message: 'private path' } }));
    assert.deepEqual(result, { url: null, error: SIGNED_IMAGE_UNAVAILABLE_MESSAGE });
    assert.equal(JSON.stringify(result).includes('private path'), false);
  } finally { console.warn = originalWarn; }
});

test('signed image URL helper handles missing URLs and thrown requests', async () => {
  const originalWarn = console.warn;
  console.warn = () => undefined;
  try {
    const missing = await resolveSignedImageUrl(async () => ({ data: null, error: null }));
    const thrown = await resolveSignedImageUrl(async () => { throw new Error('private path'); });
    assert.deepEqual(missing, { url: null, error: SIGNED_IMAGE_UNAVAILABLE_MESSAGE });
    assert.deepEqual(thrown, { url: null, error: SIGNED_IMAGE_UNAVAILABLE_MESSAGE });
  } finally { console.warn = originalWarn; }
});

test('signed image renewal waits 20 minutes and only runs while visible and idle', () => {
  const start = 1_000_000;
  assert.equal(shouldRenewSignedImages(start + 19 * 60_000, start, true, false), false);
  assert.equal(shouldRenewSignedImages(start + 20 * 60_000, start, false, false), false);
  assert.equal(shouldRenewSignedImages(start + 20 * 60_000, start, true, true), false);
  assert.equal(shouldRenewSignedImages(start + 20 * 60_000, start, true, false), true);
});
