import { ASSISTANT_NAME, MARKETING_EMAIL, PRODUCT_NAME } from "@/lib/brand";
import { marketingPhoneDisplay, marketingTelHref } from "@/lib/marketing-phone";
import { marketingMetadata } from "@/lib/marketing-seo";
import { publicSiteConfig } from "@alinstra/db";

export const metadata = marketingMetadata({
  title: "About",
  description: "Alinstra Technologies builds practical AI for small businesses, starting with the phone. Based in Morristown, Tennessee.",
  path: "/about",
});

export default async function AboutPage() {
  const site = await publicSiteConfig();
  const display = marketingPhoneDisplay(site.phone);
  const tel = marketingTelHref(site.phone);
  const email = site.email || MARKETING_EMAIL;

  return (
    <main className="mx-auto grid max-w-5xl gap-8 px-6 py-16">
      <h1 className="text-4xl font-semibold tracking-tight">About</h1>
      <p className="max-w-3xl text-lg text-[var(--muted)]">
        <strong className="font-semibold text-[var(--ink)]">Alinstra Technologies</strong> builds practical AI for small
        businesses, starting with the phone.
      </p>
      <p className="max-w-3xl text-[var(--muted)]">
        We&apos;re based in Morristown, Tennessee. {PRODUCT_NAME} is our first product. It exists because every small business owner
        we know has the same story: the call that came in while they were under a sink, on a ladder, or with a patient, and the
        customer who went to the next name on the list.
      </p>
      <p className="max-w-3xl text-[var(--muted)]">
        We don&apos;t cold call, we don&apos;t make AI robocalls, and we tell callers the truth when they ask if {ASSISTANT_NAME} is a
        person.
      </p>
      <div className="flex flex-wrap gap-3">
        {tel && display ? (
          <a
            className="inline-block rounded-md bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-[var(--accent-ink)] no-underline"
            href={tel}
          >
            Call {ASSISTANT_NAME}
          </a>
        ) : null}
        <a
          className="inline-block rounded-md border border-[var(--line)] px-4 py-2.5 text-sm font-medium text-[var(--ink)] no-underline"
          href={`mailto:${email}`}
        >
          Email us: {email}
        </a>
      </div>
    </main>
  );
}
