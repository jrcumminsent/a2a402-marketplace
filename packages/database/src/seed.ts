import { eq } from "drizzle-orm";

import { createDatabaseClient } from "./client.js";
import {
  communityChannels,
  ledgerAccounts,
  platformSettings,
} from "./schema.js";

const client = createDatabaseClient();

const settings: Array<typeof platformSettings.$inferInsert> = [
  {
    key: "protocol.version",
    value: "a2a402/0.1",
    valueType: "string",
    description: "Active marketplace protocol version.",
    isPublic: true,
    isSecret: false,
    updatedBy: "database-seed",
  },
  {
    key: "marketplace.fee_bps",
    value: Number(process.env.PLATFORM_FEE_BPS ?? 500),
    valueType: "integer",
    description: "Marketplace fee in basis points.",
    isPublic: true,
    isSecret: false,
    updatedBy: "database-seed",
  },
  {
    key: "payments.mainnet_enabled",
    value: false,
    valueType: "boolean",
    description: "Production mainnet payments are disabled in the MVP.",
    isPublic: true,
    isSecret: false,
    updatedBy: "database-seed",
  },
  {
    key: "proof_of_earn.eligible_origins",
    value: ["marketplace_earned", "verified_external_agent_earned"],
    valueType: "string_array",
    description: "Origins eligible for real marketplace spending.",
    isPublic: true,
    isSecret: false,
    updatedBy: "database-seed",
  },
  {
    key: "proof_of_earn.simulation_origin",
    value: "platform_test_funds",
    valueType: "string",
    description:
      "Test-only capital allowed only while the service is in simulation mode.",
    isPublic: true,
    isSecret: false,
    updatedBy: "database-seed",
  },
];

try {
  await client.db.transaction(async (tx) => {
    for (const setting of settings) {
      await tx
        .insert(platformSettings)
        .values(setting)
        .onConflictDoUpdate({
          target: platformSettings.key,
          set: {
            value: setting.value,
            valueType: setting.valueType,
            description: setting.description,
            isPublic: setting.isPublic,
            isSecret: setting.isSecret,
            updatedBy: setting.updatedBy,
            updatedAt: new Date(),
          },
        });
    }

    await tx
      .insert(communityChannels)
      .values({
        slug: "market-collaboration",
        name: "Market collaboration",
        description:
          "Machine-readable service announcements, capability requests, and collaboration proposals.",
        visibility: "public",
        moderationStatus: "allowed",
      })
      .onConflictDoNothing({ target: communityChannels.slug });

    const systemAccountDefinitions = [
      {
        code: "platform:cash",
        name: "Platform settlement asset",
        accountClass: "asset" as const,
        normalBalance: "debit" as const,
        balanceBucket: "available",
        allowNegative: true,
      },
      {
        code: "platform:fee-revenue",
        name: "Marketplace fee revenue",
        accountClass: "revenue" as const,
        normalBalance: "credit" as const,
        balanceBucket: "platform_fee_revenue",
        allowNegative: false,
      },
      {
        code: "platform:clearing",
        name: "Payment and settlement clearing",
        accountClass: "liability" as const,
        normalBalance: "credit" as const,
        balanceBucket: "pending_settlement",
        allowNegative: true,
      },
      {
        code: "platform:refunds",
        name: "Refund expense",
        accountClass: "expense" as const,
        normalBalance: "debit" as const,
        balanceBucket: "refunds",
        allowNegative: false,
      },
      {
        code: "platform:disputes",
        name: "Disputed funds",
        accountClass: "liability" as const,
        normalBalance: "credit" as const,
        balanceBucket: "disputed",
        allowNegative: false,
      },
    ];

    for (const definition of systemAccountDefinitions) {
      const existing = await tx
        .select({ id: ledgerAccounts.id })
        .from(ledgerAccounts)
        .where(eq(ledgerAccounts.code, definition.code))
        .limit(1);

      if (existing.length === 0) {
        await tx.insert(ledgerAccounts).values({
          ...definition,
          asset: process.env.X402_ASSET ?? "USDC",
          network: process.env.X402_NETWORK ?? "base-sepolia",
          proofOfEarnEligible: false,
          isSystemAccount: true,
        });
      }
    }
  });

  console.log(
    JSON.stringify({
      level: "info",
      event: "database.seeded",
      settings: settings.length,
    }),
  );
} finally {
  await client.close();
}
