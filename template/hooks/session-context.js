"use strict";
/**
 * SessionStart: put the project's actual configuration into context.
 *
 * Without this, the first thing a model does in a Unity repository is guess --
 * at the editor version, at the render pipeline, at whether input goes through
 * the new package or the old one -- and it guesses from whatever was most
 * common in its training data, which for Unity means code several years out of
 * date. Twenty lines of fact at the top of the session is worth more than any
 * number of rules written underneath a wrong assumption.
 */

const io = require("./lib/hook-io.js");
const unity = require("./lib/unity-project.js");

io.run((payload) => {
  const root = unity.findProjectRoot(payload.cwd);
  if (!root) return null;

  const f = unity.facts(root);
  const lines = [];

  lines.push("## Unity project");
  lines.push("");
  lines.push(`- Editor: ${f.version || "unknown"} (${f.pipeline} render pipeline)`);
  lines.push(`- Input: ${unity.inputHandlerLabel(f.inputHandler)}`);
  if (f.packages.length) lines.push(`- Packages of note: ${f.packages.join(", ")}`);
  lines.push(`- ${f.packageCount} direct package dependencies`);

  if (f.asmdefs.length) {
    const shown = f.asmdefs.slice(0, 12);
    lines.push(`- Assembly definitions (${f.asmdefs.length}): ${shown.join(", ")}`);
  } else {
    lines.push("- No assembly definitions: all runtime code compiles into Assembly-CSharp");
  }
  if (f.folders.length) lines.push(`- Assets/: ${f.folders.join(", ")}`);

  lines.push("");
  lines.push("### Working agreement in this project");
  lines.push("");
  lines.push(
    "- Scenes, prefabs and other serialized assets are edited in the Unity Editor, " +
      "by a person. Hooks in this plugin refuse text edits to them. When a change " +
      "needs Editor work, use the `editor-handoff` skill to write the checklist " +
      "instead of attempting the edit."
  );
  lines.push(
    "- C# is yours to write. After each write, a hook reports Unity-specific " +
      "problems found in it; treat those findings as review comments, not as blocks."
  );

  if (f.major >= 6000) {
    lines.push(
      "- This is Unity 6. `FindObjectOfType` and `FindObjectsOfType` are obsolete " +
        "here; use `FindFirstObjectByType` / `FindObjectsByType(FindObjectsSortMode.None)`."
    );
  }
  if (f.inputHandler === 1) {
    lines.push(
      "- The legacy `Input` class throws at runtime in this project. All input goes " +
        "through the Input System package."
    );
  }
  if (f.hasEntities) {
    lines.push(
      "- Entities is installed. Check whether the code you are touching is ECS or " +
        "MonoBehaviour before choosing an approach; the two have different rules."
    );
  }

  return io.note("SessionStart", lines.join("\n"));
});
