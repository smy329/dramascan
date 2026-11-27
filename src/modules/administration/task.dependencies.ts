/**
 * Maintenance task dependencies module.
 *
 * Tracks dependencies between maintenance operations without implementing a
 * full pipeline or scheduler. Dependencies are recorded as directional edges
 * between tasks, ensuring that prerequisite tasks complete before dependent
 * tasks begin. No automatic scheduling, worker concurrency, or dashboards.
 *
 * Do not implement: queue priorities, worker concurrency, automatic
 * scheduling, or content-release pipelines.
 */

import 'server-only';

import { eq } from 'drizzle-orm';

import { db } from '@/db/client';
import { requirePermission, type ActorContext } from '@/modules/authorization';

import { system_settings } from './schema';
import { admin_audit_log } from './schema';

/** Dependency direction. */
export type DependencyDirection = 'prerequisite' | 'dependent';

/** Maintenance task dependency record. */
export interface MaintenanceTaskDependency {
  id: string;
  task_id: string; // The task that depends on another
  prerequisite_task_id: string; // The task that must complete first
  dependency_type: DependencyDirection;
  status: 'pending' | 'satisfied' | 'failed' | 'blocked';
  created_at: string;
  created_by: string;
  notes?: string;
}

/** Create a new dependency record. */
export async function createDependency(
  options: {
    task_id: string;
    prerequisite_task_id: string;
    dependency_type: DependencyDirection;
    notes?: string;
    performed_by: string;
  }
): Promise<MaintenanceTaskDependency> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const [row] = await db
    .insert(system_settings) // Using system_settings as temporary dependency store
    .values({
      key: `dep_${id}`,
      value: JSON.stringify({
        id,
        task_id: options.task_id,
        prerequisite_task_id: options.prerequisite_task_id,
        dependency_type: options.dependency_type,
        status: 'pending',
        created_at: now,
        created_by: options.performed_by,
        notes: options.notes,
      }),
      description: 'Maintenance task dependency tracking',
      updated_by: options.performed_by,
      updated_at: new Date(),
    })
    .onConflictDoUpdate{
      target: system_settings.key,
      set: {
        value: JSON.stringify({
          id,
          task_id: options.task_id,
          prerequisite_task_id: options.prerequisite_task_id,
          dependency_type: options.dependency_type,
          status: 'pending',
          created_at: now,
          created_by: options.performed_by,
          notes: options.notes,
        }),
        description: 'Maintenance task dependency tracking',
        updated_by: options.performed_by,
        updated_at: new Date(),
      },
    }
    .returning({
      key: system_settings.key,
      value: system_settings.value,
    });

  const dependencyData = JSON.parse(row.value as string);

  return {
    id: dependencyData.id,
    task_id: dependencyData.task_id,
    prerequisite_task_id: dependencyData.prerequisite_task_id,
    dependency_type: dependencyData.dependency_type as DependencyDirection,
    status: dependencyData.status as 'pending' | 'satisfied' | 'failed' | 'blocked',
    created_at: dependencyData.created_at,
    created_by: dependencyData.created_by,
    notes: dependencyData.notes,
  };
}

/** Get a dependency by ID. */
export async function getDependency(dependencyId: string): Promise<MaintenanceTaskDependency | null> {
  const [row] = await db
    .select()
    .from(system_settings)
    .where(eq(system_settings.key, `dep_${dependencyId}`));

  if (!row || !row.value) {
    return null;
  }

  const dependencyData = JSON.parse(row.value as string);

  return {
    id: dependencyData.id,
    task_id: dependencyData.task_id,
    prerequisite_task_id: dependencyData.prerequisite_task_id,
    dependency_type: dependencyData.dependency_type as DependencyDirection,
    status: dependencyData.status as 'pending' | 'satisfied' | 'failed' | 'blocked',
    created_at: dependencyData.created_at,
    created_by: dependencyData.created_by,
    notes: dependencyData.notes,
  };
}

/** List dependencies for a task. */
export async function listDependenciesForTask(
  taskId: string
): Promise<MaintenanceTaskDependency[]> {
  const allDeps = await db
    .select()
    .from(system_settings)
    .where(sql`${system_settings.key}.like('dep_%')`);

  const dependencies: MaintenanceTaskDependency[] = [];
  for (const row of allDeps) {
    if (row.value) {
      const depData = JSON.parse(row.value as string);
      // Only return dependencies where the task_id or prerequisite_task_id matches
      if (depData.task_id === taskId || depData.prerequisite_task_id === taskId) {
        dependencies.push({
          id: depData.id,
          task_id: depData.task_id,
          prerequisite_task_id: depData.prerequisite_task_id,
          dependency_type: depData.dependency_type as DependencyDirection,
          status: depData.status as 'pending' | 'satisfied' | 'failed' | 'blocked',
          created_at: depData.created_at,
          created_by: depData.created_by,
          notes: depData.notes,
        });
      }
    }
  }

  return dependencies;
}

/** List all dependencies. */
export async function listAllDependencies(): Promise<MaintenanceTaskDependency[]> {
  const allDeps = await db
    .select()
    .from(system_settings)
    .where(sql`${system_settings.key}.like('dep_%')`);

  const dependencies: MaintenanceTaskDependency[] = [];
  for (const row of allDeps) {
    if (row.value) {
      const depData = JSON.parse(row.value as string);
      dependencies.push({
        id: depData.id,
        task_id: depData.task_id,
        prerequisite_task_id: depData.prerequisite_task_id,
        dependency_type: depData.dependency_type as DependencyDirection,
        status: depData.status as 'pending' | 'satisfied' | 'failed' | 'blocked',
        created_at: depData.created_at,
        created_by: depData.created_by,
        notes: depData.notes,
      });
    }
  }

  return dependencies;
}

/** Mark a dependency as satisfied. */
export async function markDependencySatisfied(
  dependencyId: string,
  satisfiedBy: string
): Promise<void> {
  await db
    .update(system_settings)
    .set({
      value: JSON.stringify({
        id: dependencyData?.id,
        task_id: dependencyData?.task_id,
        prerequisite_task_id: dependencyData?.prerequisite_task_id,
        dependency_type: dependencyData?.dependency_type,
        status: 'satisfied',
        created_at: dependencyData?.created_at,
        created_by: satisfiedBy,
        notes: dependencyData?.notes,
      }),
      updated_at: new Date(),
    })
    .where(eq(system_settings.key, `dep_${dependencyId}`));
}

/** Mark a dependency as failed. */
export async function markDependencyFailed(
  dependencyId: string,
  failedBy: string,
  errorMessage: string
): Promise<void> {
  await db
    .update(system_settings)
    .set({
      value: JSON.stringify({
        id: dependencyData?.id,
        task_id: dependencyData?.task_id,
        prerequisite_task_id: dependencyData?.prerequisite_task_id,
        dependency_type: dependencyData?.dependency_type,
        status: 'failed',
        created_at: dependencyData?.created_at,
        created_by: failedBy,
        notes: `${dependencyData?.notes}\n${new Date().toISOString()} - ${failedBy}: ${errorMessage}`,
      }),
      updated_at: new Date(),
    })
    .where(eq(system_settings.key, `dep_${dependencyId}`));
}