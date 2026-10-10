import { SITE_URL } from "@/lib/brand";
import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  if (process.env["APP_ENV"] !== "production") {
    return {
      rules: { userAgent: "*", disallow: "/" },
    };
  }
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", "/home", "/api"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
