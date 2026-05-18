import type { Session } from './auth.server';

export function isAdminSession(session: Session | null | undefined): boolean {
  const configuredAdminEmail = import.meta.env.ADMIN_EMAIL?.trim().toLowerCase();
  if (!configuredAdminEmail) return false;

  const sessionEmail = session?.user?.email?.trim().toLowerCase();
  return sessionEmail === configuredAdminEmail;
}
