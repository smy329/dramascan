export { cn } from 'cn';

/**
 * Format an instant for the platform display timezone.
 *
 * Every timestamp the viewer reads is rendered in `Asia/Dhaka`, and the
 * timestamps are stored in UTC. The formatter lives here so that two screens
 * never show two different times for the same row.
 *
 * @param value the instant, as a date or as an ISO string
 * @returns the local date and time
 */
export function formatCreatedAt(value: Date | string): string {
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Dhaka',
  }).format(new Date(value));
}

/** Copy text to the clipboard and return whether it succeeded. */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (!navigator.clipboard) {
    // Fallback for older browsers
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand('copy');
    } catch {
      return false;
    } finally {
      document.body.removeChild(textarea);
    }
    return true;
  }
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
