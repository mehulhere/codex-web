import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from "@/components/ui/select";

const STANDARD_REASONING_EFFORTS = ["low", "medium", "high", "xhigh"] as const;

interface ReasoningEffortSelectProps {
    value: string | null | undefined;
    options: Iterable<string | null | undefined>;
    onValueChange: (value: string) => void;
    id?: string;
    disabled?: boolean;
    triggerClassName?: string;
}

export function normalizeReasoningEffort(value: string | null | undefined): string {
    const normalized = value?.trim() ?? "";
    const hiddenValue = normalized.toLowerCase();
    if (
        hiddenValue === "" ||
        hiddenValue === "minimal" ||
        hiddenValue === "app default" ||
        hiddenValue === "__app_default__"
    ) {
        return "low";
    }
    return normalized;
}

export function reasoningEffortOptions(
    values: Iterable<string | null | undefined>
): string[] {
    const options = new Set<string>(STANDARD_REASONING_EFFORTS);
    for (const value of values) {
        options.add(normalizeReasoningEffort(value));
    }
    return Array.from(options);
}

export function ReasoningEffortSelect({
    value,
    options,
    onValueChange,
    id,
    disabled = false,
    triggerClassName
}: ReasoningEffortSelectProps): React.JSX.Element {
    const selectedValue = normalizeReasoningEffort(value);
    const visibleOptions = reasoningEffortOptions([...options, selectedValue]);

    return (
        <Select
            value={selectedValue}
            onValueChange={onValueChange}
            disabled={disabled}
        >
            <SelectTrigger id={id} className={triggerClassName}>
                <SelectValue placeholder="low" />
            </SelectTrigger>
            <SelectContent position="popper">
                {visibleOptions.map((option) => (
                    <SelectItem key={option} value={option}>
                        {option}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}
