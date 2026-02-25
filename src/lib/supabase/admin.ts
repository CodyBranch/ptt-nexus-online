import { createClient } from '@supabase/supabase-js';

// Service role client — use only in server-side code (API routes, server actions)
// This bypasses RLS policies
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}
