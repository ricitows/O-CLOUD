import { NextResponse } from 'next/server';
import sharp from 'sharp';
import { createClient } from '@/lib/supabase/server';
import { hasSupabaseConfig } from '@/lib/supabase/env';
import { composeCollage, hasVisibleCollageContent, type CollagePhoto } from '@/lib/images/collage-image';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Garment = { id: string; name: string; category: string; subcategory: string | null; original_path: string | null; processed_path: string | null };
type Photo = CollagePhoto & { garment: Garment };

// TEMP diagnostic logging: deliberately excludes user/garment IDs, paths, URLs, and provider payloads.
function logCollage(requestId: string, stage: string, details: Record<string, string | number | boolean | null> = {}) {
  console.info('[collage-diagnostic]', { requestId, stage, ...details });
}

async function hasRealTransparency(bytes: Buffer) {
  const image = sharp(bytes, { failOn: 'error', limitInputPixels: 40_000_000 });
  const metadata = await image.metadata();
  if (!metadata.hasAlpha) return false;
  const stats = await image.stats();
  const alpha = stats.channels.at(-1);
  return Boolean(alpha && alpha.min < 255);
}

async function downloadOwnPhoto(supabase: Awaited<ReturnType<typeof createClient>>, userId: string, path: string | null) {
  if (!path || !path.startsWith(`${userId}/`)) return { bytes: null, httpStatus: null };
  const { data, error } = await supabase.storage.from('garments').download(path);
  if (error || !data) {
    const statusCode = error && typeof error === 'object' && 'statusCode' in error ? Number(error.statusCode) : NaN;
    return { bytes: null, httpStatus: Number.isInteger(statusCode) ? statusCode : null };
  }
  return { bytes: Buffer.from(await data.arrayBuffer()), httpStatus: 200 };
}

async function removeBackground(supabase: Awaited<ReturnType<typeof createClient>>, photo: Photo, processingJobId: string) {
  const format = (await sharp(photo.bytes).metadata()).format;
  const mime = format === 'jpeg' ? 'image/jpeg' : format === 'png' ? 'image/png' : format === 'webp' ? 'image/webp' : null;
  if (!mime) throw new Error('Formato de imagen no compatible para quitar el fondo.');
  const form = new FormData();
  form.set('image', new Blob([new Uint8Array(photo.bytes)], { type: mime }), `${photo.garment.id}.${format}`);
  form.set('processing_job_id', processingJobId);
  const { data, error } = await supabase.functions.invoke('remove-background', { body: form });
  if (error || !(data instanceof Blob) || !data.type.toLowerCase().includes('image/png')) {
    const context = error?.context;
    if (context instanceof Response) {
      const status = context.status;
      let message = '';
      try { const payload = await context.clone().json(); if (typeof payload.error === 'string') message = payload.error; } catch { /* use a safe status message */ }
      if (message) throw new Error(message);
      if (status === 402) throw new Error('Clipdrop no tiene créditos disponibles para quitar el fondo. Puedes subir una imagen con fondo transparente.');
      if (status === 429) throw new Error('Se alcanzó el límite de procesamiento de Clipdrop. Inténtalo más tarde o sube una imagen transparente.');
      if (status === 503) throw new Error('Clipdrop no está configurado en Supabase. No se procesó esta fotografía.');
    }
    throw new Error('Clipdrop no pudo quitar el fondo. Puedes subir una imagen con fondo transparente e intentarlo de nuevo.');
  }
  const result = Buffer.from(await data.arrayBuffer());
  if (!(await hasRealTransparency(result))) throw new Error('El resultado no tiene transparencia válida. No se creó el collage para evitar mostrar la foto con su fondo.');
  return result;
}

async function collageProcessingJobId(requestId: string, garmentId: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${requestId}:${garmentId}`));
  const bytes = new Uint8Array(digest).slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  let stage = 'start';
  logCollage(requestId, stage);
  try {
    stage = 'supabase_config';
    if (!hasSupabaseConfig()) return NextResponse.json({ error: 'Supabase no está configurado.' }, { status: 503 });
    stage = 'create_supabase_client';
    const supabase = await createClient();
    stage = 'auth';
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      logCollage(requestId, stage, { authenticated: false });
      return NextResponse.json({ error: 'Inicia sesión para crear tu composición.' }, { status: 401 });
    }
    logCollage(requestId, stage, { authenticated: true });

    stage = 'request_body';
    let body: { outfit_id?: unknown; request_id?: unknown; diagnostic_mode?: unknown };
    try { body = await request.json(); } catch { return NextResponse.json({ error: 'La solicitud no es válida.' }, { status: 400 }); }
    if (typeof body.outfit_id !== 'string' || !UUID.test(body.outfit_id)) return NextResponse.json({ error: 'Selecciona un outfit válido.' }, { status: 400 });
    const processingRequestId = typeof body.request_id === 'string' && UUID.test(body.request_id) ? body.request_id : crypto.randomUUID();
    const diagnosticMode = body.diagnostic_mode === true;
    const allowClipdrop = !diagnosticMode;
    logCollage(requestId, stage, { validOutfitId: true, allowClipdrop, diagnosticMode });

    stage = 'outfit_lookup';
    const { data: outfit, error: outfitError } = await supabase.from('outfits').select('id,name').eq('id', body.outfit_id).eq('user_id', user.id).maybeSingle();
    if (outfitError) return NextResponse.json({ error: 'No se pudo consultar el outfit.' }, { status: 500 });
    if (!outfit) return NextResponse.json({ error: 'No se encontró ese outfit en tu cuenta.' }, { status: 404 });
    logCollage(requestId, stage, { found: true });
    stage = 'outfit_items_lookup';
    const { data: links, error: linksError } = await supabase.from('outfit_items').select('garment_id,sort_order').eq('outfit_id', outfit.id).eq('user_id', user.id).order('sort_order');
    if (linksError) return NextResponse.json({ error: 'No se pudieron consultar las prendas.' }, { status: 500 });
    if (!links?.length || links.length > 12) return NextResponse.json({ error: 'El outfit debe tener entre 1 y 12 prendas.' }, { status: 400 });
    logCollage(requestId, stage, { garmentCount: links.length });
    stage = 'garments_lookup';
    const ids = links.map(link => link.garment_id);
    const { data: garments, error: garmentsError } = await supabase.from('garments').select('id,name,category,subcategory,original_path,processed_path').eq('user_id', user.id).in('id', ids);
    if (garmentsError) return NextResponse.json({ error: 'No se pudieron consultar las prendas.' }, { status: 500 });
    const byId = new Map((garments ?? []).map(item => [item.id, item]));
    const items = links.map(link => byId.get(link.garment_id));
    if (items.some(item => !item)) return NextResponse.json({ error: 'Una o más prendas ya no están disponibles en tu cuenta.' }, { status: 422 });
    logCollage(requestId, stage, { foundGarmentCount: garments?.length ?? 0 });

    const photos: Photo[] = [];
    for (const [index, garment] of (items as Garment[]).entries()) {
      stage = 'storage_download';
      const paths = [...new Set([garment.processed_path, garment.original_path].filter((path): path is string => Boolean(path)))];
      let photo: Photo | null = null;
      for (const [pathIndex, path] of paths.entries()) {
        const download = await downloadOwnPhoto(supabase, user.id, path);
        const bytes = download.bytes;
        if (!bytes) {
          logCollage(requestId, stage, { garmentIndex: index + 1, pathIndex: pathIndex + 1, accessible: false, httpStatus: download.httpStatus });
          continue;
        }
        let transparent: boolean;
        try {
          transparent = await hasRealTransparency(bytes);
        } catch (error) {
          logCollage(requestId, 'sharp_inspection_failed', {
            garmentIndex: index + 1,
            bytes: bytes.length,
            errorType: error instanceof Error ? error.name : 'unknown',
          });
          continue;
        }
        const metadata = await sharp(bytes, { failOn: 'error', limitInputPixels: 40_000_000 }).metadata();
        logCollage(requestId, 'storage_image_received', {
          garmentIndex: index + 1,
          pathIndex: pathIndex + 1,
          bytes: bytes.length,
          format: metadata.format ?? null,
          width: metadata.width ?? null,
          height: metadata.height ?? null,
          hasAlpha: Boolean(metadata.hasAlpha),
          realTransparency: transparent,
        });
        if (transparent) { photo = { garment, bytes, transparent: true }; break; }
        if (!photo || path === garment.original_path) photo = { garment, bytes, transparent: false };
      }
      if (!photo) return NextResponse.json({ error: `No se puede acceder a la fotografía privada de “${garment.name || 'una prenda'}”. Revisa su imagen en tu Closet.` }, { status: 422 });
      photos.push(photo);
    }

    const opaque = photos.filter(photo => !photo.transparent);
    logCollage(requestId, 'transparency_check', { photoCount: photos.length, opaqueCount: opaque.length, allowClipdrop, diagnosticMode });
    if (opaque.length && allowClipdrop) {
      try {
        stage = 'clipdrop_remove_background';
        for (const [index, photo] of opaque.entries()) {
          photo.bytes = await removeBackground(supabase, photo, await collageProcessingJobId(processingRequestId, photo.garment.id));
          logCollage(requestId, 'clipdrop_result', { garmentIndex: index + 1, bytes: photo.bytes.length, transparent: true });
        }
      } catch (error) {
        logCollage(requestId, stage + '_failed', { errorType: error instanceof Error ? error.name : 'unknown' });
        return NextResponse.json({ error: error instanceof Error ? error.message : 'No se pudo quitar el fondo. Sube imágenes con transparencia para continuar.' }, { status: 502 });
      }
    }

    stage = 'sharp_layer_composition';
    const composition = await composeCollage(photos);
    const { png, width, height, placements } = composition;
    logCollage(requestId, stage, { layerCount: placements.length, width, height });
    if (!(await hasVisibleCollageContent(png, width, height))) {
      logCollage(requestId, 'png_rejected_no_visible_content', { bytes: png.length, width, height });
      return NextResponse.json({
        code: 'collage_no_visible_content',
        error: 'La composición no contiene suficiente detalle visible sobre el lienzo blanco. Revisa las fotos o prueba con imágenes que tengan más contraste.',
      }, { status: 422 });
    }
    logCollage(requestId, 'png_created', { bytes: png.length, width, height, format: 'png' });
    const safeName = String(outfit.name || 'outfit').normalize('NFKD').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'outfit';
    logCollage(requestId, 'response_sent', { status: 200, contentType: 'image/png', bytes: png.length, diagnosticMode });
    return new NextResponse(new Uint8Array(png), { headers: { 'Content-Type': 'image/png', 'Content-Disposition': `attachment; filename="${safeName}-composicion.png"`, 'Cache-Control': 'private, no-store', 'X-Image-Width': String(width), 'X-Image-Height': String(height), 'X-Collage-Mode': diagnosticMode ? 'diagnostic' : 'final' } });
  } catch (error) {
    logCollage(requestId, stage + '_failed', { errorType: error instanceof Error ? error.name : 'unknown' });
    return NextResponse.json({ error: 'No se pudo crear la composición. Comprueba que las imágenes de tu outfit estén disponibles.' }, { status: 500 });
  }
}


