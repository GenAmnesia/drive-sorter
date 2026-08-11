import { rmSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptsDirectory, "..");
const sourceRoot = resolve(projectRoot, "src");
const buildRoot = resolve(sourceRoot, "build");

if (basename(buildRoot) !== "build" || dirname(buildRoot) !== sourceRoot) {
  throw new Error("Refusing to clean an unexpected build path.");
}

rmSync(buildRoot, { recursive: true, force: true });
