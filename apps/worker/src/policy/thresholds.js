// apps/worker/src/policy/thresholds.ts
export const checkThreshold = (confidence, min) => typeof confidence === "number" ? confidence >= min : true;
