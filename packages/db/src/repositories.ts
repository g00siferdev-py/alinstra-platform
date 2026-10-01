import { prisma } from "./client";
import { assertTenantContext, type TenantContext } from "./tenant";

const userSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  clientId: true,
  twoFactorEnabled: true,
  createdAt: true,
} as const;

function userWhere(ctx: TenantContext): { clientId?: string } {
  assertTenantContext(ctx);
  if (ctx.role === "admin") {
    return ctx.clientId ? { clientId: ctx.clientId } : {};
  }
  return { clientId: ctx.clientId };
}

function clientWhere(ctx: TenantContext): { id?: string } {
  assertTenantContext(ctx);
  if (ctx.role === "admin") {
    return ctx.clientId ? { id: ctx.clientId } : {};
  }
  return { id: ctx.clientId };
}

export function users(ctx: TenantContext) {
  const scope = userWhere(ctx);
  return {
    list() {
      return prisma.user.findMany({ where: scope, select: userSelect, orderBy: { createdAt: "desc" } });
    },
    getById(id: string) {
      return prisma.user.findFirst({ where: { id, ...scope }, select: userSelect });
    },
  };
}

export function clients(ctx: TenantContext) {
  const scope = clientWhere(ctx);
  return {
    list() {
      return prisma.client.findMany({
        where: { ...scope, archivedAt: null },
        orderBy: { createdAt: "desc" },
      });
    },
    getById(id: string) {
      if (ctx.role !== "admin" && id !== ctx.clientId) return Promise.resolve(null);
      if (ctx.role === "admin" && ctx.clientId && id !== ctx.clientId) return Promise.resolve(null);
      return prisma.client.findFirst({ where: { id, ...scope, archivedAt: null } });
    },
  };
}

export async function createClient(ctx: TenantContext, name: string) {
  assertTenantContext(ctx);
  if (ctx.role !== "admin") {
    throw new Error("Only admin can create clients");
  }
  return prisma.client.create({ data: { name } });
}
