# Phase 13 — Prompts 175-218 Implementation Plan

## Prompt 175: Centralized System Configuration ✅ COMPLETED
- [x] Enhanced system_settings table with Zod validation
- [x] Create setting schema with typed values
- [x] Exclude secrets from configuration exports
- [x] Implement setting CRUD APIs (getSetting, updateSetting, exportConfiguration, importConfiguration)

## Prompt 176: Runtime-Safe Configuration Updates
- [ ] Classify settings as immediate vs restart-required
- [ ] Implement value validation before save
- [ ] Prevent inconsistent state on restart-required settings

## Prompt 177: Configuration Version History
- [ ] Create system_setting_versions table
- [ ] Record before/after values
- [ ] Implement Super Admin restore functionality
- [ ] Rollback creates new version, doesn't delete history

## Prompt 178: Configuration Change Confirmation
- [ ] Show current/proposed values before save
- [ ] Validate proposed value before saving
- [ ] Require explicit confirmation
- [ ] Report success/failure accurately

## Prompt 179: Configuration JSON Export/Import
- [ ] Export Super Admin configuration as JSON
- [ ] Exclude secrets, OAuth credentials, session secrets
- [ ] Provide preview of proposed changes
- [ ] Require confirmation before applying

## Prompt 180: Maintenance Mode
- [ ] Super Admin control of maintenance mode
- [ ] Configurable public maintenance page/message
- [ ] Optional estimated return time
- [ ] Authorized admins retain admin access

## Prompt 181: Application Health Checks
- [ ] Layered health checks (app, PostgreSQL, disk)
- [ ] Public responses minimal, no internal details
- [ ] Detailed diagnostics for authorized admins

## Prompt 182: Built-In Error Monitoring
- [ ] Frontend/backend exceptions capture
- [ ] Failed API requests logging
- [ ] Severity, timestamp, stack, request context
- [ ] Redact credentials/personal data
- [ ] 30-day retention default

## Prompt 183: Error Monitoring Search and Filters
- [ ] Search by severity, time, module, route, category
- [ ] Pagination
- [ ] Detail views
- [ ] Avoid sensitive data exposure
- [ ] Role-aware access restrictions

## Prompt 184: Operational Maintenance Command Framework
- [ ] Structured logs for maintenance commands
- [ ] Safe configuration loading
- [ ] Execution results and error handling
- [ ] Exit codes
- [ ] Backup, validation, retention cleanup support

## Prompt 185: Scheduled Maintenance Task Monitoring
- [ ] Task name, start/end time, duration
- [ ] Success/failure recording
- [ ] Safe error information
- [ ] No persistent workers, no queue monitoring

## Prompt 186: Maintenance Execution History
- [ ] Failed, retried, recovered, critical operations
- [ ] Successful routine records lightweight
- [ ] Configurable retention
- [ ] Secrets redaction
- [ ] Without bounds growth

## Prompt 187: Maintenance Task Dependencies
- [ ] Backup → backup validation → retention cleanup
- [ ] Image upload → validate metadata → activate asset
- [ ] MP4 URL entry → preview → admin confirmation → publication
- [ ] No scheduled content-release pipeline

## Prompt 188: Maintenance Task Controls
- [ ] Super Admin emergency pause/resume
- [ ] Concurrency controls for short-lived operations
- [ ] No queue priorities, worker concurrency, dashboards
- [ ] Prevent conflicting operations

## Prompt 189: Basic Operational Performance Analytics
- [ ] Execution duration, success/failure metrics
- [ ] System resource metrics
- [ ] No queue wait times, no worker utilization
- [ ] Lightweight collection

## Prompt 190: Basic Anomaly Detection
- [ ] Maintenance failures detection
- [ ] Unusual duration increases
- [ ] Repeated errors
- [ ] Disk/resource pressure
- [ ] Simple configurable thresholds
- [ ] Useful explanation of anomaly

## Prompt 191: System Resource Monitoring
- [ ] CPU, memory, disk usage
- [ ] Database health metrics
- [ ] Application health metrics
- [ ] Lightweight system-native collection
- [ ] No Prometheus, Grafana

## Prompt 192: Alert Severity and Configuration
- [ ] Critical, High, Medium, Low severities
- [ ] Sensible default thresholds
- [ ] Super Admin configurable
- [ ] Severity escalation/de-escalation
- [ ] Duplicate suppression
- [ ] Role-aware visibility

## Prompt 193: Automatic Alert Escalation
- [ ] Escalation based on severity, duration, impact
- [ ] Authorized manual override
- [ ] De-escalation after verified recovery
- [ ] Not solely because user hasn't opened dashboard

## Prompt 194: Alert Acknowledgement and Assignment
- [ ] Acknowledge alerts
- [ ] Assign administrator
- [ ] Internal notes
- [ ] Acknowledgement timestamps and deadlines
- [ ] Escalation when unacknowledged beyond deadline
- [ ] Preserve complete alert history

## Prompt 195: Basic Incident Management
- [ ] Incident records for video-source failures, DB backup/recovery, system health, performance
- [ ] Severity, status, ownership (High/Critical)
- [ ] Affected component, timeline
- [ ] Corrective-action tracking
- [ ] Not complex IT service management

## Prompt 196: Incident Notes and Internal Discussion
- [ ] Structured notes for all incidents
- [ ] Internal discussion for High/Critical only
- [ ] Private to authorized administrators
- [ ] Record author and timestamp
- [ ] Not exposed to ordinary users

## Prompt 197: Incident Attachments
- [ ] Attachments only for High/Critical incidents
- [ ] File type, size, permissions validation
- [ ] Malware-safety requirements
- [ ] Restrict to authorized administrators
- [ ] No executable files or dangerous content

## Prompt 198: Incident Timeline
- [ ] Unified timeline for High/Critical incidents
- [ ] Alert creation, escalation, acknowledgement, assignment, notes, status changes, recovery
- [ ] Separate histories for lower severity
- [ ] Accurate and append-only

## Prompt 199: Verified Incident Recovery
- [ ] Auto-resolve only when verified through health check
- [ ] Otherwise require authorized administrator confirmation
- [ ] Preserve incident history and corrective-action notes after resolution

## Prompt 200: Security Headers and Browser Protections
- [ ] Content Security Policy
- [ ] Frame protections
- [ ] Content-type protections
- [ ] Referrer policy
- [ ] Compatible with Google OAuth, Vidstack, MP4 hosts
- [ ] Don't weaken security globally

## Prompt 201: Application and API Rate Limiting
- [ ] PostgreSQL-backed rate limiting
- [ ] Authentication endpoints, report submission, reviews, sensitive admin operations
- [ ] Appropriate limits by identity and request context
- [ ] No Redis
- [ ] Rate-limit failures don't allow unrestricted requests

## Prompt 202: Input Validation and Output Safety
- [ ] Server-side validation for all public/admin inputs
- [ ] Safe rendering
- [ ] URL validation, file validation
- [ ] Prevent XSS, SQL injection, unsafe redirects, path traversal, mass-assignment
- [ ] Drizzle parameterization, safe React rendering

## Prompt 203: API Authorization and OpenAPI Documentation
- [ ] OpenAPI/Swagger documentation for REST endpoints
- [ ] Authentication requirements, permissions, validation schemas
- [ ] Response structures, error cases
- [ ] REST authorization matches Server Action authorization
- [ ] Never assume route is safe because UI is hidden

## Prompt 204: Secure Deployment Configuration
- [ ] Ubuntu 24.04 LTS, Nginx, systemd, PostgreSQL, Node.js runtime
- [ ] Secrets in server environment configuration
- [ ] Disable unnecessary services
- [ ] Database not publicly exposed

## Prompt 205: Configure Nginx Reverse Proxy and HTTPS
- [ ] Nginx as reverse proxy for Next.js
- [ ] Proxy headers, body limits for image uploads
- [ ] Timeouts, compression, static asset handling
- [ ] Hosting-provider-managed SSL
- [ ] Don't proxy external video media

## Prompt 206: Configure systemd Application Management
- [ ] Next.js application systemd service
- [ ] Application user, working directory, environment
- [ ] Restart behavior, startup dependencies
- [ ] Safe service limits
- [ ] Short-lived maintenance commands only

## Prompt 207: Configure PostgreSQL Production Security
- [ ] Local-only access
- [ ] Separate database users
- [ ] Conservative connection limits
- [ ] Safe authentication
- [ ] Dedicated persistent SSD data directory
- [ ] systemd restart limits, connection timeouts, logging

## Prompt 208: Configure PostgreSQL Performance and Maintenance
- [ ] pg_stat_statements enabled
- [ ] Conservative autovacuum settings
- [ ] Slow query monitoring
- [ ] Connection use, table growth, index health
- [ ] Index recommendations for review/approval

## Prompt 209: Configure Application Compression and Caching
- [ ] Hybrid Brotli + Gzip compression
- [ ] Next.js built-in caching
- [ ] PostgreSQL-backed data access without Redis
- [ ] Tag-based cache invalidation for content changes
- [ ] No caching private user data or unpublished content

## Prompt 210: Implement Full Database Backup
- [ ] Weekly full PostgreSQL backup on same server
- [ ] Standard backup compression
- [ ] Timestamped filenames
- [ ] No WAL archiving, point-in-time recovery, incremental backups
- [ ] Document accepted risk of complete server failure

## Prompt 211: Implement Backup Manifest and Integrity Validation
- [ ] Metadata manifest per backup: timestamps, DB info, file size, checksum
- [ ] Automatic integrity validation after creation
- [ ] Record validation results
- [ ] Alert Super Admin on validation failure

## Prompt 212: Implement Backup Retention
- [ ] Four-week backup retention policy
- [ ] Protect newest valid backup
- [ ] Must not delete last known-good backup when newer fails validation
- [ ] Short-lived maintenance command
- [ ] Log deleted files and failures

## Prompt 213: Manual Backup Download and Restore
- [ ] Super Admin download authorized backup
- [ ] Controlled restore through admin/terminal workflow
- [ ] Validate selected backup before restore
- [ ] Explicit confirmation for destructive restoration
- [ ] Verify restored database afterward

## Prompt 214: Image Asset Backup and Recovery Guidance
- [ ] Document manual backup, download, restore of image asset directory
- [ ] Ensure database records and stored image paths consistent after restoration
- [ ] No external object storage or automatic external backup copy

## Prompt 215: Disaster Recovery Documentation
- [ ] Essential recovery sequence for PostgreSQL, image assets, application deployment, video-source records
- [ ] Limitations of same-server backups
- [ ] Restore image files separately
- [ ] No elaborate DR orchestration, cross-region replication, mandatory rehearsals

## Prompt 216: Implement Disk and Capacity Monitoring
- [ ] PostgreSQL storage, image storage, backup storage, logs, overall disk usage
- [ ] Configurable warning and critical thresholds
- [ ] No video staging or video-storage capacity
- [ ] Capacity recommendations, no automatic resize

## Prompt 217: Implement Production Deployment Pipeline
- [ ] GitHub Actions for production build and deployment preparation
- [ ] Build in CI, not consuming production VPS memory
- [ ] Manual production approval
- [ ] Versioned releases, controlled in-place deployment with rollback
- [ ] No automatic deployment every change

## Prompt 218: Implement Deployment Rollback and Database Migration Safety
- [ ] Versioned release rollback for application code
- [ ] Migration compatibility with previous release
- [ ] Expand-contract migration practices
- [ ] Prevent rollback silently destroying newer database data
- [ ] Document reversible vs irreversible migrations