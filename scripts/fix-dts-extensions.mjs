/**
 * tsc rewriteRelativeImportExtensions rewrites .js emit but leaves .d.ts
 * importing `.ts`. Consumers resolving types via package exports need `.js`.
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");

async function walk(dir) {
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      await walk(full);
      continue;
    }
    if (!ent.name.endsWith(".d.ts")) continue;
    const src = await readFile(full, "utf8");
    const out = src.replaceAll(/from\s+("[^"]+)\.ts"/g, "from $1.js\"").replaceAll(
      /from\s+('[^']+)\.ts'/g,
      "from $1.js'",
    );
    if (out !== src) await writeFile(full, out);
  }
}

await walk(dist);
