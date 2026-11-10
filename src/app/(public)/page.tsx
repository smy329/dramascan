import { SiteIntro } from '@/components/public/SiteIntro';
import { PublicPageLayout } from '@/components/public/Layout';

export default function HomePage() {
  return (
    <PublicPageLayout title="Home" description="International drama and movies, in one place">
      <SiteIntro
        eyebrow="DramaScan"
        title="International drama and movies, in one place."
        description="Streaming for drama and film fans. The catalogue and player are being prepared."
      />
    </PublicPageLayout>
  );
}