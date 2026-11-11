import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cache } from 'react';

import { PublicPageLayout } from '@/components/public/Layout';
import { getPublishedInformationPage } from '@/modules/content';

/**
 * Public information pages: Terms, Privacy, Community Guidelines,
 * Copyright/DMCA, About, Contact.
 *
 * Only published, non-deleted rows are visible. Missing, unpublished,
 * deleted, and malformed slugs all return 404 so draft content can never leak
 * through a guessed URL.
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type InformationPageRouteProps = {
  params: Promise<{ slug: string }>;
};

// Metadata and the page body share one query per request.
const getPage = cache(getPublishedInformationPage);

export async function generateMetadata({
  params,
}: InformationPageRouteProps): Promise<Metadata> {
  const { slug } = await params;
  const page = await getPage(slug);

  if (!page) {
    return {
      title: 'Page not found',
      robots: { index: false, follow: false },
    };
  }

  return {
    title: page.title,
    description: page.preview ?? undefined,
  };
}

export default async function InformationPage({ params }: InformationPageRouteProps) {
  const { slug } = await params;
  const page = await getPage(slug);

  if (!page) {
    notFound();
  }

  return (
    <PublicPageLayout title={page.title}>
      <article className="max-w-3xl">
        <header>
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-primary">
            Information
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            {page.title}
          </h1>
          {page.preview &&
            <p className="mt-4 text-base leading-relaxed text-muted-foreground">{page.preview}</p>
          }
        </header>

        <div className="mt-8 rounded-xl border border-border bg-card px-5 py-6 sm:px-8 sm:py-8">
          <p className="whitespace-pre-line text-sm leading-7 text-muted-foreground">
            {page.content}
          </p>
        </div>

        <p className="mt-8 text-sm text-muted-foreground">
          <Link href="/" className="text-primary underline-offset-4 hover:underline">
            Back to DramaScan
          </Link>
        </p>
      </article>
    </PublicPageLayout>
  );
}
