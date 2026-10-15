// Better Auth instance factory.
//
// Better Auth owns authentication (password verification, sessions,
// revocation); this application owns authorization (roles, permissions).
// The private deployment runs plain HTTP on a trusted LAN, so secure
// cookies stay off unless explicitly enabled.
//
// better-auth ships ESM-only while this package compiles to CommonJS
// (tsc emits the decorator metadata Nest requires). All better-auth
// imports are therefore dynamic; only type imports are static.

import type { PrismaClient } from "@prisma/client";

export interface CreateAuthOptions {
  /**
   * Seed scripts create the first administrator through a Better Auth
   * instance with signup allowed. The application instance always disables
   * public self-registration: administrators create and disable accounts.
   */
  allowSignUp?: boolean;
}

export async function createAuth(
  prisma: PrismaClient,
  options: CreateAuthOptions = {},
) {
  const { betterAuth } = await import("better-auth");
  const { prismaAdapter } = await import("better-auth/adapters/prisma");

  const trustedOrigins = (process.env.BETTER_AUTH_TRUSTED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  return betterAuth({
    basePath: "/api/v1/auth",
    trustedOrigins,
    database: prismaAdapter(prisma, { provider: "postgresql" }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: !options.allowSignUp,
      minPasswordLength: 8,
    },
    user: {
      additionalFields: {
        isActive: { type: "boolean", defaultValue: true, input: false },
        mustChangePassword: {
          type: "boolean",
          defaultValue: false,
          input: false,
        },
      },
    },
    advanced: {
      // Trusted-LAN plain-HTTP posture (architecture decision ADR-004).
      useSecureCookies: process.env.BETTER_AUTH_SECURE_COOKIES === "true",
    },
  });
}

export type BetterAuthInstance = Awaited<ReturnType<typeof createAuth>>;
