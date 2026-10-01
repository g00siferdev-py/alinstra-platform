export const ROLES = ["admin", "client_owner", "client_staff"] as const;
export type Role = (typeof ROLES)[number];

export type TenantContext =
  | { role: "admin"; clientId?: string }
  | { role: "client_owner" | "client_staff"; clientId: string };

export function assertTenantContext(ctx: TenantContext): void {
  if (ctx.role !== "admin" && !ctx.clientId) {
    throw new Error("Client users require clientId");
  }
}
