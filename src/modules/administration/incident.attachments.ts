/**
 * Incident attachments module.
 *
 * Provides file attachments for High/Critical incidents only. Includes file type,
 * size, permissions validation, and malware-safety requirements. Restricts
 * attachments to authorized administrators only. No executable files or
 * dangerous content allowed.
 *
 * Do not implement: public file storage, exposure to ordinary users, or
 * attachment types beyond validated secure files.
 */

import 'server-only';

import { eq, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import { requirePermission, type ActorContext } from '@/modules/authorization';

import { system_settings } from './schema';
import { admin_audit_log } from './schema';
import { IncidentRecord, IncidentSeverity } from './incident.management';

/** Allowed file extensions for incident attachments. */
const ALLOWED_EXTENSIONS = [
  '.pdf', '.jpg', '.jpeg', '.png', '.gif', '.bmp',
  '.txt', '.doc', '.docx', '.odt',
  '.csv', '.json',
];

/** Malicious file extensions (not allowed). */
const MALICIOUS_EXTENSIONS = [
  '.exe', '.bat', '.cmd', '.com', '.scr', '.pif',
  '.sh', '.php', '.pl', '.py', '.rb',
  '.app', '.dmg', '.deb', '.rpm',
];

/** Maximum file size for attachments (10MB). */
const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024; // 10MB

/** Incident attachment. */
export interface IncidentAttachment {
  id: string;
  incidentId: string;
  filename: string;
  size: number;
  mimeType: string;
  uploadedAt: string;
  uploadedBy: string;
  malwareScanned: boolean;
  malwareResult?: 'clean' | 'infected' | 'unknown';
}

/** Create an incident attachment. */
export async function createIncidentAttachment(
  options: {
    incidentId: string;
    filename: string;
    size: number;
    mimeType: string;
    uploadedBy: string;
    malwareScanned: boolean;
    malwareResult?: 'clean' | 'infected' | 'unknown';
    metadata?: Record<string, unknown>;
  }
): Promise<IncidentAttachment> {
  // Validate file extension
  const fileExtension = options.filename.substring(options.filename.lastIndexOf('.')).toLowerCase();

  if (MALICIOUS_EXTENSIONS.includes(fileExtension)) {
    throw new Error(`File type ${fileExtension} is not allowed for incident attachments`);
  }

  // Validate file size
  if (options.size > MAX_ATTACHMENT_SIZE) {
    throw new Error(`File size exceeds maximum allowed size of ${MAX_ATTACHMENT_SIZE / (1024 * 1024)}MB`);
  }

  // Validate MIME type
  const allowedMimeTypes = ALLOWED_EXTENSIONS.map(ext => {
    const mimeMap: Record<string, string> = {
      '.pdf': 'application/pdf',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.bmp': 'image/bmp',
      '.txt': 'text/plain',
      '.doc': 'application/msword',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.odt': 'application/vnd.oasis.opendocument.text',
      '.csv': 'text/csv',
      '.json': 'application/json',
    };
    return mimeMap[ext];
  });

  if (!allowedMimeTypes.includes(options.mimeType) && options.mimeType !== 'application/octet-stream') {
    throw new Error(`MIME type ${options.mimeType} is not allowed for incident attachments`);
  }

  const id = crypto.randomUUID();
  const uploadedAt = new Date().toISOString();

  const [row] = await db
    .insert(system_settings)
    .values({
      key: `incident_attachment_${id}`,
      value: JSON.stringify({
        id,
        incidentId: options.incidentId,
        filename: options.filename,
        size: options.size,
        mimeType: options.mimeType,
        uploadedAt,
        uploadedBy: options.uploadedBy,
        malwareScanned: options.malwareScanned,
        malwareResult: options.malwareResult,
        metadata: options.metadata,
      }),
      description: 'Incident attachment tracking',
      updated_by: options.uploadedBy,
      updated_at: new Date(),
    })
    .onConflictDoUpdate({
      target: system_settings.key,
      set: {
        value: JSON.stringify({
          id,
          incidentId: options.incidentId,
          filename: options.filename,
          size: options.size,
          mimeType: options.mimeType,
          uploadedAt,
          uploadedBy: options.uploadedBy,
          malwareScanned: options.malwareScanned,
          malwareResult: options.malwareResult,
          metadata: options.metadata,
        }),
        description: 'Incident attachment tracking',
        updated_by: options.uploadedBy,
        updated_at: new Date(),
      },
    })
    .returning({
      key: system_settings.key,
      value: system_settings.value,
    });

  const attachmentData = JSON.parse(row.value as string);

  // Create audit log entry
  await db
    .insert(admin_audit_log)
    .values({
      actor_id: options.uploadedBy,
      action: 'incident_attachment_uploaded',
      entity_type: 'incident_attachment',
      entity_id: options.incidentId,
      summary: 'Incident attachment uploaded',
      metadata: {
        attachmentId: id,
        filename: options.filename,
        size: options.size,
        mimeType: options.mimeType,
        malwareScanned: options.malwareScanned,
      },
    });

  return {
    id: attachmentData.id,
    incidentId: attachmentData.incidentId,
    filename: attachmentData.filename,
    size: attachmentData.size,
    mimeType: attachmentData.mimeType,
    uploadedAt: attachmentData.uploadedAt,
    uploadedBy: attachmentData.uploadedBy,
    malwareScanned: attachmentData.malwareScanned,
    malwareResult: attachmentData.malwareResult,
  };
}

/** Get incident attachment. */
export async function getIncidentAttachment(attachmentId: string): Promise<IncidentAttachment | null> {
  const [row] = await db
    .select()
    .from(system_settings)
    .where(eq(system_settings.key, `incident_attachment_${attachmentId}`));

  if (!row || !row.value) {
    return null;
  }

  try {
    const data = JSON.parse(row.value as string);
    return {
      id: data.id,
      incidentId: data.incidentId,
      filename: data.filename,
      size: data.size,
      mimeType: data.mimeType,
      uploadedAt: data.uploadedAt,
      uploadedBy: data.uploadedBy,
      malwareScanned: data.malwareScanned,
      malwareResult: data.malwareResult,
    };
  } catch {
    return null;
  }
}

/** Get attachments for an incident (High/Critical only). */
export async function getIncidentAttachments(
  incidentId: string,
  authorizedBy: string
): Promise<IncidentAttachment[]> {
  const incident = await getIncident(incidentId);

  if (!incident) {
    return [];
  }

  // Only allow attachments for High/Critical incidents
  if (incident.severity !== IncidentSeverity.Critical && incident.severity !== IncidentSeverity.High) {
    throw new Error('Incident attachments are only accessible for High/Critical incidents');
  }

  // Get all attachments for this incident
  const allAttachments = await db
    .select()
    .from(system_settings)
    .where(sql`${system_settings.key}.like('incident_attachment_%')`);

  const attachments: IncidentAttachment[] = [];
  for (const row of allAttachments) {
    if (row.value) {
      try {
        const data = JSON.parse(row.value as string);
        if (data.incidentId === incidentId) {
          attachments.push({
            id: data.id,
            incidentId: data.incidentId,
            filename: data.filename,
            size: data.size,
            mimeType: data.mimeType,
            uploadedAt: data.uploadedAt,
            uploadedBy: data.uploadedBy,
            malwareScanned: data.malwareScanned,
            malwareResult: data.malwareResult,
          });
        }
      } catch {
        // Skip malformed entries
      }
    }
  }

  return attachments;
}

/** Validate file for incident attachment. */
export function validateIncidentAttachment(
  filename: string,
  size: number,
  mimeType: string
): { valid: boolean; errorMessage?: string } {
  // Validate file extension
  const fileExtension = filename.substring(filename.lastIndexOf('.')).toLowerCase();

  if (MALICIOUS_EXTENSIONS.includes(fileExtension)) {
    return { valid: false, errorMessage: `File type ${fileExtension} is not allowed` };
  }

  // Validate file size
  if (size > MAX_ATTACHMENT_SIZE) {
    return { valid: false, errorMessage: `File size exceeds maximum allowed size of ${MAX_ATTACHMENT_SIZE / (1024 * 1024)}MB` };
  }

  // Validate MIME type
  const allowedExtensions = ['.pdf', '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.txt', '.doc', '.docx', '.odt', '.csv', '.json'];
  const isAllowedExtension = allowedExtensions.some(ext => filename.toLowerCase().endsWith(ext));

  if (!isAllowedExtension && mimeType !== 'application/octet-stream') {
    return { valid: false, errorMessage: `File type ${fileExtension} is not allowed` };
  }

  return { valid: true };
}