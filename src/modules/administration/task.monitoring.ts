/**
 * Scheduled maintenance task monitoring module.
 *
 * Provides tracking for short-lived maintenance tasks triggered by systemd.
 * All tasks are one-off operations - no persistent workers, no queue monitoring,
 * no recurring schedules. Each task records its start time, end time, duration,
 * success/failure status, and safe error information.
 *
 * Do not implement: queue priorities, worker concurrency, dashboards, or
 * scheduled content-release pipelines.
 */

import 'server-only';

import { eq } from 'drizzle-orm';

import { db } from '@/db/client';
import { requirePermission, type ActorContext } from '@/modules/authorization';

import { system_settings } from './schema';
import { admin_audit_log } from './schema';

/** Task status. */
export type MaintenanceTaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

/** Maintenance task record. */
export interface MaintenanceTask {
  id: string;
  name: string;
  status: MaintenanceTaskStatus;
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
  success: boolean | null;
  error_message?: string | null;
  performed_by: string;
  metadata?: Record<string, unknown>;
}

/** Create a new maintenance task record. */
export async function createTask(
  name: string,
  performed_by: string,
  metadata?: Record<string, unknown>
): Promise<MaintenanceTask> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const [row] = await db
    .insert(system_settings) // Using system_settings as temporary task store
    .values({
      key: `task_${id}`,
      value: JSON.stringify({
        name,
        status: 'pending' as MaintenanceTaskStatus,
        started_at: now,
        completed_at: null,
        duration_ms: null,
        success: null,
        error_message: null,
        performed_by,
        metadata,
      }),
      description: 'Maintenance task tracking',
      updated_by: performed_by,
      updated_at: new Date(),
    })
    .onConflictDoUpdate({
      target: system_settings.key,
      set: {
        value: JSON.stringify({
          name,
          status: 'pending' as MaintenanceTaskStatus,
          started_at: now,
          completed_at: null,
          duration_ms: null,
          success: null,
          error_message: null,
          performed_by,
          metadata,
        }),
        description: 'Maintenance task tracking',
        updated_by: performed_by,
        updated_at: new Date(),
      },
    })
    .returning({
      key: system_settings.key,
      value: system_settings.value,
      updatedAt: system_settings.updated_at,
    });

  // Parse the task data from the stored value
  const taskData = JSON.parse(row.value as string);

  return {
    id: row.key.replace('task_', ''),
    name: taskData.name,
    status: 'pending',
    started_at: now,
    completed_at: null,
    duration_ms: null,
    success: null,
    error_message: null,
    performed_by,
    metadata: taskData.metadata,
  };
}

/** Update a task's status. */
export async function updateTaskStatus(
  taskId: string,
  status: MaintenanceTaskStatus,
  success: boolean | null,
  errorMessage?: string | null,
  performed_by: string
): Promise<void> {
  await db
    .update(system_settings)
    .set({
      value: JSON.stringify({
        name: `task_${taskId}`,
        status,
        started_at: errorMessage ? null : new Date().toISOString(),
        completed_at: new Date().toISOString(),
        duration_ms: success ? null : null, // Would calculate if we had start time
        success,
        error_message: errorMessage,
        performed_by,
        metadata: null,
      }),
      updated_by: performed_by,
      updated_at: new Date(),
    })
    .where(eq(system_settings.key, `task_${taskId}`));
}

/** Get a task by ID. */
export async function getTask(taskId: string): Promise<MaintenanceTask | null> {
  const [row] = await db
    .select()
    .from(system_settings)
    .where(eq(system_settings.key, `task_${taskId}`));

  if (!row || !row.value) {
    return null;
  }

  const taskData = JSON.parse(row.value as string);

  return {
    id: taskId,
    name: taskData.name,
    status: taskData.status as MaintenanceTaskStatus,
    started_at: taskData.started_at as string | null,
    completed_at: taskData.completed_at as string | null,
    duration_ms: taskData.duration_ms as number | null,
    success: taskData.success as boolean | null,
    error_message: taskData.error_message as string | null,
    performed_by: taskData.performed_by,
    metadata: taskData.metadata as Record<string, unknown> | undefined,
  };
}

/** List all tasks with pagination. */
export async function listTasks(
  page: number = 1,
  pageSize: number = 20
): Promise<{
  tasks: MaintenanceTask[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}> {
  // Count total tasks
  const [{ count }] = await db
    .select({ count: sql`count(*)` })
    .from(system_settings)
    .where(sql`${system_settings.key}.like('task_%')`);

  // Get tasks for the current page (ordered by ID descending, newest first)
  const allTasks = await db
    .select()
    .from(system_settings)
    .where(sql`${system_settings.key}.like('task_%')`)
    .orderBy(system_settings.key.desc())
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const tasks: MaintenanceTask[] = [];
  for (const row of allTasks) {
    if (row.value) {
      const taskData = JSON.parse(row.value as string);
      tasks.push({
        id: row.key.replace('task_', ''),
        name: taskData.name,
        status: taskData.status as MaintenanceTaskStatus,
        started_at: taskData.started_at as string | null,
        completed_at: taskData.completed_at as string | null,
        duration_ms: taskData.duration_ms as number | null,
        success: taskData.success as boolean | null,
        error_message: taskData.error_message as string | null,
        performed_by: taskData.performed_by,
        metadata: taskData.metadata as Record<string, unknown> | undefined,
      });
    }
  }

  return {
    tasks,
    total: count || 0,
    page,
    pageSize,
    totalPages: Math.ceil((count || 0) / pageSize),
  };
}

/** Complete a task with success status. */
export async function completeTaskSuccess(
  taskId: string,
  performed_by: string
): Promise<MaintenanceTask> {
  await updateTaskStatus(taskId, 'completed', true, null, performed_by);
  return getTask(taskId);
}

/** Complete a task with failure status. */
export async function completeTaskFailure(
  taskId: string,
  performed_by: string,
  errorMessage: string
): Promise<MaintenanceTask> {
  await updateTaskStatus(taskId, 'failed', false, errorMessage, performed_by);
  return getTask(taskId);
}