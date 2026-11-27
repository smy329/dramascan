import 'server-only';

import { getDeploymentConfiguration } from './deployment.config';

export type DeploymentStage = 'build' | 'test' | 'staging' | 'production' | 'rollback';

export type DeploymentStatus = 'pending' | 'approved' | 'in-progress' | 'completed' | 'failed' | 'rolled-back';

export interface DeploymentVersion {
  version: string;
  stage: DeploymentStage;
  status: DeploymentStatus;
  startedAt: string;
  completedAt?: string | null;
  durationMs?: number | null;
  gitCommit: string;
  triggeredBy: string;
}

export function startDeploymentPipeline(
  stage: DeploymentStage,
  gitCommit: string,
  triggeredBy: string
): DeploymentVersion {
  const version: DeploymentVersion = {
    version: gitCommit,
    stage,
    status: 'pending',
    startedAt: new Date().toISOString(),
    gitCommit,
    triggeredBy,
  };
  return version;
}

export function approveDeployment(version: DeploymentVersion): DeploymentVersion {
  return {
    ...version,
    status: 'approved',
  };
}

export function completeDeployment(version: DeploymentVersion): DeploymentVersion {
  return {
    ...version,
    status: 'completed',
    completedAt: new Date().toISOString(),
    durationMs: new Date().getTime() - new Date(version.startedAt).getTime(),
  };
}

export function rollbackDeployment(version: DeploymentVersion, toVersion: string): DeploymentVersion {
  return {
    ...version,
    status: 'rolled-back',
    completedAt: new Date().toISOString(),
    durationMs: new Date().getTime() - new Date(version.startedAt).getTime(),
    gitCommit: toVersion,
  };
}

export function getDeploymentStages(): DeploymentStage[] {
  return ['build', 'test', 'staging', 'production'];
}

export function canProceedToNextStage(
  currentStage: DeploymentStage,
  status: DeploymentStatus
): boolean {
  if (status !== 'completed' && status !== 'approved') {
    return false;
  }
  return true;
}