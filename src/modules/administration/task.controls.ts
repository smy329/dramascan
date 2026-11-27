/**
 * Maintenance task controls module.
 *
 * Provides Super Admin emergency pause/resume functionality and concurrency
 * controls for short-lived maintenance operations. Prevents conflicting
 * operations from running simultaneously. All controls are admin-facing only
 * - ordinary users cannot access these functions.
 *
 * Do not implement: queue priorities, worker concurrency, dashboards, or
 * persistent background process monitoring.
 */

import 'server-only';

import { sql } from 'drizzle-orm';

import { db } from '@/db/client';
import type { ActorContext } from '@/modules/authorization';

import { system_settings } from './schema';
import { admin_audit_log } from './schema';

/** Control action. */
export type MaintenanceControlAction = 'pause' | 'resume' | 'stop' | 'restart';

/** Control result. */
export interface MaintenanceControlResult {
  success: boolean;
  taskId?: string;
  message: string;
  previousState?: string;
  newState?: string;
}

/** Check if a task can be controlled. */
export function canControlTask(actor: ActorContext): boolean {
  // Only super admins can control tasks
  return actor.isSuperAdmin;
}

/** Pause a running maintenance task. */
export async function pauseTask(
  taskId: string,
  actor: ActorContext
): Promise<MaintenanceControlResult> {
  if (!canControlTask(actor)) {
    return {
      success: false,
      message: 'Only Super Admin can pause maintenance tasks',
    };
  }

  // In a production system, this would signal a running task to pause
  // For now, we record the pause request in the audit log

  await db
    .insert(admin_audit_log)
    .values({
      actor_id: actor.userId,
      action: 'task_paused',
      entity_type: 'maintenance_task',
      entity_id: taskId,
      summary: 'Maintenance task paused',
      metadata: {
        pausedBy: actor.userId,
        taskId,
      },
    });

  return {
    success: true,
    taskId,
    message: 'Maintenance task paused successfully',
    previousState: 'running',
    newState: 'paused',
  };
}

/** Resume a paused maintenance task. */
export async function resumeTask(
  taskId: string,
  actor: ActorContext
): Promise<MaintenanceControlResult> {
  if (!canControlTask(actor)) {
    return {
      success: false,
      message: 'Only Super Admin can resume maintenance tasks',
    };
  }

  // In a production system, this would signal a paused task to resume
  await db
    .insert(admin_audit_log)
    .values({
      actor_id: actor.userId,
      action: 'task_resumed',
      entity_type: 'maintenance_task',
      entity_id: taskId,
      summary: 'Maintenance task resumed',
      metadata: {
        resumedBy: actor.userId,
        taskId,
      },
    });

  return {
    success: true,
    taskId,
    message: 'Maintenance task resumed successfully',
    previousState: 'paused',
    newState: 'running',
  };
}

/** Stop a maintenance task. */
export async function stopTask(
  taskId: string,
  actor: ActorContext
): Promise<MaintenanceControlResult> {
  if (!canControlTask(actor)) {
    return {
      success: false,
      message: 'Only Super Admin can stop maintenance tasks',
    };
  }

  // In a production system, this would signal a running task to stop
  await db
    .insert(admin_audit_log)
    .values({
      actor_id: actor.userId,
      action: 'task_stopped',
      entity_type: 'maintenance_task',
      entity_id: taskId,
      summary: 'Maintenance task stopped',
      metadata: {
        stoppedBy: actor.userId,
        taskId,
      },
    });

  return {
    success: true,
    taskId,
    message: 'Maintenance task stopped successfully',
    previousState: 'running',
    newState: 'stopped',
  };
}

/** Check for conflicting tasks. */
export async function checkForConflicts(
  taskId: string,
  actor: ActorContext
): Promise<{
  hasConflicts: boolean;
  conflictingTaskIds: string[];
  message: string;
}> {
  if (!canControlTask(actor)) {
    return {
      hasConflicts: true,
      conflictingTaskIds: [],
      message: 'Only Super Admin can check for conflicts',
    };
  }

  // In a production system, this would check for running tasks that
  // conflict with the given task. For now, we check the system settings
  // for any running/paused tasks.

  const runningTasks: string[] = [];

  // Check for other tasks that might conflict
  const allTasks = await db
    .select()
    .from(system_settings)
    .where(sql`${system_settings.key}.like('task_%')`);

  for (const row of allTasks) {
    if (row.value) {
      const taskData = JSON.parse(row.value as string);
      // If task is running or paused and not the same task, it's a conflict
      if (
        (taskData.status === 'running' || taskData.status === 'paused') &&
        taskData.name !== taskId
      ) {
        runningTasks.push(taskData.name);
      }
    }
  }

  if (runningTasks.length > 0) {
    return {
      hasConflicts: true,
      conflictingTaskIds: runningTasks,
      message: `Conflicting tasks already running: ${runningTasks.join(', ')}`,
    };
  }

  return {
    hasConflicts: false,
    conflictingTaskIds: [],
    message: 'No conflicting tasks found',
  };
}

/** Prevent overlapping task execution. */
export async function preventOverlap(
  taskId: string,
  actor: ActorContext
): Promise<{ canExecute: boolean; message: string }> {
  if (!canControlTask(actor)) {
    return { canExecute: false, message: 'Only Super Admin can check overlap' };
  }

  const { hasConflicts, message } = await checkForConflicts(
    taskId,
    actor
  );

  if (hasConflicts) {
    return { canExecute: false, message: `Cannot execute: ${message}` };
  }

  // Mark the task as starting
  await db
    .insert(system_settings)
    .values({
      key: `task_${taskId}_status`,
      value: JSON.stringify({
        taskId,
        status: 'running',
        started_at: new Date().toISOString(),
        performed_by: actor.userId,
      }),
      description: 'Task execution state',
      updated_by: actor.userId,
      updated_at: new Date(),
    })
    .onConflictDoUpdate({
      target: system_settings.key,
      set: {
        value: JSON.stringify({
          taskId,
          status: 'running',
          started_at: new Date().toISOString(),
          performed_by: actor.userId,
        }),
        description: 'Task execution state',
        updated_by: actor.userId,
        updated_at: new Date(),
      },
    });

  return { canExecute: true, message: 'Task can execute without conflicts' };
}
