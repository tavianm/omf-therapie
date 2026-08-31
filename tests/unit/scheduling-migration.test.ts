import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('scheduling buffer migration', () => {
  it('excludes historical appointments from settings conflicts and bound refreshes', () => {
    const migration = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/015_scheduling_settings.sql'),
      'utf8',
    );
    expect(migration).toContain(
      "+ new_buffer_minutes * interval '1 minute' > now()",
    );
    expect(migration).toContain('WHERE scheduled_at + duration * interval');
  });
});
