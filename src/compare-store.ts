import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { defaultComparesDir } from "./paths.ts";
import type { CompareRecord } from "./compare.ts";

export function comparesDir(): string {
  return process.env.OLLANET_COMPARES_DIR ?? defaultComparesDir();
}

export function newCompareId(): string {
  return randomBytes(6).toString("hex");
}

function tokLabel(n: number | undefined): string {
  return n == null || !Number.isFinite(n) ? "—" : n.toFixed(1);
}

export function renderCompareMarkdown(record: CompareRecord): string {
  const lines: string[] = [
    `# Compare ${record.id}`,
    "",
    `- **host:** ${record.machine} (${record.endpoint})`,
    `- **when:** ${record.created_at}`,
    `- **models:** ${record.results.map((r) => r.model).join(", ")}`,
    "",
    "## Prompt",
    "",
    record.prompt.trimEnd(),
    "",
  ];
  if (record.system) {
    lines.push("## System", "", record.system.trimEnd(), "");
  }
  for (const r of record.results) {
    lines.push(`## ${r.model}`, "");
    if (r.error) {
      lines.push(`- **error:** ${r.error}`, "");
      continue;
    }
    lines.push(
      `- **tok/s:** ${tokLabel(r.tok_s)}`,
      `- **tokens:** ${r.eval_count ?? "—"}`,
      `- **wall:** ${r.wall_ms != null ? `${(r.wall_ms / 1000).toFixed(2)}s` : "—"}`,
      `- **done:** ${r.done_reason ?? "—"}`,
      "",
    );
    if (r.thinking) {
      lines.push("### Thinking", "", r.thinking.trimEnd(), "");
    }
    lines.push(r.content?.trimEnd() || "_(empty reply)_", "");
  }
  return `${lines.join("\n")}\n`;
}

export async function saveCompare(record: CompareRecord): Promise<{ json: string; md: string }> {
  const dir = comparesDir();
  await mkdir(dir, { recursive: true });
  const json = path.join(dir, `${record.id}.json`);
  const md = path.join(dir, `${record.id}.md`);
  await writeFile(json, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  await writeFile(md, renderCompareMarkdown(record), "utf8");
  return { json, md };
}
