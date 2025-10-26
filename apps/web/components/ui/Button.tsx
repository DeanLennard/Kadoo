// apps/web/components/ui/Button.tsx
"use client";
import clsx from "clsx";
import { ButtonHTMLAttributes } from "react";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
    size?: "sm" | "md" | "lg";
    variant?: "primary" | "ghost";
};

export default function Button({ className, size = "md", variant = "primary", ...props }: Props) {

    const sizeCls =
        size === "sm" ? "px-2 py-1 text-xs" :
            size === "lg" ? "px-4 py-3 text-base" :
                "px-3 py-2 text-sm";

    return (
        <button
            className={clsx("k-btn", variant === "primary" ? "k-btn-primary" : "k-btn-ghost", className)}
            {...props}
            onFocus={(e) => e.currentTarget.classList.add("k-focus")}
            onBlur={(e) => e.currentTarget.classList.remove("k-focus")}
        />
    );
}
