"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { analyze } = require("../extension/engine.js");

const CONFIG_NAME = ".slopdetector.json";
const DEFAULT_IGNORES = [
  "/.git/",
  "/node_modules/",
  "/.pnpm-store/",
  "/.cache/",
  "/dist/",
  "/build/",
  "/coverage/",
  "/generated/",
  "/vendor/",
  "/.next/",
  "/.output/",
  "/.wrangler/",
  "/target/",
  "/__snapshots__/",
];
const IGNORED_BASENAMES = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  "Cargo.lock",
  "THIRD_PARTY_LICENSES.txt",
]);
const PROSE_EXTENSIONS = new Set([".md", ".mdx", ".txt", ".rst", ".adoc"]);
const HTML_EXTENSIONS = new Set([".html", ".htm", ".xml", ".svg"]);
const SOURCE_EXTENSIONS = new Set([
  ".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts",
  ".astro", ".vue", ".svelte", ".py", ".rb", ".php", ".java", ".kt",
  ".kts", ".go", ".rs", ".c", ".h", ".cc", ".cpp", ".cs", ".swift",
  ".sh", ".bash", ".zsh", ".fish", ".json", ".jsonc", ".yaml", ".yml",
  ".toml", ".css", ".scss", ".sql", ".graphql", ".gql", ".qml",
]);
const JSX_EXTENSIONS = new Set([".jsx", ".tsx", ".astro", ".vue", ".svelte", ".html", ".htm"]);
const HASH_COMMENT_EXTENSIONS = new Set([".py", ".rb", ".sh", ".bash", ".zsh", ".fish", ".yaml", ".yml", ".toml"]);
const MAX_FILE_BYTES = 1024 * 1024;

function countWords(text) {
  return text.match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu)?.length ?? 0;
}

function proseSegments(text) {
  const segments = [];
  let blockStart = null;
  let blockEnd = null;
  let offset = 0;
  let inFence = false;

  function flush() {
    if (blockStart !== null && blockEnd > blockStart) {
      const value = text.slice(blockStart, blockEnd);
      if (countWords(value) >= 2) segments.push({ start: blockStart, text: value });
    }
    blockStart = null;
    blockEnd = null;
  }

  for (const line of text.match(/.*(?:\n|$)/g) ?? []) {
    const trimmed = line.trim();
    if (/^(```|~~~)/.test(trimmed)) {
      flush();
      inFence = !inFence;
      offset += line.length;
      continue;
    }
    if (inFence || trimmed === "") {
      flush();
      offset += line.length;
      continue;
    }
    if (blockStart === null) blockStart = offset;
    blockEnd = offset + line.replace(/\n$/, "").length;
    offset += line.length;
  }
  flush();
  return segments;
}

function htmlSegments(text) {
  const segments = [];
  const excluded = [];
  const excludedElements = /<(script|style|code|pre)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
  let match;
  while ((match = excludedElements.exec(text)) !== null) excluded.push([match.index, match.index + match[0].length]);

  function isExcluded(start, end) {
    return excluded.some(([rangeStart, rangeEnd]) => start < rangeEnd && end > rangeStart);
  }

  function add(start, end) {
    if (end <= start || isExcluded(start, end)) return;
    const value = text.slice(start, end);
    if (countWords(value) >= 2) segments.push({ start, text: value });
  }

  const tag = /<[^>]+>/g;
  let contentStart = 0;
  while ((match = tag.exec(text)) !== null) {
    add(contentStart, match.index);
    if (!isExcluded(match.index, match.index + match[0].length)) {
      const attribute = /\b(?:aria-label|alt|placeholder|title)\s*=\s*(["'])([\s\S]*?)\1/gi;
      let attributeMatch;
      while ((attributeMatch = attribute.exec(match[0])) !== null) {
        const valueOffset = attributeMatch.index + attributeMatch[0].indexOf(attributeMatch[1]) + 1;
        add(match.index + valueOffset, match.index + valueOffset + attributeMatch[2].length);
      }
    }
    contentStart = match.index + match[0].length;
  }
  add(contentStart, text.length);
  return segments.sort((a, b) => a.start - b.start);
}

function sourceSegments(text, extension) {
  const segments = [];
  const allowsHashComments = HASH_COMMENT_EXTENSIONS.has(extension);
  let i = 0;

  function add(start, end) {
    if (end <= start) return;
    const value = text.slice(start, end);
    if (countWords(value) >= 2) segments.push({ start, text: value });
  }

  while (i < text.length) {
    if (text.startsWith("//", i)) {
      const start = i + 2;
      const end = text.indexOf("\n", start);
      add(start, end === -1 ? text.length : end);
      i = end === -1 ? text.length : end + 1;
      continue;
    }
    if (text.startsWith("/*", i)) {
      const start = i + 2;
      const endMarker = text.indexOf("*/", start);
      const end = endMarker === -1 ? text.length : endMarker;
      add(start, end);
      i = endMarker === -1 ? text.length : endMarker + 2;
      continue;
    }
    if (allowsHashComments && text[i] === "#" && (i === 0 || text[i - 1] === "\n" || /\s/.test(text[i - 1]))) {
      const start = i + 1;
      const end = text.indexOf("\n", start);
      add(start, end === -1 ? text.length : end);
      i = end === -1 ? text.length : end + 1;
      continue;
    }

    const quote = text[i];
    if (quote === '"' || quote === "'" || quote === "`") {
      const triple = quote !== "`" && text.slice(i, i + 3) === quote.repeat(3);
      const delimiterLength = triple ? 3 : 1;
      const start = i + delimiterLength;
      i = start;
      while (i < text.length) {
        if (text[i] === "\\") {
          i += 2;
          continue;
        }
        if (triple ? text.slice(i, i + 3) === quote.repeat(3) : text[i] === quote) break;
        i++;
      }
      add(start, i);
      i += triple && i < text.length ? 3 : i < text.length ? 1 : 0;
      continue;
    }
    i++;
  }

  if (JSX_EXTENSIONS.has(extension)) {
    const tagText = />([^<>{}]+)</g;
    let match;
    while ((match = tagText.exec(text)) !== null) {
      const value = match[1];
      if (countWords(value) >= 2) segments.push({ start: match.index + 1, text: value });
    }
  }

  return segments.sort((a, b) => a.start - b.start);
}

function segmentsForFile(filename, text) {
  const extension = path.extname(filename).toLowerCase();
  if (PROSE_EXTENSIONS.has(extension) || extension === "") return proseSegments(text);
  if (HTML_EXTENSIONS.has(extension)) return htmlSegments(text);
  if (SOURCE_EXTENSIONS.has(extension)) return sourceSegments(text, extension);
  return [];
}

function lineStarts(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1);
  return starts;
}

function locate(starts, offset) {
  let low = 0;
  let high = starts.length;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (starts[middle] <= offset) low = middle;
    else high = middle;
  }
  return { line: low + 1, column: offset - starts[low] + 1 };
}

function normalizeRuleLevel(value, fallback) {
  if (value === undefined) return fallback;
  if (value === 0 || value === "off") return "off";
  if (value === 1 || value === "warn" || value === "warning") return "warning";
  if (value === 2 || value === "error") return "error";
  throw new Error(`Invalid rule level: ${JSON.stringify(value)}`);
}

function lintText(text, options = {}) {
  const filename = options.filename ?? "<stdin>";
  const segments = options.segments ?? [{ start: 0, text }];
  const rules = options.rules ?? {};
  const starts = lineStarts(text);
  const diagnostics = [];
  const seen = new Set();

  for (const segment of segments) {
    const result = analyze(segment.text);
    for (const finding of result.findings) {
      const fallback = finding.severity === "major" ? "error" : "warning";
      const level = normalizeRuleLevel(rules[finding.ruleId], fallback);
      if (level === "off") continue;

      const start = segment.start + finding.start;
      const end = segment.start + finding.end;
      const key = `${finding.ruleId}:${start}:${end}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const position = locate(starts, start);
      const violatingText = end > start
        ? text.slice(start, end)
        : segment.text.trim().slice(0, 160);
      diagnostics.push({
        file: filename,
        line: position.line,
        column: position.column,
        level,
        ruleId: finding.ruleId,
        instruction: finding.instruction,
        message: finding.message,
        text: violatingText,
        start,
        end,
      });
    }
  }

  diagnostics.sort((a, b) => a.start - b.start || a.ruleId.localeCompare(b.ruleId));
  return diagnostics;
}

function readJson(filename) {
  try {
    return JSON.parse(fs.readFileSync(filename, "utf8"));
  } catch (error) {
    throw new Error(`Could not read ${filename}: ${error.message}`);
  }
}

function validateConfig(config, filename) {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error(`${filename} must contain a JSON object`);
  }
  if (config.ignore !== undefined
    && (!Array.isArray(config.ignore) || config.ignore.some((item) => typeof item !== "string"))) {
    throw new Error(`${filename}: "ignore" must be an array of strings`);
  }
  if (config.rules !== undefined
    && (!config.rules || typeof config.rules !== "object" || Array.isArray(config.rules))) {
    throw new Error(`${filename}: "rules" must be an object`);
  }
  for (const [ruleId, level] of Object.entries(config.rules ?? {})) {
    try {
      normalizeRuleLevel(level, "warning");
    } catch {
      throw new Error(`${filename}: invalid level for rule ${JSON.stringify(ruleId)}: ${JSON.stringify(level)}`);
    }
  }
  return config;
}

function loadConfig(cwd, explicitPath) {
  const configuredHome = process.env.XDG_CONFIG_HOME;
  const configHome = configuredHome && path.isAbsolute(configuredHome)
    ? configuredHome
    : path.join(os.homedir(), ".config");
  const homeConfig = path.join(configHome, "slop-detector", "config.json");
  const globalConfig = fs.existsSync(homeConfig) ? validateConfig(readJson(homeConfig), homeConfig) : {};
  let localPath = explicitPath ? path.resolve(cwd, explicitPath) : null;

  if (!localPath) {
    let directory = cwd;
    while (true) {
      const candidate = path.join(directory, CONFIG_NAME);
      if (fs.existsSync(candidate)) {
        localPath = candidate;
        break;
      }
      const parent = path.dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
  }

  const localConfig = localPath ? validateConfig(readJson(localPath), localPath) : {};
  return {
    ...globalConfig,
    ...localConfig,
    ignore: [...(globalConfig.ignore ?? []), ...(localConfig.ignore ?? [])],
    rules: { ...(globalConfig.rules ?? {}), ...(localConfig.rules ?? {}) },
    path: localPath,
  };
}

function globToRegExp(glob) {
  let pattern = "";
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i];
    if (char === "*" && glob[i + 1] === "*" && glob[i + 2] === "/") {
      pattern += "(?:.*/)?";
      i += 2;
    } else if (char === "*" && glob[i + 1] === "*") {
      pattern += ".*";
      i++;
    } else if (char === "*") pattern += "[^/]*";
    else if (char === "?") pattern += "[^/]";
    else pattern += char.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
  }
  return new RegExp(`^(?:${pattern})$`);
}

function shouldIgnore(filename, root, patterns = []) {
  const absolute = path.resolve(filename);
  const normalized = `/${absolute.split(path.sep).join("/")}/`;
  if (DEFAULT_IGNORES.some((part) => normalized.includes(part))) return true;
  const basename = path.basename(filename);
  if (
    IGNORED_BASENAMES.has(basename)
    || basename.includes(".gen.")
    || basename.includes(".generated.")
    || basename.endsWith(".min.js")
    || basename.endsWith(".map")
  ) return true;
  const relative = path.relative(root, absolute).split(path.sep).join("/");
  return patterns.some((pattern) => pattern.test(relative));
}

function gitFiles(directory) {
  const rootResult = spawnSync("git", ["-C", directory, "rev-parse", "--show-toplevel"], { encoding: "utf8" });
  if (rootResult.status !== 0) return null;
  const root = rootResult.stdout.trim();
  const filesResult = spawnSync("git", ["-C", root, "ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
    encoding: "buffer",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (filesResult.status !== 0) throw new Error(filesResult.stderr.toString("utf8").trim() || `git ls-files failed in ${root}`);
  const requested = path.resolve(directory);
  const files = filesResult.stdout.toString("utf8").split("\0").filter(Boolean).map((file) => path.join(root, file));
  return { root, files: files.filter((file) => file === requested || file.startsWith(`${requested}${path.sep}`)) };
}

function addGitFiles(directory, files, roots) {
  const tracked = gitFiles(directory);
  if (!tracked) return false;
  for (const filename of tracked.files) {
    files.push(filename);
    roots.set(filename, tracked.root);
  }
  return true;
}

function walkWorkspace(directory, workspaceRoot, files, roots, patterns) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (shouldIgnore(filename, workspaceRoot, patterns)) continue;
    if (entry.isDirectory()) {
      if (fs.existsSync(path.join(filename, ".git")) && addGitFiles(filename, files, roots)) continue;
      walkWorkspace(filename, workspaceRoot, files, roots, patterns);
    } else if (entry.isFile()) {
      files.push(filename);
      roots.set(filename, workspaceRoot);
    }
  }
}

function collectFiles(inputs, options = {}) {
  const ignorePatterns = (options.ignore ?? [])
    .map((pattern) => globToRegExp(String(pattern).replace(/^\.\//, "")));
  const files = [];
  const roots = new Map();
  for (const input of inputs) {
    const absolute = path.resolve(input);
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) continue;
    if (stat.isFile()) {
      files.push(absolute);
      roots.set(absolute, path.dirname(absolute));
      continue;
    }
    if (!stat.isDirectory()) continue;
    if (!addGitFiles(absolute, files, roots)) {
      walkWorkspace(absolute, absolute, files, roots, ignorePatterns);
    }
  }

  const unique = [...new Set(files)].sort();
  return unique.filter((filename) => {
    if (!fs.existsSync(filename)) return false;
    const stat = fs.lstatSync(filename);
    if (stat.isSymbolicLink() || !stat.isFile()) return false;
    const root = roots.get(filename) ?? process.cwd();
    return !shouldIgnore(filename, root, ignorePatterns);
  }).map((filename) => ({ filename, root: roots.get(filename) ?? process.cwd() }));
}

function lintFileResult(filename, options = {}) {
  const stat = fs.lstatSync(filename);
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size > (options.maxFileBytes ?? MAX_FILE_BYTES)) {
    return { checked: false, diagnostics: [] };
  }
  const buffer = fs.readFileSync(filename);
  if (buffer.includes(0)) return { checked: false, diagnostics: [] };
  const text = buffer.toString("utf8");
  if ((text.match(/�/g)?.length ?? 0) > 3) return { checked: false, diagnostics: [] };
  const segments = segmentsForFile(filename, text);
  if (segments.length === 0) return { checked: false, diagnostics: [] };
  return {
    checked: true,
    diagnostics: lintText(text, { filename, segments, rules: options.rules }),
  };
}

function lintFile(filename, options = {}) {
  return lintFileResult(filename, options).diagnostics;
}

function compactInstructions(diagnostics, level) {
  const instructions = [];
  const seen = new Set();
  for (const diagnostic of diagnostics) {
    if ((level && diagnostic.level !== level) || seen.has(diagnostic.ruleId)) continue;
    seen.add(diagnostic.ruleId);
    instructions.push(diagnostic.instruction ?? `Fix ${diagnostic.ruleId}.`);
  }
  return instructions;
}

function warningNudge(diagnostics) {
  const instructions = compactInstructions(diagnostics, "warning");
  return instructions.length === 0 ? "" : `Style: ${instructions.join(" ")}`;
}

function revisionFeedback(diagnostics) {
  const instructions = compactInstructions(diagnostics);
  if (instructions.length === 0) return "";
  return `Revise style only. ${instructions.join(" ")} Preserve meaning and required facts. Return only the revision.`;
}

module.exports = {
  CONFIG_NAME,
  collectFiles,
  lintFile,
  lintFileResult,
  lintText,
  loadConfig,
  revisionFeedback,
  segmentsForFile,
  warningNudge,
};
