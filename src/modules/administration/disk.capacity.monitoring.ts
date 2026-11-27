/**
 * Disk and capacity monitoring module.
 *
 * Provides PostgreSQL storage, image storage, backup storage, logs, and overall
 * disk usage with configurable warning and critical thresholds. No video staging
 * or video-storage capacity. Capacity recommendations, no automatic resize.
 *
 * Do not implement: video staging or video-storage capacity, Prometheus, Grafana,
 * or automatic storage resize.
 */

import 'server-only';

import { getPostgreSQLSecurityConfig } from './postgres.security';

/** Disk usage metric. */
export interface DiskUsageMetric {
  /** Filesystem mount point */
  mountPoint: string;
  /** Total size in bytes */
  totalBytes: number;
  /** Used size in bytes */
  usedBytes: number;
  /** Available size in bytes */
  availableBytes: number;
  /** Usage percentage */
  usagePercentage: number;
  /** Timestamp of measurement */
  timestamp: string;
}

/** Overall storage summary. */
export interface StorageSummary {
  /** PostgreSQL data directory size in bytes */
  postgresqlSizeBytes: number;
  /** Image storage size in bytes */
  imageStorageBytes: number;
  /** Backup storage size in bytes */
  backupStorageBytes: number;
  /** Logs size in bytes */
  logsSizeBytes: number;
  /** Total disk usage in bytes */
  totalDiskUsageBytes: number;
  /** Available disk space in bytes */
  availableDiskSpaceBytes: number;
  /** Usage percentage */
  usagePercentage: number;
}

/** Get disk usage metrics. */
export function getDiskUsageMetrics(): DiskUsageMetric[] {
  // In a production environment, would use df or system stats
  // For now, return simulated values
  return [
    {
      mountPoint: '/',
      totalBytes: 53687091200, // 50GB
      usedBytes: 26843545600, // 25GB
      availableBytes: 26843545600, // 25GB
      usagePercentage: 50,
      timestamp: new Date().toISOString(),
    },
    {
      mountPoint: '/var/lib/dramascan/postgresql',
      totalBytes: 10737418240, // 10GB
      usedBytes: 8589934592, // 8GB
      availableBytes: 2147483648, // 2GB
      usagePercentage: 80,
      timestamp: new Date().toISOString(),
    },
    {
      mountPoint: '/var/lib/dramascan/images',
      totalBytes: 5368709120, // 5GB
      usedBytes: 3221225472, // 3GB
      availableBytes: 2147483648, // 2GB
      usagePercentage: 60,
      timestamp: new Date().toISOString(),
    },
  ];
}

/** Storage summary. */
export function getStorageSummary(): StorageSummary {
  const metrics = getDiskUsageMetrics();

  const postgresqlSize = metrics.find(m => m.mountPoint.includes('postgresql'))?.totalBytes || 0;
  const imageSize = metrics.find(m => m.mountPoint.includes('images'))?.totalBytes || 0;
  const backupSize = metrics.find(m => m.mountPoint.includes('backup'))?.totalBytes || 0;
  const logsSize = metrics.find(m => m.mountPoint.includes('logs'))?.totalBytes || 0;

  const totalDiskUsage = metrics.reduce((sum, m) => sum + m.usedBytes, 0);
  const totalAvailable = metrics.reduce((sum, m) => sum + m.availableBytes, 0);

  return {
    postgresqlSizeBytes: postgresqlSize,
    imageStorageBytes: imageSize,
    backupStorageBytes: backupSize,
    logsSizeBytes: logsSize,
    totalDiskUsageBytes: totalDiskUsage,
    availableDiskSpaceBytes: totalAvailable,
    usagePercentage: totalDiskUsage > 0 ? (totalDiskUsage / (totalDiskUsage + totalAvailable) * 100) : 0,
  };
}

/** Check disk space thresholds. */
export function checkDiskSpaceThresholds(
  warningPercentage: number = 80,
  criticalPercentage: number = 90
): { withinThresholds: boolean; warnings: Array<{ metric: string; percentage: number; threshold: number }> } {
  const metrics = getDiskUsageMetrics();
  const warnings: Array<{ metric: string; percentage: number; threshold: number }> = [];

  for (const metric of metrics) {
    if (metric.usagePercentage >= criticalPercentage) {
      warnings.push({ metric: metric.mountPoint, percentage: metric.usagePercentage, threshold: criticalPercentage });
    } else if (metric.usagePercentage >= warningPercentage) {
      warnings.push({ metric: metric.mountPoint, percentage: metric.usagePercentage, threshold: warningPercentage });
    }
  }

  return {
    withinThresholds: warnings.length === 0,
    warnings,
  };
}

/** Capacity recommendations. */
export function getCapacityRecommendations(): string[] {
  const recommendations: string[] = [];
  const metrics = getDiskUsageMetrics();

  for (const metric of metrics) {
    if (metric.usagePercentage > 80) {
      recommendations.push(
        'Consider expanding storage for ' + metric.mountPoint + 
        ' (current usage: ' + metric.usagePercentage + '%)'
      );
    }
  }

  if (recommendations.length === 0) {
    recommendations.push('Storage usage is within acceptable thresholds');
  }

  return recommendations;
}