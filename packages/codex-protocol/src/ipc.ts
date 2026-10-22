import { z } from "zod";
import {
  JsonValueSchema,
  NonEmptyStringSchema,
  NonNegativeIntSchema
} from "./common.js";
import { ProtocolValidationError } from "./errors.js";
import {
  CollaborationModeSchema,
  DesktopSteeringImageAttachmentSchema,
  InputPartSchema,
  ThreadStreamStateChangedParamsSchema
} from "./thread.js";

export const IpcRequestIdSchema = NonEmptyStringSchema;

export const IpcRequestFrameSchema = z
  .object({
    type: z.literal("request"),
    requestId: IpcRequestIdSchema,
    method: NonEmptyStringSchema,
    params: z.unknown().optional(),
    targetClientId: NonEmptyStringSchema.optional(),
    sourceClientId: NonEmptyStringSchema.optional(),
    hostId: NonEmptyStringSchema.optional(),
    timeoutMs: NonNegativeIntSchema.optional(),
    version: NonNegativeIntSchema.optional()
  })
  .strict();

export const IpcResponseFrameSchema = z
  .object({
    type: z.literal("response"),
    requestId: IpcRequestIdSchema,
    method: NonEmptyStringSchema.optional(),
    handledByClientId: NonEmptyStringSchema.optional(),
    resultType: z.enum(["success", "error"]),
    result: z.unknown().optional(),
    error: z.unknown().optional()
  })
  .strict();

export const IpcBroadcastFrameSchema = z
  .object({
    type: z.literal("broadcast"),
    method: NonEmptyStringSchema,
    params: z.unknown().optional(),
    sourceClientId: NonEmptyStringSchema.optional(),
    targetClientIds: z.array(NonEmptyStringSchema).min(1).optional(),
    version: NonNegativeIntSchema.optional()
  })
  .strict();

export const IpcClientDiscoveryRequestFrameSchema = z
  .object({
    type: z.literal("client-discovery-request"),
    requestId: IpcRequestIdSchema,
    request: IpcRequestFrameSchema
  })
  .strict();

export const IpcClientDiscoveryResponseFrameSchema = z
  .object({
    type: z.literal("client-discovery-response"),
    requestId: IpcRequestIdSchema,
    response: z
      .object({
        canHandle: z.boolean()
      })
      .strict()
  })
  .strict();

export const IpcFrameSchema = z.union([
  IpcRequestFrameSchema,
  IpcResponseFrameSchema,
  IpcBroadcastFrameSchema,
  IpcClientDiscoveryRequestFrameSchema,
  IpcClientDiscoveryResponseFrameSchema
]);

export const ThreadStreamStateChangedBroadcastSchema = z
  .object({
    type: z.literal("broadcast"),
    method: z.literal("thread-stream-state-changed"),
    sourceClientId: NonEmptyStringSchema,
    params: ThreadStreamStateChangedParamsSchema,
    version: NonNegativeIntSchema
  })
  .strict();

const QueuedPermissionSelectionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("agent-mode"), agentMode: NonEmptyStringSchema }).strict(),
  z.object({ kind: z.literal("profile"), profileId: NonEmptyStringSchema }).strict(),
  z.object({ kind: z.literal("custom") }).strict(),
  z.object({ kind: z.literal("server-default") }).strict()
]);

const QueuedSubmissionOptionsSchema = z.object({
  useUserMessageAdmission: z.boolean().optional(),
  executionHostId: NonEmptyStringSchema.optional(),
  agentMode: NonEmptyStringSchema.optional(),
  permissionProfileId: z.string().nullable().optional(),
  serviceTier: z.string().nullable().optional(),
  shouldSendPermissionOverrides: z.boolean().optional(),
  usePermissionSelection: z.boolean().optional(),
  permissionSelection: QueuedPermissionSelectionSchema.nullable().optional(),
  collaborationMode: CollaborationModeSchema.nullable().optional(),
  clientUserMessageId: z.string().nullable().optional()
}).strict();

const QueuedMessageSenderSchema = z.object({
  accountUserId: z.string(),
  email: z.string(),
  name: z.string(),
  profilePictureUrl: z.string().nullable()
}).strict();

const QueuedEditPositionSchema = z.object({
  messageId: NonEmptyStringSchema,
  multiUserMessageSender: QueuedMessageSenderSchema.nullable().optional(),
  isImageEditFollowUp: z.boolean().optional(),
  turnTrigger: z.string().optional(),
  previousMessageId: z.string().nullable().optional(),
  nextMessageId: z.string().nullable().optional(),
  messageThreadId: z.string().optional(),
  serverSubmission: z.object({
    id: NonEmptyStringSchema,
    clientUserMessageId: z.string().nullable().optional(),
    input: z.array(InputPartSchema)
  }).strict().nullable().optional(),
  preserveSerializedContext: z.boolean().optional()
}).strict();

const QueuedAdditionalContextEntrySchema = z.object({
  kind: z.enum(["untrusted", "application"]),
  value: z.string()
}).strict();

export const QueuedFollowUpMessageSchema = z
  .object({
    id: NonEmptyStringSchema,
    text: z.string(),
    context: z.record(JsonValueSchema),
    cwd: NonEmptyStringSchema,
    createdAt: z.number().finite().nonnegative(),
    pausedReason: NonEmptyStringSchema.optional(),
    responsesapiClientMetadata: z.record(z.string()).nullable().optional(),
    mentionedBrowserFamilies: z.array(z.string()).optional(),
    multiUserMessageSender: QueuedMessageSenderSchema.nullable().optional(),
    submissionOptions: QueuedSubmissionOptionsSchema.optional(),
    writingBlockAdditionalContext: z.record(QueuedAdditionalContextEntrySchema).nullable().optional(),
    submissionIntent: z.enum(["queue", "start", "send-now"]).optional(),
    submission: z.object({
      hostId: NonEmptyStringSchema,
      status: z.enum(["pending", "sending", "outcome-unknown"]),
      queueModeOverride: NonEmptyStringSchema.optional(),
      editPosition: QueuedEditPositionSchema.optional()
    }).strict().optional()
  })
  .strict();

export const TextQueuedFollowUpContextSchema = z
  .object({
    prompt: z.string(),
    addedFiles: z.tuple([]),
    fileAttachments: z.tuple([]),
    ideContext: z.null(),
    imageAttachments: z.array(DesktopSteeringImageAttachmentSchema),
    workspaceRoots: z.tuple([NonEmptyStringSchema])
  })
  .strict();

export const ThreadQueuedFollowUpsChangedBroadcastSchema = z
  .object({
    type: z.literal("broadcast"),
    method: z.literal("thread-queued-followups-changed"),
    sourceClientId: NonEmptyStringSchema,
    targetClientIds: z.array(NonEmptyStringSchema).min(1).optional(),
    params: z
      .object({
        conversationId: NonEmptyStringSchema,
        hostId: NonEmptyStringSchema.optional(),
        messages: z.array(QueuedFollowUpMessageSchema)
      })
      .strict(),
    version: NonNegativeIntSchema
  })
  .strict();

export const DesktopAppendQueuedFollowUpResponseSchema = z
  .object({
    messages: z.array(QueuedFollowUpMessageSchema)
  })
  .strict();

export const SharedComposerDraftSchema = z
  .object({
    text: z.string().max(1_000_000),
    revision: NonNegativeIntSchema,
    source: NonEmptyStringSchema
  })
  .strict();

export const DesktopComposerDraftResponseSchema = z
  .object({
    draft: SharedComposerDraftSchema
  })
  .strict();

export const DesktopTypeAndSubmitMessageResponseSchema = z
  .object({
    conversationId: NonEmptyStringSchema,
    submitted: z.literal(true)
  })
  .strict();

export const DesktopRefreshThreadResponseSchema = z
  .object({
    conversationId: NonEmptyStringSchema,
    refreshScheduled: z.literal(true)
  })
  .strict();

export const ThreadComposerDraftChangedBroadcastSchema = z
  .object({
    type: z.literal("broadcast"),
    method: z.literal("thread-composer-draft-changed"),
    sourceClientId: NonEmptyStringSchema,
    targetClientIds: z.array(NonEmptyStringSchema).min(1).optional(),
    params: z
      .object({
        conversationId: NonEmptyStringSchema,
        draft: SharedComposerDraftSchema
      })
      .strict(),
    version: NonNegativeIntSchema
  })
  .strict();

export type IpcFrame = z.infer<typeof IpcFrameSchema>;
export type IpcRequestFrame = z.infer<typeof IpcRequestFrameSchema>;
export type IpcResponseFrame = z.infer<typeof IpcResponseFrameSchema>;
export type IpcBroadcastFrame = z.infer<typeof IpcBroadcastFrameSchema>;
export type IpcClientDiscoveryRequestFrame = z.infer<typeof IpcClientDiscoveryRequestFrameSchema>;
export type IpcClientDiscoveryResponseFrame = z.infer<typeof IpcClientDiscoveryResponseFrameSchema>;
export type ThreadStreamStateChangedBroadcast = z.infer<
  typeof ThreadStreamStateChangedBroadcastSchema
>;
export type QueuedFollowUpMessage = z.infer<typeof QueuedFollowUpMessageSchema>;
export type TextQueuedFollowUpContext = z.infer<typeof TextQueuedFollowUpContextSchema>;
export type ThreadQueuedFollowUpsChangedBroadcast = z.infer<
  typeof ThreadQueuedFollowUpsChangedBroadcastSchema
>;
export type DesktopAppendQueuedFollowUpResponse = z.infer<
  typeof DesktopAppendQueuedFollowUpResponseSchema
>;
export type SharedComposerDraft = z.infer<typeof SharedComposerDraftSchema>;
export type DesktopComposerDraftResponse = z.infer<
  typeof DesktopComposerDraftResponseSchema
>;
export type DesktopTypeAndSubmitMessageResponse = z.infer<
  typeof DesktopTypeAndSubmitMessageResponseSchema
>;
export type DesktopRefreshThreadResponse = z.infer<
  typeof DesktopRefreshThreadResponseSchema
>;
export type ThreadComposerDraftChangedBroadcast = z.infer<
  typeof ThreadComposerDraftChangedBroadcastSchema
>;

export function parseIpcFrame(value: unknown): IpcFrame {
  const result = IpcFrameSchema.safeParse(value);
  if (!result.success) {
    throw ProtocolValidationError.fromZod("IpcFrame", result.error);
  }
  return result.data;
}

export function parseThreadStreamStateChangedBroadcast(
  value: unknown
): ThreadStreamStateChangedBroadcast {
  const result = ThreadStreamStateChangedBroadcastSchema.safeParse(value);
  if (!result.success) {
    throw ProtocolValidationError.fromZod(
      "ThreadStreamStateChangedBroadcast",
      result.error
    );
  }
  return result.data;
}

export function parseThreadQueuedFollowUpsChangedBroadcast(
  value: IpcBroadcastFrame
): ThreadQueuedFollowUpsChangedBroadcast {
  const result = ThreadQueuedFollowUpsChangedBroadcastSchema.safeParse(value);
  if (!result.success) {
    throw ProtocolValidationError.fromZod(
      "ThreadQueuedFollowUpsChangedBroadcast",
      result.error
    );
  }
  return result.data;
}

export function parseThreadComposerDraftChangedBroadcast(
  value: IpcBroadcastFrame
): ThreadComposerDraftChangedBroadcast {
  const result = ThreadComposerDraftChangedBroadcastSchema.safeParse(value);
  if (!result.success) {
    throw ProtocolValidationError.fromZod(
      "ThreadComposerDraftChangedBroadcast",
      result.error
    );
  }
  return result.data;
}
