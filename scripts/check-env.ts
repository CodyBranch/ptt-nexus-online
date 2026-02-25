// Quick script to validate .env.local is configured properly
// Run with: npx tsx scripts/check-env.ts

import { config } from 'dotenv';
import { resolve } from 'path';

// Load .env.local from project root
config({ path: resolve(process.cwd(), '.env.local') });

const vars = [
  { key: 'NEXT_PUBLIC_SUPABASE_URL', hint: 'Settings > API > Project URL' },
  { key: 'NEXT_PUBLIC_SUPABASE_ANON_KEY', hint: 'Settings > API > anon public key' },
  { key: 'SUPABASE_SERVICE_ROLE_KEY', hint: 'Settings > API > service_role secret key' },
  { key: 'DATABASE_URL', hint: 'Settings > Database > Connection string (URI tab)' },
];

async function main() {
  console.log('\nChecking .env.local configuration...\n');

  let allGood = true;

  for (const { key, hint } of vars) {
    const val = process.env[key];
    if (!val || val.includes('your-') || val.includes('password')) {
      console.log(`[MISSING] ${key}`);
      console.log(`         Find it at: ${hint}\n`);
      allGood = false;
    } else {
      // Show a masked preview
      const preview = val.length > 20
        ? val.slice(0, 12) + '...' + val.slice(-6)
        : val.slice(0, 8) + '...';
      console.log(`[OK]     ${key} = ${preview}`);
    }
  }

  if (allGood) {
    console.log('\nAll environment variables are configured!\n');

    // Try a quick database connection test
    console.log('Testing database connection...');
    try {
      const postgres = (await import('postgres')).default;
      const sql = postgres(process.env.DATABASE_URL!, { prepare: false, connect_timeout: 10 });
      const result = await sql`SELECT current_database(), current_user, version()`;
      console.log(`[OK]     Connected to database: ${result[0].current_database}`);
      console.log(`         User: ${result[0].current_user}`);
      await sql.end();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(`[FAIL]   Database connection failed: ${message}`);
      console.log('         Check your DATABASE_URL and make sure the password is correct');
    }

    // Test Supabase client
    console.log('\nTesting Supabase client...');
    try {
      const { createClient } = await import('@supabase/supabase-js');
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      );
      const { error } = await supabase.auth.getSession();
      if (error) {
        console.log(`[WARN]   Supabase responded but with: ${error.message}`);
      } else {
        console.log('[OK]     Supabase client connected successfully');
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(`[FAIL]   Supabase client failed: ${message}`);
    }

    console.log('\nDone!\n');
  } else {
    console.log('\nSome variables are missing. Fill them in .env.local and run again.\n');
  }
}

main().catch(console.error);
