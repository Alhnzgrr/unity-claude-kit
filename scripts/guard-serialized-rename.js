"use strict";
/**
 * PreToolUse: ask before a serialized field loses its name.
 *
 * Unity stores serialized data keyed by field name. Rename a field and every
 * value already set in a scene, prefab or asset is dropped on the next
 * deserialize, and the field comes back as the type default. Nothing errors.
 * The bug shows up later as a zero, an unassigned reference, or a prefab that
 * quietly stopped working, and by then the rename is several commits back.
 *
 * [FormerlySerializedAs("oldName")] is the fix, and it has to be added in the
 * same change as the rename.
 *
 * This asks rather than refuses: whether a field has data worth keeping is
 * something the person with the project open knows and a hook cannot.
 */

const io = require("./lib/hook-io.js");
const unity = require("./lib/unity-project.js");

const SERIALIZE_FIELD =
  /\[\s*SerializeField[^\]]*\](?:\s*\[[^\]]*\])*\s*(?:private|protected|internal|public)?\s+(?:readonly\s+)?[\w<>,\[\]\.\?]+\s+(\w+)\s*[=;]/g;

const PUBLIC_FIELD =
  /(?<![\w.])public\s+(?!class\b|struct\b|enum\b|interface\b|delegate\b|event\b|static\b|const\b|abstract\b|override\b|virtual\b|partial\b|readonly\b|void\b)[\w<>,\[\]\.\?]+\s+(\w+)\s*(?:=[^;]*)?;/g;

/** Field names Unity would serialize from this source. */
function serializedFields(source) {
  const code = io.stripNonCode(source);
  const names = new Set();
  for (const pattern of [SERIALIZE_FIELD, PUBLIC_FIELD]) {
    for (const hit of io.findAll(code, pattern)) names.add(hit.groups[1]);
  }
  return names;
}

/** Old names already covered by a [FormerlySerializedAs] attribute. */
function preservedNames(source) {
  const names = new Set();
  for (const hit of io.findAll(source, /FormerlySerializedAs\s*\(\s*"([^"]+)"/g)) {
    names.add(hit.groups[1]);
  }
  return names;
}

io.run((payload) => {
  const file = io.targetFile(payload);
  if (!file || !file.toLowerCase().endsWith(".cs")) return null;
  if (!unity.findProjectRoot(io.path.dirname(file)) && !unity.findProjectRoot(payload.cwd)) return null;

  const before = io.currentContent(payload);
  if (!before) return null; // a new file has no serialized data to lose

  const { text: after, whole } = io.prospectiveContent(payload);
  if (!whole || !after) return null;

  const had = serializedFields(before);
  const has = serializedFields(after);
  const preserved = preservedNames(after);

  const lost = [...had].filter((name) => !has.has(name) && !preserved.has(name));
  if (!lost.length) return null;

  const added = [...has].filter((name) => !had.has(name));
  const list = lost.map((name) => `\`${name}\``).join(", ");
  const guess =
    added.length && added.length <= lost.length + 2
      ? ` The new names in this edit are ${added.map((n) => `\`${n}\``).join(", ")}.`
      : "";

  return io.ask(
    `This edit removes the serialized field name${lost.length > 1 ? "s" : ""} ${list}.${guess}\n\n` +
      "Unity keys serialized data by field name, so any value already set on a scene " +
      "object, prefab or asset for " +
      (lost.length > 1 ? "these fields" : "this field") +
      " is dropped on the next deserialize and comes back as the type default. " +
      "Nothing errors — it surfaces later as a zero or an unassigned reference.\n\n" +
      "If this is a rename and the field has data in the project, add " +
      `\`[FormerlySerializedAs("${lost[0]}")]\` above the new declaration ` +
      "(`using UnityEngine.Serialization;`) in this same edit. If the field is genuinely " +
      "being deleted, or never had data set, this is fine as written."
  );
});
