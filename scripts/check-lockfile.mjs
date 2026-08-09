import { readFile, readdir } from "node:fs/promises";
import { join, posix } from "node:path";

const root = process.cwd();
const lines = (await readFile(join(root, "pnpm-lock.yaml"), "utf8")).split(
  /\r?\n/,
);
const importers = {};
let inImporters = false;
let workspace = null;
let section = null;
let dependency = null;

const unquote = (value) => value.replace(/^['"]|['"]$/g, "");

for (const line of lines) {
  if (line === "importers:") {
    inImporters = true;
    continue;
  }
  if (!inImporters) continue;
  if (line === "packages:") break;

  let match = /^  ([^ ].*):$/.exec(line);
  if (match?.[1]) {
    workspace = unquote(match[1]);
    importers[workspace] = {};
    section = null;
    dependency = null;
    continue;
  }
  match =
    /^    (dependencies|devDependencies|optionalDependencies):$/.exec(
      line,
    );
  if (match?.[1] && workspace) {
    section = match[1];
    importers[workspace][section] = {};
    dependency = null;
    continue;
  }
  match = /^      (.+):$/.exec(line);
  if (match?.[1] && section) {
    dependency = unquote(match[1]);
    continue;
  }
  match = /^        specifier: (.+)$/.exec(line);
  if (match?.[1] && workspace && section && dependency) {
    importers[workspace][section][dependency] = unquote(match[1]);
  }
}

const workspaces = ["."];
for (const parent of ["apps", "packages"]) {
  for (const name of await readdir(join(root, parent))) {
    try {
      await readFile(join(root, parent, name, "package.json"), "utf8");
      workspaces.push(posix.join(parent, name));
    } catch {
      // Not a package workspace.
    }
  }
}

const issues = [];
for (const name of workspaces) {
  const manifest = JSON.parse(
    await readFile(join(root, name, "package.json"), "utf8"),
  );
  const importer = importers[name];
  if (!importer) {
    issues.push(`${name}: missing lockfile importer`);
    continue;
  }
  for (const dependencySection of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
  ]) {
    const expected = manifest[dependencySection] ?? {};
    const actual = importer[dependencySection] ?? {};
    for (const [packageName, specifier] of Object.entries(expected)) {
      if (actual[packageName] !== specifier) {
        issues.push(
          `${name}: ${dependencySection}.${packageName} expected ${specifier}, found ${actual[packageName] ?? "missing"}`,
        );
      }
    }
    for (const packageName of Object.keys(actual)) {
      if (!(packageName in expected)) {
        issues.push(
          `${name}: stale ${dependencySection}.${packageName} lockfile entry`,
        );
      }
    }
  }
}

if (issues.length > 0) {
  console.error(issues.join("\n"));
  process.exitCode = 1;
} else {
  console.log("All workspace package specifiers match pnpm-lock.yaml.");
}
