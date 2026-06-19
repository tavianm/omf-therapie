import { vi } from 'vitest';

// Must run before test files import their modules (setupFiles execute first).
// The algorithm under test is pure, but its module graph constructs a Supabase
// client on load — stub import.meta.env with inert values so the import
// resolves without real credentials.
vi.stubEnv('GOOGLE_CALENDAR_MOCK', 'false');
vi.stubEnv('SUPABASE_DATABASE_URL', 'http://localhost:54321');
vi.stubEnv('SUPABASE_ANON_KEY', 'test-anon-key');
vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key');
vi.stubEnv('GOOGLE_CALENDAR_ID', 'primary');
vi.stubEnv('BETTER_AUTH_SECRET', 'test-secret');
vi.stubEnv('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5432/test');
