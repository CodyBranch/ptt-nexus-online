'use client';

import { useState } from 'react';

/**
 * A school's logo on the packet pages, drawn the dashboard's way: a light
 * logo on a white tile, a dark-ground one on gray, and the school's initials
 * in its color when there is no logo or it will not load.
 *
 * Through /logo-badge, not the file itself. The MSHSAA logos are 800x800
 * squares, and a list of 341 schools at full size is the weight that turned
 * the desk's all-races box sheet white (2026-11-02); a tablet at the packet
 * table has less memory than that laptop. Hosts the badge route will not
 * shrink are loaded as they are.
 */

export interface Badge {
  logoUrl: string | null;
  logoDarkUrl: string | null;
  color: string | null;
}

const SUPABASE = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';

function shrunk(url: string, size: number): string {
  try {
    const u = new URL(url);
    const ours = !!SUPABASE && u.hostname === new URL(SUPABASE).hostname && u.pathname.startsWith('/storage/v1/object/public/Logos/');
    const mshsaa = u.hostname === 'www.mshsaa.org' || u.hostname === 'mshsaa.org';
    if (u.protocol !== 'https:' || !(ours || mshsaa)) return url;
  } catch {
    return url;
  }
  // The route makes 64 and 128; 128 for anything drawn bigger than 40.
  return `/logo-badge?w=${size > 40 ? 128 : 64}&src=${encodeURIComponent(url)}`;
}

/** A school's color, when it is one a browser understands; otherwise none. */
function cssColor(c: string | null | undefined): string | null {
  const v = (c ?? '').trim();
  return /^#?[0-9a-f]{3}([0-9a-f]{3})?$/i.test(v) ? (v.startsWith('#') ? v : `#${v}`) : null;
}

export default function SchoolBadge({ name, badge, size = 28 }: { name: string; badge: Badge | null | undefined; size?: number }) {
  const dark = !!badge?.logoDarkUrl;
  const url = badge?.logoDarkUrl || badge?.logoUrl || null;
  // The shrunk copy first, then the file itself, then initials.
  const [stage, setStage] = useState<0 | 1 | 2>(0);
  const box = { width: size, height: size };
  if (!url || stage === 2) {
    const initials = name.replace(/^(The|University of)\s+/i, '').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
    const bg = cssColor(badge?.color);
    return (
      <span style={{ ...box, background: bg ?? undefined, fontSize: Math.max(10, Math.round(size * 0.36)) }}
        className={`inline-flex shrink-0 items-center justify-center rounded-md font-bold ${bg ? 'text-white' : 'bg-gray-800 text-gray-400'}`}>
        {initials}
      </span>
    );
  }
  const src = stage === 0 ? shrunk(url, size) : url;
  return (
    <span style={{ ...box, padding: Math.max(2, Math.round(size * 0.08)) }}
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-md ${dark ? 'bg-gray-800' : 'bg-white'}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- logos come from storage and school sites */}
      <img key={src} src={src} alt="" loading="lazy" className="max-h-full max-w-full object-contain"
        onError={() => setStage((s) => (s === 0 && src !== url ? 1 : 2))} />
    </span>
  );
}
