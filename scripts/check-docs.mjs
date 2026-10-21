#!/usr/bin/env node
// Fails when docs drift from the code: every variable of the env schema must appear in
// docs/configuration.md and in .env.example, and every relative Markdown link must resolve.
// Needs `npm run build` first (it reads the built config package).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";

const root = new URL("..", import.meta.url).pathname;
const require = createRequire(import.meta.url);
const { envSchema } = require(join(root, "packages/config/dist/index.js"));

let failures = 0;
const fail = (message) => {
  failures += 1;
  console.error(`check-docs: ${message}`);
};

const configurationDoc = readFileSync(join(root, "docs/configuration.md"), "utf8");
const envExample = readFileSync(join(root, ".env.example"), "utf8");
for (const key of Object.keys(envSchema.shape)) {
  if (!configurationDoc.includes(`\`${key}\``))
    fail(`${key} is not documented in docs/configuration.md`);
  if (!new RegExp(`^#?\\s*${key}=`, "m").test(envExample))
    fail(`${key} is missing from .env.example`);
}

function markdownFiles(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (["node_modules", "dist", "coverage", ".git", "output", "data"].includes(entry)) return [];
    if (statSync(path).isDirectory()) return markdownFiles(path);
    return path.endsWith(".md") ? [path] : [];
  });
}

const linkPattern = /\[[^\]]*\]\(([^)\s]+)\)/g;
const files = [join(root, "README.md"), ...markdownFiles(join(root, "docs"))];
for (const file of files) {
  const text = readFileSync(file, "utf8").replace(/```[\s\S]*?```/g, "");
  for (const [, target] of text.matchAll(linkPattern)) {
    if (/^(https?:|mailto:|#)/.test(target)) continue;
    const path = resolve(dirname(file), target.split("#")[0]);
    if (!existsSync(path)) fail(`${file.replace(root, "")}: broken link ${target}`);
  }
}

if (failures > 0) process.exit(1);
console.log(
  `check-docs: ${Object.keys(envSchema.shape).length} variables and ${files.length} files OK`
);
