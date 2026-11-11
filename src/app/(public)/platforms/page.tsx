import { PageHeader, PublicPageLayout } from '@/components/public/Layout';

const PLATFORMS = [
  { name: 'Viki', note: 'Korean, Chinese, Japanese, and Taiwanese series with subtitles.' },
  { name: 'Netflix', note: 'Original productions plus a broad licensed catalogue.' },
  { name: 'Prime Video', note: 'Regional catalogues that vary by country.' },
  { name: 'Disney+', note: 'Korean originals and select Asian film titles.' },
  { name: 'iQIYI', note: 'Chinese drama and variety, with international subtitles.' },
  { name: 'Kocowa', note: 'Korean broadcast content, often close to air date.' },
  { name: 'TVBAnywhere+', note: 'Cantonese-language drama and film.' },
  { name: 'Seezn', note: 'Korean streaming catalogue and originals.' },
];

export default function PlatformsPage() {
  return (
    <PublicPageLayout title="Platforms">
      <div className="space-y-10">
        <PageHeader
          eyebrow="Discover"
          title="Platforms"
          description="DramaScan does not host video itself. Where a title is available elsewhere, its page will link you to the platform that carries it."
        />

        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {PLATFORMS.map(platform =>
            <li key={platform.name} className="rounded-xl border border-border bg-card p-5">
              <p className="text-sm font-medium text-foreground">{platform.name}</p>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                {platform.note}
              </p>
            </li>
          )}
        </ul>

        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Platform availability depends on your region and changes without notice. Nothing on this
          page guarantees that a title can be streamed in your country.
        </p>
      </div>
    </PublicPageLayout>
  );
}
