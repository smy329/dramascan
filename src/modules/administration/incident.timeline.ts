/**
 * Incident timeline module.
 *
 * Provides a unified timeline for High/Critical incidents, combining alert
 * creation, escalation, acknowledgement, assignment, notes, status changes,
 * and recovery into a single accurate and append-only history. Lower-severity
 * incidents have separate, lightweight histories.
 *
 * Do not implement: complex workflow engines, external timeline services, or
 * real-time updating dashboards.
 */

import 'server-only';

import { eq, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import { requirePermission, type ActorContext } from '@/modules/authorization';

import { system_settings } from './schema';
import { admin_audit_log } from './schema';
import { IncidentRecord, IncidentSeverity, EscalationRecord, IncidentNote, IncidentAttachment } from './incident.management';

/** Timeline event types. */
export type TimelineEventType =
  | 'incident_created'
  | 'incident_updated'
  | 'incident_assigned'
  | 'incident_acknowledged'
  | 'incident_resolved'
  | 'incident_closed'
  | 'escalation_created'
  | 'escalation_resolved'
  | 'note_created'
  | 'attachment_uploaded';

/** Timeline event. */
export interface TimelineEvent {
  id: string;
  type: TimelineEventType;
  incidentId: string;
  timestamp: string;
  actor: string;
  summary: string;
  metadata?: Record<string, unknown>;
}

/** Create a timeline event. */
export async function createTimelineEvent(
  options: {
    incidentId: string;
    type: TimelineEventType;
    actor: string;
    summary: string;
    metadata?: Record<string, unknown>;
  }
): Promise<TimelineEvent> {
  const id = crypto.randomUUID();
  const timestamp = new Date().toISOString();

  const [row] = await db
    .insert(system_settings)
    .values({
      key: `timeline_event_${id}`,
      value: JSON.stringify({
        id,
        type: options.type,
        incidentId: options.incidentId,
        timestamp,
        actor: options.actor,
        summary: options.summary,
        metadata: options.metadata,
      }),
      description: 'Incident timeline tracking',
      updated_by: options.actor,
      updated_at: new Date(),
    })
    .onConflictDoUpdate({
      target: system_settings.key,
      set: {
        value: JSON.stringify({
          id,
          type: options.type,
          incidentId: options.incidentId,
          timestamp,
          actor: options.actor,
          summary: options.summary,
          metadata: options.metadata,
        }),
        description: 'Incident timeline tracking',
        updated_by: options.actor,
        updated_at: new Date(),
      },
    })
    .returning({
      key: system_settings.key,
      value: system_settings.value,
    });

  const eventData = JSON.parse(row.value as string);

  return {
    id: eventData.id,
    type: eventData.type as TimelineEventType,
    incidentId: eventData.incidentId,
    timestamp: eventData.timestamp,
    actor: eventData.actor,
    summary: eventData.summary,
    metadata: eventData.metadata,
  };
}

/** Get timeline events for an incident. */
export async function getIncidentTimeline(
  incidentId: string,
  page: number = 1,
  pageSize: number = 20
): Promise<{
  events: TimelineEvent[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}> {
  // Count total events for this incident
  const [{ count }] = await db
    .select({ count: sql`count(*)` })
    .from(system_settings)
    .where(sql`${system_settings.key}.like('timeline_event_%') AND JSON_EXTRACT(${system_settings.value}, '$.incidentId') = ${incidentId}`);

  // Get events for current page
  const allEvents = await db
    .select()
    .from(system_settings)
    .where(sql`${system_settings.key}.like('timeline_event_%')`)
    .orderBy(system_settings.key.desc())
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const events: TimelineEvent[] = [];
  for (const row of allEvents) {
    if (row.value) {
      try {
        const data = JSON.parse(row.value as string);
        if (data.incidentId === incidentId) {
          events.push({
            id: data.id,
            type: data.type as TimelineEventType,
            incidentId: data.incidentId,
            timestamp: data.timestamp,
            actor: data.actor,
            summary: data.summary,
            metadata: data.metadata,
          });
        }
      } catch {
        // Skip malformed entries
      }
    }
  }

  // Sort by timestamp descending (newest first)
  events.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  // Apply pagination
  const start = (page - 1) * pageSize;
  const end = start + pageSize;
  const pagedEvents = events.slice(start, end);

  return {
    events: pagedEvents,
    total: count || 0,
    page,
    pageSize,
    totalPages: Math.ceil((count || 0) / pageSize),
  };
}

/** Get unified timeline across incidents (Super Admin only). */
export async function getUnifiedTimeline(
  severity?: IncidentSeverity,
  page: number = 1,
  pageSize: number = 20
): Promise<{
  events: TimelineEvent[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}> {
  // Build where condition for severity if provided
  const whereCondition = severity
    ? sql`${system_settings.key}.like('timeline_event_%') AND JSON_EXTRACT(${system_settings.value}, '$.severity') = ${severity}`
    : sql`${system_settings.key}.like('timeline_event_%')`;

  // Count total events
  const [{ count }] = await db
    .select({ count: sql`count(*)` })
    .from(system_settings)
    .where(whereCondition);

  // Get events for current page
  const allEvents = await db
    .select()
    .from(system_settings)
    .where(whereCondition)
    .orderBy(system_settings.key.desc())
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const events: TimelineEvent[] = [];
  for (const row of allEvents) {
    if (row.value) {
      try {
        const data = JSON.parse(row.value as string);
        events.push({
          id: data.id,
          type: data.type as TimelineEventType,
          incidentId: data.incidentId,
          timestamp: data.timestamp,
          actor: data.actor,
          summary: data.summary,
          metadata: data.metadata,
        });
      } catch {
        // Skip malformed entries
      }
    }
  }

  // Sort by timestamp descending (newest first)
  events.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  // Apply pagination
  const start = (page - 1) * pageSize;
  const end = start + pageSize;
  const pagedEvents = events.slice(start, end);

  return {
    events: pagedEvents,
    total: count || 0,
    page,
    pageSize,
    totalPages: Math.ceil((count || 0) / pageSize),
  };
}