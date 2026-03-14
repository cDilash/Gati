import { supabase } from './supabase';
import { User } from '@supabase/supabase-js';

/**
 * Sign up a new account (one-time, on first device).
 * Returns the user on success, or throws with a message.
 */
export async function signUp(
  email: string,
  password: string,
): Promise<{ user: User | null; error: string | null }> {
  const { data, error } = await supabase.auth.signUp({ email, password });

  if (error) {
    return { user: null, error: friendlyError(error.message) };
  }

  return { user: data.user, error: null };
}

/**
 * Sign in with existing account (on new device to restore).
 */
export async function signIn(
  email: string,
  password: string,
): Promise<{ user: User | null; error: string | null }> {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    return { user: null, error: friendlyError(error.message) };
  }

  return { user: data.user, error: null };
}

/**
 * Sign out and clear the session.
 */
export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}

/**
 * Check if the user has an active session.
 */
export async function isLoggedIn(): Promise<boolean> {
  const { data } = await supabase.auth.getSession();
  return data.session !== null;
}

/**
 * Get the current authenticated user, or null.
 * Uses getSession() (local storage read) rather than getUser() (network call).
 */
export async function getCurrentUser(): Promise<User | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user ?? null;
}

/**
 * Get the current user's ID, or null.
 * Uses getSession() so it works offline and without email confirmation.
 */
export async function getCurrentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user?.id ?? null;
}

/**
 * Listen for auth state changes (sign in, sign out, token refresh).
 * Returns an unsubscribe function.
 */
export function onAuthStateChange(
  callback: (event: string, user: User | null) => void,
) {
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    callback(event, session?.user ?? null);
  });
  return data.subscription.unsubscribe;
}

/** Map Supabase error messages to user-friendly text. */
function friendlyError(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes('invalid login')) return 'Invalid email or password.';
  if (lower.includes('email not confirmed'))
    return 'Please check your email to confirm your account.';
  if (lower.includes('already registered'))
    return 'An account with this email already exists. Try signing in.';
  if (lower.includes('password') && lower.includes('least'))
    return 'Password must be at least 6 characters.';
  if (lower.includes('network') || lower.includes('fetch'))
    return 'Network error. Check your internet connection.';
  return message;
}
