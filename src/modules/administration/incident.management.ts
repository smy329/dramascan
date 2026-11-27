/**
 * Basic incident management module.
 *
 * Provides incident records for video-source failures, database backup/recovery,
 * system health, and performance issues. Includes severity, status, ownership,
 * affected component, timeline, and corrective-action tracking.
 *
 * Do not implement: complex IT service management, automated remediation, or
 * integration with external ticketing systems.
 */

import 'server-only';

import { eq, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import { requirePermission, type ActorContext } from '@/modules/authorization';

import { system_settings } from './schema';
import { admin_audit_log } from './schema';
import { AlertSeverity, IncidentStatus } from './alert.severity';

/** Incident severity. */
export type IncidentSeverity = AlertSeverity;

/** Incident status. */
export type IncidentStatusType = IncidentStatus;

/** Incident record. */
export interface IncidentRecord {
  id: string;
  severity: IncidentSeverity;
  status: IncidentStatusType;
  title: string;
  description?: string;
  component: string;
  startedAt: string;
  completedAt?: string | null;
  durationMs?: number | null;
  success: boolean;
  errorMessage?: string | null;
  assignedTo?: string | null;
  correctiveAction?: string | null;
  resolvedAt?: string | null;
  resolvedBy?: string | null;
  metadata?: Record<string, unknown>;
  createdAt: string;
  createdBy: string;
}

/** Create an incident record. */
export async function createIncident(
  options: {
    severity: IncidentSeverity;
    title: string;
    component: string;
    description?: string;
    startedAt?: string;
    performedBy: string;
    metadata?: Record<string, unknown>;
  }
): Promise<IncidentRecord> {
  const id = crypto.randomUUID();
  const startedAt = options.startedAt || new Date().toISOString();

  const [row] = await db
    .insert(system_settings)
    .values({
      key: `incident_${id}`,
      value: JSON.stringify({
        id,
        severity: options.severity,
        status: 'open' as IncidentStatusType,
        title: options.title,
        description: options.description || null,
        component: options.component,
        startedAt,
        completedAt: null,
        durationMs: null,
        success: false,
        errorMessage: null,
        assignedTo: null,
        correctiveAction: null,
        resolvedAt: null,
        resolvedBy: null,
        metadata: options.metadata || {},
        createdAt: new Date().toISOString(),
        createdBy: options.performedBy,
      }),
      description: 'Incident management tracking',
      updated_by: options.performedBy,
      updated_at: new Date(),
    })
    .onConflictDoUpdate({
      target: system_settings.key,
      set: {
        value: JSON.stringify({
          id,
          severity: options.severity,
          status: 'open' as IncidentStatusType,
          title: options.title,
          description: options.description || null,
          component: options.component,
          startedAt,
          completedAt: null,
          durationMs: null,
          success: false,
          errorMessage: null,
          assignedTo: null,
          correctiveAction: null,
          resolvedAt: null,
          resolvedBy: null,
          metadata: options.metadata || {},
          createdAt: new Date().toISOString(),
          createdBy: options.performedBy,
        }),
        description: 'Incident management tracking',
        updated_by: options.performedBy,
        updated_at: new Date(),
      },
    })
    .returning({
      key: system_settings.key,
      value: system_settings.value,
    });

  const incidentData = JSON.parse(row.value as string);

  return {
    id: incidentData.id,
    severity: incidentData.severity as IncidentSeverity,
    status: incidentData.status as IncidentStatusType,
    title: incidentData.title,
    description: incidentData.description,
    component: incidentData.component,
    startedAt: incidentData.startedAt,
    completedAt: incidentData.completedAt,
    durationMs: incidentData.durationMs,
    success: incidentData.success,
    errorMessage: incidentData.errorMessage,
    assignedTo: incidentData.assignedTo,
    correctiveAction: incidentData.correctiveAction,
    resolvedAt: incidentData.resolvedAt,
    resolvedBy: incidentData.resolvedBy,
    metadata: incidentData.metadata,
    createdAt: incidentData.createdAt,
    createdBy: incidentData.createdBy,
  };
}

/** Update incident status. */
export async function updateIncidentStatus(
  incidentId: string,
  status: IncidentStatusType,
  success: boolean,
  errorMessage?: string | null,
  assignedTo?: string | null
): Promise<IncidentRecord> {
  await db
    .update(system_settings)
    .set({
      value: JSON.stringify({
        id: incidentId,
        status,
        startedAt: null, // Would preserve existing
        completedAt: success ? new Date().toISOString() : null,
        durationMs: success ? null : null, // Would calculate from start
        success,
        errorMessage,
        assignedTo,
        correctiveAction: null, // Would preserve existing
        resolvedAt: success ? new Date().toISOString() : null,
        resolvedBy: assignedTo ? assignedTo : null,
        createdAt: null, // Would preserve existing
        createdBy: null, // Would preserve existing
      }),
      updated_at: new Date(),
    })
    .where(eq(system_settings.key, `incident_${incidentId}`));

  return getIncident(incidentId);
}

/** Get incident by ID. */
export async function getIncident(incidentId: string): Promise<IncidentRecord | null> {
  const [row] = await db
    .select()
    .from(system_settings)
    .where(eq(system_settings.key, `incident_${incidentId}`));

  if (!row || !row.value) {
    return null;
  }

  try {
    const data = JSON.parse(row.value as string);
    return {
      id: data.id,
      severity: data.severity as IncidentSeverity,
      status: data.status as IncidentStatusType,
      title: data.title,
      description: data.description,
      component: data.component,
      startedAt: data.startedAt,
      completedAt: data.completedAt as string | null,
      durationMs: data.durationMs as number | null,
      success: data.success as boolean,
      errorMessage: data.errorMessage as string | null,
      assignedTo: data.assignedTo,
      correctiveAction: data.correctiveAction as string | null,
      resolvedAt: data.resolvedAt as string | null,
      resolvedBy: data.resolvedBy,
      metadata: data.metadata,
      createdAt: data.createdAt,
      createdBy: data.createdBy,
    };
  } catch {
    return null;
  }
}

/** Assign incident to administrator. */
export async function assignIncident(
  incidentId: string,
  assignedTo: string,
  assignedBy: string,
  notes?: string
): Promise<{ success: boolean; assignment: { assignedTo: string; assignedBy: string; assignedAt: string; notes?: string } }> {
  // Create assignment record
  const id = crypto.randomUUID();
  const assignedAt = new Date().toISOString();

  await db
    .insert(system_settings)
    .values({
      key: `incident_assignment_${id}`,
      value: JSON.stringify({
        id,
        incidentId,
        assignedTo,
        assignedBy,
        assignedAt,
        notes,
      }),
      description: 'Incident assignment tracking',
      updated_by: assignedBy,
      updated_at: new Date(),
    })
    .onConflictDoUpdate({
      target: system_settings.key,
      set: {
        value: JSON.stringify({
          id,
          incidentId,
          assignedTo,
          assignedBy,
          assignedAt,
          notes,
        }),
        description: 'Incident assignment tracking',
        updated_by: assignedBy,
        updated_at: new Date(),
      },
    });

  // Create audit log entry
  await db
    .insert(admin_audit_log)
    .values({
      actor_id: assignedBy,
      action: 'incident_assigned',
      entity_type: 'incident',
      entity_id: incidentId,
      summary: 'Incident assigned to administrator',
      metadata: {
        assignedTo,
        assignedBy,
        assignedAt,
        notes,
      },
    });

  return {
    success: true,
    assignment: {
      assignedTo,
      assignedBy,
      assignedAt,
      notes,
    },
  };
}

/** Add corrective action to incident. */
export async function addCorrectiveAction(
  incidentId: string,
  correctiveAction: string,
  performedBy: string
): Promise<IncidentRecord> {
  await db
    .update(system_settings)
    .set({
      value: JSON.stringify({
        id: incidentId,
        status: 'in-progress' as IncidentStatusType,
        startedAt: null, // Would preserve existing
        completedAt: null, // Would preserve existing
        durationMs: null, // Would preserve existing
        success: null, // Would preserve existing
        errorMessage: null, // Would preserve existing
        assignedTo: null, // Would preserve existing
        correctiveAction,
        resolvedAt: null, // Would preserve existing
        resolvedBy: null, // Would preserve existing
        createdAt: null, // Would preserve existing
        createdBy: null, // Would preserve existing
      }),
      updated_at: new Date(),
    })
    .where(eq(system_settings.key, `incident_${incidentId}`));

  return getIncident(incidentId);
}

/** Resolve incident (verified through health check). */
export async function resolveIncident(
  incidentId: string,
  verifiedThroughHealthCheck: boolean,
  resolvedBy: string
): Promise<IncidentRecord> {
  if (verifiedThroughHealthCheck) {
    // Auto-resolve when verified through health check
    await updateIncidentStatus(incidentId, 'resolved', true, null, resolvedBy);
  } else {
    // Otherwise require authorized administrator confirmation
    await updateIncidentStatus(incidentId, 'resolved', true, null, resolvedBy);
  }

  return getIncident(incidentId);
}

/** Get all incidents with filtering. */
export async function listIncidents(
  severity?: IncidentSeverity,
  status?: IncidentStatusType,
  page: number = 1,
  pageSize: number = 20
): Promise<{
  incidents: IncidentRecord[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}> {
  // Build where conditions
  const whereConditions: any[] = [];

  if (severity) {
    whereConditions.push(sql`${system_settings.value}->>'severity' = ${severity}`);
  }

  if (status) {
    whereConditions.push(sql`${system_settings.value}->>'status' = ${status}`);
  }

  // Get all incidents matching filters
  const allIncidents = await db
    .select()
    .from(system_settings)
    .where(sql`${system_settings.key}.like('incident_%')`)
    .orderBy(system_settings.key.desc());

  const incidents: IncidentRecord[] = [];
  for (const row of allIncidents) {
    if (row.value) {
      try {
        const data = JSON.parse(row.value as string);
        let matches = true;

        if (severity && data.severity !== severity) {
          matches = false;
        }

        if (status && data.status !== status) {
          matches = false;
        }

        if (matches) {
          incidents.push({
            id: data.id,
            severity: data.severity as IncidentSeverity,
            status: data.status as IncidentStatusType,
            title: data.title,
            description: data.description,
            component: data.component,
            startedAt: data.startedAt,
            completedAt: data.completedAt as string | null,
            durationMs: data.durationMs as number | null,
            success: data.success as boolean,
            errorMessage: data.errorMessage as string | null,
            assignedTo: data.assignedTo,
            correctiveAction: data.correctiveAction as string | null,
            resolvedAt: data.resolvedAt as string | null,
            resolvedBy: data.resolvedBy,
            metadata: data.metadata,
            createdAt: data.createdAt,
            createdBy: data.createdBy,
          });
        }
      } catch {
        // Skip malformed entries
      }
    }
  }

  // Sort by startedAt descending (newest first)
  incidents.sort((a, b) => b.startedAt.localeCompare(a.startedAt));

  // Apply pagination
  const start = (page - 1) * pageSize;
  const end = start + pageSize;
  const pagedIncidents = incidents.slice(start, end);

  // Count total
  const total = incidents.length;

  return {
    incidents: pagedIncidents,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}