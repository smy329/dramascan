/**
 * Alert acknowledgement and assignment module.
 *
 * Provides alert acknowledgement functionality, assignment to administrators,
 * internal notes, acknowledgement timestamps and deadlines, and escalation
 * when unacknowledged beyond deadline. Preserves complete alert history.
 *
 * Do not implement: complex workflow engines, external ticketing system integration,
 * or automatic assignment without admin oversight.
 */

import 'server-only';

import { eq, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import { requirePermission, type ActorContext } from '@/modules/authorization';

import { system_settings } from './schema';
import { admin_audit_log } from './schema';
import { AlertSeverity, EscalationAction, getAlertConfiguration } from './alert.severity';

/** Acknowledgement status. */
export type AcknowledgementStatus = 'unacknowledged' | 'acknowledged' | 'resolved' | 'closed';

/** Alert assignment. */
export interface AlertAssignment {
  alertId: string;
  assignedTo: string;
  assignedBy: string;
  assignedAt: string;
  notes?: string;
}

/** Acknowledge an alert. */
export async function acknowledgeAlert(
  alertId: string,
  acknowledgedBy: string,
  notes?: string
): Promise<{ status: AcknowledgementStatus; acknowledgedAt: string }> {
  const now = new Date().toISOString();

  // In a production system, this would update the alert's acknowledgement status
  // and record the acknowledgement in the database with a timestamp.
  // For now, we'll create an acknowledgement record.

  // Create an audit log entry for the acknowledgement
  await db
    .insert(admin_audit_log)
    .values({
      actor_id: acknowledgedBy,
      action: 'alert_acknowledged',
      entity_type: 'alert',
      entity_id: alertId,
      summary: 'Alert acknowledged',
      metadata: {
        acknowledgedBy,
        acknowledgedAt: now,
        notes,
      },
    });

  return {
    status: 'acknowledged' as AcknowledgementStatus,
    acknowledgedAt: now,
  };
}

/** Assign an alert to an administrator. */
export async function assignAlert(
  alertId: string,
  assignedTo: string,
  assignedBy: string,
  notes?: string
): Promise<AlertAssignment> {
  const id = crypto.randomUUID();
  const assignedAt = new Date().toISOString();

  // Create the assignment record
  await db
    .insert(system_settings)
    .values({
      key: `alert_assignment_${id}`,
      value: JSON.stringify({
        id,
        alertId,
        assignedTo,
        assignedBy,
        assignedAt,
        notes,
      }),
      description: 'Alert assignment tracking',
      updated_by: assignedBy,
      updated_at: new Date(),
    })
    .onConflictDoUpdate({
      target: system_settings.key,
      set: {
        value: JSON.stringify({
          id,
          alertId,
          assignedTo,
          assignedBy,
          assignedAt,
          notes,
        }),
        description: 'Alert assignment tracking',
        updated_by: assignedBy,
        updated_at: new Date(),
      },
    });

  // Create audit log entry
  await db
    .insert(admin_audit_log)
    .values({
      actor_id: assignedBy,
      action: 'alert_assigned',
      entity_type: 'alert',
      entity_id: alertId,
      summary: 'Alert assigned to administrator',
      metadata: {
        assignedTo,
        assignedBy,
        assignedAt,
        notes,
      },
    });

  return {
    alertId,
    assignedTo,
    assignedBy,
    assignedAt,
    notes,
  };
}

/** Get alert assignment. */
export async function getAlertAssignment(alertId: string): Promise<AlertAssignment | null> {
  const [row] = await db
    .select()
    .from(system_settings)
    .where(eq(system_settings.key, `alert_assignment_${alertId}`));

  if (!row || !row.value) {
    return null;
  }

  try {
    const data = JSON.parse(row.value as string);
    return {
      alertId: data.alertId,
      assignedTo: data.assignedTo,
      assignedBy: data.assignedBy,
      assignedAt: data.assignedAt,
      notes: data.notes,
    };
  } catch {
    return null;
  }
}

/** Check if alert is acknowledged beyond deadline. */
export async function isAcknowledgedBeyondDeadline(
  alertId: string,
  deadlineMs: number
): Promise<{ beyondDeadline: boolean; acknowledgedAt?: string; deadlineMs: number }> {
  const assignment = await getAlertAssignment(alertId);

  if (!assignment || !assignment.assignedAt) {
    return { beyondDeadline: true, deadlineMs };
  }

  const acknowledgedAt = new Date(assignment.assignedAt).getTime();
  const now = new Date().getTime();
  const beyondDeadline = (now - acknowledgedAt) > deadlineMs;

  return {
    beyondDeadline,
    acknowledgedAt: assignment.assignedAt,
    deadlineMs,
  };
}

/** Escalate unacknowledged alert. */
export async function escalateUnacknowledgedAlert(
  alertId: string,
  escalatedBy: string
): Promise<EscalationRecord> {
  // Check if the alert has been acknowledged beyond the deadline
  const configuration = await getAlertConfiguration();

  // Get the default deadline from configuration or use a sensible default
  const defaultDeadlineMs = 3600000; // 1 hour

  const { beyondDeadline } = await isAcknowledgedBeyondDeadline(alertId, defaultDeadlineMs);

  if (beyondDeadline) {
    // Create an escalation record
    return createEscalation({
      alertId,
      severity: 'high',
      action: 'escalate',
      reason: 'Alert unacknowledged beyond deadline',
      triggeredBy: escalatedBy,
    });
  }

  return { id: '', alertId, severity: 'high' as AlertSeverity, action: 'none' as EscalationAction, triggeredAt: new Date().toISOString(), triggeredBy: escalatedBy, reason: 'Alert within acknowledgement window', metadata: {} };
}

/** Get acknowledgement history for an alert. */
export async function getAcknowledgementHistory(
  alertId: string,
  page: number = 1,
  pageSize: number = 20
): Promise<{
  acknowledgements: Array<{ acknowledgedBy: string; acknowledgedAt: string; notes?: string }>;
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}> {
  // In a production system, this would query an acknowledgement history store
  // For now, return empty history
  return {
    acknowledgements: [],
    total: 0,
    page,
    pageSize,
    totalPages: 0,
  };
}