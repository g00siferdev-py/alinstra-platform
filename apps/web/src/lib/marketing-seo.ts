import { PRODUCT_NAME, SITE_URL } from "@/lib/brand";
import type { Metadata } from "next";

export function marketingMetadata(input: {
  title: string;
  description: string;
  path: string;
}): Metadata {
  const url = `${SITE_URL}${input.path === "/" ? "" : input.path}`;
  const title = input.title.includes("Alinstra") ? input.title : `${input.title} · Alinstra`;
  return {
    title,
    description: input.description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description: input.description,
      url,
      siteName: "Alinstra",
      type: "website",
      locale: "en_US",
    },
    twitter: {
      card: "summary",
      title,
      description: input.description,
    },
  };
}

export const HOME_DESCRIPTION = `${PRODUCT_NAME} answers when your team can't: after hours, over lunch, and when every line is busy.`;
