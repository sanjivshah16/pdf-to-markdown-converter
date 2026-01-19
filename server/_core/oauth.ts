// OAuth routes - simplified for local use (no authentication required)
import type { Express, Request, Response } from "express";

export function registerOAuthRoutes(app: Express) {
  // OAuth callback - just redirect to home for local use
  app.get("/api/oauth/callback", async (req: Request, res: Response) => {
    res.redirect(302, "/");
  });
}
