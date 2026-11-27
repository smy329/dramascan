/**
 * Incident notes and internal discussion module.
 *
 * Provides structured notes for all incidents, with internal discussion
 * restricted to High/Critical severity incidents only. Records author and
 * timestamp for all notes. Notes are private to authorized administrators
 * and not exposed to ordinary users.
 *
 * Do not implement: public discussion forums, exposure to ordinary users,
 * or note types beyond structured internal notes.
 */

import 'server-only';

import { eq, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import { requirePermission, type ActorContext } from '@/modules/authorization';

import { system_settings } from './schema';
import { admin_audit_log } from './schema';
import { IncidentRecord, IncidentSeverity } from './incident.management';

/** Note severity level (internal only). */
export type NoteSeverity = 'info' | 'warning' | 'critical';

/** Incident note. */
export interface IncidentNote {
  id: string;
  incidentId: string;
  severity: NoteSeverity;
  title: string;
  body: string;
  authoredBy: string;
  authoredAt: string;
  metadata?: Record<string, unknown>;
}

/** Create an incident note. */
export async function createIncidentNote(
  options: {
    incidentId: string;
    severity: NoteSeverity;
    title: string;
    body: string;
    authoredBy: string;
    metadata?: Record<string, unknown>;
  }
): Promise<IncidentNote> {
  const id = crypto.randomUUID();
  const authoredAt = new Date().toISOString();

  // Check if note is allowed for this incident severity
  const incident = await getIncident(options.incidentId);

  if (!incident) {
    throw new Error('Incident not found');
  }

  // Only allow critical notes for High/Critical incidents, or info/warning for any incident
  const allowedSeverities = incident.severity === IncidentSeverity.Critical
    ? ['info', 'warning', 'critical']
    : ['info', 'warning'];

  if (!allowedSeverities.includes(options.severity)) {
    throw new Error(`Notes of severity ${options.severity} are not allowed for ${incident.severity} incidents`);
  }

  const [row] = await db
    .insert(system_settings)
    .values({
      key: `incident_note_${id}`,
      value: JSON.stringify({
        id,
        incidentId: options.incidentId,
        severity: options.severity,
        title: options.title,
        body: options.body,
        authoredBy: options.authoredBy,
        authoredAt,
        metadata: options.metadata,
      }),
      description: 'Incident note tracking',
      updated_by: options.authoredBy,
      updated_at: new Date(),
    })
    .onConflictDoUpdate{
      target: system_settings.key,
      set: {
        value: JSON.stringify({
          id,
          incidentId: options.incidentId,
          severity: options.severity,
          title: options.title,
          body: options.body,
          authoredBy: options.authoredBy,
          authoredAt,
          metadata: options.metadata,
        }),
        description: 'Incident note tracking',
        updated_by: options.authoredBy,
        updated_at: new Date(),
      },
    }
    .returning({
      key: system_settings.key,
      value: system_settings.value,
    });

  const noteData = JSON.parse(row.value as string);

  // Create audit log entry
  await db
    .insert(admin_audit_log)
    .values({
      actor_id: options.authoredBy,
      action: 'incident_note_created',
      entity_type: 'incident_note',
      entity_id: options.incidentId,
      summary: 'Incident note created',
      metadata: {
        noteId: id,
        severity: options.severity,
        incidentSeverity: incident.severity,
      },
    });

  return {
    id: noteData.id,
    incidentId: noteData.incidentId,
    severity: noteData.severity as NoteSeverity,
    title: noteData.title,
    body: noteData.body,
    authoredBy: noteData.authoredBy,
    authoredAt: noteData.authoredAt,
    metadata: noteData.metadata,
  };
}

/** Get incident note. */
export async function getIncidentNote(noteId: string): Promise<IncidentNote | null> {
  const [row] = await db
    .select()
    .from(system_settings)
    .where(eq(system_settings.key, `incident_note_${noteId}`));

  if (!row || !row.value) {
    return null;
  }

  try {
    const data = JSON.parse(row.value as string);
    return {
      id: data.id,
      incidentId: data.incidentId,
      severity: data.severity as NoteSeverity,
      title: data.title,
      body: data.body,
      authoredBy: data.authoredBy,
      authoredAt: data.authoredAt,
      metadata: data.metadata,
    };
  } catch {
    return null;
  }
}

/** Get notes for an incident. */
export async function getIncidentNotes(
  incidentId: string,
  page: number = 1,
  pageSize: number = 20
): Promise<{
  notes: IncidentNote[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}> {
  // Count total notes for this incident
  const [{ count }] = await db
    .select({ count: sql`count(*)` })
    .from(system_settings)
    .where(sql`${system_settings.key}.like('incident_note_%') AND JSON_EXTRACT(${system_settings.value}, '$.incidentId') = ${incidentId}`);

  // Get notes for current page
  const allNotes = await db
    .select()
    .from(system_settings)
    .where(sql`${system_settings.key}.like('incident_note_%')`)
    .orderBy(system_settings.key.desc())
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const notes: IncidentNote[] = [];
  for (const row of allNotes) {
    if (row.value) {
      try {
        const data = JSON.parse(row.value as string);
        if (data.incidentId === incidentId) {
          notes.push({
            id: data.id,
            incidentId: data.incidentId,
            severity: data.severity as NoteSeverity,
            title: data.title,
            body: data.body,
            authoredBy: data.authoredBy,
            authoredAt: data.authoredAt,
            metadata: data.metadata,
          });
        }
      } catch {
        // Skip malformed entries
      }
    }
  }

  // Sort by authoredAt descending (newest first)
  notes.sort((a, b) => b.authoredAt.localeCompare(a.authoredAt));

  // Apply pagination
  const start = (page - 1) * pageSize;
  const end = start + pageSize;
  const pagedNotes = notes.slice(start, end);

  return {
    notes: pagedNotes,
    total: count || 0,
    page,
    pageSize,
    totalPages: Math.ceil((count || 0) / pageSize),
  };
}

/** Add internal discussion note (High/Critical only). */
export async function addInternalDiscussion(
  incidentId: string,
  authoredBy: string,
  body: string,
  metadata?: Record<string, unknown>
): Promise<IncidentNote | null> {
  const incident = await getIncident(incidentId);

  if (!incident) {
    return null;
  }

  // Only allow internal discussion for High/Critical incidents
  if (incident.severity !== IncidentSeverity.Critical && incident.severity !== IncidentSeverity.High) {
    throw new Error('Internal discussion is only allowed for High/Critical incidents');
  }

  return createIncidentNote({
    incidentId,
    severity: 'critical',
    title: 'Internal discussion',
    body,
    authoredBy,
    metadata,
  });
}

/** Get discussion notes for an incident (High/Critical only). */
export async function getDiscussionNotes(
  incidentId: string,
  authorizedBy: string
): Promise<IncidentNote[]> {
  const incident = await getIncident(incidentId);

  if (!incident) {
    return [];
  }

  // Only allow discussion notes for High/Critical incidents
  if (incident.severity !== IncidentSeverity.Critical && incident.severity !== IncidentSeverity.High) {
    throw new Error('Discussion notes are only accessible for High/Critical incidents');
  }

  const allNotes = await getIncidentNotes(incidentId);

  // Filter to only critical-severity notes (internal discussion)
  return allNotes.filter(note => note.severity === 'critical');
}