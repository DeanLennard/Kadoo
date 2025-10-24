// apps/worker/src/policy/thresholds.ts
export const checkThreshold = (confidence: number | undefined | null, min: number): boolean =>
    typeof confidence === "number" ? confidence >= min : true;
