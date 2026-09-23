'use server';

import { redirect } from 'next/navigation';
import { signIn, signOut } from '@/lib/admin-auth';

export async function signInAction(_prev: unknown, formData: FormData) {
  const email = String(formData.get('email') ?? '');
  const password = String(formData.get('password') ?? '');
  const result = await signIn(email, password);
  if (!result.ok) return { error: result.error ?? 'Could not sign in' };
  redirect('/dashboard');
}

export async function signOutAction() {
  await signOut();
  redirect('/login');
}
