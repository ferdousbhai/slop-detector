"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { analyze, rules: RULES } = require("../extension/engine.js");

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
const JSX_EXTENSIONS = new Set([".jsx", ".tsx", ".astro", ".vue", ".svelte"]);
const HASH_COMMENT_EXTENSIONS = new Set([".py", ".rb", ".php", ".sh", ".bash", ".zsh", ".fish", ".yaml", ".yml", ".toml", ".graphql", ".gql"]);
/* Languages with neither "//" nor a block comment. Reading "/*" as a comment there swallows a shell glob. */
const NO_SLASH_COMMENT_EXTENSIONS = new Set([".py", ".rb", ".sh", ".bash", ".zsh", ".fish", ".yaml", ".yml", ".toml", ".graphql", ".gql", ".json"]);
const NO_LINE_SLASH_COMMENT_EXTENSIONS = new Set([".css", ".sql"]);
/* A single quote here opens a character literal or a lifetime, never a string of prose. */
const CHAR_QUOTE_EXTENSIONS = new Set([".rs", ".c", ".h", ".cc", ".cpp", ".cs", ".java", ".kt", ".kts", ".go", ".swift", ".json", ".jsonc"]);
const PROSE_BASENAMES = /^(?:readme|changelog|contributing|authors|notice|news|history|todo|copying|license)$/i;
const MAX_FILE_BYTES = 1024 * 1024;

function countWords(text) {
  return text.match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu)?.length ?? 0;
}

/* Inline code and link targets are identifiers, not prose. Blanking keeps every offset where it was.
   Bare URLs are blanked by the engine for every caller. */
function maskMarkdownCode(value) {
  const blank = (match) => " ".repeat(match.length);
  return value
    .replace(/`[^`\n]+`/g, blank)
    /* The bound keeps a file full of unclosed "](" from rescanning to the end at each one. */
    .replace(/(?<=\]\()[^)\s]{1,500}(?=\))/g, blank);
}

function proseSegments(text) {
  const segments = [];
  let blockStart = null;
  let blockEnd = null;
  let offset = 0;
  let fence = null;
  /* An indented code block starts after a blank line, but not where the indent continues a list item. */
  let indentedCode = false;
  let afterListItem = false;

  function flush() {
    if (blockStart !== null && blockEnd > blockStart) {
      const value = maskMarkdownCode(text.slice(blockStart, blockEnd));
      if (countWords(value) >= 2) segments.push({ start: blockStart, text: value });
    }
    blockStart = null;
    blockEnd = null;
  }

  /* "." stops at a carriage return, so a CRLF file would yield no lines at all. */
  for (const line of text.match(/[^\n]*(?:\n|$)/g) ?? []) {
    const trimmed = line.trim();
    /* A fence opens on a line with nothing after the info string and closes on a bare fence of the
       same character that is at least as long, so "```js``` inline" and a ``` line inside a ~~~ block change nothing. */
    const opening = fence === null && /^(`{3,}|~{3,})[^`]*$/.exec(trimmed);
    const closing = fence !== null && trimmed.length >= fence.length && trimmed === fence[0].repeat(trimmed.length);
    if (opening || closing) {
      flush();
      fence = opening ? opening[1] : null;
      offset += line.length;
      continue;
    }
    if (fence !== null || trimmed === "") {
      flush();
      offset += line.length;
      continue;
    }
    const indented = /^(?: {4}|\t)/.test(line);
    if (indented && (indentedCode || (blockStart === null && !afterListItem))) {
      indentedCode = true;
      offset += line.length;
      continue;
    }
    if (!indented) {
      indentedCode = false;
      afterListItem = /^(?:[-*+\u2022]|\d+[.)])\s+/.test(trimmed);
    }
    // The browser scanner treats every <li> as its own block, so no rule ever
    // compares one list item against another. Markdown has to split the same
    // way: a deliberately parallel list is good writing, and gluing its items
    // into one paragraph makes them read as uniform prose. Wrapped item text
    // does not carry a marker, so it stays with the item it belongs to.
    if (/^(?:[-*+\u2022]|\d+[.)])\s+/.test(trimmed)) flush();
    if (blockStart === null) blockStart = offset;
    blockEnd = offset + line.replace(/\r?\n$/, "").length;
    offset += line.length;
  }
  flush();
  return segments;
}

const INLINE_HTML_TAG = /^<\/?(?:a|abbr|b|bdi|bdo|cite|code|del|dfn|em|font|i|ins|kbd|mark|q|s|samp|small|span|strong|sub|sup|time|u|var|wbr)\b/i;

const HTML_ENTITIES = { nbsp: " ", rsquo: "'", lsquo: "'", apos: "'", quot: '"', amp: "&", lt: "<", gt: ">", mdash: "\u2014", ndash: "\u2013", ldquo: "\u201C", rdquo: "\u201D", hellip: "\u2026" };

function decodeEntity(name) {
  if (name[0] !== "#") return HTML_ENTITIES[name.toLowerCase()];
  const code = /^#x/i.test(name) ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1));
  return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : undefined;
}

/* Blanks comments and the elements whose text is not prose, keeping every offset where it was. Each
   closing tag is searched for once per element, and never again once one is found to be missing. */
function blankHiddenHtml(text) {
  const opener = /<!--|<(script|style|code|pre|textarea)\b[^<>]*>/gi;
  const unclosed = new Set();
  let out = "";
  let cursor = 0;
  for (let match = opener.exec(text); match !== null; match = opener.exec(text)) {
    const name = (match[1] ?? "!--").toLowerCase();
    if (unclosed.has(name)) continue;
    const closer = name === "!--" ? /-->/g : new RegExp(`</${name}\\s*>`, "gi");
    closer.lastIndex = match.index + match[0].length;
    const close = closer.exec(text);
    if (!close) {
      unclosed.add(name);
      continue;
    }
    const end = close.index + close[0].length;
    out += text.slice(cursor, match.index) + text.slice(match.index, end).replace(/[^\n]/g, " ");
    cursor = end;
    opener.lastIndex = end;
  }
  return out + text.slice(cursor);
}

function htmlSegments(text) {
  const segments = [];
  const visible = blankHiddenHtml(text);

  /* A block's text is the pieces between its inline tags, joined, with entities decoded. `pieces`
     records where each piece came from, because "feel free</a> to" has to read as three adjacent
     words and "I&rsquo;d" as one. */
  let pieces = [];
  let value = "";
  let inHeading = false;

  function addPiece(start, end) {
    let cursor = start;
    const push = (from, to) => {
      if (to <= from) return;
      pieces.push({ at: value.length, source: from });
      value += visible.slice(from, to);
    };
    /* Searching the piece alone keeps this linear; searching the file from each piece is not. */
    const piece = visible.slice(start, end);
    if (piece.includes("&")) {
      for (const match of piece.matchAll(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi)) {
        const decoded = decodeEntity(match[1]);
        if (decoded === undefined) continue;
        const at = start + match.index;
        push(cursor, at);
        pieces.push({ at: value.length, source: at, width: match[0].length });
        value += decoded;
        cursor = at + match[0].length;
      }
    }
    push(cursor, end);
  }

  function flush() {
    if (countWords(value) >= 2) {
      const segment = { start: pieces[0].source, text: value };
      if (pieces.length > 1) segment.pieces = pieces;
      if (inHeading) segment.heading = true;
      segments.push(segment);
    }
    pieces = [];
    value = "";
  }

  let contentStart = 0;
  /* Quoted attribute values may hold ">". The bounds stop an unclosed quote or "<" from rescanning. */
  for (const match of visible.matchAll(/<(?:[^<>"']|"[^"]{0,1000}"|'[^']{0,1000}')+>/g)) {
    const attribute = /\b(?:aria-label|alt|placeholder|title)\s*=\s*(["'])([\s\S]*?)\1/gi;
    for (const attributeMatch of match[0].matchAll(attribute)) {
      const valueOffset = match.index + attributeMatch.index + attributeMatch[0].indexOf(attributeMatch[1]) + 1;
      if (countWords(attributeMatch[2]) >= 2) segments.push({ start: valueOffset, text: attributeMatch[2] });
    }
    addPiece(contentStart, match.index);
    contentStart = match.index + match[0].length;
    if (INLINE_HTML_TAG.test(match[0])) continue;
    flush();
    /* The engine reads Markdown headings itself; HTML has to say which text sits inside one. */
    const headingTag = /^<(\/?)h[1-6]\b/i.exec(match[0]);
    if (headingTag) inHeading = headingTag[1] === "";
  }
  addPiece(contentStart, text.length);
  flush();
  return segments.sort((a, b) => a.start - b.start);
}

function sourceSegments(text, extension) {
  const segments = [];
  const allowsHashComments = HASH_COMMENT_EXTENSIONS.has(extension);
  const allowsBlockComments = !NO_SLASH_COMMENT_EXTENSIONS.has(extension);
  const allowsLineComments = allowsBlockComments && !NO_LINE_SLASH_COMMENT_EXTENSIONS.has(extension);
  const singleQuoteStrings = !CHAR_QUOTE_EXTENSIONS.has(extension);
  const allowsDashComments = extension === ".sql";
  const hasElementText = JSX_EXTENSIONS.has(extension);
  let i = 0;

  function add(start, end, isString = false) {
    if (end <= start) return;
    /* "Thanks.\nFeel free" holds an escape, not the word "nFeel". Two spaces keep the offsets. */
    const value = isString ? text.slice(start, end).replace(/\\[nrt]/g, "  ") : text.slice(start, end);
    if (countWords(value) >= 2) segments.push({ start, text: value });
  }

  while (i < text.length) {
    if ((allowsLineComments && text.startsWith("//", i)) || (allowsDashComments && text.startsWith("--", i))) {
      const start = i + 2;
      const end = text.indexOf("\n", start);
      add(start, end === -1 ? text.length : end);
      i = end === -1 ? text.length : end + 1;
      continue;
    }
    if (allowsBlockComments && text.startsWith("/*", i)) {
      const start = i + 2;
      const endMarker = text.indexOf("*/", start);
      const end = endMarker === -1 ? text.length : endMarker;
      add(start, end);
      i = endMarker === -1 ? text.length : endMarker + 2;
      continue;
    }
    if (allowsHashComments && text[i] === "#" && (i === 0 || /\s/.test(text[i - 1]))) {
      const start = i + 1;
      const end = text.indexOf("\n", start);
      add(start, end === -1 ? text.length : end);
      i = end === -1 ? text.length : end + 1;
      continue;
    }

    const quote = text[i];
    if (quote === "'" && !singleQuoteStrings) {
      /* A character literal such as '"' is skipped whole, so the quote inside it opens nothing. */
      const literal = /'(?:\\.|[^'\\\n])'/y;
      literal.lastIndex = i;
      i += literal.exec(text)?.[0].length ?? 1;
      continue;
    }
    /* Only template dialects put element text in the walker's path, where a word-internal apostrophe
       would otherwise open a string that swallows the rest of the file and turns bare identifiers
       into prose. Elsewhere every quote stays a delimiter so prefixed literals (f'', b'', L'') parse. */
    const isWordApostrophe = hasElementText
      && quote === "'"
      && i > 0
      && /[\p{L}\p{N}]/u.test(text[i - 1])
      && /[\p{L}\p{N}]/u.test(text[i + 1] ?? "");
    if (!isWordApostrophe && (quote === '"' || (quote === "'" && singleQuoteStrings) || quote === "`")) {
      const triple = quote !== "`" && text.slice(i, i + 3) === quote.repeat(3);
      const multiline = triple || quote === "`";
      const delimiterLength = triple ? 3 : 1;
      const start = i + delimiterLength;
      let end = start;
      let closed = false;
      while (end < text.length) {
        if (text[end] === "\\") {
          end += 2;
          continue;
        }
        if (triple ? text.slice(end, end + 3) === quote.repeat(3) : text[end] === quote) {
          closed = true;
          break;
        }
        /* An ordinary string cannot span lines, so a quote left open is an apostrophe or a typo. */
        if (!multiline && text[end] === "\n") break;
        end++;
      }
      if (!closed && !multiline) {
        /* Nothing else on this line can close it, and restarting one character on is quadratic. */
        i = Math.min(end, text.length);
        continue;
      }
      add(start, Math.min(end, text.length), true);
      i = closed ? end + delimiterLength : text.length;
      continue;
    }
    i++;
  }

  if (hasElementText) {
    /* Text counts only between two tags, which keeps "a > b && c < d" out. */
    const tagText = /(?<=<\/?[A-Za-z][^<>]*)>([^<>{}]+)<(?=[\/A-Za-z!])/g;
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
  if (PROSE_EXTENSIONS.has(extension)) return proseSegments(text);
  /* Without an extension only the conventional document names are prose; a Makefile is not. */
  if (extension === "") return PROSE_BASENAMES.test(path.basename(filename)) ? proseSegments(text) : [];
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

/* Maps a flagged range in a segment's text back to the file. Segments joined from pieces look up the
   piece; a decoded entity is one character wide in the text and `width` characters wide in the file. */
function pieceAt(segment, index) {
  let piece = segment.pieces[0];
  for (const candidate of segment.pieces) {
    if (candidate.at > index) break;
    piece = candidate;
  }
  return piece;
}

function sourceRange(segment, start, end) {
  if (!segment.pieces) return [segment.start + start, segment.start + end];
  const first = pieceAt(segment, start);
  const from = first.source + (first.width ? 0 : start - first.at);
  if (end <= start) return [from, from];
  /* The end is exclusive, so it is found from the last flagged character, not the one after it. */
  const last = pieceAt(segment, end - 1);
  return [from, last.source + (last.width ?? end - last.at)];
}

function lintText(text, options = {}) {
  const filename = options.filename ?? "<stdin>";
  const segments = options.segments ?? [{ start: 0, text }];
  const rules = options.rules ?? {};
  const starts = lineStarts(text);
  const diagnostics = [];
  const seen = new Set();

  for (const segment of segments) {
    const result = analyze(segment.text, { heading: segment.heading === true });
    for (const finding of result.findings) {
      const fallback = finding.severity === "major" ? "error" : "warning";
      const level = normalizeRuleLevel(rules[finding.ruleId], fallback);
      if (level === "off") continue;

      const [start, end] = sourceRange(segment, finding.start, finding.end);
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
    if (!Object.hasOwn(RULES, ruleId)) {
      throw new Error(`${filename}: unknown rule ${JSON.stringify(ruleId)}. Known rules: ${Object.keys(RULES).join(", ")}`);
    }
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
    /* Ignore patterns are relative to the config that wrote them, however the files are named on the command line. */
    root: localPath ? path.dirname(localPath) : cwd,
    ignore: [...(globalConfig.ignore ?? []), ...(localConfig.ignore ?? [])],
    rules: { ...(globalConfig.rules ?? {}), ...(localConfig.rules ?? {}) },
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
  /* A pattern that names a directory covers everything under it. */
  return new RegExp(`^(?:${pattern})(?:/.*)?$`);
}

function shouldIgnore(filename, root, patterns, patternBase) {
  const absolute = path.resolve(filename);
  /* Match inside the collection root only. Testing the absolute path let any ancestor directory
     above the checkout -- build/, dist/, vendor/, target/ -- discard every file and exit clean. */
  const relative = path.relative(root, absolute).split(path.sep).join("/");
  const normalized = `/${relative}/`;
  if (DEFAULT_IGNORES.some((part) => normalized.includes(part))) return true;
  const basename = path.basename(filename);
  if (
    IGNORED_BASENAMES.has(basename)
    || basename.includes(".gen.")
    || basename.includes(".generated.")
    || basename.endsWith(".min.js")
    || basename.endsWith(".map")
  ) return true;
  const fromBase = path.relative(patternBase, absolute).split(path.sep).join("/");
  return patterns.some((pattern) => pattern.test(fromBase));
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
  /* Git reports physical paths, so a directory reached through a symlink has to be compared the same way. */
  const requested = fs.realpathSync(directory);
  const files = filesResult.stdout.toString("utf8").split("\0").filter(Boolean).map((file) => path.join(root, file));
  /* Default ignores apply inside the directory that was asked for, so naming build/ lints build/. */
  return { root: requested, files: files.filter((file) => file === requested || file.startsWith(`${requested}${path.sep}`)) };
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

function walkWorkspace(directory, workspaceRoot, files, roots, patterns, patternBase) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (shouldIgnore(filename, workspaceRoot, patterns, patternBase)) continue;
    if (entry.isDirectory()) {
      if (fs.existsSync(path.join(filename, ".git")) && addGitFiles(filename, files, roots)) continue;
      walkWorkspace(filename, workspaceRoot, files, roots, patterns, patternBase);
    } else if (entry.isFile()) {
      files.push(filename);
      roots.set(filename, workspaceRoot);
    }
  }
}

function collectFiles(inputs, options = {}) {
  const ignorePatterns = (options.ignore ?? [])
    .map((pattern) => globToRegExp(String(pattern).replace(/^\.?\//, "").replace(/\/$/, "")));
  const patternBase = fs.realpathSync(options.root ?? process.cwd());
  const files = [];
  const roots = new Map();
  for (const input of inputs) {
    if (fs.lstatSync(path.resolve(input)).isSymbolicLink()) {
      throw new Error(`${input} is a symbolic link, and symbolic links are not scanned; name its target instead`);
    }
    const absolute = fs.realpathSync(path.resolve(input));
    const stat = fs.lstatSync(absolute);
    if (stat.isFile()) {
      files.push(absolute);
      roots.set(absolute, path.dirname(absolute));
      continue;
    }
    if (!stat.isDirectory()) continue;
    if (!addGitFiles(absolute, files, roots)) {
      walkWorkspace(absolute, absolute, files, roots, ignorePatterns, patternBase);
    }
  }

  const unique = [...new Set(files)].sort();
  return unique.filter((filename) => {
    if (!fs.existsSync(filename)) return false;
    const stat = fs.lstatSync(filename);
    if (stat.isSymbolicLink() || !stat.isFile()) return false;
    return !shouldIgnore(filename, roots.get(filename), ignorePatterns, patternBase);
  });
}

function lintFileResult(filename, options = {}) {
  const stat = fs.lstatSync(filename);
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size > MAX_FILE_BYTES) {
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

function compactInstructions(diagnostics) {
  const instructions = [];
  const seen = new Set();
  for (const diagnostic of diagnostics) {
    if (seen.has(diagnostic.ruleId)) continue;
    seen.add(diagnostic.ruleId);
    instructions.push(diagnostic.instruction);
  }
  return instructions;
}

function revisionFeedback(diagnostics) {
  const instructions = compactInstructions(diagnostics);
  if (instructions.length === 0) return "";
  return `Revise style only. ${instructions.join(" ")} Preserve meaning and required facts. Return only the revision.`;
}

module.exports = {
  collectFiles,
  lintFileResult,
  lintText,
  loadConfig,
  revisionFeedback,
  segmentsForFile,
};
