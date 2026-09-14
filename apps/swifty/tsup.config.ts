/**
 * Copyright (c) 2026 hangtiancheng
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

import { readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "tsup";
import type { Options } from "tsup";

// tsup does not re-export the esbuild Plugin type used by `esbuildPlugins`;
// recover it from the Options type so standalone plugin consts stay typed.
type EsbuildPlugin = NonNullable<Options["esbuildPlugins"]>[number];

const __dirname = dirname(fileURLToPath(import.meta.url));

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf-8")) as {
  version: string;
  dependencies?: Record<string, string>;
};

// CLI build bundles everything (noExternal), so CJS deps (e.g. signal-exit)
// use bare require("assert") which esbuild can't shim in ESM output —
// externalize all Node.js built-ins instead.
const externalizeNodeBuiltinsPlugin: EsbuildPlugin = {
  name: "externalize-node-builtins",
  setup(build) {
    const re = new RegExp(`^(${builtinModules.join("|")})(/.*)?$`);
    build.onResolve({ filter: re }, (args) => ({
      path: args.path,
      external: true,
    }));
    build.onResolve({ filter: /^react-devtools-core$/ }, () => ({
      path: "react-devtools-core",
      external: true,
    }));
    // sharp is a native module (prebuilt binaries) — esbuild cannot
    // bundle it, so keep it external and resolved from node_modules.
    build.onResolve({ filter: /^sharp$/ }, () => ({
      path: "sharp",
      external: true,
    }));
  },
};

const tuiDirs = [join(__dirname, "src", "tui") + sep];

// Library-build guard: the barrel entry (src/index.ts) must never reach the
// ink/react TUI layer, neither via bare specifiers nor via a path resolving
// into either TUI implementation. Failing the build is the point.
const banTuiAndInkPlugin: EsbuildPlugin = {
  name: "ban-tui-and-ink",
  setup(build) {
    const ban = (importer: string, path: string): never => {
      throw new Error(
        `[library-build] TUI dependency "${path}" (imported by ${importer || "entry"}) must not be reachable from src/index.ts`,
      );
    };
    build.onResolve({ filter: /^(ink|react|@\/tui)/ }, (args) => ban(args.importer, args.path));
    build.onResolve({ filter: /^\.\.?\// }, (args) => {
      const resolved = resolve(dirname(args.importer), args.path);
      if (tuiDirs.some((directory) => resolved.startsWith(directory))) {
        ban(args.importer, args.path);
      }
      return undefined;
    });
  },
};

// CLI entry: fully bundled, minified single-graph output with a shebang so the
// `swifty` bin is self-contained.
const cliConfig: Options = {
  entry: ["src/main.tsx"],
  format: ["esm"],
  env: {
    NODE_ENV: "production",
  },
  platform: "node",
  target: "node20",
  outDir: "dist",
  clean: true,
  minify: true,
  banner: {
    js: [
      "#!/usr/bin/env node",
      // Provide a real `require` for bundled CJS modules (e.g. signal-exit)
      // that call require("assert") etc. esbuild's CJS-to-ESM shim checks
      // `typeof require !== "undefined"` and will use this instead of throwing.
      'import { createRequire as __swiftyCreateRequire } from "node:module";',
      "const require = __swiftyCreateRequire(import.meta.url);",
    ].join("\n"),
  },
  noExternal: [/.*/],
  define: { __SWIFTY_VERSION__: JSON.stringify(pkg.version) },
  tsconfig: "tsconfig.json",
  esbuildPlugins: [externalizeNodeBuiltinsPlugin],
};

// Library entry: keeps dependencies external (consumers resolve them from
// their own node_modules), emits bundled d.ts, and must never reach src/tui.
// outDir is nested under dist/ (cleaned by the CLI build that runs first) so
// the two builds' chunk graphs never overwrite each other.
const libConfig: Options = {
  entry: ["src/index.ts"],
  format: ["esm"],
  platform: "node",
  target: "node20",
  env: {
    NODE_ENV: "production",
  },
  outDir: "dist/lib",
  clean: true,
  minify: false,
  splitting: true,
  dts: true,
  tsconfig: "tsconfig.build.json",
  define: { __SWIFTY_VERSION__: JSON.stringify(pkg.version) },
  // TUI-only deps (ink, ink-spinner, ink-text-input, react, react-dom) are
  // deliberately NOT external: if the library graph ever reaches them, the
  // ban-tui-and-ink plugin fails the build instead of silently externalizing.
  external: [...Object.keys(pkg.dependencies ?? {})].filter((dep) => !/^(ink|react)/.test(dep)),
  esbuildPlugins: [externalizeNodeBuiltinsPlugin, banTuiAndInkPlugin],
};

export default defineConfig([cliConfig, libConfig]);
