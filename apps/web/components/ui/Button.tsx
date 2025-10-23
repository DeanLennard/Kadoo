// apps/web/components/ui/Button.tsx
"use client";
import clsx from "clsx";
import { ButtonHTMLAttributes } from "react";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: "primary" | "ghost";
};

export default function Button({ className, variant = "primary", ...props }: Props) {
    return (
        <button
            className={clsx("k-btn", variant === "primary" ? "k-btn-primary" : "k-btn-ghost", className)}
            {...props}
            onFocus={(e) => e.currentTarget.classList.add("k-focus")}
            onBlur={(e) => e.currentTarget.classList.remove("k-focus")}
        />
    );
}
