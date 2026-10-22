import { z } from "zod";

export const CliDecisionSchema = z.enum(["accept", "decline", "cancel"]);
export const CliQuestionSchema = z.object({
  id: z.string().min(1), header: z.string(), question: z.string(),
  isOther: z.boolean().optional(), isSecret: z.boolean().optional(),
  options: z.array(z.object({ label: z.string(), description: z.string() }).strict()).nullable().optional()
}).strict();
export const CliPendingRequestSchema = z.object({
  id: z.string().uuid(), threadId: z.string(), turnId: z.string(),
  kind: z.enum(["command", "file-change", "questions"]),
  reason: z.string().nullable(), command: z.string().nullable(), cwd: z.string().nullable(),
  details: z.string().nullable(),
  decisions: z.array(CliDecisionSchema), questions: z.array(CliQuestionSchema)
}).strict();
export type CliPendingRequest = z.infer<typeof CliPendingRequestSchema>;
export const CliRequestReplySchema = z.union([
  z.object({ decision: CliDecisionSchema }).strict(),
  z.object({ answers: z.record(z.object({ answers: z.array(z.string().max(20_000)).max(20) }).strict()) }).strict()
]);
