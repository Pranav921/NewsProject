import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// KN-UI-005: Tailwind v4 puts utilities in a cascade layer. Any UNLAYERED rule in
// globals.css that sets typography on form controls beats every layered utility,
// silently ignoring text-*, font-* and leading-* classes. Preflight already applies
// `font: inherit` to these elements inside @layer base, so no global copy is needed.
function topLevelRules(css) {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = []; let depth = 0; let start = 0; let layered = 0; const stack = [];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === "{") {
      const prelude = source.slice(start, i).trim();
      const isLayer = /^@layer\b/.test(prelude);
      stack.push({ prelude, isLayer, body: i + 1 });
      if (isLayer) layered++;
      depth++; start = i + 1;
    } else if (source[i] === "}") {
      const block = stack.pop(); depth--;
      if (block.isLayer) layered--;
      else if (!block.prelude.startsWith("@") && layered === 0 && stack.every((b) => !b.isLayer)) {
        rules.push({ selector: block.prelude, body: source.slice(block.body, i), nestedInAtRule: stack.length > 0 });
      }
      start = i + 1;
    } else if (source[i] === ";" && depth === 0) start = i + 1;
  }
  return rules;
}

test("globals.css has no unlayered typography rule on form controls (KN-UI-005)", () => {
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  const rules = topLevelRules(css);
  assert.ok(rules.some((rule) => rule.selector === "body"), "parser sanity: sees unlayered rules");
  const offenders = rules.filter((rule) => /(^|,)\s*(button|input|select|textarea|optgroup)\b/.test(rule.selector)
    && /(^|;|\s)(font(-size|-weight|-family|-style)?|line-height)\s*:/.test(rule.body));
  assert.deepEqual(offenders.map((rule) => rule.selector), []);
});

test("the KN-UI-005 parser rejects the original defect and accepts the same rule inside @layer base", () => {
  const defect = "body { color: red; }\nbutton,\ninput,\nselect,\ntextarea {\n  font: inherit;\n}";
  const flagged = topLevelRules(defect).filter((rule) => /button/.test(rule.selector) && /font\s*:/.test(rule.body));
  assert.equal(flagged.length, 1);
  assert.equal(topLevelRules("@layer base { button, input { font: inherit; } }").length, 0);
  assert.equal(topLevelRules("button:not(:disabled) { cursor: pointer; }")[0].body.includes("font"), false, "cursor-only rules stay allowed");
});
