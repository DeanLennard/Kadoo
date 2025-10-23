// apps/web/components/ui/Card.tsx
import { ReactNode } from "react";
import clsx from "clsx";

export default function Card({ className, children }: { className?: string; children: ReactNode }) {
    return <section className={clsx("k-card p-5", className)}>{children}</section>;
}
