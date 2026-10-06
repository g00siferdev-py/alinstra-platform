import { MarketingFooter, MarketingHeader } from "@/components/marketing/site-chrome";
import { publicSiteConfig } from "@alinstra/db";

/** Per-request: Railway's build container has no Postgres; readers fall back when the DB is down. */
export const dynamic = "force-dynamic";

export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  const site = await publicSiteConfig();
  return (
    <div className="flex min-h-screen flex-col bg-white">
      <MarketingHeader phone={site.phone} />
      <div className="flex-1 bg-white">{children}</div>
      <MarketingFooter email={site.email} phone={site.phone} />
    </div>
  );
}
