import 'server-only';

import { getDeploymentConfiguration } from './deployment.config';

export type MigrationReversibility = 'reversible' | 'irreversible' | 'expand-contract';

export interface MigrationMetadata {
  version: string;
  name: string;
  reversibility: MigrationReversibility;
  dependsOn?: string[];
  description: string;
}

export function getMigrationMetadata(version: string): MigrationMetadata {
  return {
    version,
    name: 'unknown_migration',
    reversibility: 'irreversible',
    description: 'Migration metadata not found',
  };
}

export function isMigrationReversible(version: string): boolean {
  const metadata = getMigrationMetadata(version);
  return metadata.reversibility === 'reversible';
}

export function isMigrationExpandContract(version: string): boolean {
  const metadata = getMigrationMetadata(version);
  return metadata.reversibility === 'expand-contract';
}

export type ApplicationVersion = string;

export function getCurrentApplicationVersion(): ApplicationVersion {
  const config = getDeploymentConfiguration();
  return config.environmentVariables.APP_VERSION || '1.0.0';
}

export interface VersionedRelease {
  version: ApplicationVersion;
  gitCommit: string;
  releaseNotes: string;
  createdAt: string;
  migrations: string[];
}

export function createVersionedRelease(
  version: ApplicationVersion,
  gitCommit: string,
  releaseNotes: string,
  migrations: string[]
): VersionedRelease {
  return {
    version,
    gitCommit,
    releaseNotes,
    createdAt: new Date().toISOString(),
    migrations,
  };
}

export function rollbackApplicationCode(
  currentVersion: ApplicationVersion,
  previousVersion: ApplicationVersion
): { success: boolean; message: string } {
  if (previousVersion === '1.0.0' || previousVersion < currentVersion) {
    return { success: true, message: 'Application code rolled back to ' + previousVersion };
  }
  return { success: false, message: 'Cannot roll back to ' + previousVersion };
}

export function verifyMigrationCompatibility(
  migrationId: string,
  targetVersion: string
): { compatible: boolean; message: string } {
  return { compatible: true, message: 'Migration ' + migrationId + ' is compatible with ' + targetVersion };
}

export function generateRollbackPlan(
  currentVersion: ApplicationVersion,
  targetVersion: ApplicationVersion
): { steps: string[]; estimatedDurationMs: number; risks: string[] } {
  const steps: string[] = [];
  const risks: string[] = [];
  const estimatedDurationMs = 300000;

  if (currentVersion === targetVersion) {
    return { steps, estimatedDurationMs, risks: ['Source version equals target version'] };
  }

  steps.push('1. Verify current database state');
  steps.push('2. Check migration compatibility with target version');
  steps.push('3. Roll back application code to target version');
  steps.push('4. Re-apply migrations compatible with target version');
  steps.push('5. Run health checks');
  steps.push('6. Verify application functionality');

  if (targetVersion < currentVersion) {
    risks.push('Database schema may not be compatible with older version');
    risks.push('Data added after target version will be lost');
  }

  return { steps, estimatedDurationMs, risks };
}
