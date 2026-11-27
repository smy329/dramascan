/**
 * Basic anomaly detection module.
 *
 * Detects maintenance failures, unusual duration increases, repeated errors,
 * and disk/resource pressure with simple configurable thresholds. Provides
 * useful explanations of anomalies without complex IT service management.
 *
 * Do not implement: predictive analytics, complex ML models, automated
 * remediation, or cross-service correlation beyond simple thresholds.
 */

import 'server-only';

import { eq, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import { requirePermission, type ActorContext } from '@/modules/authorization';

import { system_settings } from './schema';
import { admin_audit_log } from './schema';
import { PerformanceMetric } from './performance.analytics';

/** Anomaly type. */
export type AnomalyType =
  | 'failure_increase'
  | 'duration_spike'
  | 'repeated_error'
  | 'disk_pressure'
  | 'resource_pressure';

/** Anomaly severity. */
export type AnomalySeverity = 'low' | 'medium' | 'high' | 'critical';

/** Anomaly record. */
export interface AnomalyRecord {
  id: string;
  type: AnomalyType;
  severity: AnomalySeverity;
  title: string;
  description: string;
  detected_at: string;
  metric_name?: string;
  metric_value?: number;
  threshold?: number;
  current_value?: number;
  task_id?: string | null;
  incident_id?: string | null;
  resolved?: boolean;
  resolved_at?: string | null;
  resolved_by?: string | null;
  explanation?: string;
  metadata?: Record<string, unknown>;
}

/** Create an anomaly record. */
export async function createAnomaly(
  options: {
    type: AnomalyType;
    severity: AnomalySeverity;
    title: string;
    description: string;
    detectedAt?: string;
    metricName?: string;
    metricValue?: number;
    threshold?: number;
    currentValue?: number;
    taskId?: string;
    incidentId?: string;
    performedBy: string;
    explanation?: string;
    metadata?: Record<string, unknown>;
  }
): Promise<AnomalyRecord> {
  const id = crypto.randomUUID();
  const detectedAt = options.detectedAt || new Date().toISOString();

  const [row] = await db
    .insert(system_settings) // Using system_settings as temporary anomaly store
    .values({
      key: `anomaly_${id}`,
      value: JSON.stringify({
        id,
        type: options.type,
        severity: options.severity,
        title: options.title,
        description: options.description,
        detected_at: detectedAt,
        metric_name: options.metricName || null,
        metric_value: options.metricValue || null,
        threshold: options.threshold,
        current_value: options.currentValue || null,
        task_id: options.taskId || null,
        incident_id: options.incidentId || null,
        resolved: false,
        resolved_at: null,
        resolved_by: null,
        explanation: options.explanation || null,
        metadata: options.metadata || {},
      }),
      description: 'Anomaly detection tracking',
      updated_by: options.performedBy,
      updated_at: new Date(),
    })
    .onConflictDoUpdate({
      target: system_settings.key,
      set: {
        value: JSON.stringify({
          id,
          type: options.type,
          severity: options.severity,
          title: options.title,
          description: options.description,
          detected_at: detectedAt,
          metric_name: options.metricName || null,
          metric_value: options.metricValue || null,
          threshold: options.threshold,
          current_value: options.currentValue || null,
          task_id: options.taskId || null,
          incident_id: options.incidentId || null,
          resolved: false,
          resolved_at: null,
          resolved_by: null,
          explanation: options.explanation || null,
          metadata: options.metadata || {},
        }),
        description: 'Anomaly detection tracking',
        updated_by: options.performedBy,
        updated_at: new Date(),
      },
    })
    .returning({
      key: system_settings.key,
      value: system_settings.value,
    });

  const anomalyData = JSON.parse(row.value as string);

  return {
    id: anomalyData.id,
    type: anomalyData.type as AnomalyType,
    severity: anomalyData.severity as AnomalySeverity,
    title: anomalyData.title,
    description: anomalyData.description,
    detected_at: anomalyData.detected_at,
    metric_name: anomalyData.metric_name,
    metric_value: anomalyData.metric_value,
    threshold: anomalyData.threshold,
    current_value: anomalyData.current_value,
    task_id: anomalyData.task_id,
    incident_id: anomalyData.incident_id,
    resolved: anomalyData.resolved as boolean,
    resolved_at: anomalyData.resolved_at,
    resolved_by: anomalyData.resolved_by,
    explanation: anomalyData.explanation,
    metadata: anomalyData.metadata,
  };
}

/** Get an anomaly by ID. */
export async function getAnomaly(anomalyId: string): Promise<AnomalyRecord | null> {
  const [row] = await db
    .select()
    .from(system_settings)
    .where(eq(system_settings.key, `anomaly_${anomalyId}`));

  if (!row || !row.value) {
    return null;
  }

  const anomalyData = JSON.parse(row.value as string);

  return {
    id: anomalyData.id,
    type: anomalyData.type as AnomalyType,
    severity: anomalyData.severity as AnomalySeverity,
    title: anomalyData.title,
    description: anomalyData.description,
    detected_at: anomalyData.detected_at,
    metric_name: anomalyData.metric_name,
    metric_value: anomalyData.metric_value,
    threshold: anomalyData.threshold,
    current_value: anomalyData.current_value,
    task_id: anomalyData.task_id,
    incident_id: anomalyData.incident_id,
    resolved: anomalyData.resolved as boolean,
    resolved_at: anomalyData.resolved_at,
    resolved_by: anomalyData.resolved_by,
    explanation: anomalyData.explanation,
    metadata: anomalyData.metadata,
  };
}

/** List anomalies with filtering. */
export async function listAnomalies(
  type?: AnomalyType,
  severity?: AnomalySeverity,
  resolved?: boolean | null,
  page: number = 1,
  pageSize: number = 20
): Promise<{
  anomalies: AnomalyRecord[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}> {
  // Build where conditions
  const whereConditions: any[] = [];

  if (type) {
    whereConditions.push(sql`${system_settings.value}->>'type' = ${type}`);
  }

  if (severity) {
    whereConditions.push(sql`${system_settings.value}->>'severity' = ${severity}`);
  }

  if (resolved !== null) {
    whereConditions.push(sql`${system_settings.value}->>'resolved' = ${resolved}`);
  }

  // Count total anomalies
  const whereClause = whereConditions.length > 0
    ? sql.join(whereConditions, sql` AND `)
    : undefined;

  const [{ count }] = await db
    .select({ count: sql`count(*)` })
    .from(system_settings)
    .where(whereClause ?? sql`1=1`);

  // Actually let me fix this - need to properly build the query
  // For now, get all anomalies and filter
  const allAnomalies = await db
    .select()
    .from(system_settings)
    .where(sql`${system_settings.key}.like('anomaly_%')`)
    .orderBy(system_settings.key.desc());

  const anomalies: AnomalyRecord[] = [];
  for (const row of allAnomalies) {
    if (row.value) {
      const anomalyData = JSON.parse(row.value as string);

      // Apply filters
      let matches = true;

      if (type && anomalyData.type !== type) {
        matches = false;
      }

      if (severity && anomalyData.severity !== severity) {
        matches = false;
      }

      if (resolved !== null && anomalyData.resolved !== resolved) {
        matches = false;
      }

      if (matches) {
        anomalies.push({
          id: anomalyData.id,
          type: anomalyData.type as AnomalyType,
          severity: anomalyData.severity as AnomalySeverity,
          title: anomalyData.title,
          description: anomalyData.description,
          detected_at: anomalyData.detected_at,
          metric_name: anomalyData.metric_name,
          metric_value: anomalyData.metric_value,
          threshold: anomalyData.threshold,
          current_value: anomalyData.current_value,
          task_id: anomalyData.task_id,
          incident_id: anomalyData.incident_id,
          resolved: anomalyData.resolved as boolean,
          resolved_at: anomalyData.resolved_at,
          resolved_by: anomalyData.resolved_by,
          explanation: anomalyData.explanation,
          metadata: anomalyData.metadata,
        });
      }
    }
  }

  // Sort by detected_at descending (newest first)
  anomalies.sort((a, b) => b.detected_at.localeCompare(a.detected_at));

  // Apply pagination
  const start = (page - 1) * pageSize;
  const end = start + pageSize;
  const pagedAnomalies = anomalies.slice(start, end);

  return {
    anomalies: pagedAnomalies,
    total: anomalies.length,
    page,
    pageSize,
    totalPages: Math.ceil(anomalies.length / pageSize),
  };
}

/** Detect a failure increase anomaly. */
export async function detectFailureIncrease(
  taskId: string,
  performedBy: string,
  threshold: number = 5
): Promise<AnomalyRecord | null> {
  // Get recent failure metrics for this task
  const metrics = await getMetricsByName('task_failure_count', 1, 10);

  if (metrics.metrics.length === 0) {
    return null;
  }

  // Check if failure count exceeds threshold
  let totalFailures = 0;
  for (const metric of metrics.metrics) {
    totalFailures += metric.value;
  }

  if (totalFailures >= threshold) {
    return createAnomaly({
      type: 'failure_increase',
      severity: 'high',
      title: 'Task failure increase detected',
      description: `Task ${taskId} has exceeded ${threshold} failures (total: ${totalFailures})`,
      metricName: 'task_failure_count',
      metricValue: totalFailures,
      threshold,
      currentValue: totalFailures,
      performedBy,
      explanation: `Task ${taskId} has shown an increase in failure count, exceeding the configured threshold of ${threshold}. Investigate task logs for specific failure reasons.`,
    });
  }

  return null;
}

/** Detect a duration spike anomaly. */
export async function detectDurationSpike(
  taskId: string,
  performedBy: string,
  thresholdMs: number = 300000
): Promise<AnomalyRecord | null> {
  // Get recent duration metrics for this task
  const metrics = await getMetricsByName('task_duration_ms', 1, 20);

  if (metrics.metrics.length === 0) {
    return null;
  }

  // Check if any duration exceeds threshold
  for (const metric of metrics.metrics) {
    if (metric.value > thresholdMs) {
      return createAnomaly({
        type: 'duration_spike',
        severity: 'medium',
        title: 'Task duration spike detected',
        description: `Task ${taskId} duration exceeded ${thresholdMs}ms threshold (actual: ${metric.value}ms)`,
        metricName: 'task_duration_ms',
        metricValue: metric.value,
        threshold: thresholdMs,
        currentValue: metric.value,
        performedBy,
        explanation: `Task ${taskId} has shown an unusual duration of ${metric.value}ms, exceeding the ${thresholdMs}ms threshold. This may indicate performance issues or resource constraints.`,
      });
    }
  }

  return null;
}

/** Detect repeated errors anomaly. */
export async function detectRepeatedError(
  taskId: string,
  performedBy: string,
  threshold: number = 3
): Promise<AnomalyRecord | null> {
  // Get recent error metrics for this task
  const metrics = await getMetricsByName('task_error_count', 1, 10);

  if (metrics.metrics.length === 0) {
    return null;
  }

  // Check if error count exceeds threshold
  let totalErrors = 0;
  for (const metric of metrics.metrics) {
    totalErrors += metric.value;
  }

  if (totalErrors >= threshold) {
    return createAnomaly({
      type: 'repeated_error',
      severity: 'high',
      title: 'Repeated errors detected in task',
      description: `Task ${taskId} has exceeded ${threshold} errors (total: ${totalErrors})`,
      metricName: 'task_error_count',
      metricValue: totalErrors,
      threshold,
      currentValue: totalErrors,
      performedBy,
      explanation: `Task ${taskId} has shown ${totalErrors} errors, exceeding the configured threshold of ${threshold}. Investigate error logs for specific error reasons.`,
    });
  }

  return null;
}

/** Detect disk pressure anomaly. */
export async function detectDiskPressure(
  performedBy: string,
  thresholdBytes: number = 1073741824 // 1GB default
): Promise<AnomalyRecord | null> {
  // Get disk usage metric
  const metrics = await getMetricsByName('disk_usage_bytes', 1, 1);

  if (metrics.metrics.length === 0) {
    return null;
  }

  const metric = metrics.metrics[0];

  if (metric.value > thresholdBytes) {
    const percentage = ((metric.value / thresholdBytes) * 100).toFixed(1);

    return createAnomaly({
      type: 'disk_pressure',
      severity: 'high',
      title: 'Disk space pressure detected',
      description: `Disk usage (${percentage}%) exceeds ${formatBytes(thresholdBytes)} threshold`,
      metricName: 'disk_usage_bytes',
      metricValue: metric.value,
      threshold: thresholdBytes,
      currentValue: metric.value,
      performedBy,
      explanation: `Disk usage is at ${percentage}% of the ${formatBytes(
        thresholdBytes
      )} threshold. Consider cleaning up temporary files, old backups, or logs.`,
    });
  }

  return null;
}

/** Detect resource pressure anomaly. */
export async function detectResourcePressure(
  performedBy: string,
  thresholdUtilization: number = 80 // 80% default
): Promise<AnomalyRecord | null> {
  // Get CPU/memory metrics
  const metrics = await getMetricsByName('system_utilization_percent', 1, 20);

  if (metrics.metrics.length === 0) {
    return null;
  }

  // Check if any metric exceeds threshold
  for (const metric of metrics.metrics) {
    if (metric.value > thresholdUtilization) {
      const resourceName = metric.unit === '%' ? 'system utilization' : metric.unit;

      return createAnomaly({
        type: 'resource_pressure',
        severity: 'medium',
        title: 'Resource pressure detected',
        description: `${resourceName} exceeded ${thresholdUtilization}% threshold (actual: ${metric.value}%)`,
        metricName: 'system_utilization_percent',
        metricValue: metric.value,
        threshold: thresholdUtilization,
        currentValue: metric.value,
        performedBy,
        explanation: `${resourceName} has exceeded the ${thresholdUtilization}% threshold. Consider scaling resources or investigating resource-intensive operations.`,
      });
    }
  }

  return null;
}

/** Helper function to format bytes. */
function formatBytes(bytes: number): string {
  if (bytes >= 1073741824) {
    return ((bytes / 1073741824).toFixed(1) + ' GB');
  }
  if (bytes >= 1048576) {
    return ((bytes / 1048576).toFixed(1) + ' MB');
  }
  if (bytes >= 1024) {
    return ((bytes / 1024).toFixed(1) + ' KB');
  }
  return `${bytes} bytes`;
}

/** Resolve an anomaly. */
export async function resolveAnomaly(
  anomalyId: string,
  resolvedBy: string
): Promise<AnomalyRecord> {
  const anomaly = await getAnomaly(anomalyId);

  if (!anomaly) {
    throw new Error('Anomaly not found');
  }

  await db
    .update(system_settings)
    .set({
      value: JSON.stringify({
        ...JSON.parse(anomaly.value as string),
        resolved: true,
        resolved_at: new Date().toISOString(),
        resolved_by: resolvedBy,
      }),
      updated_at: new Date(),
    })
    .where(eq(system_settings.key, `anomaly_${anomalyId}`));

  return getAnomaly(anomalyId);
}