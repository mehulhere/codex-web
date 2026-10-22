import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";

const MASKED_EMAIL_PATTERN = /^[^@]+\*{3}@[^@]+\.[^@]+$/;
const STALE_AFTER_MS = 15 * 60 * 1000;
const FIVE_HOUR_WINDOW_MINUTES = 300;
const SEVEN_DAY_WINDOW_MINUTES = 10_080;
const execFileAsync = promisify(execFile);

const QuotaWindowSchema = z
  .object({
    usedPercent: z.number().finite().min(0).max(100).optional(),
    windowMinutes: z.number().finite().nonnegative().optional(),
    resetAtMs: z.number().finite().positive().optional()
  })
  .strict();

const StoredThreadStatusSchema = z
  .object({
    accountNumber: z.number().int().positive(),
    accountDisplay: z.string().min(1),
    maskedEmail: z.string().regex(MASKED_EMAIL_PATTERN).nullable(),
    primary: QuotaWindowSchema,
    secondary: QuotaWindowSchema,
    updatedAt: z.number().finite().positive()
  })
  .strict();

const PoolQuotaWindowSchema = z
  .object({
    windowMinutes: z.number().finite().nonnegative(),
    reportedCount: z.number().int().nonnegative(),
    totalRemainingPercent: z.number().finite().min(0),
    averageRemainingPercent: z.number().finite().min(0).max(100),
    earliestResetAtMs: z.number().finite().positive(),
    latestResetAtMs: z.number().finite().positive()
  })
  .strict();

const PoolQuotaSchema = z
  .object({
    accountCount: z.number().int().nonnegative(),
    fiveHour: PoolQuotaWindowSchema.nullable(),
    sevenDay: PoolQuotaWindowSchema.nullable(),
    updatedAt: z.number().finite().positive()
  })
  .strict();

const RouterStatusSchema = z
  .object({
    version: z.literal(1),
    kind: z.literal("codex-app-runtime-rotation-router"),
    state: z.literal("running"),
    pid: z.number().int().positive(),
    updatedAt: z.number().finite().positive(),
    baseUrl: z.string().url(),
    totalRequests: z.number().int().nonnegative(),
    upstreamRequests: z.number().int().nonnegative(),
    retries: z.number().int().nonnegative(),
    rotations: z.number().int().nonnegative(),
    activeWebSockets: z.number().int().nonnegative().optional(),
    webSocketUpgrades: z.number().int().nonnegative().optional(),
    webSocketFallbacks: z.number().int().nonnegative().optional(),
    webSocketAbnormalCloses: z.number().int().nonnegative().optional(),
    webSocketPeakBufferedBytes: z.number().int().nonnegative().optional(),
    webSocketLastError: z.string().nullable().optional(),
    lastAccountIndex: z.number().int().nonnegative().nullable(),
    lastAccountLabel: z.string().min(1).nullable(),
    lastAccountId: z.string().min(1).nullable(),
    lastAccountUpdatedAt: z.number().finite().positive().nullable(),
    poolQuota: PoolQuotaSchema.optional(),
    threadStatuses: z.record(z.string().min(1), StoredThreadStatusSchema),
    threadStatusPersistence: z.enum(["durable", "memory-only", "error"]),
    lastError: z.string().nullable()
  })
  .strict();

const PublicQuotaSchema = z
  .object({
    remainingPercent: z.number().int().min(0).max(100),
    resetAtMs: z.number().finite().positive().nullable()
  })
  .strict();

const AccountForecastSchema = z
  .object({
    command: z.literal("forecast"),
    model: z.string().min(1),
    liveProbe: z.boolean(),
    runtimeOverlay: z.boolean(),
    summary: z
      .object({
        total: z.number().int().nonnegative(),
        ready: z.number().int().nonnegative(),
        delayed: z.number().int().nonnegative(),
        unavailable: z.number().int().nonnegative(),
        highRisk: z.number().int().nonnegative()
      })
      .strict(),
    recommendation: z
      .object({
        recommendedIndex: z.number().int().nonnegative().nullable(),
        reason: z.string().min(1)
      })
      .strict(),
    probeErrors: z.array(z.string()),
    accounts: z.array(
      z
        .object({
          index: z.number().int().nonnegative(),
          label: z.string().min(1),
          isCurrent: z.boolean(),
          selected: z.boolean(),
          primaryReason: z.string().min(1).optional(),
          availability: z.enum(["ready", "delayed", "unavailable"]),
          riskScore: z.number().finite().nonnegative(),
          riskLevel: z.enum(["low", "medium", "high"]),
          waitMs: z.number().finite().nonnegative(),
          reasons: z.array(z.string())
        })
        .strict()
    )
  })
  .strict();

export const AccountsStatusSchema = z
  .object({
    summary: z
      .object({
        total: z.number().int().nonnegative(),
        ready: z.number().int().nonnegative(),
        delayed: z.number().int().nonnegative(),
        unavailable: z.number().int().nonnegative()
      })
      .strict(),
    recommendedAccountNumber: z.number().int().positive().nullable(),
    accounts: z.array(
      z
        .object({
          accountNumber: z.number().int().positive(),
          availability: z.enum(["ready", "delayed", "unavailable"]),
          current: z.boolean(),
          riskLevel: z.enum(["low", "medium", "high"]),
          waitMs: z.number().finite().nonnegative(),
          reason: z.string().min(1).nullable()
        })
        .strict()
    )
  })
  .strict();

export type AccountsStatus = z.infer<typeof AccountsStatusSchema>;

export function parseAccountForecast(value: string): AccountsStatus {
  const forecast = AccountForecastSchema.parse(JSON.parse(value));
  return AccountsStatusSchema.parse({
    summary: {
      total: forecast.summary.total,
      ready: forecast.summary.ready,
      delayed: forecast.summary.delayed,
      unavailable: forecast.summary.unavailable
    },
    recommendedAccountNumber:
      forecast.recommendation.recommendedIndex === null
        ? null
        : forecast.recommendation.recommendedIndex + 1,
    accounts: forecast.accounts.map((account) => ({
      accountNumber: account.index + 1,
      availability: account.availability,
      current: account.isCurrent,
      riskLevel: account.riskLevel,
      waitMs: account.waitMs,
      reason: account.primaryReason ?? null
    }))
  });
}

export async function readAccountsStatus(): Promise<AccountsStatus> {
  const result = await execFileAsync("codex-multi-auth", ["forecast", "--json"], {
    encoding: "utf8",
    timeout: 15_000,
    maxBuffer: 1024 * 1024
  });
  return parseAccountForecast(result.stdout);
}

export const ThreadAccountStatusSchema = z
  .object({
    state: z.enum(["assigned", "pending", "unavailable"]),
    accountNumber: z.number().int().positive().nullable(),
    accountDisplay: z.string().min(1).nullable(),
    maskedEmail: z.string().regex(MASKED_EMAIL_PATTERN).nullable(),
    quota5h: PublicQuotaSchema.nullable(),
    quota7d: PublicQuotaSchema.nullable(),
    poolQuota: PoolQuotaSchema.nullable(),
    updatedAt: z.number().finite().positive().nullable(),
    stale: z.boolean(),
    reason: z.string().min(1)
  })
  .strict();

export type ThreadAccountStatus = z.infer<typeof ThreadAccountStatusSchema>;

export interface ThreadAccountStatusOptions {
  codexHome?: string;
  now?: number;
}

function statusPath(codexHome: string): string {
  return join(
    codexHome,
    "multi-auth",
    "app-bind",
    "runtime-rotation-app-bind-status.json"
  );
}

function publicQuotaForDuration(
  primary: z.infer<typeof QuotaWindowSchema>,
  secondary: z.infer<typeof QuotaWindowSchema>,
  expectedWindowMinutes: number
): z.infer<typeof PublicQuotaSchema> | null {
  const window =
    primary.windowMinutes === expectedWindowMinutes
      ? primary
      : secondary.windowMinutes === expectedWindowMinutes
        ? secondary
        : null;
  if (window === null || window.usedPercent === undefined) {
    return null;
  }

  return {
    remainingPercent: Math.round(Math.max(0, Math.min(100, 100 - window.usedPercent))),
    resetAtMs: window.resetAtMs ?? null
  };
}

function normalizePoolQuota(
  poolQuota: z.infer<typeof PoolQuotaSchema>
): z.infer<typeof PoolQuotaSchema> {
  const windows = [poolQuota.fiveHour, poolQuota.sevenDay].filter(
    (window): window is NonNullable<typeof window> => window !== null
  );
  const reportedCounts = windows
    .map((window) => window.reportedCount)
    .filter((reportedCount) => reportedCount > 0);
  const accountCount =
    reportedCounts.length > 0 ? Math.max(...reportedCounts) : poolQuota.accountCount;

  const normalizeWindow = (
    window: z.infer<typeof PoolQuotaWindowSchema> | null
  ): z.infer<typeof PoolQuotaWindowSchema> | null => {
    if (window === null || window.reportedCount === 0) {
      return window;
    }
    return {
      ...window,
      averageRemainingPercent: window.totalRemainingPercent / window.reportedCount
    };
  };

  return {
    ...poolQuota,
    accountCount,
    fiveHour: normalizeWindow(poolQuota.fiveHour),
    sevenDay: normalizeWindow(poolQuota.sevenDay)
  };
}

export function readThreadAccountStatus(
  threadId: string,
  options: ThreadAccountStatusOptions = {}
): ThreadAccountStatus {
  const codexHome = options.codexHome ?? process.env["CODEX_HOME"] ?? join(homedir(), ".codex");
  const filePath = statusPath(codexHome);

  if (!existsSync(filePath)) {
    return ThreadAccountStatusSchema.parse({
      state: "unavailable",
      accountNumber: null,
      accountDisplay: null,
      maskedEmail: null,
      quota5h: null,
      quota7d: null,
      poolQuota: null,
      updatedAt: null,
      stale: false,
      reason: "Multi-account router status unavailable"
    });
  }

  const routerStatus = RouterStatusSchema.parse(JSON.parse(readFileSync(filePath, "utf8")));
  const status = routerStatus.threadStatuses[threadId];

  if (!status) {
    return ThreadAccountStatusSchema.parse({
      state: "pending",
      accountNumber: null,
      accountDisplay: null,
      maskedEmail: null,
      quota5h: null,
      quota7d: null,
      poolQuota: routerStatus.poolQuota
        ? normalizePoolQuota(routerStatus.poolQuota)
        : null,
      updatedAt: null,
      stale: false,
      reason: "Waiting for first routed response"
    });
  }

  const now = options.now ?? Date.now();
  return ThreadAccountStatusSchema.parse({
    state: "assigned",
    accountNumber: status.accountNumber,
    accountDisplay: status.accountDisplay,
    maskedEmail: status.maskedEmail,
    quota5h: publicQuotaForDuration(
      status.primary,
      status.secondary,
      FIVE_HOUR_WINDOW_MINUTES
    ),
    quota7d: publicQuotaForDuration(
      status.primary,
      status.secondary,
      SEVEN_DAY_WINDOW_MINUTES
    ),
    poolQuota: routerStatus.poolQuota
      ? normalizePoolQuota(routerStatus.poolQuota)
      : null,
    updatedAt: status.updatedAt,
    stale: now - status.updatedAt > STALE_AFTER_MS,
    reason: "Saved task assignment"
  });
}
