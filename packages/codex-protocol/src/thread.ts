import { z } from "zod";
import {
  JsonValueSchema,
  NonEmptyStringSchema,
  NonNegativeIntSchema,
  NullableNonEmptyStringSchema,
  NullableStringSchema
} from "./common.js";
import { ProtocolValidationError } from "./errors.js";

export const CollaborationModeSettingsSchema = z
  .object({
    model: NullableStringSchema.optional(),
    reasoning_effort: NullableStringSchema.optional(),
    developer_instructions: z.union([z.string(), z.null()]).optional()
  })
  .strict();

export const CollaborationModeSchema = z
  .object({
    mode: NonEmptyStringSchema,
    settings: CollaborationModeSettingsSchema
  })
  .strict();

export const InputTextPartSchema = z
  .object({
    type: z.literal("text"),
    text: z.string(),
    text_elements: z.array(JsonValueSchema).optional()
  })
  .strict();

export const InputImagePartSchema = z
  .object({
    type: z.literal("image"),
    url: z.string(),
    detail: z.enum(["auto", "low", "high", "original"]).nullable().optional()
  })
  .strict();

export const InputLocalImagePartSchema = z
  .object({
    type: z.literal("localImage"),
    path: z.string(),
    detail: z.enum(["auto", "low", "high", "original"]).nullable().optional()
  })
  .strict();

export const InputSkillPartSchema = z
  .object({
    type: z.literal("skill"),
    name: z.string(),
    path: z.string()
  })
  .strict();

export const InputMentionPartSchema = z
  .object({
    type: z.literal("mention"),
    name: z.string(),
    path: z.string()
  })
  .strict();

export const InputPartSchema = z.union([
  InputTextPartSchema,
  InputImagePartSchema,
  InputLocalImagePartSchema,
  InputSkillPartSchema,
  InputMentionPartSchema
]);

export const TurnStartParamsSchema = z
  .object({
    threadId: NonEmptyStringSchema,
    input: z.array(InputPartSchema),
    cwd: NonEmptyStringSchema.optional(),
    model: NullableStringSchema.optional(),
    effort: NullableStringSchema.optional(),
    approvalPolicy: NonEmptyStringSchema.optional(),
    sandboxPolicy: z.object({ type: NonEmptyStringSchema }).passthrough().optional(),
    summary: z.string().optional(),
    attachments: z.array(JsonValueSchema).optional(),
    collaborationMode: z.union([CollaborationModeSchema, z.null()]).optional(),
    personality: z.union([JsonValueSchema, z.null()]).optional(),
    outputSchema: z.union([JsonValueSchema, z.null()]).optional(),
    clientUserMessageId: NonEmptyStringSchema.optional(),
    commentAttachments: z.tuple([]).optional(),
    multiAgentMode: NonEmptyStringSchema.optional(),
    serviceTier: NullableNonEmptyStringSchema.optional(),
    approvalsReviewer: NonEmptyStringSchema.optional(),
    permissions: NullableNonEmptyStringSchema.optional(),
    runtimeWorkspaceRoots: z.array(NonEmptyStringSchema).nullable().optional(),
    useAppServerPermissionDefault: z.boolean().optional()
  })
  .strict();

export const UserMessageContentPartSchema = z
  .object({
    type: z.literal("text"),
    text: z.string(),
    text_elements: z.array(JsonValueSchema).optional()
  })
  .strict();

export const UserMessagePartSchema = InputPartSchema;

export const UserMessageItemSchema = z
  .object({
    id: NonEmptyStringSchema,
    type: z.literal("userMessage"),
    content: z.array(UserMessagePartSchema),
    clientId: z.string().nullable().optional()
  })
  .strict();

const LegacySteeringUserMessageItemSchema = z
  .object({
    id: NonEmptyStringSchema,
    type: z.literal("steeringUserMessage"),
    content: z.array(UserMessagePartSchema),
    attachments: z.array(JsonValueSchema).optional(),
    status: z.enum(["pending", "accepted"]).optional()
  })
  .strict();

const DesktopSteeringAttachmentSchema = z
  .object({
    label: z.string(),
    path: z.string(),
    fsPath: z.string()
  })
  .strict();

export const DesktopSteeringImageAttachmentSchema = z
  .object({
    id: NonEmptyStringSchema,
    src: z.string(),
    localPath: z.string(),
    filename: z.string(),
    uploadStatus: NonEmptyStringSchema
  })
  .strict();

export const DesktopSteeringRestoreContextSchema = z
  .object({
    addedFiles: z.array(JsonValueSchema),
    chatGptConversationContexts: z.array(JsonValueSchema),
    prompt: z.string(),
    ideContext: JsonValueSchema.nullable(),
    imageAttachments: z.array(DesktopSteeringImageAttachmentSchema),
    imageCommentDrafts: z.array(JsonValueSchema),
    appshotContexts: z.array(JsonValueSchema),
    fileAttachments: z.array(JsonValueSchema),
    pastedTextAttachments: z.array(JsonValueSchema),
    inAppBrowserContext: JsonValueSchema.nullable(),
    commentAttachments: z.array(JsonValueSchema),
    mcpAppModelContextAttachments: z.array(JsonValueSchema),
    selectedTextAttachments: z.array(JsonValueSchema),
    responseTextAnnotations: z.array(JsonValueSchema),
    pullRequestChecks: z.array(JsonValueSchema),
    pullRequestMergeConflict: JsonValueSchema.nullable(),
    workspaceRoots: z.array(NonEmptyStringSchema),
    threadReferences: z.array(JsonValueSchema)
  })
  .strict();

export const DesktopSteeringRestoreMessageSchema = z
  .object({
    id: NonEmptyStringSchema,
    text: z.string(),
    context: DesktopSteeringRestoreContextSchema,
    cwd: NonEmptyStringSchema,
    createdAt: z.number().finite().nonnegative(),
    pausedReason: NonEmptyStringSchema.optional()
  })
  .strict();

const CurrentDesktopSteeringUserMessageItemSchema = z
  .object({
    id: NonEmptyStringSchema,
    type: z.literal("steeringUserMessage"),
    targetTurnId: NullableNonEmptyStringSchema,
    targetTurnStartedAtMs: z.union([NonNegativeIntSchema, z.null()]),
    status: z.enum(["pending", "accepted"]),
    clientUserMessageId: NullableNonEmptyStringSchema,
    input: z.array(UserMessagePartSchema),
    attachments: z.array(DesktopSteeringAttachmentSchema),
    restoreMessage: DesktopSteeringRestoreMessageSchema,
    compareKey: z
      .object({
        rawText: z.string(),
        imageCount: NonNegativeIntSchema
      })
      .strict()
  })
  .strict()
  .transform((item) => ({
    id: item.id,
    type: item.type,
    content: item.input,
    attachments: item.attachments
  }));

export const SteeringUserMessageItemSchema = z.union([
  LegacySteeringUserMessageItemSchema,
  CurrentDesktopSteeringUserMessageItemSchema
]);

export const AgentMessageItemSchema = z
  .object({
    id: NonEmptyStringSchema,
    type: z.literal("agentMessage"),
    text: z.string(),
    phase: z.enum(["commentary", "final_answer"]).nullable().optional(),
    delivery: z.literal("async").nullable().optional(),
    questions: z.array(z.object({
      title: z.string(),
      options: z.array(z.string()).nullable().optional()
    }).strict()).nullable().optional(),
    memoryCitation: z
      .object({
        entries: z.array(
          z
            .object({
              path: z.string(),
              lineStart: NonNegativeIntSchema,
              lineEnd: NonNegativeIntSchema,
              note: z.string()
            })
            .strict()
        ),
        threadIds: z.array(z.string())
      })
      .strict()
      .nullable()
      .optional()
  })
  .strict();

export const ReasoningItemSchema = z
  .object({
    id: NonEmptyStringSchema,
    type: z.literal("reasoning"),
    summary: z.array(z.string()).optional(),
    content: z.array(JsonValueSchema).optional(),
    text: z.string().optional()
  })
  .strict();

export const PlanItemSchema = z
  .object({
    id: NonEmptyStringSchema,
    type: z.literal("plan"),
    text: z.string()
  })
  .strict();

export const TodoListPlanItemSchema = z
  .object({
    step: z.string(),
    status: NonEmptyStringSchema
  })
  .strict();

export const TodoListItemSchema = z
  .object({
    id: NonEmptyStringSchema,
    type: z.literal("todo-list"),
    explanation: NullableStringSchema,
    plan: z.array(TodoListPlanItemSchema)
  })
  .strict();

const HttpStatusErrorInfoSchema = z
  .object({
    httpStatusCode: z.union([z.number().int(), z.null()])
  })
  .strict();

const CodexErrorInfoSchema = z.union([
  z.enum([
    "contextWindowExceeded",
    "sessionBudgetExceeded",
    "usageLimitExceeded",
    "serverOverloaded",
    "cyberPolicy",
    "internalServerError",
    "unauthorized",
    "badRequest",
    "threadRollbackFailed",
    "sandboxError",
    "other"
  ]),
  z.object({ httpConnectionFailed: HttpStatusErrorInfoSchema }).strict(),
  z.object({ responseStreamConnectionFailed: HttpStatusErrorInfoSchema }).strict(),
  z.object({ responseStreamDisconnected: HttpStatusErrorInfoSchema }).strict(),
  z.object({ responseTooManyFailedAttempts: HttpStatusErrorInfoSchema }).strict(),
  z
    .object({
      activeTurnNotSteerable: z
        .object({ turnKind: z.enum(["review", "compact"]) })
        .strict()
    })
    .strict()
]);

export const ErrorItemSchema = z
  .object({
    id: NonEmptyStringSchema,
    type: z.literal("error"),
    message: z.string(),
    willRetry: z.boolean(),
    errorInfo: CodexErrorInfoSchema.nullable(),
    additionalDetails: NullableStringSchema
  })
  .strict();

export const UserInputAnsweredQuestionSchema = z
  .object({
    id: NonEmptyStringSchema,
    header: z.string().optional(),
    question: z.string().optional()
  })
  .strict();

export const UserInputResponseItemSchema = z
  .object({
    id: NonEmptyStringSchema,
    type: z.literal("userInputResponse"),
    requestId: NonNegativeIntSchema,
    turnId: NonEmptyStringSchema,
    questions: z.array(UserInputAnsweredQuestionSchema),
    answers: z.record(z.array(z.string())),
    completed: z.boolean().optional()
  })
  .strict();

export const CommandActionSchema = z
  .object({
    type: NonEmptyStringSchema,
    command: z.string().optional(),
    name: z.string().optional(),
    path: z.union([z.string(), z.null()]).optional(),
    query: z.string().optional()
  })
  .strict();

export const CommandExecutionItemSchema = z
  .object({
    type: z.literal("commandExecution"),
    id: NonEmptyStringSchema,
    source: z.string().optional(),
    command: z.string(),
    cwd: z.string().optional(),
    processId: z.string().optional(),
    status: NonEmptyStringSchema,
    commandActions: z.array(CommandActionSchema).optional(),
    aggregatedOutput: z.union([z.string(), z.null()]).optional(),
    exitCode: z.union([z.number().int(), z.null()]).optional(),
    durationMs: z.union([NonNegativeIntSchema, z.null()]).optional(),
    pluginId: z.string().nullable().optional(),
    scriptPath: z.string().nullable().optional()
  })
  .strict();

export const FileChangeKindSchema = z
  .object({
    type: NonEmptyStringSchema,
    move_path: z.union([z.string(), z.null()]).optional()
  })
  .strict();

export const FileChangeEntrySchema = z
  .object({
    path: z.string(),
    kind: FileChangeKindSchema,
    diff: z.string().optional()
  })
  .strict();

export const FileChangeItemSchema = z
  .object({
    type: z.literal("fileChange"),
    id: NonEmptyStringSchema,
    changes: z.array(FileChangeEntrySchema),
    status: NonEmptyStringSchema
  })
  .strict();

export const ContextCompactionItemSchema = z
  .object({
    type: z.literal("contextCompaction"),
    id: NonEmptyStringSchema,
    completed: z.boolean().optional(),
    source: NonEmptyStringSchema.optional()
  })
  .strict();

export const WebSearchActionSchema = z
  .object({
    type: NonEmptyStringSchema,
    query: NullableStringSchema.optional(),
    queries: z.array(z.string()).nullable().optional(),
    url: NullableStringSchema.optional(),
    pattern: z.string().nullable().optional()
  })
  .strict();

export const WebSearchItemSchema = z
  .object({
    type: z.literal("webSearch"),
    id: NonEmptyStringSchema,
    query: z.string(),
    action: WebSearchActionSchema.nullable(),
    results: z.array(JsonValueSchema).nullable().optional()
  })
  .strict();

export const ModelChangedItemSchema = z
  .object({
    type: z.literal("modelChanged"),
    id: NonEmptyStringSchema,
    fromModel: NullableStringSchema.optional(),
    toModel: NullableStringSchema.optional()
  })
  .strict();

const McpToolCallAppContextSchema = z
  .object({
    connectorId: z.string(),
    actionName: z.string().nullable().optional(),
    appName: z.string().nullable().optional(),
    linkId: z.string().nullable().optional(),
    resourceUri: z.string().nullable().optional(),
    templateId: z.string().nullable().optional()
  })
  .strict();

const McpToolCallResultSchema = z
  .object({
    content: z.array(JsonValueSchema),
    _meta: JsonValueSchema.optional(),
    structuredContent: JsonValueSchema.optional()
  })
  .strict();

export const McpToolCallItemSchema = z
  .object({
    id: NonEmptyStringSchema,
    type: z.literal("mcpToolCall"),
    server: z.string(),
    tool: z.string(),
    status: z.enum(["inProgress", "completed", "failed"]),
    arguments: JsonValueSchema,
    appContext: McpToolCallAppContextSchema.nullable().optional(),
    mcpAppUi: z.object({
      resourceUri: z.string(),
      preferredModelDisplayMode: z.enum(["inline", "fullscreen"])
    }).strict().nullable().optional(),
    durationMs: NonNegativeIntSchema.nullable().optional(),
    error: z.object({ message: z.string() }).strict().nullable().optional(),
    mcpAppResourceUri: z.string().nullable().optional(),
    pluginId: z.string().nullable().optional(),
    readOnlyHint: z.boolean().nullable().optional(),
    result: McpToolCallResultSchema.nullable().optional()
  })
  .strict();

export const SubAgentActivityItemSchema = z
  .object({
    id: NonEmptyStringSchema,
    type: z.literal("subAgentActivity"),
    agentPath: z.string(),
    agentThreadId: z.string(),
    kind: z.enum(["started", "interacted", "interrupted", "completed"]),
    model: z.string().nullable().optional(),
    reasoningEffort: NonEmptyStringSchema.nullable().optional()
  })
  .strict();

export const HookPromptItemSchema = z
  .object({
    id: NonEmptyStringSchema,
    type: z.literal("hookPrompt"),
    fragments: z.array(
      z
        .object({
          hookRunId: z.string(),
          text: z.string()
        })
        .strict()
    )
  })
  .strict();

const DynamicToolCallOutputContentItemSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("inputText"), text: z.string() }).strict(),
  z.object({ type: z.literal("inputImage"), imageUrl: z.string() }).strict()
]);

export const DynamicToolCallItemSchema = z
  .object({
    id: NonEmptyStringSchema,
    type: z.literal("dynamicToolCall"),
    tool: z.string(),
    status: z.enum(["inProgress", "completed", "failed"]),
    arguments: JsonValueSchema,
    contentItems: z.array(DynamicToolCallOutputContentItemSchema).nullable().optional(),
    durationMs: z.number().int().nullable().optional(),
    namespace: z.string().nullable().optional(),
    success: z.boolean().nullable().optional()
  })
  .strict();

const CollabAgentStateSchema = z
  .object({
    status: z.enum([
      "pendingInit",
      "running",
      "interrupted",
      "completed",
      "errored",
      "shutdown",
      "notFound"
    ]),
    message: z.string().nullable().optional()
  })
  .strict();

export const CollabAgentToolCallItemSchema = z
  .object({
    id: NonEmptyStringSchema,
    type: z.literal("collabAgentToolCall"),
    tool: z.enum(["spawnAgent", "sendInput", "resumeAgent", "wait", "closeAgent"]),
    status: z.enum(["inProgress", "completed", "failed"]),
    senderThreadId: z.string(),
    receiverThreadIds: z.array(z.string()),
    agentsStates: z.record(CollabAgentStateSchema),
    model: z.string().nullable().optional(),
    prompt: z.string().nullable().optional(),
    reasoningEffort: NonEmptyStringSchema.nullable().optional()
  })
  .strict();

export const ImageViewItemSchema = z
  .object({
    id: NonEmptyStringSchema,
    type: z.literal("imageView"),
    path: z.string()
  })
  .strict();

export const SleepItemSchema = z
  .object({
    id: NonEmptyStringSchema,
    type: z.literal("sleep"),
    durationMs: NonNegativeIntSchema
  })
  .strict();

export const ImageGenerationItemSchema = z
  .object({
    id: NonEmptyStringSchema,
    type: z.literal("imageGeneration"),
    result: z.string().optional(),
    fileId: z.string().optional(),
    status: z.string(),
    inputImages: z.array(z.object({ path: z.string(), sha256: z.string() }).strict()).optional(),
    failure: z.object({
      type: z.literal("usageLimitExceeded"),
      limitId: z.string(),
      resetsAt: z.number().int().nullable().optional()
    }).strict().nullable().optional(),
    revisedPrompt: z.string().nullable().optional(),
    savedPath: z.string().nullable().optional(),
    transparentBackground: z.boolean().nullable().optional(),
    src: z.string().optional()
  })
  .strict()
  .refine((item) => item.result !== undefined || item.fileId !== undefined,
    "Generated images require inline data or an attachment identity");

export const EnteredReviewModeItemSchema = z
  .object({
    id: NonEmptyStringSchema,
    type: z.literal("enteredReviewMode"),
    review: z.string()
  })
  .strict();

export const ExitedReviewModeItemSchema = z
  .object({
    id: NonEmptyStringSchema,
    type: z.literal("exitedReviewMode"),
    review: z.string()
  })
  .strict();

export const SteeredItemSchema = z
  .object({
    id: NonEmptyStringSchema,
    type: z.literal("steered")
  })
  .strict();

const NonSteeringTurnItemSchemas = [
  UserMessageItemSchema,
  AgentMessageItemSchema,
  ReasoningItemSchema,
  PlanItemSchema,
  TodoListItemSchema,
  ErrorItemSchema,
  UserInputResponseItemSchema,
  CommandExecutionItemSchema,
  FileChangeItemSchema,
  ContextCompactionItemSchema,
  WebSearchItemSchema,
  ModelChangedItemSchema,
  McpToolCallItemSchema,
  SubAgentActivityItemSchema,
  HookPromptItemSchema,
  DynamicToolCallItemSchema,
  CollabAgentToolCallItemSchema,
  ImageViewItemSchema,
  SleepItemSchema,
  EnteredReviewModeItemSchema,
  ExitedReviewModeItemSchema,
  SteeredItemSchema
] as const;

const TurnItemSchemas = [
  ...NonSteeringTurnItemSchemas,
  ImageGenerationItemSchema,
  SteeringUserMessageItemSchema
] as const;

export type TurnItem = z.output<(typeof TurnItemSchemas)[number]>;
export type TurnItemInput = z.input<(typeof TurnItemSchemas)[number]>;

export const TurnItemSchema: z.ZodType<TurnItem, z.ZodTypeDef, TurnItemInput> =
  z.union([
    z.discriminatedUnion("type", NonSteeringTurnItemSchemas),
    ImageGenerationItemSchema,
    SteeringUserMessageItemSchema
  ]);

export const UserInputOptionSchema = z
  .object({
    label: z.string(),
    description: z.string()
  })
  .strict();

export const UserInputQuestionSchema = z
  .object({
    id: NonEmptyStringSchema,
    header: z.string(),
    question: z.string(),
    isOther: z.boolean().default(false),
    isSecret: z.boolean().default(false),
    options: z.array(UserInputOptionSchema)
  })
  .strict();

export const UserInputRequestParamsSchema = z
  .object({
    threadId: NonEmptyStringSchema,
    turnId: NonEmptyStringSchema,
    itemId: NonEmptyStringSchema,
    questions: z.array(UserInputQuestionSchema)
  })
  .strict();

export const UserInputRequestSchema = z
  .object({
    method: z.literal("item/tool/requestUserInput"),
    id: NonNegativeIntSchema,
    params: UserInputRequestParamsSchema,
    completed: z.boolean().optional()
  })
  .strict();

export const ThreadTurnSchema = z
  .object({
    params: TurnStartParamsSchema.optional(),
    turnId: z.union([NonEmptyStringSchema, z.null()]).optional(),
    id: NonEmptyStringSchema.optional(),
    status: NonEmptyStringSchema,
    turnStartedAtMs: z.union([NonNegativeIntSchema, z.null()]).optional(),
    finalAssistantStartedAtMs: z.union([NonNegativeIntSchema, z.null()]).optional(),
    startedAt: z.union([NonNegativeIntSchema, z.null()]).optional(),
    completedAt: z.union([NonNegativeIntSchema, z.null()]).optional(),
    durationMs: z.union([NonNegativeIntSchema, z.null()]).optional(),
    error: z.union([JsonValueSchema, z.null()]).optional(),
    diff: z.union([JsonValueSchema, z.null()]).optional(),
    items: z.array(TurnItemSchema)
  })
  .passthrough();

type ThreadTurn = z.output<typeof ThreadTurnSchema>;
type ThreadTurnInput = z.input<typeof ThreadTurnSchema>;
type CanonicalThreadTurnEntity = ThreadTurn & { turnId: string | null };
type CanonicalThreadTurnEntityInput = ThreadTurnInput & { turnId: string | null };
type CanonicalTurnHistoryBoundary =
  | {
      status: "exhausted";
      boundaryId: string;
    }
  | {
      status: "available";
      boundaryId: string;
      handle: {
        cursor: string;
        oldestLoadedTurnId: string;
      };
      progressKey: string;
    };
type CanonicalTurnHistory = {
  kind: "canonical";
  history: {
    entitiesByKey: Record<string, CanonicalThreadTurnEntity>;
    generation: number;
    isComplete: boolean;
    islands: Array<{
      id: string;
      entries: Array<{
        key: string;
        value: string;
      }>;
      olderBoundary: CanonicalTurnHistoryBoundary;
      newerBoundary: CanonicalTurnHistoryBoundary;
    }>;
  };
};
type CanonicalTurnHistoryInput = {
  kind: "canonical";
  history: {
    entitiesByKey: Record<string, CanonicalThreadTurnEntityInput>;
    generation: number;
    isComplete: boolean;
    islands: CanonicalTurnHistory["history"]["islands"];
  };
};

const CanonicalThreadTurnEntitySchema: z.ZodType<
  CanonicalThreadTurnEntity,
  z.ZodTypeDef,
  CanonicalThreadTurnEntityInput
> = ThreadTurnSchema.extend({
  turnId: z.union([NonEmptyStringSchema, z.null()])
});

const CanonicalTailTurnKeySchema = z.string().regex(
  /^tail:\d+:local:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
);

const CanonicalTurnHistoryEntrySchema = z
  .object({
    key: NonEmptyStringSchema,
    value: NonEmptyStringSchema
  })
  .strict();

const ExhaustedTurnHistoryBoundarySchema = z
  .object({
    status: z.literal("exhausted"),
    boundaryId: NonEmptyStringSchema
  })
  .strict();

const AvailableTurnHistoryBoundarySchema = z
  .object({
    status: z.literal("available"),
    boundaryId: NonEmptyStringSchema,
    handle: z
      .object({
        cursor: NonEmptyStringSchema,
        oldestLoadedTurnId: NonEmptyStringSchema
      })
      .strict(),
    progressKey: NonEmptyStringSchema
  })
  .strict();

const CanonicalTurnHistoryBoundarySchema = z.discriminatedUnion("status", [
  ExhaustedTurnHistoryBoundarySchema,
  AvailableTurnHistoryBoundarySchema
]);

const CanonicalTurnHistoryIslandSchema = z
  .object({
    id: NonEmptyStringSchema,
    entries: z.array(CanonicalTurnHistoryEntrySchema),
    olderBoundary: CanonicalTurnHistoryBoundarySchema,
    newerBoundary: CanonicalTurnHistoryBoundarySchema
  })
  .strict();

const CanonicalTurnHistorySchema: z.ZodType<
  CanonicalTurnHistory,
  z.ZodTypeDef,
  CanonicalTurnHistoryInput
> = z
  .object({
    kind: z.literal("canonical"),
    history: z
      .object({
        entitiesByKey: z.record(CanonicalThreadTurnEntitySchema),
        generation: NonNegativeIntSchema,
        isComplete: z.boolean(),
        islands: z.array(CanonicalTurnHistoryIslandSchema)
      })
      .strict()
  })
  .strict()
  .superRefine((turnHistory, ctx) => {
    for (const [entityKey, turn] of Object.entries(turnHistory.history.entitiesByKey)) {
      // Desktop adds a null-ID tail entity, then commits its ID in place before
      // the next snapshot normalizes the key to turn:<turnId>.
      const isTailKey = CanonicalTailTurnKeySchema.safeParse(entityKey).success;
      if (turn.turnId === null) {
        if (!isTailKey) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["history", "entitiesByKey", entityKey, "turnId"],
            message: `provisional canonical turn entity ${entityKey} must use a tail key`
          });
        }
        continue;
      }

      if (!isTailKey && entityKey !== `turn:${turn.turnId}`) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["history", "entitiesByKey", entityKey, "turnId"],
          message: `canonical turn entity ${entityKey} does not match turn ${turn.turnId}`
        });
      }
    }

    const seenTurnKeys = new Set<string>();
    for (const island of turnHistory.history.islands) {
      for (const entry of island.entries) {
        if (entry.key !== entry.value) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `canonical turn history entry key ${entry.key} does not match value ${entry.value}`
          });
        }
        if (seenTurnKeys.has(entry.value)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `canonical turn history contains duplicate entry ${entry.value}`
          });
        }
        seenTurnKeys.add(entry.value);
        const turn = turnHistory.history.entitiesByKey[entry.value];
        if (!turn) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `canonical turn history entry ${entry.value} has no entity`
          });
          continue;
        }
        if (
          turn.turnId !== null &&
          !CanonicalTailTurnKeySchema.safeParse(entry.value).success &&
          entry.value !== `turn:${turn.turnId}`
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `canonical turn history entity ${entry.value} does not match turn ${turn.turnId}`
          });
        }
      }
    }
  });

const ThreadConversationStateWireSchema = z
  .object({
    id: NonEmptyStringSchema,
    turns: z.array(ThreadTurnSchema),
    requests: z.array(UserInputRequestSchema).default([]),
    createdAt: NonNegativeIntSchema.optional(),
    updatedAt: NonNegativeIntSchema.optional(),
    title: NullableStringSchema.optional(),
    model: NullableStringSchema.optional(),
    modelProvider: z.string().optional(),
    reasoningEffort: NullableStringSchema.optional(),
    latestModel: NullableStringSchema.optional(),
    latestReasoningEffort: NullableStringSchema.optional(),
    previousTurnModel: NullableStringSchema.optional(),
    latestCollaborationMode: z.union([CollaborationModeSchema, z.null()]).optional(),
    hasUnreadTurn: z.boolean().optional(),
    rolloutPath: z.string().optional(),
    cwd: z.string().optional(),
    gitInfo: z.union([JsonValueSchema, z.null()]).optional(),
    resumeState: z.string().optional(),
    latestTokenUsageInfo: JsonValueSchema.optional(),
    source: z.string().optional(),
    turnHistory: CanonicalTurnHistorySchema.optional()
  })
  .passthrough();

export type ThreadConversationState = z.infer<typeof ThreadConversationStateWireSchema>;

export const ThreadConversationStateSchema: z.ZodType<
  ThreadConversationState,
  z.ZodTypeDef,
  z.input<typeof ThreadConversationStateWireSchema>
> = ThreadConversationStateWireSchema
  .transform((state) => {
    if (!state.turnHistory) {
      return state;
    }
    const turns = state.turnHistory.history.islands.flatMap((island) =>
      island.entries.flatMap((entry) => {
        const turn = state.turnHistory?.history.entitiesByKey[entry.value];
        return turn && turn.turnId !== null ? [turn] : [];
      })
    );
    return {
      ...state,
      turns
    };
  });

export const ThreadStreamPatchPathSegmentSchema = z.union([
  NonNegativeIntSchema,
  NonEmptyStringSchema
]);

export const ThreadStreamPatchSchema = z
  .object({
    op: z.enum(["add", "replace", "remove"]),
    path: z.array(ThreadStreamPatchPathSegmentSchema).min(1),
    value: JsonValueSchema.optional()
  })
  .strict()
  .superRefine((patch, ctx) => {
    const hasValue = Object.prototype.hasOwnProperty.call(patch, "value");

    if (patch.op === "remove" && hasValue) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "remove patches must not include value"
      });
    }

    if (patch.op !== "remove" && !hasValue) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${patch.op} patches must include value`
      });
    }
  });

export const ThreadStreamSnapshotChangeSchema = z
  .object({
    type: z.literal("snapshot"),
    revision: NonNegativeIntSchema,
    conversationState: ThreadConversationStateSchema
  })
  .strict();

export const ThreadStreamPatchesChangeSchema = z
  .object({
    type: z.literal("patches"),
    baseRevision: NonNegativeIntSchema,
    revision: NonNegativeIntSchema,
    patches: z.array(ThreadStreamPatchSchema)
  })
  .strict();

export const ThreadStreamChangeSchema = z.union([
  ThreadStreamSnapshotChangeSchema,
  ThreadStreamPatchesChangeSchema
]);

export const ThreadStreamStateChangedParamsSchema = z
  .object({
    conversationId: NonEmptyStringSchema,
    hostId: NonEmptyStringSchema,
    change: ThreadStreamChangeSchema
  })
  .strict();

export type CollaborationMode = z.infer<typeof CollaborationModeSchema>;
export type FileChangeEntry = z.infer<typeof FileChangeEntrySchema>;
export type TurnStartParams = z.infer<typeof TurnStartParamsSchema>;
export type UserInputRequest = z.infer<typeof UserInputRequestSchema>;
export type ThreadStreamPatch = z.infer<typeof ThreadStreamPatchSchema>;
export type ThreadStreamStateChangedParams = z.infer<typeof ThreadStreamStateChangedParamsSchema>;

export function parseThreadConversationState(value: unknown): ThreadConversationState {
  const result = ThreadConversationStateSchema.safeParse(value);
  if (!result.success) {
    throw ProtocolValidationError.fromZod("ThreadConversationState", result.error);
  }
  return result.data;
}

export function parseThreadStreamStateChangedParams(
  value: unknown
): ThreadStreamStateChangedParams {
  const result = ThreadStreamStateChangedParamsSchema.safeParse(value);
  if (!result.success) {
    throw ProtocolValidationError.fromZod("ThreadStreamStateChangedParams", result.error);
  }
  return result.data;
}

export const UserInputAnswerSchema = z
  .object({
    answers: z.array(z.string().min(1))
  })
  .strict();

export const UserInputResponsePayloadSchema = z
  .object({
    answers: z.record(UserInputAnswerSchema)
  })
  .strict();

export type UserInputResponsePayload = z.infer<typeof UserInputResponsePayloadSchema>;

export function parseUserInputResponsePayload(value: unknown): UserInputResponsePayload {
  const result = UserInputResponsePayloadSchema.safeParse(value);
  if (!result.success) {
    throw ProtocolValidationError.fromZod("UserInputResponsePayload", result.error);
  }
  return result.data;
}
