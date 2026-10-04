const SLUG_MAX = 40;

/** Lowercase `[a-z0-9_]` slug for a transfer label. Digits in the label stay; phone numbers never pass through here. */
export function transferSlug(label: string): string {
  const slug = label
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, SLUG_MAX)
    .replace(/_+$/g, "");
  return slug || "target";
}

/** One Retell tool name per label, in order, deduped with a numeric suffix. */
export function transferToolNames(labels: string[]): string[] {
  const taken = new Set<string>();
  return labels.map((label) => {
    const base = `transfer_${transferSlug(label)}`;
    let name = base;
    let suffix = 2;
    while (taken.has(name)) {
      name = `${base}_${suffix}`;
      suffix += 1;
    }
    taken.add(name);
    return name;
  });
}
