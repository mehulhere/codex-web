import { z } from "zod";

const ThreadLiveStateChangedEventSchema = z.object({
    type: z.literal("thread-live-state-changed"),
    threadId: z.string().min(1)
}).strict();

const GenericSseEventSchema = z.discriminatedUnion("type", [
    z.object({ type: z.literal("history"), entry: z.null() }).strict(),
    z.object({ type: z.literal("state"), state: z.unknown() }).strict(),
    z.object({
        type: z.literal("queued-follow-ups-changed"),
        threadId: z.string().min(1)
    }).strict()
]);

export function parseThreadLiveStateChangedEvent(data: string): z.infer<
    typeof ThreadLiveStateChangedEventSchema
> {
    return ThreadLiveStateChangedEventSchema.parse(JSON.parse(data));
}

export function parseGenericSseEvent(data: string): z.infer<typeof GenericSseEventSchema> | null {
    try {
        const parsed = GenericSseEventSchema.safeParse(JSON.parse(data));
        return parsed.success ? parsed.data : null;
    } catch {
        return null;
    }
}
