// Barrel for backward compatibility — prefer importing from auth.server.ts or auth.client.ts directly
export { auth, pool } from './auth.server';
export type { Session, User } from './auth.server';
export { authClient } from './auth.client';
