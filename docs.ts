import { $ } from "bun";
import { parseArgs } from "util";
import { cp, readdir, stat, readFile, exists } from "fs/promises";
import { join, extname, relative, sep } from "path";

const ACCEPTED_COMMANDS = ["dev", "build", "preview"] as const;
type Command = (typeof ACCEPTED_COMMANDS)[number];

function pArgs(args: string[]) {
    const { values, positionals } = parseArgs({
        args: Bun.argv,
        options: {
            skip: {
                type: "boolean",
            },
        },
        strict: true,
        allowPositionals: true,
    });

    const bunPath = positionals[0] || Bun.which("bun") || "bun";
    const cwd = positionals[1]?.replace(__filename, "") || process.cwd() || ".";
    const actualPositionals: Command[] = [];
    let pos = positionals.slice(2);
    if (pos.length === 0) {
        actualPositionals.push("dev");
    } else if (!ACCEPTED_COMMANDS.includes(pos[0] as Command)) {
        throw new Error(`Unknown command: ${pos[0]}. Expected one of "dev", "build", "preview".`);
    }
    return { values, positionals: actualPositionals.concat(pos.filter(p => ACCEPTED_COMMANDS.includes(p as Command)) as Command[]), bunPath, cwd };
}

if (import.meta.main) {
    const { values, positionals, bunPath, cwd } = pArgs(Bun.argv);
    const since = await getLastEdited("./docs/api");
    const rootFilesChanged = await hasChanges(["logo.svg", "README.md", "typedoc.json", "tsconfig.json"], {
        since,
    });
    const srcFilesChanged = await hasChanges(["src"], {
        since,
        extensions: [".ts"]
    });
    const manualDocsChanged = await hasChanges(["docs"], {
        since,
        exclude: ["docs/guide/readme.md", "docs/api", "docs/.vitepress/cache", "docs/.vitepress/.temp", "docs/.vitepress/dist"],
        extensions: [".md", ".mts", ".css"]
    });

    console.log(`Docs last edited at ${new Date(since).toLocaleString()} - Changes since then:`, (() => {
        let changes = [];
        if (rootFilesChanged) changes.push("root files");
        if (srcFilesChanged) changes.push("src files");
        if (manualDocsChanged) changes.push("manual docs files");
        if (changes.length === 0) return "none";
        return changes.join(", ");
    })());

    const toRebuild = new Map<"vitepress" | "typedoc", boolean>([
        ["vitepress", false],
        ["typedoc", false],
    ]);

    if (srcFilesChanged) {
        toRebuild.set("typedoc", true);
    }

    if (manualDocsChanged) {
        toRebuild.set("vitepress", true);
    }

    if (rootFilesChanged) {
        toRebuild.set("vitepress", true);
        toRebuild.set("typedoc", true);
    }

    if (values.skip === true) {
        console.log("Skipping API docs build due to --skip flag");
        toRebuild.set("typedoc", false);
        toRebuild.set("vitepress", false);
    }

    let ass = await ensureAss();

    if (!ass.manualDocsExist) {
        console.log("Some non-generated docs assets are missing, rebuilding those...");
        toRebuild.set("vitepress", true);

        if (values.skip === true) {
            console.log("--skip flag ignored because assets are missing");
        }
    }

    if (toRebuild.get("vitepress")) {
        console.log("Copying new assets to docs...");
        await cpToDocs();
    }
    if (toRebuild.get("typedoc")) {
        console.log("Rebuilding API docs...");
        await buildApiDocs(bunPath, cwd);
    }

    let exitCode: number = -1;
    switch (positionals[0]) {
        case "dev":
            exitCode = await meow([bunPath, "vitepress", "dev", "docs"])
            break;
        case "build":
            exitCode = await meow([bunPath, "vitepress", "build", "docs"])
            break;
        case "preview":
            if (await exists(join(cwd, "docs/.vitepress/dist"))) {
                const buildTime = await getLastEdited("./docs/.vitepress/dist");
                if (buildTime > since && !toRebuild.get("vitepress") && !toRebuild.get("typedoc")) {
                    console.log("Existing prod build is up to date, skipping rebuild...");
                    exitCode = await meow([bunPath, "vitepress", "preview", "docs"])
                    break;
                } else {
                    console.log("Existing prod build is outdated, rebuilding...");
                    await meow([bunPath, "vitepress", "build", "docs"]);
                    exitCode = await meow([bunPath, "vitepress", "preview", "docs"])
                    break;
                }
            } else {
                console.log("No existing prod build found, building first...");
                await meow([bunPath, "vitepress", "build", "docs"]);
                exitCode = await meow([bunPath, "vitepress", "preview", "docs"])
            }
            exitCode = await meow([bunPath, "vitepress", "preview", "docs"])
            break;

    }
    console.log(`Vitepress exited with code ${exitCode}`);
} else {
    // uh?
}

async function buildApiDocs(bunPath: string, cwd: string) {
    await $`${bunPath} typedoc --options typedoc.json`.cwd(cwd);
}

async function cpToDocs() {
    await cp("README.md", "docs/guide/readme.md", { force: true });
    await cp("logo.svg", "docs/public/logo.svg", { force: true });
    await cp("og-banner.png", "docs/public/og-banner.png", { force: true });
}

async function meow(cmd: string[]) {
    const proc = Bun.spawn({
        cmd,
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
    });

    const signals = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

    const handlers: Partial<Record<typeof signals[number], () => void>> = {};

    for (const sig of signals) {
        const handler = () => {
            // forward signal to child
            proc.kill(sig);
        };

        handlers[sig] = handler;
        process.on(sig, handler);
    }

    const cleanup = () => {
        for (const sig of signals) {
            const handler = handlers[sig];
            if (handler) {
                process.off(sig, handler);
            }
        }
    };

    return proc.exited.finally(cleanup);
}

async function ensureAss() {
    const [logoExists, readmeExists, typeDocExists, ogBannerExists] = await Promise.all([
        exists("docs/public/logo.svg"),
        exists("docs/guide/readme.md"),
        exists("docs/api/index.md"),
        exists("docs/public/og-banner.png"),
    ]);

    let manualDocsExist = true;
    let generatedDocsExist = true;
    if (!logoExists || !readmeExists || !ogBannerExists) {
        manualDocsExist = false;
    }
    if (!typeDocExists) {
        generatedDocsExist = false;
    }

    if (manualDocsExist && generatedDocsExist) {
        return { allOk: true, manualDocsExist, generatedDocsExist };
    } else {
        return { allOk: false, manualDocsExist, generatedDocsExist };
    }
}

type Options = {
    extensions?: string[];
    since: number;
    root?: string;
    exclude?: string[];
};

async function hasChanges(
    input: string | string[],
    options: Options
): Promise<boolean> {
    const {
        extensions,
        since,
        root = process.cwd(),
        exclude,
    } = options;

    const paths = Array.isArray(input) ? input : [input];
    const rules = await loadGitIgnore(root);

    for (const p of paths) {
        if (await walk(p, extensions, since, root, rules, exclude)) {
            return true;
        }
    }

    return false;
}

// gitignore parser
type IgnoreRule = {
    pattern: string;
    negate: boolean;
    dirOnly: boolean;
};

async function loadGitIgnore(root: string): Promise<IgnoreRule[]> {
    try {
        const raw = await readFile(join(root, ".gitignore"), "utf-8");

        return raw
            .split("\n")
            .map((l) => l.trim())
            .filter((l) => l && !l.startsWith("#"))
            .map((line) => {
                const negate = line.startsWith("!");
                if (negate) line = line.slice(1);

                const dirOnly = line.endsWith("/");
                if (dirOnly) line = line.slice(0, -1);

                return {
                    pattern: line,
                    negate,
                    dirOnly,
                };
            });
    } catch {
        return [];
    }
}

// checks n matchers

function isIgnored(relPath: string, isDir: boolean, rules: IgnoreRule[]) {
    let ignored = false;

    for (const rule of rules) {
        if (rule.dirOnly && !isDir) continue;

        if (matchPattern(relPath, rule.pattern)) {
            ignored = !rule.negate;
        }
    }

    return ignored;
}

function isExcluded(
    relPath: string,
    exclude: string[] | undefined,
    isDir: boolean
): boolean {
    if (!exclude || exclude.length === 0) return false;

    const path = relPath.split("\\").join("/");

    for (const ex of exclude) {
        const pattern = ex.split("\\").join("/");

        // directory exclude (fast path)
        if (pattern.endsWith("/")) {
            if (isDir && path.startsWith(pattern.slice(0, -1))) return true;
            if (path.startsWith(pattern)) return true;
        }

        // simple wildcard support
        if (pattern.includes("*")) {
            const regex = new RegExp(
                "^" +
                pattern
                    .split("*")
                    .map((s) => s.replace(/[.+^${}()|[\]\\]/g, "\\$&"))
                    .join(".*") +
                "$"
            );

            if (regex.test(path)) return true;
            continue;
        }

        // exact match or path match
        if (path === pattern || path.endsWith("/" + pattern)) {
            return true;
        }
    }

    return false;
}

// Very small matcher (fast path, not full glob)
function matchPattern(path: string, pattern: string): boolean {
    // Normalize to posix-style
    const p = path.split(sep).join("/");
    const pat = pattern.split(sep).join("/");

    if (pat === "**") return true;

    // prefix match (covers most gitignore use cases like node_modules, dist, etc.)
    if (pat.endsWith("/")) {
        return p.startsWith(pat);
    }

    if (pat.includes("*")) {
        // minimal glob: only support * wildcard
        const regex = new RegExp(
            "^" +
            pat
                .split("*")
                .map(escapeRegex)
                .join(".*") +
            "$"
        );
        return regex.test(p);
    }

    return p === pat || p.endsWith("/" + pat);
}

function escapeRegex(s: string) {
    return s.replace(/[.+^${}()|[\]\\]/g, "\\$&");
}

// puppy walker
async function walk(
    path: string,
    extensions: string[] | undefined,
    since: number,
    root: string,
    rules: IgnoreRule[],
    exclude: string[] | undefined
): Promise<boolean> {
    let stats;

    try {
        stats = await stat(path);
    } catch {
        return false;
    }

    const rel = relative(root, path).split(sep).join("/");

    const isDir = stats.isDirectory();
    // check runtime exlcude -> gitignore - and then stuff like ext + if file for fast path

    if (isExcluded(rel, exclude, isDir)) {
        return false;
    }

    if (isIgnored(rel, isDir, rules)) {
        return false;
    }

    if (stats.isFile()) {
        if (extensions?.length && !extensions.includes(extname(path))) {
            return false;
        }

        return stats.mtimeMs > since;
    }

    if (isDir) {
        const entries = await readdir(path, { withFileTypes: true });

        for (const entry of entries) {
            const full = join(path, entry.name);
            const childRel = relative(root, full).split(sep).join("/");

            const childIsDir = entry.isDirectory();

            // pruwune
            if (isExcluded(childRel, exclude, childIsDir)) continue;
            if (isIgnored(childRel, childIsDir, rules)) continue;

            if (childIsDir) {
                if (await walk(full, extensions, since, root, rules, exclude)) {
                    return true;
                }
            } else {
                if (
                    (!extensions || extensions.includes(extname(entry.name))) &&
                    (await stat(full)).mtimeMs > since
                ) {
                    return true;
                }
            }
        }
    }

    return false;
}

export async function getLastEdited(dir: string): Promise<number> {
    let latest = 0;

    async function walk(path: string) {
        let entries;

        try {
            entries = await readdir(path, { withFileTypes: true });
        } catch {
            return;
        }

        for (const entry of entries) {
            const full = join(path, entry.name);

            if (entry.isDirectory()) {
                await walk(full);
            } else if (entry.isFile()) {
                try {
                    const s = await stat(full);
                    if (s.mtimeMs > latest) latest = s.mtimeMs;
                } catch {
                    // ignore broken files
                }
            }
        }
    }

    await walk(dir);
    return latest;
}
