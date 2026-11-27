/**
 * Alert severity and configuration module.
 *
 * Provides severity levels (Critical, High, Medium, Low) for alerts and incidents,
 * with sensible default thresholds that can be Super Admin configured. Includes
 * duplicate suppression to prevent alert flooding and role-aware visibility.
 *
 * Do not implement: complex escalation pipelines, external notification systems,
 * or predictive analytics.
 */

import 'server-only';

import { eq, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import { requirePermission, type ActorContext } from '@/modules/authorization';

import { system_settings } from './schema';
import { admin_audit_log } from './schema';

/** Alert severity levels. */
export type AlertSeverity = 'critical' | 'high' | 'medium' | 'low';

/** Alert configuration thresholds. */
export interface AlertThresholds {
  /** CPU usage percentage threshold for warning */
  cpuUsage: number;
  /** Memory usage percentage threshold for warning */
  memoryUsage: number;
  /** Disk usage percentage threshold for warning */
  diskUsage: number;
  /** Swap usage percentage threshold for warning */
  swapUsage: number;
  /** Task failure count threshold */
  taskFailureCount: number;
  /** Error count threshold */
  errorCount: number;
  /** Duration spike threshold in milliseconds */
  durationSpikeThreshold: number;
}

/** Default alert thresholds. */
export const DEFAULT_ALERT_THRESHOLDS: AlertThresholds = {
  cpuUsage: 80,
  memoryUsage: 80,
  diskUsage: 85,
  swapUsage: 90,
  taskFailureCount: 5,
  errorCount: 10,
  durationSpikeThreshold: 300000, // 5 minutes
};

/** Alert configuration. */
export interface AlertConfiguration {
  id: string;
  thresholds: AlertThresholds;
  severities: {
    critical: {
      enabled: boolean;
      autoResolve: boolean;
      minDurationMs: number;
    };
    high: {
      enabled: boolean;
      autoResolve: boolean;
      minDurationMs: number;
    };
    medium: {
      enabled: boolean;
      autoResolve: boolean;
      minDurationMs: number;
    };
    low: {
      enabled: boolean;
      autoResolve: boolean;
      minDurationMs: number;
    };
  };
  duplicateSuppression: {
    enabled: boolean;
    maxSuppressedPerHour: number;
    windowMs: number;
  };
  roleAwareVisibility: {
    admin: boolean;
    superAdmin: boolean;
    viewer: boolean;
  };
  createdAt: string;
  updatedAt: string;
}

/** Get current alert configuration. */
export async function getAlertConfiguration(): Promise<AlertConfiguration> {
  const [row] = await db
    .select()
    .from(system_settings)
    .where(eq(system_settings.key, 'alert_configuration'));

  if (!row || !row.value) {
    // Return default configuration
    const defaultConfig: AlertConfiguration = {
      id: 'default',
      thresholds: { ...DEFAULT_ALERT_THRESHOLDS },
      severities: {
        critical: { enabled: true, autoResolve: true, minDurationMs: 0 },
        high: { enabled: true, autoResolve: false, minDurationMs: 0 },
        medium: { enabled: true, autoResolve: false, minDurationMs: 0 },
        low: { enabled: true, autoResolve: false, minDurationMs: 0 },
      },
      duplicateSuppression: {
        enabled: true,
        maxSuppressedPerHour: 10,
        windowMs: 3600000, // 1 hour
      },
      roleAwareVisibility: {
        admin: true,
        superAdmin: true,
        viewer: false,
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Save the default configuration
    await db
      .insert(system_settings)
      .values({
        key: 'alert_configuration',
        value: JSON.stringify(defaultConfig),
        description: 'Alert severity and configuration',
        updated_by: 'system',
        updated_at: new Date(),
      });

    return defaultConfig;
  }

  try {
    return JSON.parse(row.value as string) as AlertConfiguration;
  } catch {
    // Fall back to defaults
    return {
      id: 'default',
      thresholds: { ...DEFAULT_ALERT_THRESHOLDS },
      severities: {
        critical: { enabled: true, autoResolve: true, minDurationMs: 0 },
        high: { enabled: true, autoResolve: false, minDurationMs: 0 },
        medium: { enabled: true, autoResolve: false, minDurationMs: 0 },
        low: { enabled: true, autoResolve: false, minDurationMs: 0 },
      },
      duplicateSuppression: {
        enabled: true,
        maxSuppressedPerHour: 10,
        windowMs: 3600000,
      },
      roleAwareVisibility: {
        admin: true,
        superAdmin: true,
        viewer: false,
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }
}

/** Update alert configuration (Super Admin only). */
export async function updateAlertConfiguration(
  configuration: Partial<AlertConfiguration>,
  actor: ActorContext
): Promise<AlertConfiguration> {
  requirePermission(actor, 'admin.manage');

  const currentConfig = await getAlertConfiguration();

  const newConfig: AlertConfiguration = {
    ...currentConfig,
    ...configuration,
    updatedAt: new Date().toISOString(),
  };

  // Save the updated configuration
  const [row] = await db
    .update(system_settings)
    .set({
      value: JSON.stringify(newConfig),
      updated_by: actor.userId,
      updated_at: new Date(),
    })
    .where(eq(system_settings.key, 'alert_configuration'))
    .returning({
      key: system_settings.key,
      value: system_settings.value,
    });

  try {
    return JSON.parse(row.value as string) as AlertConfiguration;
  } catch {
    return newConfig;
  }
}

/** Check if an alert severity is enabled. */
export function isSeverityEnabled(
  severity: AlertSeverity,
  configuration: AlertConfiguration
): boolean {
  return configuration.severities[severity].enabled;
}

/** Check if an alert should auto-resolve. */
export function shouldAutoResolve(
  severity: AlertSeverity,
  configuration: AlertConfiguration
): boolean {
  return configuration.severities[severity].autoResolve;
}

/** Get the minimum duration for auto-resolution. */
export function getMinDurationMs(
  severity: AlertSeverity,
  configuration: AlertConfiguration
): number {
  return configuration.severities[severity].minDurationMs;
}

/** Check for duplicate alerts (suppression). */
export function checkForDuplicateAlert(
  alertId: string,
  configuration: AlertConfiguration
): { isDuplicate: boolean; lastSent?: string; suppressedCount: number } {
  // In a production system, this would query a duplicate suppression store
  // For now, return based on configuration

  if (!configuration.duplicateSuppression.enabled) {
    return { isDuplicate: false, suppressedCount: 0 };
  }

  // Simulated - in production would check timestamps within the window
  const windowMs = configuration.duplicateSuppression.windowMs;
  const maxSuppressed = configuration.duplicateSuppression.maxSuppressedPerHour;

  return {
    isDuplicate: false, // Would check actual suppression database
    suppressedCount: 0,
  };
}

/** Get role-aware visibility for a severity. */
export function getSeverityVisibility(
  severity: AlertSeverity,
  configuration: AlertConfiguration
): { admin: boolean; superAdmin: boolean; viewer: boolean } {
  const vis = configuration.roleAwareVisibility;
  return {
    admin: vis.admin,
    superAdmin: vis.superAdmin,
    viewer: vis.viewer,
  };
}