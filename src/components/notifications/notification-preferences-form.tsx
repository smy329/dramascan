'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { BellRing, Check } from 'lucide-react';

import type { NotificationPreferenceSet } from '@/modules/notifications';
import { saveNotificationPreferences } from '@/workflows/notifications/preferences';
import { cn } from '@/lib/utils';

/**
 * The notification preference form (Prompt 150).
 *
 * Five independent event preferences sit beside the two global channel
 * switches. The account/security notifications have no switch at all: they
 * are mandatory, so the form says so instead of offering a control that would
 * do nothing.
 *
 * The form saves the switches the viewer changed. It never sends the switches
 * it did not change, so two devices cannot silently reset each other.
 */

export type NotificationPreferencesFormProps = Readonly<{
  preferences: NotificationPreferenceSet;
}>;

type SwitchKey = keyof NotificationPreferenceSet;

/** The switches the viewer may change. */
const EVENT_SWITCHES: ReadonlyArray<{ key: SwitchKey; label: string; description: string }> = [
  {
    key: 'newEpisode',
    label: 'New episodes',
    description: 'A new episode of a drama you bookmarked.',
  },
  {
    key: 'newDrama',
    label: 'New dramas',
    description: 'A newly published drama.',
  },
  {
    key: 'newDramaSeason',
    label: 'New seasons',
    description: 'A new season of a drama.',
  },
  {
    key: 'websiteAnnouncement',
    label: 'Website announcements',
    description: 'An announcement published by the platform.',
  },
];

const CHANNEL_SWITCHES: ReadonlyArray<{ key: SwitchKey; label: string; description: string }> = [
  {
    key: 'globalInApp',
    label: 'In-app notifications',
    description: 'Show notifications in the notification centre.',
  },
  {
    key: 'globalPush',
    label: 'Browser push',
    description: 'Send notifications to this browser.',
  },
];

function Switch({
  id,
  label,
  description,
  checked,
  disabled,
  onChange,
}: Readonly<{
  id: string;
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (_checked: boolean) => void;
}>) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="min-w-0">
        <label htmlFor={id} className="text-sm font-medium text-foreground">
          {label}
        </label>
        <p id={`${id}-description`} className="mt-1 text-sm text-muted-foreground">
          {description}
        </p>
      </div>

      <button
        type="button"
        id={id}
        role="switch"
        aria-checked={checked}
        aria-describedby={`${id}-description`}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors',
          checked ? 'border-primary bg-primary' : 'border-border bg-secondary',
          disabled ? 'cursor-not-allowed opacity-50' : ''
        )}
      >
        <span
          className={cn(
            'inline-block size-4 rounded-full bg-background transition-transform',
            checked ? 'translate-x-5' : 'translate-x-1'
          )}
        />
      </button>
    </div>
  );
}

export function NotificationPreferencesForm({
  preferences: initialPreferences,
}: Readonly<NotificationPreferencesFormProps>) {
  const router = useRouter();
  const [preferences, setPreferences] = useState<NotificationPreferenceSet>({
    ...initialPreferences,
  });
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const toggle = (key: SwitchKey, checked: boolean) => {
    setSaved(false);
    setError(null);
    setPreferences(current => ({ ...current, [key]: checked }));
  };

  const save = () => {
    startTransition(async () => {
      const result = await saveNotificationPreferences({
        newEpisode: preferences.newEpisode,
        newDrama: preferences.newDrama,
        newDramaSeason: preferences.newDramaSeason,
        websiteAnnouncement: preferences.websiteAnnouncement,
        globalInApp: preferences.globalInApp,
        globalPush: preferences.globalPush,
      });

      if (!result.ok) {
        setError(result.error.message);
        return;
      }

      setPreferences(result.data);
      setSaved(true);
      router.refresh();
    });
  };

  return (
    <div className="space-y-8">
      <section aria-labelledby="events-heading" className="rounded-xl border border-border bg-card p-5">
        <h2 id="events-heading" className="text-base font-medium text-foreground">
          Events
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose which events reach you. Every switch is independent.
        </p>

        <div className="mt-2 divide-y divide-border">
          {EVENT_SWITCHES.map(switchRow => (
            <Switch
              key={switchRow.key}
              id={`preference-${switchRow.key}`}
              label={switchRow.label}
              description={switchRow.description}
              checked={preferences[switchRow.key]}
              onChange={checked => toggle(switchRow.key, checked)}
            />
          ))}

          <div className="flex items-start justify-between gap-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">Account & security</p>
              <p id="preference-accountSecurity-description" className="mt-1 text-sm text-muted-foreground">
                Always on. Security notifications cannot be switched off.
              </p>
            </div>
            <span className="shrink-0 rounded-full border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground">
              Mandatory
            </span>
          </div>
        </div>
      </section>

      <section aria-labelledby="channels-heading" className="rounded-xl border border-border bg-card p-5">
        <h2 id="channels-heading" className="text-base font-medium text-foreground">
          Delivery
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          A notification is delivered only when the channel is on and the event preference is on.
        </p>

        <div className="mt-2 divide-y divide-border">
          {CHANNEL_SWITCHES.map(switchRow => (
            <Switch
              key={switchRow.key}
              id={`preference-${switchRow.key}`}
              label={switchRow.label}
              description={switchRow.description}
              checked={preferences[switchRow.key]}
              onChange={checked => toggle(switchRow.key, checked)}
            />
          ))}
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={isPending}
          className="inline-flex min-h-11 items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/80 disabled:opacity-50"
        >
          <Check className="size-4" aria-hidden="true" />
          {isPending ? 'Saving…' : 'Save preferences'}
        </button>

        {saved ? (
          <p className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
            <BellRing className="size-4" aria-hidden="true" />
            Your preferences were saved.
          </p>
        ) : null}

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
