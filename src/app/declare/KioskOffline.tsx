'use client';

import { useEffect, useState } from 'react';

/**
 * The meet tablet's "lost sync" banner, and its offline helper.
 *
 * Only inside the PTT Nexus Tablet app (its user agent says PTTNexusTablet):
 * there the declare pages register /kiosk-sw.js, which keeps the last copy of
 * each page and holds a coach's answers while the Wi-Fi is down. This shows
 * when the page is that last copy, and how many changes are waiting to send.
 * On anyone else's phone it does nothing at all.
 */
export default function KioskOffline() {
  const [on, setOn] = useState(false);
  const [staleAt, setStaleAt] = useState<string | null>(null);
  const [held, setHeld] = useState(0);
  const [refused, setRefused] = useState(0);

  useEffect(() => {
    if (!/PTTNexusTablet/.test(navigator.userAgent) || !('serviceWorker' in navigator)) return;
    setOn(true);
    void navigator.serviceWorker.register('/kiosk-sw.js', { scope: '/declare/' }).catch(() => { /* the page still works online */ });

    const onMessage = (e: MessageEvent) => {
      const m = e.data as { type?: string; at?: string | null; held?: number; refused?: number };
      if (m?.type === 'kiosk-live') setStaleAt(null);
      if (m?.type === 'kiosk-stale') setStaleAt(m.at ?? 'unknown');
      if (m?.type === 'kiosk-queue') {
        setHeld(m.held ?? 0);
        setRefused(m.refused ?? 0);
      }
    };
    navigator.serviceWorker.addEventListener('message', onMessage);

    const ask = (what: string) => navigator.serviceWorker.controller?.postMessage(what);
    ask('kiosk-status');
    // The service worker cannot wake itself when the Wi-Fi returns; the page asks.
    const t = setInterval(() => ask('kiosk-flush'), 15_000);
    const back = () => ask('kiosk-flush');
    window.addEventListener('online', back);
    return () => {
      navigator.serviceWorker.removeEventListener('message', onMessage);
      clearInterval(t);
      window.removeEventListener('online', back);
    };
  }, []);

  if (!on || (!staleAt && !held && !refused)) return null;

  const since = staleAt && staleAt !== 'unknown'
    ? new Date(staleAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 space-y-1 border-t border-amber-700/50 bg-gray-950/95 px-4 py-2 text-sm text-amber-200" role="status">
      {staleAt && <p>Lost sync with Nexus Online. Showing what this tablet last had{since ? `, from ${since}` : ''}.</p>}
      {held > 0 && (
        <p>
          {held} {held === 1 ? 'change is' : 'changes are'} waiting to send. {held === 1 ? 'It goes' : 'They go'} to the meet as soon as the
          tablet is back online.
        </p>
      )}
      {refused > 0 && (
        <p className="text-red-300">
          {refused} {refused === 1 ? 'change was' : 'changes were'} turned down by the meet when sent late (a race full or closed, or a
          label not in this meet). Ask the meet office.{' '}
          <button type="button" className="underline" onClick={() => navigator.serviceWorker.controller?.postMessage('kiosk-clear-refused')}>
            OK
          </button>
        </p>
      )}
    </div>
  );
}
