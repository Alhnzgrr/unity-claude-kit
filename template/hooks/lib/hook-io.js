"use strict";
/**
 * Hook I/O for Claude Code.
 *
 * Every hook here follows the same contract: read the JSON payload on stdin,
 * print one JSON object on stdout, exit 0. Exit 2 is deliberately unused --
 * `permissionDecision` carries a reason string back to the model, and a reason
 * the model can act on is worth more than a refusal it has to guess about.
 */

const fs = require("fs");
const path = require("path");

/** Read the whole of stdin. Returns "" when nothing is piped in. */
function readStdin() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

/**
 * Run a hook body against the payload on stdin.
 *
 * Anything thrown inside `body` is swallowed. A guardrail that crashes must get
 * out of the way rather than block every edit in the session, so a broken hook
 * costs enforcement, never the ability to work.
 */
function run(body) {
  let payload;
  try {
    payload = JSON.parse(readStdin());
  } catch {
    process.exit(0);
  }
  try {
    const result = body(payload);
    if (result) process.stdout.write(JSON.stringify(result));
  } catch (error) {
    if (process.env.UNITY_KIT_DEBUG) process.stderr.write(String(error.stack || error));
  }
  process.exit(0);
}

const decide = (permissionDecision, reason) => ({
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision,
    permissionDecisionReason: reason,
  },
});

/** Refuse the tool call outright. `reason` reaches the model. */
const deny = (reason) => decide("deny", reason);

/** Put the call in front of the user, who knows things the hook cannot. */
const ask = (reason) => decide("ask", reason);

/** Attach findings to a tool result without changing its outcome. */
const note = (hookEventName, additionalContext) => ({
  hookSpecificOutput: { hookEventName, additionalContext },
});

/**
 * The file a Write or Edit is aimed at, or null for a tool that names none.
 */
function targetFile(payload) {
  const input = payload.tool_input || {};
  return input.file_path || input.notebook_path || null;
}

/**
 * The content the file WOULD have if this call went through.
 *
 * Checks that scan for structure -- preprocessor regions, field declarations --
 * need the whole prospective file, not the fragment in `new_string`. A rule
 * evaluated against a fragment produces false blocks on correct edits, which
 * teaches everyone to route around the hook.
 *
 * Returns { text, whole } where `whole` is false when only a fragment could be
 * reconstructed, so callers can drop checks that need full-file context.
 */
function prospectiveContent(payload) {
  const input = payload.tool_input || {};
  const filePath = targetFile(payload);

  if (typeof input.content === "string") return { text: input.content, whole: true };

  let current = null;
  try {
    if (filePath && fs.existsSync(filePath)) current = fs.readFileSync(filePath, "utf8");
  } catch {
    current = null;
  }

  const edits = Array.isArray(input.edits)
    ? input.edits
    : typeof input.new_string === "string"
      ? [{ old_string: input.old_string, new_string: input.new_string, replace_all: input.replace_all }]
      : [];

  if (!edits.length) return { text: current || "", whole: current !== null };

  if (current === null) {
    return { text: edits.map((edit) => edit.new_string || "").join("\n"), whole: false };
  }

  let text = current;
  for (const edit of edits) {
    const from = edit.old_string;
    const to = edit.new_string || "";
    if (typeof from !== "string" || from === "") continue;
    text = edit.replace_all ? text.split(from).join(to) : text.replace(from, to);
  }
  return { text, whole: true };
}

/** The content the file has right now, or "" when it does not exist yet. */
function currentContent(payload) {
  const filePath = targetFile(payload);
  try {
    if (filePath && fs.existsSync(filePath)) return fs.readFileSync(filePath, "utf8");
  } catch {
    /* unreadable is the same as absent for every check here */
  }
  return "";
}

/**
 * Blank out comments, string literals and `#if`-disabled code, keeping every
 * newline so reported line numbers still match the file the user opens.
 *
 * Without this a rule written in a doc comment trips its own check, and the
 * cheapest way to make a guardrail distrusted is to have it fire on prose.
 */
function stripNonCode(source) {
  const out = Array.from(source);
  const blank = (start, end) => {
    for (let i = start; i < end && i < out.length; i++) {
      if (out[i] !== "\n") out[i] = " ";
    }
  };

  let i = 0;
  while (i < source.length) {
    const two = source.slice(i, i + 2);

    if (two === "//") {
      let end = source.indexOf("\n", i);
      if (end === -1) end = source.length;
      blank(i, end);
      i = end;
      continue;
    }
    if (two === "/*") {
      let end = source.indexOf("*/", i + 2);
      end = end === -1 ? source.length : end + 2;
      blank(i, end);
      i = end;
      continue;
    }
    if (source[i] === '"' || source[i] === "'") {
      const quote = source[i];
      const verbatim = i > 0 && source[i - 1] === "@" && quote === '"';
      let j = i + 1;
      while (j < source.length) {
        if (!verbatim && source[j] === "\\") { j += 2; continue; }
        if (source[j] === quote) {
          if (verbatim && source[j + 1] === quote) { j += 2; continue; }
          break;
        }
        if (!verbatim && source[j] === "\n") break;
        j++;
      }
      blank(i + 1, j);
      i = j + 1;
      continue;
    }
    i++;
  }

  return out.join("");
}

/** 1-based line number of an index into the source. */
const lineAt = (source, index) => source.slice(0, index).split("\n").length;

/** Every match of `pattern` as { index, line, text }. `pattern` must be global. */
function findAll(source, pattern) {
  const hits = [];
  let match;
  pattern.lastIndex = 0;
  while ((match = pattern.exec(source)) !== null) {
    hits.push({ index: match.index, line: lineAt(source, match.index), text: match[0], groups: match });
    if (match.index === pattern.lastIndex) pattern.lastIndex++;
  }
  return hits;
}

/** Path with forward slashes, for matching and for messages. */
const normalize = (p) => String(p || "").split("\\").join("/");

/** True when any path segment equals `segment` (so `Editor/`, not `MyEditorThing.cs`). */
const hasSegment = (p, segment) =>
  normalize(p).split("/").some((part) => part.toLowerCase() === segment.toLowerCase());

module.exports = {
  run,
  deny,
  ask,
  note,
  targetFile,
  prospectiveContent,
  currentContent,
  stripNonCode,
  lineAt,
  findAll,
  normalize,
  hasSegment,
  path,
  fs,
};
