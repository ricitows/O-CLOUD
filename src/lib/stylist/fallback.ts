export type FallbackGarment = {
  id: string;
  name: string;
  category: string;
  subcategory: string | null;
  color: string | null;
  is_favorite: boolean;
};

type Weather = { temperature: number; apparentTemperature: number; precipitation: number; code: number; label: string };

export function fallbackPick(garments: FallbackGarment[], weather: Weather) {
  const favoritesFirst = [...garments].sort((a, b) => Number(b.is_favorite) - Number(a.is_favorite));
  const choose = (predicate: (item: FallbackGarment) => boolean) => favoritesFirst.find(predicate);
  const complete = choose(item => item.category === 'Prendas completas');
  const selected: FallbackGarment[] = [];
  if (complete) selected.push(complete);
  else {
    const layers = weather.temperature < 16 ? ['Abrigos', 'Chamarras', 'Suéteres', 'Cárdigans', 'Blusas', 'Camisas', 'Playeras', 'Tops'] : ['Playeras', 'Blusas', 'Camisas', 'Tops', 'Suéteres', 'Cárdigans', 'Chamarras', 'Abrigos'];
    const top = choose(item => item.category === 'Parte superior' && (!item.subcategory || layers.includes(item.subcategory))) || choose(item => item.category === 'Parte superior');
    const bottom = choose(item => item.category === 'Parte inferior');
    if (top) selected.push(top);
    if (bottom) selected.push(bottom);
  }
  const shoes = choose(item => item.category === 'Calzado');
  const accessory = choose(item => item.category === 'Accesorios');
  if (shoes && selected.length < 4) selected.push(shoes);
  if (accessory && (weather.precipitation > 0 || weather.temperature < 12) && selected.length < 4) selected.push(accessory);
  if (selected.length < 2) {
    for (const item of favoritesFirst) if (!selected.some(existing => existing.id === item.id) && selected.length < 3) selected.push(item);
  }
  return selected;
}
