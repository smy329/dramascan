/**
 * PostgreSQL performance and maintenance module.
 *
 * Provides pg_stat_statements enabled, conservative autovacuum settings, slow
 * query monitoring, connection use, table growth, index health, and index
 * recommendations for review/approval.
 *
 * Do not implement: automatic index creation, automated vacuum scheduling
 * beyond conservative defaults, or cross-database performance tuning.
 */

import 'server-only';

import { getPostgreSQLSecurityConfig } from './postgres.security';

/** PostgreSQL performance metrics. */
export interface PostgreSQLPerformanceMetrics {
  /** Total number of connections */
  totalConnections: number;
  /** Active connections */
  activeConnections: number;
  /** Idle connections */
  idleConnections: number;
  /** Number of slow queries */
  slowQueryCount: number;
  /** Total disk usage in bytes */
  diskUsageBytes: number;
  /** Table size in bytes */
  totalTableSizeBytes: number;
  /** Index size in bytes */
  totalIndexSizeBytes: number;
}

/** Get PostgreSQL performance metrics. */
export function getPostgreSQLPerformanceMetrics(): PostgreSQLPerformanceMetrics {
  // In a production environment, would query pg_stat_database and pg_stat_user_tables
  // For now, return simulated values
  return {
    totalConnections: 15,
    activeConnections: 8,
    idleConnections: 7,
    slowQueryCount: 2,
    diskUsageBytes: 5368709120, // 5GB
    totalTableSizeBytes: 10737418240, // 10GB
    totalIndexSizeBytes: 2147483648, // 2GB
  };
}

/** PostgreSQL index health. */
export interface PostgreSQLIndexHealth {
  /** Index name */
  name: string;
  /** Table name */
  tableName: string;
  /** Whether index is usable */
  isUsable: boolean;
  /** Whether index is primary key */
  isPrimaryKey: boolean;
  /** Index usage statistics */
  usageCount: number;
  /** Last analyzed */
  lastAnalyzed: string | null;
  /** Recommendation */
  recommendation: 'keep' | 'rebuild' | 'drop' | 'analyze';
}

/** Get index health recommendations. */
export function getIndexHealthRecommendations(): PostgreSQLIndexHealth[] {
  // In a production environment, would query pg_stat_user_indexes
  // For now, return simulated values
  return [
    {
      name: 'idx_dramas_title',
      tableName: 'dramas',
      isUsable: true,
      isPrimaryKey: false,
      usageCount: 45,
      lastAnalyzed: new Date(Date.now() - 86400000).toISOString(), // 1 day ago
      recommendation: 'keep',
    },
    {
      name: 'idx_dramas_type',
      tableName: 'dramas',
      isUsable: true,
      isPrimaryKey: false,
      usageCount: 12,
      lastAnalyzed: new Date(Date.now() - 604800000).toISOString(), // 7 days ago
      recommendation: 'analyze',
    },
  ];
}

/** Table growth monitoring. */
export interface TableGrowthMonitoring {
  /** Table name */
  tableName: string;
  /** Current size in bytes */
  currentSizeBytes: number;
  /** Estimated growth per day in bytes */
  growthPerDayBytes: number;
  /** Estimated time until storage alert in days */
  daysUntilAlert: number;
  /** Recommendation */
  recommendation: 'monitor' | 'increase_storage' 'vacuum_analyze';
}

/** Get table growth monitoring. */
export function getTableGrowthMonitoring(): TableGrowthMonitoring[] {
  // In a production environment, would query pg_total_relation_size
  // For now, return simulated values
  return [
    {
      tableName: 'dramas',
      currentSizeBytes: 10737418240, // 10GB
      growthPerDayBytes: 10485760, // 10MB per day
      daysUntilAlert: 100, // 100 days until 11GB alert
      recommendation: 'monitor',
    },
    {
      tableName: 'episodes',
      currentSizeBytes: 5368709120, // 5GB
      growthPerDayBytes: 5242880, // 5MB per day
      daysUntilAlert: 200, // 200 days until 5.5GB alert
      recommendation: 'monitor',
    },
  ];
}

/** Slow query monitoring configuration. */
export interface SlowQueryMonitoringConfig {
  /** Query execution time threshold in milliseconds */
  thresholdMs: number;
  /** Enabled */
  enabled: boolean;
  /** Log destination */
  logDestination: string;
  /** Track Queries over */ track: 'none' | 'top' | 'all';
}

/** Get slow query monitoring configuration. */
export function getSlowQueryMonitoringConfig(): SlowQueryMonitoringConfig {
  const securityConfig = getPostgreSQLSecurityConfig();

  return {
    thresholdMs: 1000, // 1 second
    enabled: securityConfig.pgStatStatements,
    logDestination: 'stderr',
    track: 'all',
  };
}

/** Autovacuum conservative settings. */
export interface AutovacuumConservativeSettings {
  /** Vacuum scale factor */
  vacuumScaleFactor: string;
  /** Analyze scale factor */
  analyzeScaleFactor: string;
  /** Vacuum cost limit */
  vacuumCostLimit: number;
  /** Vacuum cost delay */
  vacuumCostDelay: string;
  /** Min vacuum degree */
  minVacuumDegree: number;
  /** Min analyze degree */
  minAnalyzeDegree: number;
}

/** Get conservative autovacuum settings. */
export function getConservativeAutovacuumSettings(): AutovacuumConservativeSettings {
  return {
    vacuumScaleFactor: '0.2', // More aggressive than default 0.2
    analyzeScaleFactor: '0.05',
    vacuumCostLimit: 1000,
    vacuumCostDelay: '10ms',
    minVacuumDegree: 1,
    minAnalyzeDegree: 1,
  };
}