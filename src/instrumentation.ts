export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') {
    return;
  }

  if (process.env.NEXT_PHASE === 'phase-production-build') {
    return;
  }

  // Importing the config module validates the environment immediately.
  await import('./platform/config');
}
