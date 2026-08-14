/**
 * Heuristic for Finetuna-style named variants (and similar host-side tunes).
 * Scan uses the name only — no extra /api/show per model.
 */

const CTX = /-ctx\d+k(\b|-|$)/i;
const FLASH = /-flash(\b|-|$)/i;

export function looksTuned(
  name: string,
  extra?: { modelfile?: string; parameters?: string },
): boolean {
  const n = (name ?? "").trim();
  if (!n) return false;
  if (n.toLowerCase().includes("finetuna")) return true;
  if (CTX.test(n) || FLASH.test(n)) return true;
  const blob = `${extra?.modelfile ?? ""}\n${extra?.parameters ?? ""}`.toLowerCase();
  return blob.includes("finetuna");
}
