import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { computeReputation } from '@/lib/reputation/attestation-engine';
import { isValidDid } from '@/lib/reputation/crypto';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

function generateBadgeSvg(taskCount: number, acceptedRate: number, flagged: boolean): string {
  const label = 'CPR Score';
  const scoreText = taskCount === 0
    ? 'no data'
    : `${(acceptedRate * 100).toFixed(0)}% · ${taskCount} tasks`;

  const labelColor = '#555';
  const valueColor = flagged
    ? '#e05d44'
    : acceptedRate >= 0.9
      ? '#4c1'
      : acceptedRate >= 0.7
        ? '#dfb317'
        : '#e05d44';

  const labelWidth = label.length * 7 + 12;
  const valueWidth = scoreText.length * 6.5 + 12;
  const totalWidth = labelWidth + valueWidth;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="20" role="img" aria-label="${label}: ${scoreText}">
  <title>${label}: ${scoreText}</title>
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r">
    <rect width="${totalWidth}" height="20" rx="3" fill="#fff"/>
  </clipPath>
  <g clip-path="url(#r)">
    <rect width="${labelWidth}" height="20" fill="${labelColor}"/>
    <rect x="${labelWidth}" width="${valueWidth}" height="20" fill="${valueColor}"/>
    <rect width="${totalWidth}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="11">
    <text aria-hidden="true" x="${labelWidth / 2}" y="15" fill="#010101" fill-opacity=".3">${label}</text>
    <text x="${labelWidth / 2}" y="14">${label}</text>
    <text aria-hidden="true" x="${labelWidth + valueWidth / 2}" y="15" fill="#010101" fill-opacity=".3">${scoreText}</text>
    <text x="${labelWidth + valueWidth / 2}" y="14">${scoreText}</text>
  </g>
</svg>`;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ did: string }> }
) {
  try {
    const { did } = await params;
    const agentDid = decodeURIComponent(did);

    if (!isValidDid(agentDid)) {
      const svg = generateBadgeSvg(0, 0, false);
      return new NextResponse(svg, {
        headers: {
          'Content-Type': 'image/svg+xml',
          'Cache-Control': 'public, max-age=300',
        },
      });
    }

    const reputation = await computeReputation(supabase, agentDid);
    const allTime = reputation.windows.all_time;
    const svg = generateBadgeSvg(
      allTime.task_count,
      allTime.accepted_rate,
      reputation.anti_gaming.flagged
    );

    return new NextResponse(svg, {
      headers: {
        'Content-Type': 'image/svg+xml',
        'Cache-Control': 'public, max-age=300',
      },
    });
  } catch (error) {
    console.error('Badge generation error:', error);
    const svg = generateBadgeSvg(0, 0, false);
    return new NextResponse(svg, {
      headers: { 'Content-Type': 'image/svg+xml' },
      status: 500,
    });
  }
}
