import type { ThreadConversationState } from "@farfield/protocol";

type ThreadTurn = ThreadConversationState["turns"][number];

export function getConversationStateUpdatedAt(
  state: ThreadConversationState | null | undefined
): number {
  return typeof state?.updatedAt === "number" ? state.updatedAt : Number.NEGATIVE_INFINITY;
}

function getTurnKey(turn: ThreadTurn): string | null {
  const value = turn.turnId ?? turn.id;
  return typeof value === "string" && value.length > 0 ? value : null;
}

function preferLiveTurn(liveTurn: ThreadTurn, durableTurn: ThreadTurn): ThreadTurn {
  if (liveTurn.status === "inProgress") {
    return liveTurn;
  }
  return liveTurn.items.length >= durableTurn.items.length ? liveTurn : durableTurn;
}

export function mergeConversationStates(
  liveState: ThreadConversationState | null | undefined,
  durableState: ThreadConversationState | null | undefined
): ThreadConversationState | null {
  if (!liveState) return durableState ?? null;
  if (!durableState) return liveState;

  const liveTurnsByKey = new Map<string, ThreadTurn>();
  for (const turn of liveState.turns) {
    const key = getTurnKey(turn);
    if (key) {
      liveTurnsByKey.set(key, turn);
    }
  }

  const consumedLiveKeys = new Set<string>();
  const turns = durableState.turns.map((durableTurn) => {
    const key = getTurnKey(durableTurn);
    if (!key) return durableTurn;
    const liveTurn = liveTurnsByKey.get(key);
    if (!liveTurn) return durableTurn;
    consumedLiveKeys.add(key);
    return preferLiveTurn(liveTurn, durableTurn);
  });

  for (const liveTurn of liveState.turns) {
    const key = getTurnKey(liveTurn);
    if (!key || !consumedLiveKeys.has(key)) {
      turns.push(liveTurn);
      if (key) consumedLiveKeys.add(key);
    }
  }

  const newerState =
    getConversationStateUpdatedAt(liveState) > getConversationStateUpdatedAt(durableState)
      ? liveState
      : durableState;
  const { turnHistory: _unusedTurnHistory, ...stateWithoutCanonicalHistory } = newerState;
  return {
    ...stateWithoutCanonicalHistory,
    turns
  };
}
