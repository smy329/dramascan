type SiteIntroProps = Readonly<{
  eyebrow: string;
  title: string;
  description: string;
}>;

export function SiteIntro({ eyebrow, title, description }: SiteIntroProps) {
  return (
    <main className="page">
      <p className="eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      <p className="lede">{description}</p>
    </main>
  );
}
