import { describe, expect, it } from 'vitest';
import { isWideLandscapePanel } from '@/components/admin/admin-side-panel-utils';

describe('admin side panel layout contract', () => {
  it('uses a modal sheet for portrait and narrow layouts', () => {
    expect(isWideLandscapePanel(768, false)).toBe(false);
    expect(isWideLandscapePanel(900, true)).toBe(false);
  });

  it('uses a complementary master-detail panel only on wide landscape', () => {
    expect(isWideLandscapePanel(1024, true)).toBe(true);
  });
});
