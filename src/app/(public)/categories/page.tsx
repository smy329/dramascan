import { PageHeader, PublicPageLayout } from '@/components/public/Layout';

const DRAMA_GENRES = [
  { name: 'Romance', note: 'Slow burns, second chances, and the people who cause them.' },
  { name: 'Melodrama', note: 'High emotion, long looks, and one impossible choice.' },
  { name: 'Historical', note: 'Courts, dynasties, and costume drama with real weight.' },
  { name: 'Political', note: 'Power, press, and the cost of staying in the room.' },
];

const MOVIE_GENRES = [
  { name: 'Action', note: 'Chases, fights, and the occasional improbable jump.' },
  { name: 'Thriller', note: 'Tension that builds quietly until it does not.' },
  { name: 'Documentary', note: 'Real people, real stakes, no script.' },
  { name: 'Independent', note: 'Small budgets, distinct voices, festival runs.' },
];

function GenreGroup({ heading, genres }: Readonly<{
  heading: string;
  genres: ReadonlyArray<{ name: string; note: string }>;
}>) {
  return (
    <section aria-labelledby={`${heading}-heading`}>
      <h2 id={`${heading}-heading`} className="text-lg font-medium text-foreground">
        {heading}
      </h2>
      <ul className="mt-4 grid gap-3 sm:grid-cols-2">
        {genres.map(genre =>
          <li key={genre.name} className="rounded-xl border border-border bg-card p-5">
            <p className="text-sm font-medium text-foreground">{genre.name}</p>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{genre.note}</p>
          </li>
        )}
      </ul>
    </section>
  );
}

export default function CategoriesPage() {
  return (
    <PublicPageLayout title="Categories">
      <div className="space-y-10">
        <PageHeader
          eyebrow="Browse"
          title="Categories"
          description="Start with a genre when you know the mood you want. Both lists grow as the catalogue is published."
        />

        <div className="grid gap-10 lg:grid-cols-2">
          <GenreGroup heading="Drama genres" genres={DRAMA_GENRES} />
          <GenreGroup heading="Film genres" genres={MOVIE_GENRES} />
        </div>
      </div>
    </PublicPageLayout>
  );
}
