import { useState } from "react";
import type { CliPendingRequest } from "@farfield/protocol";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function CliRequests({ requests, onReply }: {
  requests: CliPendingRequest[];
  onReply: (id: string, reply: { decision: "accept" | "decline" | "cancel" } | { answers: Record<string, { answers: string[] }> }) => Promise<void>;
}): React.JSX.Element {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  async function submit(request: CliPendingRequest, decision?: "accept" | "decline" | "cancel") {
    setBusy(request.id); setError("");
    try {
      await onReply(request.id, decision ? { decision } : { answers: Object.fromEntries(
        request.questions.map(q => [q.id, { answers: [drafts[`${request.id}:${q.id}`] ?? ""].filter(Boolean) }])
      ) });
      setDrafts(current => Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith(`${request.id}:`))));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not submit the response"); }
    finally { setBusy(null); }
  }
  return <section aria-label="CLI requests" className="space-y-3">
    {requests.map(request => <div key={request.id} className="rounded-xl border border-border bg-card p-4 space-y-3">
      <h3 className="font-medium">{request.kind === "questions" ? "Codex needs your input"
        : request.kind === "command" ? "Approve command?" : "Approve file changes?"}</h3>
      {request.reason && <p className="text-sm whitespace-pre-wrap break-words">{request.reason}</p>}
      {request.cwd && <p className="text-xs break-all">{request.cwd}</p>}
      {request.command && <pre className="whitespace-pre-wrap break-all text-xs">{request.command}</pre>}
      {request.details && <details className="text-xs"><summary>Requested operation and permissions</summary>
        <pre className="whitespace-pre-wrap break-all mt-2">{request.details}</pre>
      </details>}
      {request.questions.map(q => {
        const key = `${request.id}:${q.id}`;
        return <label key={q.id} className="block space-y-2 text-sm">
          <span>{q.question}</span>
          {q.options?.length ? <select aria-label={q.question} value={drafts[key] ?? ""}
            className="block w-full rounded-md border border-border bg-background p-2"
            onChange={event => setDrafts(current => ({ ...current, [key]: event.target.value }))}>
            <option value="">Choose an answer</option>
            {q.options.map(option => <option key={option.label} value={option.label}>{option.label}{option.description ? ` — ${option.description}` : ""}</option>)}
          </select> : null}
          {(!q.options?.length || q.isOther) && <Input aria-label={`${q.question} answer`}
            type={q.isSecret ? "password" : "text"} value={drafts[key] ?? ""}
            onChange={event => setDrafts(current => ({ ...current, [key]: event.target.value }))} />}
        </label>;
      })}
      <div className="flex flex-wrap gap-2">
        {request.kind === "questions" ? <Button disabled={busy !== null} onClick={() => void submit(request)}>Submit answers</Button>
          : request.decisions.map(decision => <Button key={decision} disabled={busy !== null}
            variant={decision === "accept" ? "default" : "outline"} onClick={() => void submit(request, decision)}>
            {decision === "accept" ? "Approve once" : decision === "decline" ? "Deny" : "Cancel"}
          </Button>)}
      </div>
    </div>)}
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
  </section>;
}
