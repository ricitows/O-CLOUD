import sharp from 'sharp';

export const COLLAGE_WIDTH = 1200;
export type CollagePhoto = {
  garment: { category: string; subcategory: string | null };
  bytes: Buffer;
  transparent: boolean;
};
export type CollagePlacement = { left: number; top: number; width: number; height: number };
type Role = 'onepiece' | 'top' | 'bottom' | 'shoes' | 'accessory' | 'other';
type Slot = { left: number; top: number; width: number; height: number };

function classify(item: CollagePhoto['garment']): Role {
  const value = `${item.category} ${item.subcategory || ''}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es');
  if (/prendas completas|vestido|mono|jumpsuit|enterizo/.test(value)) return 'onepiece';
  if (/calzado|zapato|tenis|bota|sandalia|tacon/.test(value)) return 'shoes';
  if (/accesorios|bolso|cinturon|sombrero|joyer|reloj|bufanda/.test(value)) return 'accessory';
  if (/parte superior|blusa|camisa|playera|sueter|chaqueta|abrigo|top|hoodie/.test(value)) return 'top';
  if (/parte inferior|pantalon|jean|falda|short/.test(value)) return 'bottom';
  return 'other';
}

function grid(items: CollagePhoto[], area: Slot): Array<{ photo: CollagePhoto; slot: Slot }> {
  if (!items.length) return [];
  const ratio = area.width / area.height;
  const columns = Math.min(items.length, Math.max(1, Math.round(Math.sqrt(items.length * ratio))));
  const rows = Math.ceil(items.length / columns);
  const cellWidth = area.width / columns;
  const cellHeight = area.height / rows;
  const inset = Math.min(18, Math.floor(Math.min(cellWidth, cellHeight) * 0.06));
  return items.map((photo, index) => ({
    photo,
    slot: {
      left: Math.round(area.left + (index % columns) * cellWidth + inset),
      top: Math.round(area.top + Math.floor(index / columns) * cellHeight + inset),
      width: Math.max(1, Math.floor(cellWidth - inset * 2)),
      height: Math.max(1, Math.floor(cellHeight - inset * 2)),
    },
  }));
}

function layout(photos: CollagePhoto[]) {
  const groups: Record<Role, CollagePhoto[]> = { onepiece: [], top: [], bottom: [], shoes: [], accessory: [], other: [] };
  for (const photo of photos) groups[classify(photo.garment)].push(photo);
  const placed: Array<{ photo: CollagePhoto; slot: Slot }> = [];
  const hasMainGarments = groups.top.length + groups.bottom.length > 0;

  if (groups.onepiece.length) {
    placed.push(...grid(groups.onepiece, { left: 80, top: 55, width: 690, height: 1060 }));
    const side = [...groups.top, ...groups.bottom, ...groups.accessory, ...groups.other];
    placed.push(...grid(side, { left: 805, top: 55, width: 345, height: 1060 }));
  } else {
    const side = [...groups.accessory, ...groups.other];
    if (hasMainGarments) {
      if (groups.top.length && groups.bottom.length) {
        placed.push(...grid(groups.top, { left: 90, top: 55, width: 630, height: 465 }));
        placed.push(...grid(groups.bottom, { left: 90, top: 535, width: 630, height: 625 }));
      } else if (groups.top.length) {
        placed.push(...grid(groups.top, { left: 90, top: 70, width: 630, height: 1080 }));
      } else {
        placed.push(...grid(groups.bottom, { left: 90, top: 70, width: 630, height: 1080 }));
      }
      placed.push(...grid(side, { left: 755, top: 55, width: 395, height: 1105 }));
    } else {
      const main = groups.other.length ? groups.other : groups.accessory;
      const remaining = groups.other.length ? groups.accessory : [];
      placed.push(...grid(main, { left: 100, top: 65, width: 700, height: 1085 }));
      placed.push(...grid(remaining, { left: 825, top: 65, width: 325, height: 1085 }));
    }
  }
  placed.push(...grid(groups.shoes, { left: 65, top: 1190, width: 1070, height: 350 }));
  return placed;
}

export async function composeCollage(photos: CollagePhoto[]) {
  if (!photos.length) throw new Error('No hay prendas para componer.');
  const placed = layout(photos);
  const placements = placed.map(({ slot }) => slot);
  const height = photos.some(photo => classify(photo.garment) === 'shoes') ? 1600 : 1200;
  for (const placement of placements) {
    if (placement.left < 0 || placement.top < 0 || placement.width <= 0 || placement.height <= 0 ||
      placement.left + placement.width > COLLAGE_WIDTH || placement.top + placement.height > height) {
      throw new Error('Una prenda queda fuera de los límites del lienzo.');
    }
  }

  const layers = await Promise.all(placed.map(async ({ photo, slot }) => ({
    input: await sharp(photo.bytes, { failOn: 'error', limitInputPixels: 40_000_000 })
      .rotate()
      .resize(slot.width, slot.height, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
      .png().toBuffer(),
    left: slot.left,
    top: slot.top,
  })));
  const png = await sharp({ create: { width: COLLAGE_WIDTH, height, channels: 4, background: '#ffffff' } })
    .composite(layers).png().toBuffer();
  return { png, width: COLLAGE_WIDTH, height, placements };
}

/** Checks aggregate contrast against the white canvas; individual white regions remain valid. */
export async function hasVisibleCollageContent(png: Buffer, expectedWidth: number, expectedHeight: number) {
  if (!png.length) return false;
  const { data, info } = await sharp(png, { failOn: 'error' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.format !== 'raw' || info.width !== expectedWidth || info.height !== expectedHeight || info.channels !== 4) return false;

  const minimumVisiblePixels = Math.max(64, Math.ceil(info.width * info.height * 0.0002));
  let visiblePixels = 0;
  for (let index = 0; index < data.length; index += 4) {
    if (data[index] < 244 || data[index + 1] < 244 || data[index + 2] < 244) visiblePixels++;
    if (visiblePixels >= minimumVisiblePixels) return true;
  }
  return false;
}
