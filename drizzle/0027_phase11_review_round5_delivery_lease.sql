-- Migration 0027 — Phase 11 review fixes, round 5 (notification delivery lease)
--
-- The notification maintenance may run twice at the same time — the systemd
-- timer fires while an operator starts the command by hand. Without a claim,
-- both runs read the same candidate notifications and both send the same push
-- message to the same browser.
--
-- The lease is the claim: a candidate is selected with `FOR UPDATE SKIP
-- LOCKED`, so the second run skips the rows the first run holds, and the
-- selected rows carry the lease until it expires. A run that dies leaves the
-- lease behind, and the lease expiry hands the notification back to the next
-- run, so no notification is lost by a crashed command.
--
-- The token names the owner of the lease, so a run only releases its own
-- claim.
--
-- Reversible: the rollback drops the two columns. A claim that is running
-- while the rollback is applied is released with the columns; the delivery
-- records are unaffected, so a notification may be retried once more.

ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "delivery_lease_until" timestamp with time zone;
--> statement-breakpoint

ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "delivery_lease_token" text;
--> statement-breakpoint

-- The claim query filters on the lease, so the lease is indexed on its own.
CREATE INDEX IF NOT EXISTS "idx_notifications_delivery_lease"
ON "notifications" ("delivery_lease_until")
WHERE "deleted_at" IS NULL;
