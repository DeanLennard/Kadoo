"use client";

import clsx from "clsx";

type ToggleProps = {
    checked: boolean;
    onChange: (next: boolean) => void;
    ariaLabel?: string;
    disabled?: boolean;
    className?: string;
    size?: "sm" | "md";
    useVars?: boolean; // use CSS variables instead of Tailwind colours
};

export default function Toggle({
                                   checked,
                                   onChange,
                                   ariaLabel,
                                   disabled,
                                   className,
                                   size = "md",
                                   useVars = false,
                               }: ToggleProps) {
    const dims =
        size === "sm"
            ? { w: "w-8", h: "h-5", knob: "w-4 h-4", off: "left-0.5", on: "left-3.5", top: "top-0.5" }
            : { w: "w-10", h: "h-6", knob: "w-5 h-5", off: "left-0.5", on: "left-5", top: "top-0.5" };

    const trackOn  = useVars ? "bg-[var(--mint-600)]"  : "bg-emerald-500";
    const trackOff = useVars ? "bg-[var(--cloud-600)]" : "bg-slate-300";

    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            aria-label={ariaLabel}
            disabled={disabled}
            onClick={() => !disabled && onChange(!checked)}
            className={clsx(
                "relative rounded-full transition-colors outline-none focus:ring-2 focus:ring-black/10",
                dims.w, dims.h,
                checked ? trackOn : trackOff,
                disabled && "opacity-50 cursor-not-allowed",
                className
            )}
        >
      <span
          className={clsx(
              "absolute bg-white rounded-full transition-all shadow",
              dims.top, checked ? dims.on : dims.off, dims.knob
          )}
      />
        </button>
    );
}
