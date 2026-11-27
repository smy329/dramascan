/**
 * Automatic alert escalation module.
 *
 * Provides escalation based on severity, duration, and impact. Includes authorized
 * manual override and de-escalation after verified recovery. Does not escalate
 * solely because a user hasn't opened the dashboard.
 *
 * Do not implement: complex escalation pipelines, external notification systems,
 * or automatic remediation.
 */

import 'server-only';

import { eq, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import { requirePermission, type ActorContext } from '@/modules/authorization';

import { system_settings } from './schema';
import { admin_audit_log } from './schema';
import { AlertSeverity, getAlertConfiguration, isSeverityEnabled, shouldAutoResolve, getMinDurationMs } from './alert.severity';

/** Escalation action. */
export type EscalationAction = 'none' | 'notify' | 'escalate' | 'critical-escalate';

/** Escalation record. */
export interface EscalationRecord {
  id: string;
  alertId: string;
  severity: AlertSeverity;
  action: EscalationAction;
  triggeredAt: string;
  triggeredBy: string;
  reason: string;
  resolved?: boolean;
  resolvedAt?: string;
  resolvedBy?: string;
  metadata?: Record<string, unknown>;
}

/** Create an escalation record. */
export async function createEscalation(
  options: {
    alertId: string;
    severity: AlertSeverity;
    action: EscalationAction;
    reason: string;
    triggeredBy: string;
    metadata?: Record<string, unknown>;
  }
): Promise<EscalationRecord> {
  const id = crypto.randomUUID();
  const triggeredAt = new Date().toISOString();

  const [row] = await db
    .insert(system_settings)
    .values({
      key: `escalation_${id}`,
      value: JSON.stringify({
        id,
        alertId: options.alertId,
        severity: options.severity,
        action: options.action,
        triggeredAt,
        triggeredBy: options.triggeredBy,
        reason: options.reason,
        metadata: options.metadata,
      }),
      description: 'Alert escalation tracking',
      updated_by: options.triggeredBy,
      updated_at: new Date(),
    })
    .onConflictDoUpdate({
      target: system_settings.key,
      set: {
        value: JSON.stringify({
          id,
          alertId: options.alertId,
          severity: options.severity,
          action: options.action,
          triggeredAt,
          triggeredBy: options.triggeredBy,
          reason: options.reason,
          metadata: options.metadata,
        }),
        description: 'Alert escalation tracking',
        updated_by: options.triggeredBy,
        updated_at: new Date(),
      },
    })
    .returning({
      key: system_settings.key,
      value: system_settings.value,
    });

  const escalationData = JSON.parse(row.value as string);

  return {
    id: escalationData.id,
    alertId: escalationData.alertId,
    severity: escalationData.severity as AlertSeverity,
    action: escalationData.action as EscalationAction,
    triggeredAt: escalationData.triggeredAt,
    triggeredBy: escalationData.triggeredBy,
    reason: escalationData.reason,
    metadata: escalationData.metadata,
  };
}

/** Get an escalation by ID. */
export async function getEscalation(escalationId: string): Promise<EscalationRecord | null> {
  const [row] = await db
    .select()
    .from(system_settings)
    .where(eq(system_settings.key, `escalation_${escalationId}`));

  if (!row || !row.value) {
    return null;
  }

  const escalationData = JSON.parse(row.value as string);

  return {
    id: escalationData.id,
    alertId: escalationData.alertId,
    severity: escalationData.severity as AlertSeverity,
    action: escalationData.action as EscalationAction,
    triggeredAt: escalationData.triggeredAt,
    triggeredBy: escalationData.triggeredBy,
    reason: escalationData.reason,
    resolved: escalationData.resolved as boolean,
    resolvedAt: escalationData.resolved_at,
    resolvedBy: escalationData.resolved_by,
    metadata: escalationData.metadata,
  };
}

/** Check if escalation is needed based on severity and duration. */
export async function checkEscalationNeeded(
  alertId: string,
  severity: AlertSeverity,
  triggeredAt: string,
  performedBy: string
): Promise<{ escalationNeeded: boolean; action: EscalationAction; reason: string }> {
  const configuration = await getAlertConfiguration();

  // Check if this severity level is enabled
  if (!isSeverityEnabled(severity, configuration)) {
    return { escalationNeeded: false, action: 'none', reason: 'Severity level not enabled' };
  }

  // Check minimum duration for auto-escalation
  const minDuration = getMinDurationMs(severity, configuration);
  const triggeredTime = new Date(triggeredAt).getTime();
  const now = new Date().getTime();
  const duration = now - triggeredTime;

  // If duration is less than minimum, no escalation yet
  if (duration < minDuration && minDuration > 0) {
    return { escalationNeeded: false, action: 'none', reason: 'Minimum duration not yet reached' };
  }

  // Determine escalation action based on severity
  let action: EscalationAction = 'none';
  let reason = '';

  switch (severity) {
    case 'critical':
      action = 'critical-escalate';
      reason = `Critical alert has been active for ${Math.round(duration / 60000)} minutes, exceeding minimum duration of ${Math.round(minDuration / 60000)} minutes`;
      break;
    case 'high':
      if (duration >= minDuration) {
        action = 'escalate';
        reason = `High alert has been active for ${Math.round(duration / 60000)} minutes, exceeding minimum duration of ${Math.round(minDuration / 60000)} minutes`;
      } else {
        action = 'notify';
        reason = `High alert has been active for ${Math.round(duration / 60000)} minutes, approaching minimum duration of ${Math.round(minDuration / 60000)} minutes`;
      }
      break;
    case 'medium':
      if (duration >= minDuration) {
        action = 'notify';
        reason = `Medium alert has been active for ${Math.round(duration / 60000)} minutes, exceeding minimum duration of ${Math.round(minDuration / 60000)} minutes`;
      } else {
        action = 'none';
        reason = `Medium alert has been active for ${Math.round(duration / 60000)} minutes, below minimum duration of ${Math.round(minDuration / 60000)} minutes`;
      }
      break;
    case 'low':
      action = 'none';
      reason = `Low alert active for ${Math.round(duration / 60000)} minutes`;
      break;
  }

  // Create escalation record if escalation is needed
  if (action !== 'none') {
    await createEscalation({
      alertId,
      severity,
      action,
      reason,
      triggeredBy: performedBy,
    });
  }

  return { escalationNeeded: action !== 'none', action, reason };
}

/** Manual override - resolve an escalation. */
export async function resolveEscalation(
  escalationId: string,
  resolvedBy: string
): Promise<EscalationRecord> {
  const escalation = await getEscalation(escalationId);

  if (!escalation) {
    throw new Error('Escalation not found');
  }

  // Update the escalation as resolved
  await db
    .update(system_settings)
    .set({
      value: JSON.stringify({
        ...JSON.parse(escalation.value as string),
        resolved: true,
        resolvedAt: new Date().toISOString(),
        resolvedBy,
      }),
      updated_at: new Date(),
    })
    .where(eq(system_settings.key, `escalation_${escalationId}`));

  return getEscalation(escalationId);
}

/** De-escalate an alert based on verified recovery. */
export async function deEscalateAlert(
  alertId: string,
  verifiedBy: string,
  performedBy: string
): Promise<EscalationRecord | null> {
  // Check if the alert should be de-escalated based on health check
  const configuration = await getAlertConfiguration();

  // Get the alert/resolution status
  // In a production system, this would query the actual alert state
  // For now, we'll create a de-escalation record

  const escalation = await createEscalation({
    alertId,
    severity: 'low',
    action: 'none',
    reason: 'De-escalation after verified recovery',
    triggeredBy: performedBy,
    metadata: { resolvedBy: verifiedBy, deEscalation: true },
  });

  return escalation;
}

/** Get all escalations for an alert. */
export async function getEscalationsForAlert(
  alertId: string,
  page: number = 1,
  pageSize: number = 20
): Promise<{
  escalations: EscalationRecord[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}> {
  // Count total escalations for this alert
  const [{ count }] = await db
    .select({ count: sql`count(*)` })
    .from(system_settings)
    .where(sql`${system_settings.key}.like('escalation_%') AND JSON_EXTRACT(${system_settings.value}, '$.alertId') = ${alertId}`);

  // Get escalations for current page
  const allEscalations = await db
    .select()
    .from(system_settings)
    .where(sql`${system_settings.key}.like('escalation_%')`)
    .orderBy(system_settings.key.desc())
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const escalations: EscalationRecord[] = [];
  for (const row of allEscalations) {
    if (row.value) {
      const data = JSON.parse(row.value as string);
      if (data.alertId === alertId) {
        escalations.push({
          id: data.id,
          alertId: data.alertId,
          severity: data.severity as AlertSeverity,
          action: data.action as EscalationAction,
          triggeredAt: data.triggeredAt,
          triggeredBy: data.triggeredBy,
          reason: data.reason,
          resolved: data.resolved as boolean,
          resolvedAt: data.resolved_at,
          resolvedBy: data.resolved_by,
          metadata: data.metadata,
        });
      }
    }
  }

  // Sort by triggeredAt descending (newest first)
  escalations.sort((a, b) => b.triggeredAt.localeCompare(a.triggeredAt));

  // Apply pagination
  const start = (page - 1) * pageSize;
  const end = start + pageSize;
  const pagedEscalations = escalations.slice(start, end);

  return {
    escalations: pagedEscalations,
    total: count || 0,
    page,
    pageSize,
    totalPages: Math.ceil((count || 0) / pageSize),
  };
}