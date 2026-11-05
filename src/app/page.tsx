import { redirect } from 'next/navigation';
import Dashboard from './Dashboard';
import { createClient } from '@/lib/supabase/server';
import { hasSupabaseConfig } from '@/lib/supabase/env';

export default async function HomePage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const params = await searchParams;
  const supabaseConfigured = hasSupabaseConfig();
  if (!supabaseConfigured) return <Dashboard />;

  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect('/login');

  const { data: profile } = await supabase.from('profiles').select('display_name,username,avatar_path').eq('id', user.id).maybeSingle();
  const avatarPath = profile?.avatar_path?.startsWith(`${user.id}/avatars/`) ? profile.avatar_path : null;
  const { data: avatarImage } = avatarPath
    ? await supabase.storage.from('private-photos').createSignedUrl(avatarPath, 30 * 60)
    : { data: null };
  const { count: garmentCount } = await supabase.from('garments').select('id', { count: 'exact', head: true }).eq('user_id', user.id);
  const { count: outfitCount } = await supabase.from('outfits').select('id', { count: 'exact', head: true }).eq('user_id', user.id);
  const today = new Date().toISOString().slice(0, 10);
  const { data: nextEntry } = await supabase.from('outfit_calendar').select('outfit_id,outfit_date').eq('user_id', user.id).gte('outfit_date', today).order('outfit_date').limit(1).maybeSingle();
  const { data: nextOutfit } = nextEntry ? await supabase.from('outfits').select('id,name,occasion,season,description,is_favorite').eq('id', nextEntry.outfit_id).eq('user_id', user.id).maybeSingle() : { data: null };
  const { data: recentOutfitRecords } = await supabase.from('outfits').select('id,name,occasion,season,description,is_favorite').eq('user_id', user.id).order('created_at', { ascending: false }).limit(4);
  const outfitRecords = recentOutfitRecords ?? [];
  const featuredOutfitRecord = nextOutfit || outfitRecords[0] || null;
  const outfitIds = [...new Set([...(featuredOutfitRecord ? [featuredOutfitRecord.id] : []), ...outfitRecords.map(outfit => outfit.id)])];
  const { data: links } = outfitIds.length
    ? await supabase.from('outfit_items').select('outfit_id,garment_id,sort_order').eq('user_id', user.id).in('outfit_id', outfitIds).order('sort_order')
    : { data: [] };
  const garmentIds = [...new Set((links ?? []).map(link => link.garment_id))];
  const { data: garments } = garmentIds.length
    ? await supabase.from('garments').select('id,name,category,original_path,processed_path').eq('user_id', user.id).in('id', garmentIds)
    : { data: [] };
  const byId = new Map((garments ?? []).map(garment => [garment.id, garment]));
  const outfitItems = await Promise.all((links ?? []).map(async link => {
    const garment = byId.get(link.garment_id);
    if (!garment) return null;
    const imagePath = garment.processed_path || garment.original_path;
    const { data } = imagePath ? await supabase.storage.from('garments').createSignedUrl(imagePath, 30 * 60) : { data: null };
    return { outfit_id: link.outfit_id, item: { id: garment.id, name: garment.name, category: garment.category, image_url: data?.signedUrl ?? null } };
  }));
  const itemsByOutfit = new Map<string, NonNullable<(typeof outfitItems)[number]>['item'][] >();
  for (const entry of outfitItems) {
    if (!entry) continue;
    itemsByOutfit.set(entry.outfit_id, [...(itemsByOutfit.get(entry.outfit_id) ?? []), entry.item]);
  }
  const recentOutfits = outfitRecords.map(outfit => ({ ...outfit, items: itemsByOutfit.get(outfit.id) ?? [] }));
  const featuredOutfit = featuredOutfitRecord ? { ...featuredOutfitRecord, items: itemsByOutfit.get(featuredOutfitRecord.id) ?? [] } : undefined;
  return <Dashboard displayName={profile?.display_name || user.user_metadata?.display_name || ''} username={profile?.username || ''} avatarUrl={avatarImage?.signedUrl || ''} email={user.email || ''} garmentCount={garmentCount ?? 0} outfitCount={outfitCount || 0} nextOutfit={nextEntry && nextOutfit ? { name: nextOutfit.name, date: nextEntry.outfit_date } : undefined} featuredOutfit={featuredOutfit} recentOutfits={recentOutfits} supabaseConfigured processorAvailable={supabaseConfigured} tripoAvailable={supabaseConfigured} authError={params.error} authNotice={params.notice} />;
}
