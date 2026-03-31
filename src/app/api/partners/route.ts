import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/server';

const EXCLUDED_NAMES = ['test business', 'test', '.', ''];

export async function GET() {
  try {
    const supabase = getSupabaseAdmin();

    const { data: businesses, error } = await supabase
      .from('businesses')
      .select('id, name, description, webhook_url, logo_url')
      .eq('active', true)
      .not('webhook_url', 'is', null)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Failed to fetch partners:', error);
      return NextResponse.json({ partners: [] });
    }

    const partners = (businesses || [])
      .filter((b) => {
        const name = (b.name || '').trim();
        if (!name || EXCLUDED_NAMES.includes(name.toLowerCase())) return false;
        try {
          new URL(b.webhook_url);
          return true;
        } catch {
          return false;
        }
      })
      .map((b) => {
        const parsed = new URL(b.webhook_url);
        const baseUrl = `${parsed.protocol}//${parsed.host}`;
        return {
          name: b.name.trim(),
          url: baseUrl,
          description: b.description || null,
          logo_url: b.logo_url || null,
        };
      });

    return NextResponse.json({ partners });
  } catch (err) {
    console.error('Partners API error:', err);
    return NextResponse.json({ partners: [] });
  }
}
