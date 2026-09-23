import type { Metadata } from 'next';
import LoginForm from './LoginForm';
import { adminConfigured } from '@/lib/admin-auth';

// Says nothing about what is behind it.
export const metadata: Metadata = { title: 'Sign in' };

export const dynamic = 'force-dynamic';

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <h1 className="text-xl font-bold text-gray-100">PrimeTime Timing</h1>
        <p className="text-sm text-gray-500 mt-1 mb-6">Staff sign in.</p>
        {adminConfigured()
          ? <LoginForm />
          : (
            <div className="px-4 py-3 bg-amber-500/10 border border-amber-500/30 rounded text-sm text-amber-300">
              No admin password is set on this server, so nobody can sign in and nothing
              can be changed. Set <code className="font-mono">ADMIN_PASSWORD</code> in the
              environment and restart.
            </div>
          )}
      </div>
    </div>
  );
}
