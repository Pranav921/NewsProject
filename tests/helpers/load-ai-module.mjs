import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";

// As with newsletter route fixtures, run the actual TS module with explicit mocks.
export function loadAiModule(relativePath, imports = {}, extraGlobals = {}) {
  const url = new URL(relativePath, import.meta.url);
  const exports = {};
  const nativeRequire = createRequire(url);
  const code = ts.transpileModule(readFileSync(url, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(code, {
    exports,
    require(name) {
      if (name === "server-only") return {};
      if (name.startsWith("node:")) return nativeRequire(name);
      assert.ok(Object.hasOwn(imports, name), `Unexpected dependency ${name}`);
      return imports[name];
    },
    Error, Date, JSON, URL, Request, Response, TextEncoder, TextDecoder, Uint8Array, AbortSignal,
    process: { env: {} }, ...extraGlobals,
  });
  return exports;
}
