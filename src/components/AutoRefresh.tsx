'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Keeps a server-rendered page current without anybody pressing reload.
 *
 * The Declarations pages are watched while coaches are answering; a page that
 * shows the state of an hour ago reads as "nobody has opened it". Re-rendered
 * from the server every `seconds` while the tab is visible — a school opened
 * on the page stays open, because a refresh keeps what is on screen and swaps
 * only the data.
 */
export default function AutoRefresh({ seconds = 15 }: { seconds?: number }) {
  const router = useRouter();
  const [at, setAt] = useState(() => new Date());

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== 'visible') return;
      router.refresh();
      setAt(new Date());
    };
    const t = setInterval(tick, seconds * 1000);
    // Coming back to the tab after a while: bring it up to date at once.
    const onShow = () => { if (document.visibilityState === 'visible') tick(); };
    document.addEventListener('visibilitychange', onShow);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onShow); };
  }, [router, seconds]);

  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-gray-500" title={`Updates every ${seconds} seconds while this tab is open`}>
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
      Live · updated {at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}
    </span>
  );
}
