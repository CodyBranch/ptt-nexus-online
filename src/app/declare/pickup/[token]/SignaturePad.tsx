'use client';

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';

export interface SignaturePadHandle {
  /** The drawing as a PNG data URL, or null when nothing was drawn. */
  value: () => string | null;
  clear: () => void;
}

/**
 * A box to sign in with a finger, a stylus or a mouse. Drawn in black on
 * white whatever the page's theme, so the PNG kept reads the same printed.
 * Kept small (about 600 x 200) so a signature is a few kilobytes.
 */
const SignaturePad = forwardRef<SignaturePadHandle, { onChange?: (drawn: boolean) => void }>(function SignaturePad({ onChange }, ref) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [drawn, setDrawn] = useState(false);

  const reset = useCallback(() => {
    const c = canvas.current;
    if (!c) return;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    setDrawn(false);
    onChange?.(false);
  }, [onChange]);

  useEffect(() => { reset(); }, [reset]);

  useImperativeHandle(ref, () => ({
    value: () => (drawn && canvas.current ? canvas.current.toDataURL('image/png') : null),
    clear: reset,
  }), [drawn, reset]);

  const at = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = canvas.current!;
    const r = c.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * c.width, y: ((e.clientY - r.top) / r.height) * c.height };
  };

  return (
    <div>
      <canvas
        ref={canvas}
        width={600}
        height={200}
        aria-label="Sign here"
        className="block w-full touch-none rounded-lg bg-white ring-1 ring-gray-600"
        style={{ aspectRatio: '3 / 1' }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drawing.current = true;
          last.current = at(e);
        }}
        onPointerMove={(e) => {
          if (!drawing.current || !last.current) return;
          const p = at(e);
          const ctx = canvas.current!.getContext('2d')!;
          ctx.beginPath();
          ctx.moveTo(last.current.x, last.current.y);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
          last.current = p;
          if (!drawn) { setDrawn(true); onChange?.(true); }
        }}
        onPointerUp={() => { drawing.current = false; last.current = null; }}
        onPointerCancel={() => { drawing.current = false; last.current = null; }}
      />
      <div className="mt-1 flex items-center justify-between text-xs text-gray-500">
        <span>Sign above</span>
        <button type="button" onClick={reset} className="rounded px-2 py-1 text-gray-300 ring-1 ring-gray-700 hover:bg-gray-800">Clear</button>
      </div>
    </div>
  );
});

export default SignaturePad;
