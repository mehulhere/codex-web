import { CollaborationModeSchema } from "@farfield/protocol";
import { z } from "zod";
import { DeviceStatusSchema } from "./device-status.js";
import { AccountsStatusSchema, ThreadAccountStatusSchema } from "./multi-auth-status.js";

export const ImageUploadMetadataSchema = z
  .object({
    id: z.string().uuid(),
    filename: z.string().min(1),
    mediaType: z.enum(["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif"]),
    size: z.number().int().positive(),
    url: z.string().startsWith("/api/uploads/")
  })
  .strict();

export const ImageUploadResponseSchema = z
  .object({
    ok: z.literal(true),
    image: ImageUploadMetadataSchema
  })
  .strict();

export const AuthErrorCodeSchema = z.enum([
  "AUTH_REQUIRED",
  "AUTH_INVALID",
  "AUTH_EXPIRED",
  "DEBUG_DISABLED_REMOTE"
]);

export const AuthErrorBodySchema = z
  .object({
    ok: z.literal(false),
    error: z.string(),
    code: AuthErrorCodeSchema
  })
  .strict();

export const LoginBodySchema = z
  .object({
    pin: z.string().min(1).max(128)
  })
  .strict();

export const LoginResponseSchema = z
  .object({
    ok: z.literal(true),
    expiresAt: z.string().nullable()
  })
  .strict();

export const LogoutResponseSchema = z
  .object({
    ok: z.literal(true)
  })
  .strict();

export const HealthResponseSchema = z
  .object({
    ok: z.literal(true),
    state: z
      .object({
        appReady: z.boolean(),
        ipcConnected: z.boolean(),
        ipcInitialized: z.boolean(),
        requiresAuth: z.boolean(),
        multiAccount: z.boolean()
      })
      .strict()
  })
  .strict();

export const ClientErrorBodySchema = z
  .object({
    kind: z.enum([
      "window-error",
      "unhandled-rejection",
      "react-error-boundary",
      "request-error"
    ]),
    message: z.string().trim().min(1).max(2_000),
    stack: z.string().max(8_000).optional(),
    url: z.string().max(1_000),
    userAgent: z.string().max(500),
    timestamp: z.number().int().nonnegative(),
    details: z.record(z.string().max(500)).default({})
  })
  .strict();

export const AuthSessionResponseSchema = z
  .object({
    ok: z.literal(true),
    authenticated: z.boolean(),
    expiresAt: z.string().nullable(),
    requiresAuth: z.boolean(),
    remoteRequest: z.boolean(),
    debugAvailable: z.boolean(),
    fullControlAvailable: z.literal(true)
  })
  .strict();

export const RemoteStatusResponseSchema = z
  .object({
    ok: z.literal(true),
    tailscaleInstalled: z.boolean(),
    tailscaleIps: z.array(z.string()),
    host: z.string(),
    port: z.number().int().positive()
  })
  .strict();

export const DeviceStatusResponseSchema = z
  .object({
    ok: z.literal(true),
    status: DeviceStatusSchema
  })
  .strict();

export const ThreadAccountStatusResponseSchema = ThreadAccountStatusSchema.extend({
  ok: z.literal(true)
}).strict();

export const AccountsStatusResponseSchema = AccountsStatusSchema.extend({
  ok: z.literal(true)
}).strict();

export const ThreadSettingsResponseSchema = z
  .object({
    ok: z.literal(true),
    model: z.string().min(1),
    modelProvider: z.string().min(1).nullable(),
    reasoningEffort: z.string().min(1).nullable()
  })
  .strict();

export const UpdateThreadSettingsBodySchema = z
  .object({
    model: z.string().min(1).nullable().optional(),
    effort: z.string().min(1).nullable().optional(),
    collaborationMode: CollaborationModeSchema.nullable().optional()
  })
  .strict();

export const CompactThreadBodySchema = z
  .object({
    ownerClientId: z.string().min(1).optional()
  })
  .strict();

export const EditLastMessageBodySchema = z
  .object({
    ownerClientId: z.string().min(1).optional(),
    turnId: z.string().min(1),
    message: z.string().min(1)
  })
  .strict();

export const ForkThreadBodySchema = z
  .object({
    turnId: z.string().min(1)
  })
  .strict();

export const SideThreadBodySchema = z
  .object({
    cwd: z.string().min(1),
    ownerClientId: z.string().min(1).optional()
  })
  .strict();

export const ThreadActionResponseSchema = z
  .object({
    ok: z.literal(true),
    threadId: z.string().min(1)
  })
  .strict();

export const SideThreadResponseSchema = z
  .object({
    ok: z.literal(true),
    threadId: z.string().min(1),
    title: z.string().min(1)
  })
  .strict();

export const ThreadMediaRouteSchema = z
  .object({
    threadId: z.string().min(1),
    itemId: z.string().min(1),
    imageIndex: z.union([
      z.number().int().nonnegative(),
      z
        .string()
        .regex(/^(0|[1-9]\d*)$/)
        .transform((value) => Number(value))
    ])
  })
  .strict();

export const SetModeBodySchema = z
  .object({
    ownerClientId: z.string().optional(),
    collaborationMode: CollaborationModeSchema
  })
  .strict();

export const StartThreadBodySchema = z
  .object({
    cwd: z.string().optional(),
    model: z.string().optional(),
    modelProvider: z.string().optional(),
    personality: z.string().optional(),
    sandbox: z.string().optional(),
    approvalPolicy: z.string().optional(),
    ephemeral: z.boolean().optional()
  })
  .strict();

export const SendMessageBodySchema = z
  .object({
    ownerClientId: z.string().optional(),
    text: z.string().trim(),
    cwd: z.string().optional(),
    isSteering: z.boolean().optional(),
    images: z.array(z.string().uuid()).max(8).default([])
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.images).size !== value.images.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["images"],
        message: "Duplicate image uploads are not allowed"
      });
    }
    if (!value.text && value.images.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["text"],
        message: "Message text or image is required"
      });
    }
  });

export const PublicQueuedImageSchema = ImageUploadMetadataSchema;

export const PublicQueuedFollowUpSchema = z
  .object({
    id: z.string().min(1),
    text: z.string(),
    createdAt: z.number().finite().nonnegative(),
    pausedReason: z.string().min(1).optional(),
    images: z.array(PublicQueuedImageSchema).default([])
  })
  .strict();

export const QueuedFollowUpsResponseSchema = z
  .object({
    ok: z.literal(true),
    threadId: z.string().min(1),
    ownerClientId: z.string().min(1).nullable(),
    messages: z.array(PublicQueuedFollowUpSchema)
  })
  .strict();

export const EditQueuedFollowUpBodySchema = z
  .object({
    text: z.string().trim().min(1)
  })
  .strict();

export const QueuedFollowUpActionResponseSchema = z
  .object({
    ok: z.literal(true),
    threadId: z.string().min(1),
    messageId: z.string().min(1)
  })
  .strict();

export const SubmitUserInputBodySchema = z
  .object({
    ownerClientId: z.string().optional(),
    requestId: z.number().int().nonnegative(),
    response: z.unknown()
  })
  .strict();

export const InterruptBodySchema = z
  .object({
    ownerClientId: z.string().optional()
  })
  .strict();

export const TraceStartBodySchema = z
  .object({
    label: z.string().min(1).max(120)
  })
  .strict();

export const TraceMarkBodySchema = z
  .object({
    note: z.string().max(500)
  })
  .strict();

export const ReplayBodySchema = z
  .object({
    entryId: z.string().min(1),
    waitForResponse: z.boolean().optional()
  })
  .strict();

export function parseBody<Schema extends z.ZodTypeAny>(
  schema: Schema,
  value: unknown
): z.infer<Schema> {
  return schema.parse(value);
}
