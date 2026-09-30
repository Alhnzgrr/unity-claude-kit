"use strict";
/**
 * PreToolUse: the two C# mistakes that compile cleanly and fail later.
 *
 *   1. UnityEditor in runtime code. The editor assembly does not exist in a
 *      player build, so the project compiles, runs in play mode, and fails at
 *      the point someone makes a build -- usually the day of a build.
 *
 *   2. The legacy Input class in a project whose player is built with the Input
 *      System backend only. That one throws InvalidOperationException the first
 *      time the line runs.
 *
 * Both are read from the project rather than assumed. Check 2 does nothing in a
 * project that still has the old backend enabled, because there it is correct
 * code and a guardrail that fires on correct code gets switched off.
 */

const io = require("./lib/hook-io.js");
const unity = require("./lib/unity-project.js");

/**
 * Line numbers where UNITY_EDITOR is guaranteed to be defined.
 *
 * "The file mentions #if UNITY_EDITOR somewhere" is not the same claim, and the
 * difference is exactly the bug: a guarded helper at the bottom of a file does
 * nothing for an unguarded using directive at the top.
 */
function editorGuardedLines(source) {
  const guarded = new Set();
  const stack = [];

  // UNITY_EDITOR is guaranteed only when every top-level alternative requires
  // it; `UNITY_EDITOR || UNITY_STANDALONE` guarantees nothing.
  const guarantees = (condition) =>
    condition
      .split("||")
      .every((part) => /(^|[^!\w])UNITY_EDITOR\b/.test(part) && !/!\s*UNITY_EDITOR\b/.test(part));

  const negates = (condition) => /^\s*!\s*UNITY_EDITOR\s*$/.test(condition);

  source.split("\n").forEach((line, index) => {
    const directive = line.match(/^\s*#\s*(if|elif|else|endif)\b(.*)$/);
    if (directive) {
      const [, keyword, rest] = directive;
      if (keyword === "if") stack.push({ ifGuards: guarantees(rest), elseGuards: negates(rest), inElse: false });
      else if (keyword === "elif" && stack.length) {
        const top = stack[stack.length - 1];
        top.inElse = false;
        top.ifGuards = guarantees(rest);
        top.elseGuards = false;
      } else if (keyword === "else" && stack.length) stack[stack.length - 1].inElse = true;
      else if (keyword === "endif") stack.pop();
      return;
    }
    const active = stack.some((frame) => (frame.inElse ? frame.elseGuards : frame.ifGuards));
    if (active) guarded.add(index + 1);
  });

  return guarded;
}

const EDITOR_ONLY = /(?<![\w.])(?:using\s+UnityEditor|UnityEditor\s*\.|EditorWindow|ScriptableWizard|\[\s*(?:MenuItem|CustomEditor|CustomPropertyDrawer|InitializeOnLoad|OnOpenAsset|DidReloadScripts)\b)/g;

const LEGACY_INPUT = /(?<!\w)(?:UnityEngine\s*\.\s*)?Input\s*\.\s*(?:GetKey|GetKeyDown|GetKeyUp|GetAxis|GetAxisRaw|GetButton|GetButtonDown|GetButtonUp|GetMouseButton|GetMouseButtonDown|GetMouseButtonUp|mousePosition|mouseScrollDelta|anyKey|anyKeyDown|touches|touchCount|GetTouch|acceleration|inputString)\b/g;

io.run((payload) => {
  const file = io.targetFile(payload);
  if (!file || !file.toLowerCase().endsWith(".cs")) return null;

  const root = unity.findProjectRoot(io.path.dirname(file)) || unity.findProjectRoot(payload.cwd);
  if (!root) return null;

  const { text } = io.prospectiveContent(payload);
  if (!text) return null;

  const code = io.stripNonCode(text);

  // --- editor code in a runtime assembly ---------------------------------
  // Two ways a file is legitimately editor code: the Editor/ folder convention,
  // and -- the one that actually decides it -- an assembly definition whose
  // includePlatforms is Editor alone. Edit mode test assemblies are the second
  // case and have no Editor folder anywhere in their path.
  const relativePath = io.path.relative(root, file);
  const isEditorFile =
    io.hasSegment(relativePath, "Editor") || unity.isEditorOnlyAssembly(file, root);
  if (!isEditorFile) {
    const guarded = editorGuardedLines(text);
    const unguarded = io.findAll(code, EDITOR_ONLY).filter((hit) => !guarded.has(hit.line));
    if (unguarded.length) {
      const where = unguarded.slice(0, 3).map((hit) => `line ${hit.line}: ${hit.text.trim()}`).join("; ");
      return io.deny(
        "This file is in a runtime assembly and reaches into UnityEditor without a " +
          `UNITY_EDITOR guard (${where}).\n\n` +
          "The UnityEditor assembly is not shipped in a player build, so this compiles " +
          "now, runs in play mode, and breaks the first time someone makes a build — " +
          "with an error that points at this line long after the change is forgotten.\n\n" +
          "Either move the file under an `Editor/` folder, or wrap the editor-only code " +
          "(including the `using UnityEditor;` line) in `#if UNITY_EDITOR` / `#endif`."
      );
    }
  }

  // --- legacy input against an Input System-only backend ------------------
  const handler = unity.activeInputHandler(root);
  if (handler === 1) {
    const hits = io.findAll(code, LEGACY_INPUT);
    if (hits.length) {
      const where = hits.slice(0, 3).map((hit) => `line ${hit.line}: ${hit.text.trim()}`).join("; ");
      return io.deny(
        `This project's Active Input Handling is set to "Input System Package (New)", ` +
          `and this file uses the legacy Input class (${where}).\n\n` +
          "With that setting the legacy class is not backed by anything: the first call " +
          "throws InvalidOperationException at runtime. It compiles, so nothing catches " +
          "it before someone plays the scene.\n\n" +
          "Use the Input System instead — an InputAction asset, or `Keyboard.current` / " +
          "`Mouse.current` / `Gamepad.current` from `UnityEngine.InputSystem` for a " +
          "direct read."
      );
    }
  }

  return null;
});
