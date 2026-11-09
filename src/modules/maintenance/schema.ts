/**
 * Maintenance schema fragment (owned by `maintenance`).
 *
 * Tables are added by the maintenance, backup, and incident implementation
 * prompts. Planned tables: `maintenance_task_runs`, `backup_manifests`,
 * `system_alerts`, `incidents`, `incident_notes`, `incident_attachments`,
 * `error_records`, `health_snapshots`. Only the `maintenance` module may write these tables.
 * `src/db/schema.ts` assembles this namespace.
 */
export {};
