import { useEffect, useState } from 'react';

import { listPublicDramaEpisodes } from '@/modules/content/public-episodes';

type EpisodeFlat = {
  id: string;
  title: string;
  episodeNumber: number | null;
  isCurrent: boolean;
  isAvailable: boolean;
};

export type { EpisodeFlat };

type EpisodeNavigationProps = {
  dramaId: string;
  dramaSlug: string;
  currentEpisodeId: string | null;
};

export function EpisodeNavigation({ dramaId, dramaSlug, currentEpisodeId }: EpisodeNavigationProps) {
  const [episodes, setEpisodes] = useState<EpisodeFlat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, [dramaId, dramaSlug, currentEpisodeId]);

  async function loadData() {
    setLoading(true);
    setError(null);

    try {
      const playableEpisodes = await listPublicDramaEpisodes(dramaId);

      const episodeList: EpisodeFlat[] = playableEpisodes.map((ep) => ({
        id: ep.id,
        title: ep.title,
        episodeNumber: ep.episodeNumber,
        isCurrent: ep.id === currentEpisodeId,
        isAvailable: true,
      }));

      setEpisodes(episodeList);
      setLoading(false);
    } catch (err) {
      setError('Failed to load episode navigation');
      setLoading(false);
      console.error(err);
    }
  }

  if (loading) {
    return <div className="p-8 text-muted-foreground">Loading episode navigation…</div>;
  }

  if (error) {
    return <div className="p-8 text-destructive">Error: {error}</div>;
  }

  const getBorderClass = (isCurrent: boolean) =>
    `rounded-md border border-${
      isCurrent ? 'primary' : 'border-border'
    } p-4 hover:bg-muted-focus transition-colors ${
      isCurrent ? 'bg-primary/10' : ''
    } cursor-pointer`;

  return (
    <div className="space-y-4">
      {episodes.map((ep) => (
        <div key={ep.id} className={getBorderClass(ep.isCurrent)}>
          <p className="font-medium {ep.isCurrent ? 'text-primary' : 'text-foreground'}">
            {ep.title}
          </p>
          {ep.episodeNumber !== null && (
            <p className="text-xs text-muted-foreground">
              Episode {ep.episodeNumber}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
