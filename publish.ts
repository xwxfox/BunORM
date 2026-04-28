import { $ } from "bun";
import { readFile, writeFile } from "fs/promises";

const pkg = JSON.parse(await readFile("package.json", "utf-8"));
const localVersion: string = pkg.version;

// Get latest version from npm
let npmVersion: string;
try {
    const result = await $`npm view ${pkg.name} version`.text();
    npmVersion = result.trim();
} catch {
    npmVersion = "0.0.0";
}

console.log(`Local version: ${localVersion}`);
console.log(`NPM version:   ${npmVersion}`);

if (localVersion === npmVersion) {
    const [major, minor, patch] = localVersion.split(".").map(Number);
    const newVersion = `${major}.${(minor || 0) + 1}.0`;
    pkg.version = newVersion;
    await writeFile("package.json", JSON.stringify(pkg, null, 2) + "\n");
    console.log(`\nBumped version to ${newVersion}`);
} else {
    console.log("\nVersion already differs from npm, no bump needed");
}

// Build docs
console.log("\nBuilding docs...");
const docsBuild = await $`bun run docs build`.nothrow();
if (docsBuild.exitCode !== 0) {
    console.error("Docs build failed!");
    process.exit(1);
}

// Build project
console.log("Building project...");
const projBuild = await $`bun run build`.nothrow();
if (projBuild.exitCode !== 0) {
    console.error("Project build failed!");
    process.exit(1);
}

const version = pkg.version;

// Publish to npm
console.log("\nPublishing to npm...");
const publish = await $`bun pm publish --access public`.nothrow();
if (publish.exitCode !== 0) {
    console.error("npm publish failed!");
    process.exit(1);
}

console.log(`\nPublished foxdb@${version} to npm`);