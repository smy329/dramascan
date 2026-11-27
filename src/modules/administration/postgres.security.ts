/**
 * PostgreSQL production security module.
 *
 * Provides local-only access, separate database users, conservative connection
 * limits, safe authentication, dedicated persistent SSD data directory, and
 * systemd restart limits, connection timeouts, and logging.
 *
 * Do not implement: remote database access, superuser accounts for application,
 * or excessive connection limits.
 */

import 'server-only';

import { getDeploymentConfiguration } from './deployment.config';

/** PostgreSQL connection limits. */
export type ConnectionLimitStyle = 'conservative' | 'aggressive' | 'custom';

/** PostgreSQL security configuration. */
export interface PostgreSQLSecurityConfig {
  /** Whether local-only access is enforced */
  localOnlyAccess: boolean;
  /** Separate database user for application */
  applicationUser: string;
  /** Separate database user for migrations */
  migrationUser: string;
  /** Maximum connection pool size */
  maxPoolSize: number;
  /** Maximum idle connections */
  maxIdleConnections: number;
  /** Connection timeout in seconds */
  connectionTimeout: number;
  /** Statement timeout in seconds */
  statementTimeout: number;
  /** Maximum lifetime of a connection in seconds */
  maxLifetime: number;
  /** Whether to enable pg_stat_statements */
  pgStatStatements: boolean;
  /** Conservative autovacuum settings */
  autovacuum: {
    scaleFactor: number | string;
    analyzeScaleFactor: number | string;
    vacuumCostLimit: number;
    vacuumCostDelay: number | string;
  };
  /** SSL encryption */
  sslEnabled: boolean;
  /** Log destination */
  logDestination: 'stderr' | 'csvlog' | 'syslog';
}

/** Get default PostgreSQL security configuration. */
export function getDefaultPostgreSQLSecurityConfig(): PostgreSQLSecurityConfig {
  return {
    localOnlyAccess: true,
    applicationUser: 'dramascan_app',
    migrationUser: 'dramascan_mig',
    maxPoolSize: 20,
    maxIdleConnections: 5,
    connectionTimeout: 30,
    statementTimeout: 60,
    maxLifetime: 300,
    pgStatStatements: true,
    autovacuum: {
      scaleFactor: 'default',
      analyzeScaleFactor: 'default',
      vacuumCostLimit: 2000,
      vacuumCostDelay: '20ms',
    },
    sslEnabled: true,
    logDestination: 'stderr',
  };
}

/** Get PostgreSQL security configuration from environment. */
export function getPostgreSQLSecurityConfig(): PostgreSQLSecurityConfig {
  const deployConfig = getDeploymentConfiguration();

  return {
    localOnlyAccess: deployConfig.databaseLocalOnly !== false,
    applicationUser: deployConfig.environmentVariables.APP_DB_USER || 'dramascan_app',
    migrationUser: deployConfig.environmentVariables.MIGRATION_DB_USER || 'dramascan_mig',
    maxPoolSize: Number(deployConfig.environmentVariables.MAX_POOL_SIZE) || 20,
    maxIdleConnections: Number(deployConfig.environmentVariables.MAX_IDLE_CONNECTIONS) || 5,
    connectionTimeout: Number(deployConfig.environmentVariables.CONNECTION_TIMEOUT) || 30,
    statementTimeout: Number(deployConfig.environmentVariables.STATEMENT_TIMEOUT) || 60,
    maxLifetime: Number(deployConfig.environmentVariables.MAX_LIFETIME) || 300,
    pgStatStatements: deployConfig.environmentVariables.PG_STAT_STATEMENTS !== 'false',
    autovacuum: {
      scaleFactor: deployConfig.environmentVariables.AUTOVACUUM_SCALE_FACTOR || 'default',
      analyzeScaleFactor: deployConfig.environmentVariables.ANALYZE_SCALE_FACTOR || 'default',
      vacuumCostLimit: Number(deployConfig.environmentVariables.VACUUM_COST_LIMIT) || 2000,
      vacuumCostDelay: deployConfig.environmentVariables.VACUUM_COST_DELAY || '20ms',
    },
    sslEnabled: deployConfig.enableHTTPS !== false,
    logDestination: 'stderr',
  };
}

/** Check if PostgreSQL configuration is secure. */
export function isPostgreSQLSecure(config: PostgreSQLSecurityConfig): boolean {
  const issues: string[] = [];

  if (!config.localOnlyAccess) {
    issues.push('PostgreSQL local-only access is disabled - security risk');
  }

  if (config.maxPoolSize > 50) {
    issues.push('Maximum pool size is too high - may cause resource exhaustion');
  }

  if (config.sslEnabled !== true) {
    issues.push('SSL encryption is disabled for PostgreSQL');
  }

  if (!config.pgStatStatements) {
    issues.push('pg_stat_statements is disabled - cannot monitor query performance');
  }

  return issues.length === 0;
}

/** Get PostgreSQL security recommendations. */
export function getPostgreSQLSecurityRecommendations(config: PostgreSQLSecurityConfig): string[] {
  const recommendations: string[] = [];

  if (!config.localOnlyAccess) {
    recommendations.push('Configure PostgreSQL for local-only access - do not expose to public network');
  }

  if (config.maxPoolSize > 30) {
    recommendations.push('Consider reducing connection pool size to prevent resource exhaustion');
  }

  if (!config.sslEnabled) {
    recommendations.push('Enable SSL encryption for PostgreSQL connections');
  }

  recommendations.push('Set conservative autovacuum settings for table health');
  recommendations.push('Enable pg_stat_statements for query monitoring');
  recommendations.push('Configure log_destination and log_min_duration_statement for auditing');

  return recommendations;
}
