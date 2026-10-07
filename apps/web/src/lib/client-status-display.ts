/** Display-only admin labels for self-serve lead clients. Does not change the DB enum. */
export function clientStatusDisplay(client: {
  status: string;
  billingStatus: string;
  wizardSubmittedAt: Date | string | null;
}): { label: string; awaitingReview: boolean } {
  const submitted = Boolean(client.wizardSubmittedAt);
  if (client.status === "lead" && client.billingStatus === "paid" && submitted) {
    return { label: "Awaiting your review", awaitingReview: true };
  }
  if (client.status === "lead" && client.billingStatus === "paid" && !submitted) {
    return { label: "Paid · setting up", awaitingReview: false };
  }
  return { label: client.status, awaitingReview: false };
}

/** Sort key: awaiting-review clients first, then original order preserved among peers. */
export function clientStatusSortRank(client: {
  status: string;
  billingStatus: string;
  wizardSubmittedAt: Date | string | null;
}): number {
  return clientStatusDisplay(client).awaitingReview ? 0 : 1;
}
