/**
 * Basic operational performance analytics module.
 *
 * Provides lightweight collection of execution duration, success/failure metrics,
 * and system resource metrics. Designed for basic monitoring without queue wait
 * times, worker utilization, or complex analytics dashboards.
 *
 * Do not implement: queue wait times, worker utilization metrics, complex KPI
 * calculations, or predictive analytics.
 */

import 'server-only';

import { sql, desc } from 'drizzle-orm';

import { db } from '@/db/client';

import { system_settings } from './schema';

/** Performance metric entry. */
export interface PerformanceMetric {
  id: string;
  name: string;
  value: number;
  unit: string;
  recorded_at: string;
  task_id?: string | null;
  incident_id?: string | null;
  metadata?: Record<string, unknown>;
}

/** Record a performance metric. */
export async function recordMetric(
  options: {
    name: string;
    value: number;
    unit: string;
    taskId?: string;
    incidentId?: string;
    metadata?: Record<string, unknown>;
    recordedBy: string;
  }
): Promise<PerformanceMetric> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const [row] = await db
    .insert(system_settings) // Using system_settings as temporary metric store
    .values({
      key: `metric_${id}`,
      value: JSON.stringify({
        id,
        name: options.name,
        value: options.value,
        unit: options.unit,
        recorded_at: now,
        task_id: options.taskId || null,
        incident_id: options.incidentId || null,
        metadata: options.metadata || {},
        recorded_by: options.recordedBy,
      }),
      description: 'Performance metric tracking',
      updated_by: options.recordedBy,
      updated_at: new Date(),
    })
    .onConflictDoUpdate({
      target: system_settings.key,
      set: {
        value: JSON.stringify({
          id,
          name: options.name,
          value: options.value,
          unit: options.unit,
          recorded_at: now,
          task_id: options.taskId || null,
          incident_id: options.incidentId || null,
          metadata: options.metadata || {},
          recorded_by: options.recordedBy,
        }),
        description: 'Performance metric tracking',
        updated_by: options.recordedBy,
        updated_at: new Date(),
      },
    })
    .returning({
      key: system_settings.key,
      value: system_settings.value,
    });

  if (!row || !row.value) {
    throw new Error('Failed to record metric');
  }

  const metricData = JSON.parse(row.value as string);

  return {
    id: metricData.id,
    name: metricData.name,
    value: metricData.value,
    unit: metricData.unit,
    recorded_at: metricData.recorded_at,
    task_id: metricData.task_id,
    incident_id: metricData.incident_id,
    metadata: metricData.metadata,
  };
}

/** Get metrics by name. */
export async function getMetricsByName(
  name: string,
  page: number = 1,
  pageSize: number = 20
): Promise<{
  metrics: PerformanceMetric[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}> {
  // Count total metrics with this name
  const countResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(system_settings)
    .where(sql`${system_settings.key}.like('metric_%') AND JSON_EXTRACT(${system_settings.value}, '$.name') = ${name}`);

  const totalCount = Number(countResult[0]?.count || 0);

  // Get metrics for the current page
  const allMetrics = await db
    .select()
    .from(system_settings)
    .where(sql`${system_settings.key}.like('metric_%')`)
    .orderBy(desc(system_settings.key))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const metrics: PerformanceMetric[] = [];
  for (const row of allMetrics) {
    if (row.value) {
      const metricData = JSON.parse(row.value as string);
      if (metricData.name === name) {
        metrics.push({
          id: metricData.id,
          name: metricData.name,
          value: metricData.value,
          unit: metricData.unit,
          recorded_at: metricData.recorded_at,
          task_id: metricData.task_id,
          incident_id: metricData.incident_id,
          metadata: metricData.metadata,
        });
      }
    }
  }

  return {
    metrics,
    total: totalCount,
    page,
    pageSize,
    totalPages: Math.ceil(totalCount / pageSize),
  };
}

/** Get recent performance metrics. */
export async function getRecentMetrics(
  limit: number = 50
): Promise<PerformanceMetric[]> {
  const allMetrics = await db
    .select()
    .from(system_settings)
    .where(sql`${system_settings.key}.like('metric_%')`)
    .orderBy(desc(system_settings.key))
    .limit(limit);

  const metrics: PerformanceMetric[] = [];
  for (const row of allMetrics) {
    if (row.value) {
      const metricData = JSON.parse(row.value as string);
      metrics.push({
        id: metricData.id,
        name: metricData.name,
        value: metricData.value,
        unit: metricData.unit,
        recorded_at: metricData.recorded_at,
        task_id: metricData.task_id,
        incident_id: metricData.incident_id,
        metadata: metricData.metadata,
      });
    }
  }

  return metrics;
}

/** Get system resource metrics summary. */
export async function getSystemResourceMetrics(): Promise<{
  totalMetrics: number;
  metricsByName: Record<string, PerformanceMetric[]>;
  recentMetrics: PerformanceMetric[];
}> {
  // Get all metrics
  const allMetrics = await db
    .select()
    .from(system_settings)
    .where(sql`${system_settings.key}.like('metric_%')`);

  const metricsByName: Record<string, PerformanceMetric[]> = {};
  const metrics: PerformanceMetric[] = [];

  for (const row of allMetrics) {
    if (row.value) {
      const metricData = JSON.parse(row.value as string);
      const name = metricData.name;

      if (!metricsByName[name]) {
        metricsByName[name] = [];
      }

      const metric: PerformanceMetric = {
        id: metricData.id,
        name,
        value: metricData.value,
        unit: metricData.unit,
        recorded_at: metricData.recorded_at,
        task_id: metricData.task_id,
        incident_id: metricData.incident_id,
        metadata: metricData.metadata,
      };

      metricsByName[name].push(metric);
      metrics.push(metric);
    }
  }

  // Get recent metrics (newest first)
  const recentMetrics = metrics.slice(0, 20);

  return {
    totalMetrics: allMetrics.length,
    metricsByName,
    recentMetrics,
  };
}

/** Record a task execution duration metric. */
export async function recordTaskDuration(
  taskId: string,
  durationMs: number,
  performedBy: string,
  incidentId?: string
): Promise<PerformanceMetric> {
  return recordMetric({
    name: 'task_duration_ms',
    value: durationMs,
    unit: 'ms',
    taskId: taskId,
    incidentId: incidentId,
    metadata: { task: taskId },
    recordedBy: performedBy,
  });
}

/** Record a system health check metric. */
export async function recordHealthCheckMetric(
  checkName: string,
  status: 'healthy' | 'degraded' | 'unhealthy',
  performedBy: string
): Promise<PerformanceMetric> {
  const statusValue = { healthy: 1, degraded: 2, unhealthy: 3 }[status] as number;

  return recordMetric({
    name: `healthcheck_${checkName}`,
    value: statusValue,
    unit: 'status',
    metadata: { check: checkName, status },
    recordedBy: performedBy,
  });
}
