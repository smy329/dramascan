import Link from 'next/link';

import { PageHeader, PublicPageLayout } from '@/components/public/Layout';

const FAQS = [
  {
    question: 'Do I need an account to watch?',
    answer:
      'No. Browsing and playback work without signing in. An account is only needed for features that have to remember you, such as bookmarks and cross-device progress.',
  },
  {
    question: 'Where does playback come from?',
    answer:
      'DramaScan links to a public video source provided for each episode. Playback happens in your browser directly against that host, so nothing is re-hosted or proxied.',
  },
  {
    question: 'The video will not start. What should I check?',
    answer:
      'Some sources block browser playback or do not support seeking. Try the title again later, or check whether the host is reachable from your network. Region locks also apply to some sources.',
  },
  {
    question: 'Is my watch progress saved?',
    answer:
      'Progress is stored per episode. If an episode source is replaced by an administrator, progress for that episode resets, because the new source may not line up with the old timestamps.',
  },
  {
    question: 'Why is the catalogue still small?',
    answer:
      'Titles are published after their sources are checked. The catalogue grows as more sources are verified, rather than showing placeholder entries that cannot be played.',
  },
  {
    question: 'How do I sign out?',
    answer:
      'Open the account menu in the header and choose sign out. On mobile, the account item is the last icon in the bottom bar.',
  },
];

export default function HelpPage() {
  return (
    <PublicPageLayout title="Help">
      <div className="space-y-10">
        <PageHeader
          eyebrow="Support"
          title="Help"
          description="Short answers to the questions that come up most often. If something here is wrong or missing, it should be fixed rather than worked around."
        />

        <div className="max-w-3xl divide-y divide-border rounded-xl border border-border bg-card">
          {FAQS.map(item =>
            <details key={item.question} className="group px-5 py-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-medium text-foreground">
                {item.question}
                <span
                  aria-hidden="true"
                  className="text-muted-foreground transition-transform group-open:rotate-45"
                >
                  +
                </span>
              </summary>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{item.answer}</p>
            </details>
          )}
        </div>

        <p className="text-sm text-muted-foreground">
          Still stuck?{' '}
          <Link href="/auth/signin" className="text-primary underline-offset-4 hover:underline">
            Sign in
          </Link>{' '}
          so the team can find your account when you report a problem.
        </p>
      </div>
    </PublicPageLayout>
  );
}
