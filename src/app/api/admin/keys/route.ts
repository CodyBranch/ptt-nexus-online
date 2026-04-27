import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { desktopApiKeys } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { randomBytes } from 'crypto';

// ── GET /api/admin/keys ─────────────────────────────────────────────────────
// Returns all API keys (id, label, key masked, isActive, createdAt, lastUsedAt)

export async function GET() {
  try {
    const keys = await db
      .select({
        id: desktopApiKeys.id,
        label: desktopApiKeys.label,
        key: desktopApiKeys.key,
        isActive: desktopApiKeys.isActive,
        createdAt: desktopApiKeys.createdAt,
        lastUsedAt: desktopApiKeys.lastUsedAt,
      })
      .from(desktopApiKeys)
      .orderBy(desktopApiKeys.createdAt);

    return NextResponse.json({ keys });
  } catch (error) {
    console.error('Failed to list API keys:', error);
    return NextResponse.json({ error: 'Failed to list keys' }, { status: 500 });
  }
}

// ── POST /api/admin/keys ────────────────────────────────────────────────────
// Body: { label: string }
// Generates a new 32-char hex key and inserts it.

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { label?: string };
    const label = (body.label ?? '').trim();
    if (!label) {
      return NextResponse.json({ error: 'label is required' }, { status: 400 });
    }

    const key = randomBytes(16).toString('hex');

    const [row] = await db
      .insert(desktopApiKeys)
      .values({ label, key })
      .returning();

    return NextResponse.json({ key: row }, { status: 201 });
  } catch (error) {
    console.error('Failed to create API key:', error);
    return NextResponse.json({ error: 'Failed to create key' }, { status: 500 });
  }
}

// ── DELETE /api/admin/keys?id=<uuid> ───────────────────────────────────────
// Soft-delete (sets isActive = false).

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'id query param required' }, { status: 400 });
  }

  try {
    await db
      .update(desktopApiKeys)
      .set({ isActive: false })
      .where(eq(desktopApiKeys.id, id));

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Failed to revoke API key:', error);
    return NextResponse.json({ error: 'Failed to revoke key' }, { status: 500 });
  }
}
