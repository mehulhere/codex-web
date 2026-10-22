import { useEffect, useState } from "react";

interface WorkingSummaryProps {
  status: string;
  startedAtMs: number | null | undefined;
  endedAtMs?: number | null;
  now?: number;
}

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) {
    return `${seconds}s`;
  }
  return `${minutes}m ${seconds}s`;
}

function isActiveStatus(status: string): boolean {
  return status === "in-progress" || status === "inProgress";
}

export function WorkingSummary({
  status,
  startedAtMs,
  endedAtMs,
  now
}: WorkingSummaryProps): React.JSX.Element | null {
  const [clock, setClock] = useState(() => now ?? Date.now());
  const isActive = isActiveStatus(status);

  useEffect(() => {
    if (now !== undefined || !isActive) {
      return;
    }
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [isActive, now]);

  if (startedAtMs === null || startedAtMs === undefined) {
    return null;
  }

  const currentTime = isActive ? (now ?? clock) : endedAtMs;
  if (currentTime === null || currentTime === undefined) {
    return null;
  }
  const durationLabel = `${isActive ? "Working" : "Worked"} for ${formatDuration(currentTime - startedAtMs)}`;
  return (
    <div className="working-summary">
      <span>{durationLabel}</span>
    </div>
  );
}
