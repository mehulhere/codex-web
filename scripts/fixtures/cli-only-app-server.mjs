// Synthetic app-server used by the real HTTP/browser integration test. No model or account access.
import readline from "node:readline";
const send = value => process.stdout.write(JSON.stringify(value) + "\n");
const notify = (method, params) => send({ method, params });
let sequence = 0;
const threads = new Map();
const requests = new Map();
function create(id, cwd = "/workspace/example") {
  const thread = { id, preview: "CLI example chat", createdAt: 1, updatedAt: 1,
    cwd, model: "model-test", modelProvider: "openai", reasoningEffort: "high", status: { type: "idle" },
    turns: [{ id: "seed", status: "completed", items: [{ type: "agentMessage", id: "seed-reply", text: "Synthetic history", phase: "final_answer" }] }] };
  threads.set(id, thread); return thread;
}
create("thread-cli");
function metadata(thread) { return { thread: { ...thread, turns: undefined }, cwd: thread.cwd, model: thread.model,
  modelProvider: "openai", reasoningEffort: "high", approvalPolicy: "on-request", sandbox: { type: "workspaceWrite", writableRoots: [], networkAccess: false, excludeTmpdirEnvVar: false, excludeSlashTmp: false } }; }
function finish(thread, turn, text) {
  if (turn.status !== "inProgress") return;
  turn.items.push({ type: "agentMessage", id: `reply-${turn.id}`, text, phase: "final_answer" });
  turn.status = "completed"; thread.status = { type: "idle" }; thread.updatedAt++;
  notify("turn/completed", { threadId: thread.id, turn });
}
readline.createInterface({ input: process.stdin }).on("line", line => {
  const message = JSON.parse(line);
  if (!message.method) {
    const pending = requests.get(message.id);
    if (pending) { requests.delete(message.id); finish(pending.thread, pending.turn, message.error ? "Request rejected" : JSON.stringify(message.result)); }
    return;
  }
  const p = message.params ?? {};
  const thread = threads.get(p.threadId) ?? threads.get("thread-cli");
  let result;
  switch (message.method) {
    case "initialize": result = { userAgent: "synthetic-test" }; break;
    case "thread/list": result = { data: [...threads.values()].map(t => metadata(t).thread), nextCursor: null }; break;
    case "thread/read": result = { thread }; break;
    case "thread/start": result = metadata(create(`thread-${++sequence}`, p.cwd)); break;
    case "thread/resume": result = metadata(thread); break;
    case "thread/settings/update": thread.model = p.model ?? thread.model; result = {}; break;
    case "thread/queue/list": result = { data: [], nextCursor: null }; break;
    case "model/list": result = { data: [{ id: "model-test", model: "model-test", displayName: "Test model", description: "Synthetic", upgrade: null,
      supportedReasoningEfforts: [{ reasoningEffort: "high", description: "High" }], defaultReasoningEffort: "high", inputModalities: ["text", "image"], supportsPersonality: false, isDefault: true }], nextCursor: null }; break;
    case "collaborationMode/list": result = { data: [{ name: "Default", mode: "default", model: "model-test", reasoning_effort: "high", developer_instructions: null }] }; break;
    case "turn/start": {
      const text = p.input.find(part => part.type === "text")?.text ?? "";
      const turn = { id: `turn-${++sequence}`, status: "inProgress", items: [] };
      thread.turns.push(turn); thread.status = { type: "active", activeFlags: [] }; thread.updatedAt++;
      result = { turn };
      setTimeout(() => {
        notify("turn/started", { threadId: thread.id, turn });
        if (text === "approval" || text === "questions" || text === "file-approval") {
          const id = `request-${++sequence}`;
          const method = text === "questions" ? "item/tool/requestUserInput"
            : text === "file-approval" ? "item/fileChange/requestApproval" : "item/commandExecution/requestApproval";
          const params = { threadId: thread.id, turnId: turn.id, itemId: `item-${sequence}`,
            ...(text === "questions" ? { isBlocking: true, questions: [{ id: "choice", header: "Choice", question: "Which color?", options: [{ label: "Blue", description: "Use blue" }], isOther: true }] }
              : { startedAtMs: 1, reason: "Synthetic approval", ...(text === "approval" ? { command: "node --version", cwd: thread.cwd, availableDecisions: ["accept", "decline"] } : {}) }) };
          requests.set(id, { thread, turn }); send({ id, method, params });
        } else if (text !== "hold") finish(thread, turn, `Reply: ${text}`);
      }, 50);
      break;
    }
    case "turn/steer": result = { turnId: p.expectedTurnId }; finish(thread, thread.turns.at(-1), `Steered: ${p.input[0].text}`); break;
    case "turn/interrupt": {
      const turn = thread.turns.at(-1); turn.status = "interrupted"; thread.status = { type: "idle" };
      notify("turn/completed", { threadId: thread.id, turn }); result = {}; break;
    }
    case "thread/compact/start": result = {}; break;
    default: send({ id: message.id, error: { code: -32601, message: `Unexpected method ${message.method}` } }); return;
  }
  send({ id: message.id, result });
});
