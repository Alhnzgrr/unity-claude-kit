"use strict";
/**
 * PreToolUse on Bash: ask before assets move or disappear outside the Editor.
 *
 * Every asset under Assets/ has a .meta file next to it holding the GUID that
 * scenes and prefabs reference. The two only stay in step when the Project
 * window does the move. A shell `rm` or `mv` breaks the pair:
 *
 *   - delete the asset, keep the .meta   -> an orphan the Editor cleans up
 *   - delete the .meta, keep the asset   -> Unity writes a NEW GUID, and every
 *                                           reference to that asset in every
 *                                           scene and prefab becomes missing
 *   - move the asset without its .meta   -> same as deleting the .meta
 *
 * Shell command text is fuzzy to parse, so this only ever asks. A false ask
 * costs a keystroke; a false block costs trust in the whole set.
 */

const io = require("./lib/hook-io.js");
const unity = require("./lib/unity-project.js");

const DESTRUCTIVE = /(?:^|[;&|]\s*)\s*(?:sudo\s+)?(git\s+rm|git\s+mv|git\s+clean|rm|mv|del|erase|move|rimraf)\b([^;&|]*)/gi;

io.run((payload) => {
  const command = (payload.tool_input || {}).command;
  if (typeof command !== "string" || !command) return null;
  if (!unity.findProjectRoot(payload.cwd)) return null;

  const hits = io.findAll(command, DESTRUCTIVE);
  if (!hits.length) return null;

  const touched = [];
  let metaOnly = false;
  let assetOnly = false;

  for (const hit of hits) {
    const args = String(hit.groups[2] || "");
    for (const raw of args.split(/\s+/)) {
      const arg = io.normalize(raw.replace(/^["']|["']$/g, ""));
      if (!arg || arg.startsWith("-")) continue;
      if (!/(^|\/)Assets(\/|$)/i.test(arg)) continue;
      touched.push(arg);
      if (arg.toLowerCase().endsWith(".meta")) metaOnly = true;
      else if (/\.\w+$/.test(arg)) assetOnly = true;
    }
  }

  if (!touched.length) return null;

  const pairsHandled = metaOnly && assetOnly;
  const list = touched.slice(0, 6).map((p) => `\`${p}\``).join(", ");

  const reason = metaOnly && !assetOnly
    ? "This command removes or moves a .meta file on its own. The GUID in that file " +
      "is what every scene and prefab uses to point at the asset; once it is gone " +
      "Unity generates a new one on next import and every one of those references " +
      "becomes a missing reference."
    : pairsHandled
      ? "This command handles assets and their .meta files together, which is the " +
        "right pairing. Worth one look that every path has its partner before it runs."
      : "This command removes or moves assets under Assets/ without their .meta " +
        "files. The .meta holds the GUID that scenes and prefabs reference, so the " +
        "asset and its .meta have to move together or the references break.";

  return io.ask(
    `${reason}\n\nPaths: ${list}\n\n` +
      "The safe route for anything still referenced is the Unity Project window, " +
      "which moves or deletes the pair and updates nothing else. In a shell, move or " +
      "delete the `.meta` alongside its asset."
  );
});
