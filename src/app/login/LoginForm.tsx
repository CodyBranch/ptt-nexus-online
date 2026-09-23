'use client';

import { useActionState } from 'react';
import { signInAction } from './actions';

export default function LoginForm() {
  const [state, action, pending] = useActionState(signInAction, null as { error?: string } | null);

  return (
    <form action={action} className="space-y-3">
      <input
        type="password"
        name="password"
        autoFocus
        autoComplete="current-password"
        placeholder="Admin password"
        className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-sm text-gray-200"
      />
      {state?.error && (
        <p className="text-sm text-red-400">{state.error}</p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-sm rounded-lg transition-colors"
      >
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
