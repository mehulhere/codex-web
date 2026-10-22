export type ComposerCommand = "status" | "compact" | "side";

export interface SlashCommandOption {
  command: ComposerCommand;
  description: string;
  disabled: boolean;
}

interface SlashCommandMenuProps {
  options: SlashCommandOption[];
  selectedIndex: number;
  onSelect: (command: ComposerCommand) => void;
}

export function SlashCommandMenu({
  options,
  selectedIndex,
  onSelect
}: SlashCommandMenuProps): React.JSX.Element {
  return (
    <div
      role="listbox"
      aria-label="Chat commands"
      className="absolute bottom-[calc(100%+0.5rem)] left-0 z-40 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-border bg-popover p-1.5 text-popover-foreground shadow-xl"
    >
      {options.map((option, index) => (
        <button
          key={option.command}
          type="button"
          role="option"
          aria-selected={selectedIndex === index}
          aria-disabled={option.disabled}
          disabled={option.disabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onSelect(option.command)}
          className={`flex w-full items-start gap-3 rounded-xl px-3 py-2 text-left transition-colors ${
            selectedIndex === index ? "bg-muted text-foreground" : "text-muted-foreground"
          } disabled:cursor-not-allowed disabled:opacity-45`}
        >
          <span className="min-w-16 font-mono text-sm text-foreground">/{option.command}</span>
          <span className="pt-0.5 text-xs leading-4">{option.description}</span>
        </button>
      ))}
    </div>
  );
}
