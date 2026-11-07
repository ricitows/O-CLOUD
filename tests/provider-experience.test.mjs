import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('garment UI uses generic consent and neutral original-image fallback copy', async () => {
  const ui = await read('../src/components/garments/GarmentCloset.tsx');
  const route = await read('../src/app/api/garments/route.ts');
  assert.match(ui, /Autorizo el procesamiento externo, que puede generar costos, para mejorar esta imagen/);
  assert.doesNotMatch(ui, /Clipdrop|créditos|API/);
  assert.match(route, /form\.get\('allow_paid'\) === 'yes'/);
  assert.doesNotMatch(route, /NODE_ENV === 'development'/);
  assert.match(route, /La prenda se guardó\. La imagen original se conserva\./);
  assert.doesNotMatch(route, /Clipdrop devolvió|remove-background no está desplegada/);
  assert.ok(route.indexOf("storage.from('garments').upload(objectPath") < route.indexOf("functions.invoke('remove-background'"));
});

test('stylist UI keeps explicit generic consent and never renders provider failure details', async () => {
  const ui = await read('../src/components/stylist/WeatherStylist.tsx');
  const route = await read('../src/app/api/stylist/route.ts');
  assert.match(ui, /Autorizo el procesamiento externo, que puede generar costos, para preparar una recomendación avanzada/);
  assert.doesNotMatch(ui, /OpenAI|créditos|API/);
  assert.match(ui, /No pudimos generar sugerencias en este momento\. Inténtalo más tarde\./);
  assert.match(route, /const allowPaid = body\.allow_paid === true/);
  assert.doesNotMatch(route, /NODE_ENV === 'development'/);
  assert.match(route, /Preparamos una sugerencia alternativa con prendas de tu Closet\./);
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

test('final collage requires generic cost consent before any external background processing', async () => {
  const ui = await read('../src/components/outfits/VirtualTryOn.tsx');
  const route = await read('../src/app/api/collage/route.ts');
  assert.match(ui, /Autorizo el procesamiento externo, que puede generar costos/);
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
