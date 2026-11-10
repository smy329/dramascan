/**
 * Pure authentication policies.
 *
 * These functions contain the decisions that govern first-sign-in Super Admin
 * bootstrap and session creation. They deliberately have no database or
 * framework imports so they can be unit-tested, including concurrent bootstrap
 * attempts, without touching PostgreSQL.
 */

/** User row fields needed to decide whether bootstrap applies. */
export type SuperAdminCandidate = {
  id: string;
  email: string;
  isSuperAdmin: boolean;
  isActive: boolean;
  deletedAt: Date | null;
};

export type SuperAdminBootstrapReason =
  | 'promoted'
  | 'not-configured'
  | 'user-missing'
  | 'already-super-admin'
  | 'inactive'
  | 'deleted'
  | 'email-mismatch'
  | 'super-admin-exists';

export type SuperAdminBootstrapResult = {
  promoted: boolean;
  reason: SuperAdminBootstrapReason;
};

/**
 * The store must run inside the caller's exclusive section (a PostgreSQL
 * transaction holding the bootstrap advisory lock in production).
 */
export type SuperAdminBootstrapStore = {
  findCandidate(_userId: string): Promise<SuperAdminCandidate | null>;
  hasSuperAdmin(): Promise<boolean>;
  promote(_userId: string): Promise<void>;
};

export type SuperAdminBootstrapDeps = {
  /** Normalized `SUPER_ADMIN_EMAIL`, or `null` when unconfigured. */
  configuredEmail: string | null;
  /** Serializes the read/decide/write sequence across concurrent sign-ins. */
  runExclusive<T>(_work: (_store: SuperAdminBootstrapStore) => Promise<T>): Promise<T>;
};

/** Emails are compared case-insensitively after trimming provider whitespace. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Decide whether a candidate should be promoted to Super Admin.
 *
 * Promotion is possible only when:
 * - a configured email exists,
 * - the candidate exists and is active and not soft-deleted,
 * - the candidate is not already a Super Admin,
 * - the candidate email matches the configured email, and
 * - no Super Admin currently exists.
 *
 * `superAdminExists` is the value observed inside the exclusive section, so
 * concurrent first sign-ins cannot promote two users.
 */
export function decideSuperAdminPromotion(
  candidate: SuperAdminCandidate | null,
  configuredEmail: string | null,
  superAdminExists: boolean
): SuperAdminBootstrapReason {
  if (!configuredEmail) {
    return 'not-configured';
  }
  if (!candidate) {
    return 'user-missing';
  }
  if (candidate.isSuperAdmin) {
    return 'already-super-admin';
  }
  if (!candidate.isActive) {
    return 'inactive';
  }
  if (candidate.deletedAt !== null) {
    return 'deleted';
  }
  if (normalizeEmail(candidate.email) !== normalizeEmail(configuredEmail)) {
    return 'email-mismatch';
  }
  if (superAdminExists) {
    return 'super-admin-exists';
  }
  return 'promoted';
}

/**
 * Bootstrap the configured first Super Admin.
 *
 * The candidate checks run before the `hasSuperAdmin` lookup to avoid a query
 * for users that can never be promoted. The entire decision and promotion run
 * inside `runExclusive`, which production implements with a PostgreSQL
 * transaction-scoped advisory lock.
 */
export async function bootstrapSuperAdmin(
  userId: string,
  deps: SuperAdminBootstrapDeps
): Promise<SuperAdminBootstrapResult> {
  if (!deps.configuredEmail) {
    return { promoted: false, reason: 'not-configured' };
  }

  return deps.runExclusive(async store => {
    const candidate = await store.findCandidate(userId);
    const preliminary = decideSuperAdminPromotion(candidate, deps.configuredEmail, false);

    if (preliminary !== 'promoted') {
      return { promoted: false, reason: preliminary };
    }

    const superAdminExists = await store.hasSuperAdmin();
    const decision = decideSuperAdminPromotion(
      candidate,
      deps.configuredEmail,
      superAdminExists
    );

    if (decision !== 'promoted') {
      return { promoted: false, reason: decision };
    }

    await store.promote(userId);
    return { promoted: true, reason: 'promoted' };
  });
}

export type SessionUserStatus = {
  isActive: boolean;
  deletedAt: Date | null;
} | null;

export type SessionCreationDecision = 'allowed' | 'user-missing' | 'inactive' | 'deleted';

/**
 * Deactivated (or soft-deleted) users must not create new sessions. The same
 * status check is applied when existing sessions are validated by
 * `getActiveSession` and by the authorization module's actor resolver.
 */
export function decideSessionCreation(user: SessionUserStatus): SessionCreationDecision {
  if (!user) {
    return 'user-missing';
  }
  if (!user.isActive) {
    return 'inactive';
  }
  if (user.deletedAt !== null) {
    return 'deleted';
  }
  return 'allowed';
}
