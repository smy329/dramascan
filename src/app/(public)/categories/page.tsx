import type { JSX } from 'react';
import { Shapes } from 'lucide-react';

import { buildDiscoveryHref } from '@/components/public/discovery-filters';
import { PageHeader, PublicPageLayout } from '@/components/public/Layout';
import { RankedDiscoveryView } from '@/components/public/ranked-discovery-view';
import {
  readContentTypeParam,
  readPageParam,
  readSortParam,
  readStringParam,
  type PublicSearchParams,
} from '@/lib/discovery-params';
import { listRankedContent } from '@/modules/analytics';
import { listPublicCategories } from '@/modules/content';

/**
 * The category browse page.
 *
 * The page is one browsing experience, not a set of landing pages: the
 * categories are filters, several of them may be selected at once, and the
 * result is a grid of cards with a pager.
 */

export const dynamic = 'force-dynamic';

type CategoriesPageProps = {
  searchParams: Promise<PublicSearchParams>;
};

/** Split the comma-separated category parameter into slugs. */
export function parseCategorySlugs(raw: string): string[] {
  return raw
    .split(',')
    .map(slug => slug.trim())
    .filter(slug => slug.length > 0);
}

export default async function CategoriesPage({
  searchParams,
}: CategoriesPageProps): Promise<JSX.Element> {
  const params = await searchParams;
  const type = readContentTypeParam(params);
  const sort = readSortParam(params);
  const page = readPageParam(params);
  const selectedSlugs = parseCategorySlugs(readStringParam(params, 'category'));

  const [categories, result] = await Promise.all([
    listPublicCategories(),
    listRankedContent({
      type,
      sort,
      page,
      pageSize: 24,
      categorySlugs: selectedSlugs,
    }),
  ]);

  const categoryGroup = {
    label: 'Category',
    param: 'category',
    options: categories.map(category => ({
      value: category.slug,
      label: `${category.name} (${category.contentCount})`,
    })),
    value: selectedSlugs.join(','),
    hrefFor: (value: string) => {
      // Several categories may be selected at once. Clicking a selected
      // category removes it; clicking an unselected one adds it.
      const next = selectedSlugs.includes(value)
        ? selectedSlugs.filter(slug => slug !== value)
        : [...selectedSlugs, value];

      return buildDiscoveryHref('/categories', params, {
        category: next.length > 0 ? next.join(',') : undefined,
      });
    },
  };

  return (
    <PublicPageLayout title="Categories">
      <div className="space-y-10">
        <PageHeader
          eyebrow="Browse"
          title="Categories"
          description="Pick one or more categories and browse what is published inside them."
        />

        <RankedDiscoveryView
          basePath="/categories"
          params={params}
          result={result}
          showContentType
          showSort
          extraGroups={[categoryGroup]}
          emptyIcon={Shapes}
          emptyTitle="Nothing in this selection"
          emptyDescription="No published drama or film matches the categories you picked. Try another category, or clear the selection."
          emptyHref="/categories"
          emptyHrefLabel="Show every category"
        />
      </div>
    </PublicPageLayout>
  );
}
