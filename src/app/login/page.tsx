import Image from 'next/image';
import type { Metadata } from 'next';
import LoginForm from './LoginForm';
import { authConfigured } from '@/lib/admin-auth';

// Says nothing about what is behind it.
export const metadata: Metadata = { title: 'Sign in' };

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  const configured = await authConfigured();
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <Image
          src="/PRIMETIME.png"
          alt="PrimeTime Timing"
          width={1586}
          height={250}
          priority
          className="w-56 h-auto mb-8"
        />
        <p className="text-sm text-gray-500 mb-6">Staff sign in.</p>
        {configured
          ? <LoginForm />
          : (
            <div className="px-4 py-3 bg-amber-500/10 border border-amber-500/30 rounded text-sm text-amber-300">
              Nobody can sign in yet: there are no accounts, and no{' '}
              <code className="font-mono">ADMIN_PASSWORD</code> is set on this server.
              Set one in the environment, sign in with it, and add people from there.
            </div>
          )}
      </div>
    </div>
  );
}
