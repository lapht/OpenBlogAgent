#!/usr/bin/env node
// Fails when a workspace imports a package that its own package.json does not declare.
import { builtinModules } from "node:module";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const workspaceRoots = ["apps", "packages"];
const importPattern =
  /(?:\bfrom\s+|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)["']([^"']+)["']/gm;

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (entry === "node_modules" || entry === "dist") return [];
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function packageName(specifier) {
  if (specifier.startsWith(".") || specifier.startsWith("/")) return null;
  const bare = specifier.replace(/^node:/, "");
  if (builtinModules.includes(bare.split("/")[0]) || builtinModules.includes(bare)) return null;
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

let failures = 0;

for (const group of workspaceRoots) {
  for (const name of readdirSync(join(root, group))) {
    const dir = join(root, group, name);
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    } catch {
      continue;
    }
    const declared = new Set([
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.devDependencies ?? {}),
      ...Object.keys(manifest.peerDependencies ?? {})
    ]);
    const missing = new Map();

    let files = [];
    try {
      files = walk(join(dir, "src")).filter((f) => /\.(ts|tsx|js|mjs|cjs)$/.test(f));
    } catch {
      continue;
    }

    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(importPattern)) {
        const dep = packageName(match[1]);
        if (dep && dep !== manifest.name && !declared.has(dep)) {
          missing.set(dep, file.replace(root, ""));
        }
      }
    }

    for (const [dep, file] of missing) {
      console.error(`${manifest.name}: imports "${dep}" without declaring it (e.g. ${file})`);
      failures++;
    }
  }
}

if (failures > 0) {
  console.error(`\n${failures} undeclared dependenc${failures === 1 ? "y" : "ies"} found.`);
  process.exit(1);
}
console.log("All imported dependencies are declared.");
