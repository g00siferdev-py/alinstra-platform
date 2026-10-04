import { MarketingFooter, MarketingHeader } from "@/components/marketing/site-chrome";
import { publicSiteConfig } from "@alinstra/db";

export const revalidate = 3600;

export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  const site = await publicSiteConfig();
  return (
    <div className="flex min-h-screen flex-col">
      <MarketingHeader phone={site.phone} />
      <div className="flex-1">{children}</div>
      <MarketingFooter email={site.email} />
    </div>
  );
}
