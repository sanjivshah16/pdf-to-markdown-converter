import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";

// Simplified user type for local use
export type User = {
  id: number;
  openId: string;
  name: string | null;
  email: string | null;
  role: "user" | "admin";
} | null;

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  // No authentication needed for local use
  return {
    req: opts.req,
    res: opts.res,
    user: null,
  };
}
