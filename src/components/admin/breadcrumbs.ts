/**
 * Admin breadcrumbs.
 *
 * Labels come from a centralized map of *implemented* routes only. An unknown
 * path falls back to a single "Admin" item instead of inventing links to pages
 * that do not exist. The map accepts nested paths so later prompts can add
 * labels without changing the resolver.
 */

export type AdminBreadcrumb = Readonly<{
  label: string;
  /** Omitted for the current page. */
  href?: string;
}>;

export const ADMIN_ROUTE_LABELS: Readonly<Record<string, string>> = {
  '/admin': 'Admin',
};

const ADMIN_ROOT = '/admin';

function normalizePathname(pathname: string): string {
  const path = pathname.split(/[?#]/)[0] ?? '';
  const trimmed = path.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
}

function isAdminPath(pathname: string): boolean {
  return pathname === ADMIN_ROOT || pathname.startsWith(`${ADMIN_ROOT}/`);
}

/**
 * Resolve breadcrumbs for an admin pathname.
 *
 * - Only labelled paths become crumbs; unlabelled segments are skipped.
 * - Known ancestors are links; the final crumb never is.
 * - A path that is outside `/admin` or not labelled falls back to "Admin".
 */
export function getAdminBreadcrumbs(
  pathname: string,
  labels: Readonly<Record<string, string>> = ADMIN_ROUTE_LABELS
): readonly AdminBreadcrumb[] {
  const normalized = normalizePathname(pathname);
  const fallbackLabel = labels[ADMIN_ROOT] ?? 'Admin';
  const fallback: readonly AdminBreadcrumb[] = [{ label: fallbackLabel }];

  if (!isAdminPath(normalized) || labels[normalized] === undefined) {
    return fallback;
  }

  const labelledPaths: { path: string; label: string }[] = [];
  let path = '';

  for (const segment of normalized.split('/').filter(Boolean)) {
    path += `/${segment}`;
    const label = labels[path];
    if (label !== undefined) {
      labelledPaths.push({ path, label });
    }
  }

  return labelledPaths.map((item, index) => {
    if (index === labelledPaths.length - 1) {
      return { label: item.label };
    }
    return { label: item.label, href: item.path };
  });
}
