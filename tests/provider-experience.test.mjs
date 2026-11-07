import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('saving a garment uses the standing authorization and preserves neutral original-image fallback copy', async () => {
  const ui = await read('../src/components/garments/GarmentCloset.tsx');
  const route = await read('../src/app/api/garments/route.ts');
  assert.doesNotMatch(ui, /Autoriza|Autorizo|Clipdrop|créditos|API/);
  assert.match(ui, /data\.set\('allow_paid', 'yes'\)/);
  assert.match(route, /form\.get\('allow_paid'\) === 'yes'/);
  assert.doesNotMatch(route, /NODE_ENV === 'development'/);
  assert.match(route, /La prenda se guardó\. La imagen original se conserva\./);
  assert.doesNotMatch(route, /Clipdrop devolvió|remove-background no está desplegada/);
  assert.ok(route.indexOf("storage.from('garments').upload(objectPath") < route.indexOf("functions.invoke('remove-background'"));
});

test('stylist action uses standing authorization and silently falls back to JavaScript', async () => {
  const ui = await read('../src/components/stylist/WeatherStylist.tsx');
  const route = await read('../src/app/api/stylist/route.ts');
  assert.doesNotMatch(ui, /Autoriza|Autorizo|OpenAI|créditos|API/);
  assert.match(ui, /request_id: requestId, allow_paid: true/);
  assert.doesNotMatch(ui, /Preparamos una sugerencia alternativa/);
  assert.match(ui, /No pudimos generar sugerencias en este momento\. Inténtalo más tarde\./);
  assert.match(route, /const allowPaid = body\.allow_paid === true/);
  assert.doesNotMatch(route, /NODE_ENV === 'development'/);
  assert.doesNotMatch(route, /assistant_notice|Preparamos una sugerencia alternativa/);
  assert.match(route, /fallbackPick\(garments, weather\)/);
  assert.match(route, /\.eq\('user_id', user\.id\)/);
});

test('missing paid consent is rejected before provider invocation in server routes', async () => {
  const garments = await read('../src/app/api/garments/route.ts');
  const stylist = await read('../src/app/api/stylist/route.ts');
  assert.ok(garments.indexOf("if (!allowClipdrop)") < garments.indexOf("functions.invoke('remove-background'"));
  assert.match(stylist, /if \(!allowPaid\)[\s\S]{0,220}return NextResponse\.json/);
  assert.ok(stylist.indexOf('if (!allowPaid)') < stylist.indexOf("functions.invoke('garment-assistant'"));
});

test('final collage uses standing authorization only on manual action and preserves the free diagnostic mode', async () => {
  const ui = await read('../src/components/outfits/VirtualTryOn.tsx');
  const route = await read('../src/app/api/collage/route.ts');
  assert.doesNotMatch(ui, /Autoriza|Autorizo|Clipdrop|créditos|API/);
  assert.match(ui, /allow_paid: mode === 'final'/);
  assert.doesNotMatch(ui, /Clipdrop|créditos|API/);
  assert.match(route, /if \(opaque\.length && allowClipdrop\) \{\s*if \(body\.allow_paid !== true\)/);
  assert.ok(route.indexOf("body.allow_paid !== true") < route.indexOf('photo.bytes = await removeBackground'));
  assert.match(route, /No pudimos preparar los fondos para esta composición/);
  assert.doesNotMatch(route, /Clipdrop no tiene créditos|Clipdrop no está configurado/);
});

test('virtual try-on keeps both consent gates without exposing provider or credit details', async () => {
  const route = await read('../src/app/api/try-on/route.ts');
  assert.match(route, /if \(!allowPaid\)/);
  assert.match(route, /if \(!consent\)/);
  assert.match(route, /Autoriza el procesamiento externo, que puede generar costos/);
  assert.doesNotMatch(route, /return error\([^\n]*(?:FASHN|créditos|proveedor)/i);
  assert.doesNotMatch(route, /NextResponse\.json\(\{ error: '[^']*(?:FASHN|créditos|proveedor)/i);
});
