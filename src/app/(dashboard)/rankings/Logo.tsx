'use client';

import { useState } from 'react';

/**
 * A school's logo at the size of a table row.
 *
 * A logo drawn for a dark background goes on the dashboard's dark; the
 * ordinary one goes on a white chip, which is what it was drawn for - put
 * straight on the dark, a navy wordmark disappears. No logo, or one that
 * fails to load, is a quiet placeholder rather than a broken image.
 */
export default function Logo({ url, darkUrl, name, size = 28 }: {
  url: string | null;
  darkUrl: string | null;
  name: string;
  size?: number;
}) {
  const src = darkUrl || url;
  const [failed, setFailed] = useState<string | null>(null);
  const box = { width: size, height: size };

  if (!src || failed === src) {
    const initials = name.replace(/^(The|University of)\s+/i, '').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
    return (
      <span style={box} title={src ? `${name}: the logo did not load` : `${name}: no logo`}
        className="inline-flex shrink-0 items-center justify-center rounded bg-gray-800 border border-dashed border-gray-700 text-[10px] font-semibold text-gray-500">
        {initials}
      </span>
    );
  }
  return (
    <span style={box}
      className={`inline-flex shrink-0 items-center justify-center rounded overflow-hidden p-0.5 ${darkUrl ? 'bg-gray-800' : 'bg-white'}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- logos come from storage and school sites */}
      <img src={src} alt="" loading="lazy" className="max-w-full max-h-full object-contain" onError={() => setFailed(src)} />
    </span>
  );
}
