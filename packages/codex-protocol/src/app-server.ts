import { z } from "zod";
import {
  JsonValueSchema,
  NonEmptyStringSchema,
  NonNegativeIntSchema,
  NullableNonEmptyStringSchema
} from "./common.js";
import { ProtocolValidationError } from "./errors.js";
import {
  CollaborationModeSchema,
  InputPartSchema,
  ThreadConversationStateSchema,
  ThreadTurnSchema
} from "./thread.js";

const AppServerGitInfoSchema = z
  .object({
    branch: z.string().nullable().optional(),
    originUrl: z.string().nullable().optional(),
    sha: z.string().nullable().optional()
  })
  .strict();

export const AppServerQueueInputSchema = z.union([
  InputPartSchema,
  z.object({ type: z.literal("image"), fileId: NonEmptyStringSchema,
    detail: z.enum(["auto", "low", "high", "original"]).optional() }).strict(),
  z.object({ type: z.literal("audio"), url: z.string() }).strict(),
  z.object({ type: z.literal("localAudio"), path: z.string() }).strict()
]);
export const AppServerQueuedSubmissionSchema = z.object({
  id: NonEmptyStringSchema,
  input: z.array(AppServerQueueInputSchema),
  clientUserMessageId: z.string()
}).strict();
export const AppServerQueueListResponseSchema = z.object({
  data: z.array(AppServerQueuedSubmissionSchema), nextCursor: z.string().nullable()
}).strict();
export const AppServerQueueWriteResponseSchema = z.object({
  queuedSubmission: AppServerQueuedSubmissionSchema
}).strict();
export const AppServerQueueDeleteResponseSchema = z.object({ deleted: z.boolean() }).strict();
export const AppServerQueueChangedNotificationSchema = z.object({ threadId: NonEmptyStringSchema }).strict();
export type AppServerQueuedSubmission = z.infer<typeof AppServerQueuedSubmissionSchema>;

const AppServerThreadStatusSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("notLoaded") }).strict(),
  z.object({ type: z.literal("idle") }).strict(),
  z.object({ type: z.literal("systemError") }).strict(),
  z
    .object({
      type: z.literal("active"),
      activeFlags: z.array(z.enum(["waitingOnApproval", "waitingOnUserInput"]))
    })
    .strict()
]);

const AppServerSubAgentSourceSchema = z.union([
  z.enum(["review", "compact", "memory_consolidation"]),
  z
    .object({
      thread_spawn: z
        .object({
          agent_nickname: z.string().nullable().optional(),
          agent_path: z.string().nullable().optional(),
          agent_role: z.string().nullable().optional(),
          depth: z.number().int(),
          parent_thread_id: z.string()
        })
        .strict()
    })
    .strict(),
  z.object({ other: z.string() }).strict()
]);

const AppServerSessionSourceSchema = z.union([
  z.enum(["cli", "vscode", "exec", "appServer", "unknown"]),
  z.object({ custom: z.string() }).strict(),
  z.object({ subAgent: AppServerSubAgentSourceSchema }).strict()
]);

const AppServerThreadSectionSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    appearance: z.object({
      color: z.string().nullable().optional(),
      icon: z.string().nullable().optional()
    }).strict().nullable().optional()
  })
  .strict();

const AppServerThreadEnvironmentSchema = z
  .object({
    environmentId: z.string(),
    cwd: z.string(),
    runtimeWorkspaceRoots: z.array(z.string())
  })
  .strict();

export const AppServerThreadListItemSchema = z
  .object({
    id: NonEmptyStringSchema,
    extra: z.record(JsonValueSchema).nullable().optional(),
    sessionId: z.string().optional(),
    forkedFromId: z.string().nullable().optional(),
    parentThreadId: z.string().nullable().optional(),
    preview: z.string(),
    ephemeral: z.boolean().optional(),
    historyMode: z.enum(["legacy", "paginated"]).optional(),
    modelProvider: z.string().optional(),
    environments: z.array(AppServerThreadEnvironmentSchema).nullable().optional(),
    projectId: z.string().nullable().optional(),
    model: z.string().nullable().optional(),
    reasoningEffort: NonEmptyStringSchema.nullable().optional(),
    originator: z.string().nullable().optional(),
    daybreakEnabled: z.boolean().nullable().optional(),
    createdAt: NonNegativeIntSchema,
    updatedAt: NonNegativeIntSchema,
    recencyAt: NonNegativeIntSchema.nullable().optional(),
    status: AppServerThreadStatusSchema.optional(),
    path: z.string().nullable().optional(),
    cwd: z.string().optional(),
    cliVersion: z.string().optional(),
    source: AppServerSessionSourceSchema.optional(),
    threadSource: z.string().nullable().optional(),
    agentNickname: z.string().nullable().optional(),
    agentRole: z.string().nullable().optional(),
    gitInfo: AppServerGitInfoSchema.nullable().optional(),
    name: z.string().nullable().optional(),
    isPinned: z.boolean().optional(),
    canAcceptDirectInput: z.boolean().nullable().optional(),
    section: AppServerThreadSectionSchema.nullable().optional(),
    sectionEnteredAt: NonNegativeIntSchema.nullable().optional(),
    turns: z.array(JsonValueSchema).optional()
  })
  .strict();

export const AppServerThreadReadStateSchema = z.object({
  revision: z.string(),
  firstUnread: z.discriminatedUnion("type", [
    z.object({ type: z.literal("threadStart") }).strict(),
    z.object({ type: z.literal("turn"), turnId: z.string() }).strict()
  ]).nullable().optional()
}).strict();

export const AppServerListThreadsResponseSchema = z
  .object({
    data: z.array(AppServerThreadListItemSchema),
    readStates: z.record(AppServerThreadReadStateSchema).nullable().optional(),
    nextCursor: z.string().nullable().optional(),
    backwardsCursor: z.string().nullable().optional(),
    pages: NonNegativeIntSchema.optional(),
    truncated: z.boolean().optional()
  })
  .strict();

export const AppServerReadThreadResponseSchema = z
  .object({
    thread: ThreadConversationStateSchema,
    readState: AppServerThreadReadStateSchema.nullable().optional()
  })
  .strict();

export const AppServerModelReasoningEffortSchema = z
  .object({
    reasoningEffort: NonEmptyStringSchema,
    description: z.string()
  })
  .strict();

const AppServerModelUpgradeInfoSchema = z
  .object({
    model: z.string(),
    migrationMarkdown: z.string().nullable().optional(),
    modelLink: z.string().nullable().optional(),
    upgradeCopy: z.string().nullable().optional(),
    retirementAt: z.number().int().nullable().optional()
  })
  .strict();

const AppServerModelAvailabilityNuxSchema = z
  .object({
    message: z.string()
  })
  .strict();

const AppServerModelServiceTierSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string()
  })
  .strict();

export const AppServerModelSchema = z
  .object({
    id: NonEmptyStringSchema,
    model: NonEmptyStringSchema,
    upgrade: z.union([NonEmptyStringSchema, z.null()]),
    upgradeInfo: AppServerModelUpgradeInfoSchema.nullable().optional(),
    availabilityNux: AppServerModelAvailabilityNuxSchema.nullable().optional(),
    displayName: z.string(),
    description: z.string(),
    modelSpecialty: z.string().nullable().optional(),
    multiAgentVersion: z.enum(["disabled", "v1", "v2"]).nullable().optional(),
    availableAccessPrograms: z.object({
      cyber: z.array(z.enum(["standard", "daybreakBlue", "daybreakRed"]))
    }).strict().nullable().optional(),
    supportedReasoningEfforts: z.array(AppServerModelReasoningEffortSchema),
    defaultReasoningEffort: NonEmptyStringSchema,
    inputModalities: z.array(NonEmptyStringSchema),
    supportsPersonality: z.boolean(),
    isDefault: z.boolean(),
    hidden: z.boolean().optional(),
    additionalSpeedTiers: z.array(z.string()).optional(),
    serviceTiers: z.array(AppServerModelServiceTierSchema).optional(),
    defaultServiceTier: z.string().nullable().optional()
  })
  .strict();

export const AppServerListModelsResponseSchema = z
  .object({
    data: z.array(AppServerModelSchema),
    nextCursor: z.union([z.string(), z.null()])
  })
  .strict();

export const AppServerCollaborationModeListItemSchema = z
  .object({
    name: z.string(),
    mode: NonEmptyStringSchema,
    model: NullableNonEmptyStringSchema,
    reasoning_effort: NullableNonEmptyStringSchema,
    developer_instructions: z.union([z.string(), z.null()]).optional()
  })
  .strict();

export const AppServerCollaborationModeListResponseSchema = z
  .object({
    data: z.array(AppServerCollaborationModeListItemSchema)
  })
  .strict();

export const AppServerStartThreadRequestSchema = z
  .object({
    cwd: z.string(),
    // The PWA reader uses thread/read with inline turns.
    historyMode: z.literal("legacy").default("legacy"),
    model: z.string().optional(),
    modelProvider: z.string().optional(),
    personality: z.string().optional(),
    sandbox: z.string().optional(),
    approvalPolicy: z.string().optional(),
    ephemeral: z.boolean().optional()
  })
  .strict();

export const AppServerSandboxResponseSchema = z
  .object({
    type: z.enum(["dangerFullAccess", "readOnly", "externalSandbox", "workspaceWrite"]),
    writableRoots: z.array(z.string()).optional(),
    readOnlyAccess: z
      .object({
        type: NonEmptyStringSchema,
        roots: z.array(z.string()).optional()
      })
      .strict()
      .optional(),
    excludeSlashTmp: z.boolean().optional(),
    excludeTmpdirEnvVar: z.boolean().optional(),
    networkAccess: z.boolean().optional()
  })
  .strict();

export const AppServerSandboxPolicySchema = z
  .object({
    type: z.enum(["danger-full-access", "read-only", "external-sandbox", "workspace-write"]),
    writableRoots: z.array(z.string()).optional(),
    readOnlyAccess: z
      .object({
        type: NonEmptyStringSchema,
        roots: z.array(z.string()).optional()
      })
      .strict()
      .optional(),
    excludeSlashTmp: z.boolean().optional(),
    excludeTmpdirEnvVar: z.boolean().optional(),
    networkAccess: z.boolean().optional()
  })
  .strict();

export const AppServerResumeThreadRequestSchema = z
  .object({
    threadId: NonEmptyStringSchema,
    excludeTurns: z.boolean().optional()
  })
  .strict();

const AppServerApprovalsReviewerSchema = z.enum(["user", "auto_review", "guardian_subagent"]);

const AppServerActivePermissionProfileSchema = z
  .object({
    id: NonEmptyStringSchema,
    extends: z.string().nullable()
  })
  .strict();

const AppServerMultiAgentModeSchema = z.union([
  z.enum(["explicitRequestOnly", "proactive"]),
  z.object({ custom: z.string() }).strict()
]);

export const AppServerStartThreadResponseSchema = z
  .object({
    thread: AppServerThreadListItemSchema,
    model: z.string().optional(),
    modelProvider: z.string().optional(),
    serviceTier: z.string().nullable().optional(),
    cwd: z.string().optional(),
    runtimeWorkspaceRoots: z.array(z.string()).nullable().optional(),
    instructionSources: z.array(z.string()).optional(),
    approvalPolicy: z.string().optional(),
    approvalsReviewer: AppServerApprovalsReviewerSchema.optional(),
    sandbox: AppServerSandboxResponseSchema.optional(),
    activePermissionProfile: AppServerActivePermissionProfileSchema.nullable().optional(),
    reasoningEffort: z.string().nullable().optional(),
    multiAgentMode: AppServerMultiAgentModeSchema.optional(),
    disabledPluginIds: z.array(z.string()).optional()
  })
  .strict();

const AppServerTurnsPageSchema = z
  .object({
    data: z.array(ThreadTurnSchema),
    nextCursor: z.string().nullable(),
    backwardsCursor: z.string().nullable()
  })
  .strict();

export const AppServerResumeThreadResponseSchema = AppServerStartThreadResponseSchema.extend({
  collaborationMode: CollaborationModeSchema.nullable().optional(),
  initialTurnsPage: AppServerTurnsPageSchema.nullable().optional(),
  turnsBackwardsCursor: NullableNonEmptyStringSchema.optional(),
  itemsBackwardsCursor: NullableNonEmptyStringSchema.optional()
}).strict();

export const AppServerThreadSettingsUpdateRequestSchema = z
  .object({
    threadId: NonEmptyStringSchema,
    model: NullableNonEmptyStringSchema.optional(),
    effort: NullableNonEmptyStringSchema.optional(),
    collaborationMode: CollaborationModeSchema.nullable().optional()
  })
  .strict();

export const AppServerThreadSettingsUpdateResponseSchema = z.object({}).strict();

export const AppServerThreadDeleteRequestSchema = z
  .object({
    threadId: NonEmptyStringSchema
  })
  .strict();

export const AppServerThreadDeleteResponseSchema = z.object({}).strict();

export const AppServerThreadForkRequestSchema = z
  .object({
    threadId: NonEmptyStringSchema,
    cwd: z.string().optional(),
    ephemeral: z.boolean().optional(),
    excludeTurns: z.boolean().optional(),
    lastTurnId: NonEmptyStringSchema.nullable().optional()
  })
  .strict();

export const AppServerThreadForkResponseSchema = AppServerStartThreadResponseSchema;

export const SideBoundaryInputTextSchema = z
  .object({
    type: z.literal("input_text"),
    text: NonEmptyStringSchema
  })
  .strict();

export const SideBoundaryItemSchema = z
  .object({
    type: z.literal("message"),
    role: z.literal("user"),
    content: z.array(SideBoundaryInputTextSchema).length(1)
  })
  .strict();

export const AppServerThreadInjectItemsRequestSchema = z
  .object({
    threadId: NonEmptyStringSchema,
    items: z.array(SideBoundaryItemSchema).length(1)
  })
  .strict();

export const AppServerThreadInjectItemsResponseSchema = z.object({}).strict();

export const AppServerThreadRollbackRequestSchema = z
  .object({
    threadId: NonEmptyStringSchema,
    numTurns: z.number().int().positive()
  })
  .strict();

export const AppServerThreadRollbackResponseSchema = z
  .object({
    thread: ThreadConversationStateSchema
  })
  .strict();

export const AppServerThreadCompactRequestSchema = z
  .object({
    threadId: NonEmptyStringSchema
  })
  .strict();

export const AppServerThreadCompactResponseSchema = z.object({}).strict();

export const AppServerTurnStartTextInputSchema = z
  .object({
    type: z.literal("text"),
    text: z.string(),
    text_elements: z.array(JsonValueSchema)
  })
  .strict();

export const AppServerTurnStartRequestSchema = z
  .object({
    threadId: NonEmptyStringSchema,
    input: z.array(InputPartSchema).min(1),
    attachments: z.array(JsonValueSchema).optional()
  })
  .strict();

export const AppServerTurnStartResponseSchema = z
  .object({
    turn: ThreadTurnSchema
  })
  .strict();

export const AppServerTurnSteerRequestSchema = z
  .object({
    threadId: NonEmptyStringSchema,
    input: z.array(InputPartSchema).min(1),
    expectedTurnId: NonEmptyStringSchema
  })
  .strict();

export const AppServerTurnSteerResponseSchema = z
  .object({
    turnId: NonEmptyStringSchema
  })
  .strict();

export const AppServerTurnInterruptRequestSchema = z
  .object({
    threadId: NonEmptyStringSchema,
    turnId: NonEmptyStringSchema
  })
  .strict();

export const AppServerTurnInterruptResponseSchema = z.object({}).strict();

export const AppServerTurnCompletedNotificationSchema = z
  .object({
    threadId: NonEmptyStringSchema,
    turn: ThreadTurnSchema
  })
  .strict();

export const AppServerThreadUnsubscribeRequestSchema = z
  .object({
    threadId: NonEmptyStringSchema
  })
  .strict();

export const AppServerThreadUnsubscribeResponseSchema = z
  .object({
    status: z.enum(["notLoaded", "notSubscribed", "unsubscribed"])
  })
  .strict();

export const AppServerSetModeRequestSchema = z
  .object({
    conversationId: NonEmptyStringSchema,
    collaborationMode: CollaborationModeSchema
  })
  .strict();

export type AppServerListThreadsResponse = z.infer<typeof AppServerListThreadsResponseSchema>;
export type AppServerReadThreadResponse = z.infer<typeof AppServerReadThreadResponseSchema>;
export type AppServerListModelsResponse = z.infer<typeof AppServerListModelsResponseSchema>;
export type AppServerCollaborationModeListResponse = z.infer<
  typeof AppServerCollaborationModeListResponseSchema
>;
export type AppServerStartThreadResponse = z.infer<typeof AppServerStartThreadResponseSchema>;
export type AppServerResumeThreadResponse = z.infer<typeof AppServerResumeThreadResponseSchema>;
export type AppServerThreadForkResponse = z.infer<typeof AppServerThreadForkResponseSchema>;
export type AppServerThreadRollbackResponse = z.infer<
  typeof AppServerThreadRollbackResponseSchema
>;
export type AppServerTurnCompletedNotification = z.infer<
  typeof AppServerTurnCompletedNotificationSchema
>;
export type AppServerThreadUnsubscribeResponse = z.infer<
  typeof AppServerThreadUnsubscribeResponseSchema
>;
export type AppServerSandboxResponse = z.infer<typeof AppServerSandboxResponseSchema>;
export type AppServerSandboxPolicy = z.infer<typeof AppServerSandboxPolicySchema>;

export function parseAppServerListThreadsResponse(
  value: unknown
): AppServerListThreadsResponse {
  const result = AppServerListThreadsResponseSchema.safeParse(value);
  if (!result.success) {
    throw ProtocolValidationError.fromZod("AppServerListThreadsResponse", result.error);
  }
  return result.data;
}

export function parseAppServerReadThreadResponse(value: unknown): AppServerReadThreadResponse {
  const result = AppServerReadThreadResponseSchema.safeParse(value);
  if (!result.success) {
    throw ProtocolValidationError.fromZod("AppServerReadThreadResponse", result.error);
  }
  return result.data;
}

export function parseAppServerListModelsResponse(value: unknown): AppServerListModelsResponse {
  const result = AppServerListModelsResponseSchema.safeParse(value);
  if (!result.success) {
    throw ProtocolValidationError.fromZod("AppServerListModelsResponse", result.error);
  }
  return result.data;
}

export function parseAppServerCollaborationModeListResponse(
  value: unknown
): AppServerCollaborationModeListResponse {
  const result = AppServerCollaborationModeListResponseSchema.safeParse(value);
  if (!result.success) {
    throw ProtocolValidationError.fromZod(
      "AppServerCollaborationModeListResponse",
      result.error
    );
  }
  return result.data;
}

export function parseAppServerStartThreadResponse(value: unknown): AppServerStartThreadResponse {
  const result = AppServerStartThreadResponseSchema.safeParse(value);
  if (!result.success) {
    throw ProtocolValidationError.fromZod("AppServerStartThreadResponse", result.error);
  }
  return result.data;
}

export function parseAppServerResumeThreadResponse(
  value: unknown
): AppServerResumeThreadResponse {
  const result = AppServerResumeThreadResponseSchema.safeParse(value);
  if (!result.success) {
    throw ProtocolValidationError.fromZod("AppServerResumeThreadResponse", result.error);
  }
  return result.data;
}
