import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  notificationPreferencesSchema,
  type NotificationPreferencesValues,
} from '@/lib/contracts/notification-preferences';

/**
 * The notification preference contract (CONVENTIONS §6.3/§6.4).
 *
 * The switches are edited in the browser and saved by a Server Action. The
 * schema is the single definition of what a valid switch set is: the form
 * validates against it, and the action re-validates against the same schema.
 * Two definitions would let the browser accept something the server rejects.
 *
 * The account/security switch has no field: the notification is mandatory, so
 * a payload that tries to switch it off is rejected rather than ignored.
 */

const CONTRACT_FILE = join(process.cwd(), 'src/lib/contracts/notification-preferences.ts');
const WORKFLOW_FILE = join(process.cwd(), 'src/workflows/notifications/preferences.ts');
const FORM_FILE = join(
  process.cwd(),
  'src/components/notifications/notification-preferences-form.tsx'
);

const VALID: NotificationPreferencesValues = {
  newEpisode: true,
  newDrama: false,
  newDramaSeason: true,
  websiteAnnouncement: false,
  globalInApp: true,
  globalPush: false,
};

describe('the notification preference contract', () => {
  it('accepts a complete switch set', () => {
    const parsed = notificationPreferencesSchema.safeParse(VALID);

    expect(parsed.success).toBe(true);
  });

  it('rejects a switch that is not a boolean', () => {
    const parsed = notificationPreferencesSchema.safeParse({ ...VALID, globalPush: 'yes' });

    expect(parsed.success).toBe(false);
  });

  it('rejects an unknown switch', () => {
    const parsed = notificationPreferencesSchema.safeParse({ ...VALID, accountSecurity: false });

    expect(parsed.success).toBe(false);
  });

  it('is the schema the Server Action validates with', () => {
    expect(existsSync(CONTRACT_FILE)).toBe(true);

    const workflow = readFileSync(WORKFLOW_FILE, 'utf8');

    expect(workflow).toContain('@/lib/contracts/notification-preferences');
    expect(workflow).not.toMatch(/const\s+preferenceInputSchema\s*=\s*z\./);
  });

  it('is the schema the form validates with', () => {
    const form = readFileSync(FORM_FILE, 'utf8');

    expect(form).toContain('@/lib/contracts/notification-preferences');
    expect(form).toContain('useForm');
    expect(form).toContain('zodResolver');
  });
});
