// Concatenate every src/**/*.css into dist/styles.css so consumers can
// `import "@lalss/bug-report-fab/styles.css"` once and pick up every
// component CSS in deterministic source order.
//
// Mirrors the sections-kit pattern (general/reference_sections_kit.md).
import { readdirSync, readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = "src";
const OUT = "dist/styles.css";

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else if (entry.endsWith(".css")) out.push(full);
  }
  return out;
}

const files = walk(SRC).sort();
mkdirSync("dist", { recursive: true });
const merged = files.map((f) => `/* ${f} */\n${readFileSync(f, "utf8")}\n`).join("\n");
writeFileSync(OUT, merged, "utf8");
console.log(`[bug-report-fab] wrote ${OUT} (${files.length} sources)`);
