import { ServiceCheck } from "@/components/service-check";
import { Card, PageHeader, Pill } from "@/components/ui";
import { getEnv, type Env } from "@alinstra/config";
import { getBackupSnapshot } from "@alinstra/db";
import { BackupsCard } from "./backups-card";
import { requireAdmin } from "@/lib/session";
import Link from "next/link";
import type { CheckableService } from "./actions";

type EnvName = keyof Env;

type Service = {
  name: string;
  purpose: string;
  dashboard: string;
  docs: string;
  envVars: EnvName[];
  check?: CheckableService;
  note?: string;
};

const SERVICES: Service[] = [
  {
    name: "Retell",
    purpose: "Runs Ava: the voice agent, the LLM behind it, and the phone numbers callers dial.",
    dashboard: "https://dashboard.retellai.com",
    docs: "https://docs.retellai.com",
    envVars: ["RETELL_API_KEY", "RETELL_DEFAULT_AREA_CODE", "RETELL_DEFAULT_TOLL_FREE", "DANIEL_TRANSFER_NUMBER"],
    check: "retell",
    note:
      "Usage is prepaid credits (auto recharge may be off). Phone numbers are monthly subscriptions billed to the card on file. A past-due card makes inbound calls fail with 'user busy'.",
  },
  {
    name: "Stripe",
    purpose: "Bills clients: customers, Checkout links, subscriptions, and the webhook that marks a client paid.",
    dashboard: "https://dashboard.stripe.com",
    docs: "https://docs.stripe.com",
    envVars: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"],
    check: "stripe",
  },
  {
    name: "Resend",
    purpose: "Sends every email: invites, password resets, taken messages, admin notices, provisioning failures.",
    dashboard: "https://resend.com",
    docs: "https://resend.com/docs",
    envVars: ["RESEND_API_KEY", "EMAIL_FROM", "EMAIL_TRANSPORT"],
  },
  {
    name: "Cloudflare R2",
    purpose: "Private bucket for uploaded knowledge documents.",
    dashboard: "https://dash.cloudflare.com",
    docs: "https://developers.cloudflare.com/r2/",
    envVars: ["STORAGE_DRIVER", "S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "S3_REGION"],
  },
  {
    name: "Railway",
    purpose: "Hosts the web app, the worker, Postgres, and Redis.",
    dashboard: "https://railway.com",
    docs: "https://docs.railway.com",
    envVars: ["APP_URL", "BETTER_AUTH_URL", "DATABASE_URL", "REDIS_URL"],
  },
  {
    name: "Sentry",
    purpose: "Error reporting for the web app and worker.",
    dashboard: "https://sentry.io",
    docs: "https://docs.sentry.io",
    envVars: ["SENTRY_DSN", "SENTRY_ENVIRONMENT"],
  },
  {
    name: "Cloudflare DNS",
    purpose: "DNS for alinstra.com. Grey-cloud CNAME for the app hostname points at Railway.",
    dashboard: "https://dash.cloudflare.com",
    docs: "https://developers.cloudflare.com/dns/",
    envVars: [],
  },
];

function presence(env: Env, name: EnvName): "set" | "missing" {
  const value = env[name];
  return typeof value === "string" && value.trim() !== "" ? "set" : typeof value === "number" ? "set" : "missing";
}

export default async function ServicesPage() {
  await requireAdmin();
  const env = getEnv();
  const backups = await getBackupSnapshot();
  return (
    <main className="grid gap-6">
      <Link className="text-sm text-[var(--muted)]" href="/home">
        Home
      </Link>
      <PageHeader
        title="Services"
        description="Where each outside service lives and whether this deployment has its keys. Values are never shown here; change them in Railway."
      />
      <BackupsCard snapshot={backups} />
      {SERVICES.map((service) => (
        <Card key={service.name} className="grid gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-extrabold text-[var(--ink)]">{service.name}</h2>
            <div className="flex gap-3 text-sm font-semibold">
              <a href={service.dashboard} target="_blank" rel="noreferrer">
                Dashboard
              </a>
              <a href={service.docs} target="_blank" rel="noreferrer">
                Docs
              </a>
            </div>
          </div>
          <p className="text-sm text-[var(--body)]">{service.purpose}</p>
          {service.note ? (
            <p className="rounded-xl border border-[var(--line)] bg-[var(--surface-subtle)] p-3 text-sm">{service.note}</p>
          ) : null}
          {service.envVars.length > 0 ? (
            <ul className="grid gap-1 text-sm sm:grid-cols-2">
              {service.envVars.map((name) => {
                const state = presence(env, name);
                return (
                  <li key={name} className="flex items-center justify-between gap-2">
                    <code className="text-xs">{name}</code>
                    <Pill tone={state === "set" ? "success" : "danger"}>{state}</Pill>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-[var(--muted)]">No environment variables. Hostname comes from APP_URL.</p>
          )}
          {service.check ? <ServiceCheck service={service.check} label={service.name} /> : null}
        </Card>
      ))}
    </main>
  );
}
