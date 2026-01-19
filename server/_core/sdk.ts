// SDK - simplified for local use (no OAuth required)
// This file is kept for compatibility but authentication is disabled

import type { Request } from "express";

export type SessionPayload = {
  openId: string;
  appId: string;
  name: string;
};

class SDKServer {
  async exchangeCodeForToken(code: string, state: string): Promise<any> {
    return {};
  }

  async getUserInfo(accessToken: string): Promise<any> {
    return {};
  }

  async createSessionToken(
    openId: string,
    options: { expiresInMs?: number; name?: string } = {}
  ): Promise<string> {
    return "";
  }

  async verifySession(
    cookieValue: string | undefined | null
  ): Promise<{ openId: string; appId: string; name: string } | null> {
    return null;
  }

  async authenticateRequest(req: Request): Promise<null> {
    // No authentication for local use
    return null;
  }
}

export const sdk = new SDKServer();
