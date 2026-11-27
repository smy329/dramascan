/**
 * Secure deployment configuration module.
 *
 * Provides Ubuntu 24.04 LTS, Nginx, systemd, PostgreSQL, and Node.js runtime
 * configuration. Includes secrets in server environment configuration, disabling
 * unnecessary services, and ensuring the database is not publicly exposed.
 *
 * Do not implement: Docker or Docker Compose, external object storage, or
 * cross-region replication.
 */

import 'server-only';

import { getAlertConfiguration } from './alert.severity';

/** Deployment platform. */
export type DeploymentPlatform = 'ubuntu-24.04' | 'digitalocean' | 'aws' | 'azure';

/** Deployment configuration. */
export interface DeploymentConfiguration {
  platform: DeploymentPlatform;
  nodeVersion: string;
  nginxVersion: string;
  postgresVersion: string;
  /** Whether to enable HTTPS via Let's Encrypt */
  enableHTTPS: boolean;
  /** Whether to disable unnecessary services */
  disableUnnecessaryServices: boolean;
  /** Whether database is local-only */
  databaseLocalOnly: boolean;
  /** Custom environment variables (excluding secrets) */
  environmentVariables: Record<string, string>;
}

/** Get default deployment configuration. */
export function getDefaultDeploymentConfiguration(): DeploymentConfiguration {
  return {
    platform: 'ubuntu-24.04',
    nodeVersion: '20.x',
    nginxVersion: '1.26.x',
    postgresVersion: '16.x',
    enableHTTPS: true,
    disableUnnecessaryServices: true,
    databaseLocalOnly: true,
    environmentVariables: {
      NODE_ENV: 'production',
      PORT: '3000',
    },
  };
}

/** Get deployment configuration from environment. */
export function getDeploymentConfiguration(): DeploymentConfiguration {
  const platform = (process.env.DEPLOYMENT_PLATFORM || 'ubuntu-24.04') as DeploymentPlatform;

  return {
    platform,
    nodeVersion: process.env.NODE_VERSION || '20.x',
    nginxVersion: process.env.NGINX_VERSION || '1.26.x',
    postgresVersion: process.env.POSTGRES_VERSION || '16.x',
    enableHTTPS: process.env.ENABLE_HTTPS !== 'false',
    disableUnnecessaryServices: process.env.DISABLE_UNNECESSARY_SERVICES !== 'false',
    databaseLocalOnly: process.env.DATABASE_LOCAL_ONLY !== 'false',
    environmentVariables: {
      NODE_ENV: process.env.NODE_ENV || 'production',
      PORT: process.env.PORT || '3000',
      // Note: Database credentials should NOT be included here;
      // use separate secure secret management
    },
  };
}

/** Check if deployment is secure. */
export function isDeploymentSecure(config: DeploymentConfiguration): boolean {
  const issues: string[] = [];

  if (config.platform !== 'ubuntu-24.04') {
    issues.push('Non-Ubuntu 24.04 platform may have different security defaults');
  }

  if (!config.enableHTTPS) {
    issues.push('HTTPS is disabled - recommended for production');
  }

  if (!config.disableUnnecessaryServices) {
    issues.push('Unnecessary services may be running');
  }

  if (!config.databaseLocalOnly) {
    issues.push('Database is not local-only - security risk');
  }

  if (Object.keys(config.environmentVariables).some(
    key => key.toLowerCase().includes('password') || key.toLowerCase().includes('secret') || key.toLowerCase().includes('token')
  )) {
    issues.push('Environment variables contain potential secrets');
  }

  return issues.length === 0;
}

/** Get security recommendations. */
export function getSecurityRecommendations(config: DeploymentConfiguration): string[] {
  const recommendations: string[] = [];

  if (!config.enableHTTPS) {
    recommendations.push('Enable HTTPS using Let''s Encrypt or provided SSL certificate');
  }

  if (config.disableUnnecessaryServices) {
    recommendations.push('Disable unused services to reduce attack surface');
  }

  if (config.databaseLocalOnly) {
    recommendations.push('Ensure PostgreSQL is configured for local-only access');
  }

  recommendations.push('Store secrets in dedicated secret management, not in environment variables');
  recommendations.push('Use strong, rotated passwords for all service accounts');
  recommendations.push('Configure firewall to only allow necessary ports');

  return recommendations;
}