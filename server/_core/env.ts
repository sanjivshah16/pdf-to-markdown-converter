// Environment variables - all optional for local use
export const ENV = {
  appId: process.env.VITE_APP_ID ?? "local-pdf-converter",
  cookieSecret: process.env.JWT_SECRET ?? "local-dev-secret-not-for-production",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  // No longer needed - using local storage
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
};
