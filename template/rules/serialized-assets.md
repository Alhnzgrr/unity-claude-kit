---
paths:
  - "**/*.unity"
  - "**/*.prefab"
  - "**/*.asset"
  - "**/*.meta"
  - "**/*.controller"
  - "**/*.mat"
---

# Reading a serialized asset

You are reading a file Unity wrote. Read it, do not write it — a hook refuses
the write, and the refusal is the cheaper of the two outcomes.

## What you are looking at

- `fileID` is an object's id **within one file**. The same number in two files
  means nothing.
- `guid` identifies an **asset**, and lives in that asset's `.meta`. Every
  cross-file reference is a `{fileID, guid}` pair.
- `m_Script: {fileID: 11500000, guid: ...}` is the component's C# class. The
  `11500000` is the constant for a MonoScript; the guid is the one in the
  matching `.cs.meta`.
- A field missing from the YAML is not unset — it is at its default, because
  Unity omits defaults. Absence is not evidence.
- On a prefab instance, `m_Modifications` is the override list. The value that
  runs is the prefab's, overridden by anything listed there.

## Useful things to extract

- Which objects carry a given script: take the guid from its `.cs.meta` and
  grep it across `*.prefab` and `*.unity`.
- Whether a serialized field is assigned anywhere, before concluding that a
  null at runtime is a code bug rather than a wiring one.
- An object's hierarchy path, by following `m_Father` up the transforms.

## What to do instead of editing

Write the change as Editor steps with the `editor-handoff` skill. Name the
object by its hierarchy path and the asset by its project path — both of which
you can read out of this file.
