import { readFileSync } from "node:fs";
import { stripVTControlCharacters } from "node:util";

import { renderToString } from "ink";
import { createElement } from "react";
import chalk from "chalk";

import { ToolBlock } from "@/tui/tool-display.js";
import { setThemeMode } from "@/ui/styles.js";

chalk.level = 0;
setThemeMode("light");

const file =
  "/Users/hangtiancheng/github/swifty-code/node_modules/.pnpm/ink@7.1.1_@types+react@19.2.18_react@19.2.7/node_modules/ink/build/wrap-text.js";
const raw = readFileSync(file, "utf8").split("\n");
const output = raw
  .slice(0, 9)
  .map((line, i) => `${String(i + 1)}\t${line}`)
  .join("\n");

function setColumns(n: number): void {
  Object.defineProperty(process.stdout, "columns", {
    value: n,
    configurable: true,
    writable: true,
  });
}

for (const columns of [80, 100, 120, 140]) {
  setColumns(columns);
  const frame = renderToString(
    createElement(ToolBlock, {
      tool: {
        toolId: "r",
        toolName: "ReadFile",
        args: { file_path: file },
        output,
        isError: false,
        elapsed: 0.0,
      },
      expanded: true,
    } as never),
    { columns },
  );
  const rows = frame.split("\n").map(stripVTControlCharacters);
  console.log(`\n=== term=${String(columns)} (content=${String(columns - 2)}) ===`);
  rows.forEach((row, i) => {
    let col = 0;
    for (const ch of row) col += ch === "\t" ? 8 - (col % 8) : 1;
    const origin = row.replace(/^ /, "");
    console.log(
      `row#${String(i).padStart(2)} inkWidth=${String(row.length).padStart(3)} termCols=${String(col).padStart(3)} overflow=${col > columns ? "YES " + String(col - columns) : "no"}  ${JSON.stringify(origin.slice(0, 40))}`,
    );
  });
}
