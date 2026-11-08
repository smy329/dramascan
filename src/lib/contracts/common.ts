/**
 * Client-safe contracts shared across application entrypoints.
 *
 * Domain-specific types belong in their owning module; only genuinely
 * cross-cutting shapes belong here. See API.md §2.2 and §2.7.
 */

export type PaginationMeta = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
};

export type ActionError = {
  code: string;
  message: string;
  fieldErrors?: Record<string, string[]>;
  requestId?: string;
};

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ActionError };
