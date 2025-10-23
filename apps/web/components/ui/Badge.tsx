// apps/web/components/ui/Badge.tsx
import clsx from "clsx";

export default function Badge({ children, tone = "mint", className }: { children: React.ReactNode; tone?: "mint"|"warm"; className?: string; }) {
    return (
        <span className={clsx("k-badge", tone === "warm" ? "k-badge-warm" : "k-badge-mint", className)}>
      {children}
    </span>
    );
}
