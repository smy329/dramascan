/**
 * Maintenance mode module.
 *
 * Allows Super Admin to enable/disable manual maintenance mode.
 * During maintenance mode, a configurable public page is shown to viewers,
 * while authorized administrators retain access to the admin interface.
 *
 * Do not implement maintenance scheduling or recurring maintenance publication.
 */

import 'server-only';

import { eq } from 'drizzle-orm';

import { db } from '@/db/client';
import { requirePermission, type ActorContext } from '@/modules/authorization';

import { system_settings } from './schema';
import { admin_audit_log } from './schema';

/** Maintenance mode state. */
export type MaintenanceMode = 'enabled' | 'disabled';

/** Check if maintenance mode is currently enabled. */
export async function isMaintenanceMode(): Promise<MaintenanceMode> {
  const setting = await db
    .select({
      value: system_settings.value,
    })
    .from(system_settings)
    .where(eq(system_settings.key, 'maintenance_mode'))

  const row = setting[0]

  if (!row || !row.value) {
    return 'disabled'
  }

  return row.value === 'enabled' ? 'enabled' : 'disabled'
}

/**
 * Enable maintenance mode.
 * Only Super Admin can enable maintenance mode.
 *
 * @param actor The administrator enabling maintenance mode.
 * @param message The public message to display during maintenance.
 * @param estimatedReturn Optional estimated return time (ISO 8601 string).
 */
export async function enableMaintenanceMode(
  actor: ActorContext,
  message: string,
  estimatedReturn?: string
): Promise<{ success: boolean; previousMode: MaintenanceMode }> {
  requirePermission(actor, 'admin.manage')

  // Get previous mode
  const previousMode = await isMaintenanceMode()

  // Update the maintenance mode setting
  await db
    .insert(system_settings)
    .values({
      key: 'maintenance_mode',
      value: 'enabled',
      description: message,
      updated_by: actor.userId,
      updated_at: new Date(),
    })
    .onConflictDoUpdate({
      target: system_settings.key,
      set: {
        value: 'enabled',
        description: message,
        updated_by: actor.userId,
        updated_at: new Date(),
      },
    })

    // Record audit event
    await db
      .insert(admin_audit_log)
      .values({
        actor_id: actor.userId,
        action: 'maintenance_mode_enabled',
        entity_type: 'system',
        entity_id: null,
        summary: 'Maintenance mode enabled',
        metadata: {
          message,
          estimatedReturn,
          changedBy: actor.userId,
        },
      })

    return { success: true, previousMode }
}

/**
 * Disable maintenance mode.
 * Only Super Admin can disable maintenance mode.
 *
 * @param actor The administrator disabling maintenance mode.
 * @param message Optional new maintenance message (empty to clear).
 */
export async function disableMaintenanceMode(
  actor: ActorContext,
  message?: string
): Promise<{ success: boolean; previousMode: MaintenanceMode }> {
  requirePermission(actor, 'admin.manage')

  // Get previous mode
  const previousMode = await isMaintenanceMode()

  // Update or remove the maintenance mode setting
  if (message && message.trim()) {
    // Keep maintenance mode on with new message
    await db
      .insert(system_settings)
      .values({
        key: 'maintenance_mode',
        value: 'enabled',
        description: message,
        updated_by: actor.userId,
        updated_at: new Date(),
      })
      .onConflictDoUpdate({
        target: system_settings.key,
        set: {
          value: 'enabled',
          description: message,
          updated_by: actor.userId,
          updated_at: new Date(),
        },
      })
    } else {
    // Remove maintenance mode setting
    await db
      .delete(system_settings)
      .where(eq(system_settings.key, 'maintenance_mode'))
    }

    // Record audit event
    await db
      .insert(admin_audit_log)
      .values({
        actor_id: actor.userId,
        action: 'maintenance_mode_disabled',
        entity_type: 'system',
        entity_id: null,
        summary: 'Maintenance mode disabled',
        metadata: {
          changedBy: actor.userId,
        },
      })

    return { success: true, previousMode }
}

/**
 * Get the current maintenance mode message and estimated return time.
 */
export async function getMaintenanceInfo() {
  const setting = await db
    .select({
      value: system_settings.value,
      description: system_settings.description,
    })
    .from(system_settings)
    .where(eq(system_settings.key, 'maintenance_mode'))

  const row = setting[0]

  if (!row || row.value !== 'enabled') {
    return { mode: 'disabled' as MaintenanceMode, message: null, estimatedReturn: null }
  }

  return {
    mode: 'enabled' as MaintenanceMode,
    message: row.description || 'Site is under maintenance',
    estimatedReturn: null, // Could be stored in a separate setting
  }
}

/**
 * Check if the current actor can access the admin interface during maintenance mode.
 */
export async function canAccessAdmin(actor: { userId: string; isSuperAdmin: boolean }): Promise<boolean> {
  // Super admins always have access
  if (actor.isSuperAdmin) {
    return true
  }

  // Non-super admins can only access if maintenance mode is not enabled.
  // `isMaintenanceMode()` returns a string ('enabled' | 'disabled'), which is
  // always truthy, so it must be compared explicitly rather than negated —
  // `!await isMaintenanceMode()` would be false for every non-super admin even
  // when the site is not in maintenance mode.
  const mode = await isMaintenanceMode()
  return mode === 'disabled'
}
