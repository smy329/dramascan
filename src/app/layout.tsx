import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { connection } from 'next/server';

import './globals.css';
// The player's theme and layout styles. Vidstack ships them as plain CSS, so
// they are imported once here rather than in every consumer.
import '@vidstack/react/player/styles/default/theme.css';
import '@vidstack/react/player/styles/default/layouts/video.css';
import { Geist } from 'next/font/google';
import { cn } from '@/lib/utils';

const geist = Geist({ subsets: ['latin'], variable: '--font-geist-sans' });

export const metadata: Metadata = {
  title: {
    default: 'DramaScan',
    template: '%s | DramaScan',
  },
  description: 'International drama and movie streaming platform.',
};

export default async function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  // The Content Security Policy carries a per-request nonce, so every document
  // has to be rendered per request: a prerendered document would ship inline
  // scripts without a nonce and the browser would refuse to run them.
  await connection();

  return (
    <html lang="en" className={cn('dark font-sans', geist.variable)}>
      <body>
        <a href="#main-content" className="skip-link">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
