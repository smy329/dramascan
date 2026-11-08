import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import './globals.css';
import { Geist } from 'next/font/google';
import { cn } from '@/lib/utils';

const geist = Geist({ subsets: ['latin'], variable: '--font-sans' });

export const metadata: Metadata = {
  title: {
    default: 'DramaScan',
    template: '%s | DramaScan',
  },
  description: 'International drama and movie streaming platform.',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className={cn('font-sans', geist.variable)}>
      <body>{children}</body>
    </html>
  );
}
