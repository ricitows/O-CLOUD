import sharp from 'sharp';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_INPUT_PIXELS = 40_000_000;

const formats = {
  jpeg: { mime: 'image/jpeg', extension: 'jpg' },
  png: { mime: 'image/png', extension: 'png' },
  webp: { mime: 'image/webp', extension: 'webp' },
} as const;

type ImageFormat = keyof typeof formats;

function detectFormat(bytes: Buffer): ImageFormat | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png';
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

function hasExpectedExtension(name: string, format: ImageFormat) {
  if (format === 'jpeg') return /\.jpe?g$/i.test(name);
  if (format === 'png') return /\.png$/i.test(name);
  return /\.webp$/i.test(name);
}

/** Trusts the encoded bytes, not the user-supplied file name or MIME type. */
export async function normalizeGarmentImage(file: File): Promise<File> {
  if (file.size <= 0 || file.size > MAX_IMAGE_BYTES) {
    throw new Error('Elige una imagen de hasta 10 MB.');
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const format = detectFormat(bytes);
  if (!format) throw new Error('El archivo no es una imagen JPEG, PNG o WEBP válida.');

  try {
    const options = { failOn: 'error' as const, limitInputPixels: MAX_INPUT_PIXELS };
    const metadata = await sharp(bytes, options).metadata();
    if (metadata.format !== format || !metadata.width || !metadata.height) throw new Error('Formato de imagen inconsistente.');
    // Force a decode so truncated or corrupt files are rejected before storage.
    await sharp(bytes, options).rotate().resize({ width: 1, height: 1 }).toBuffer();
  } catch {
    throw new Error('La imagen está dañada o no se puede decodificar. Prueba con otra fotografía.');
  }

  const expected = formats[format];
  const mimeMatches = file.type.toLowerCase() === expected.mime;
  const extensionMatches = hasExpectedExtension(file.name, format);
  if (mimeMatches && extensionMatches) return file;

  const baseName = file.name.replace(/\.[^.]*$/, '').slice(0, 100) || 'prenda';
  return new File([bytes], `${baseName}.${expected.extension}`, {
    type: expected.mime,
    lastModified: file.lastModified,
  });
}
