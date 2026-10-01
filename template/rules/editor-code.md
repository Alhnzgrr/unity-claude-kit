---
paths:
  - "**/Editor/**/*.cs"
  - "**/*Editor.cs"
  - "**/*Drawer.cs"
  - "**/*Window.cs"
---

# Editor code

This file compiles into an editor assembly and does not ship. Different rules
apply here than in runtime code.

- **The assembly is the guarantee, not the folder name.** An `Editor/` folder
  gets an implicit editor assembly only while no `.asmdef` above it says
  otherwise. In a project that uses assembly definitions, editor code needs one
  with `"includePlatforms": ["Editor"]`.
- **`[CustomEditor]` wants `[CanEditMultipleObjects]`** unless there is a reason
  it cannot support a multi-selection. Without it, selecting two objects shows
  nothing and nobody knows why.
- **Go through `SerializedProperty` and `serializedObject`,** not the target's
  fields. Direct field writes skip Undo, skip the dirty flag, are lost on the
  next reload, and do the wrong thing on a prefab instance. The shape is
  `serializedObject.Update()` … `ApplyModifiedProperties()`.
- **Mutating an asset outside a property drawer** needs `Undo.RecordObject`
  before and `EditorUtility.SetDirty` after, plus `AssetDatabase.SaveAssets`
  for an asset file.
- **`OnInspectorGUI` runs constantly.** No scene searches, no `AssetDatabase`
  queries, no allocation per repaint. Cache in `OnEnable`.
- **`[InitializeOnLoad]` runs on every domain reload,** which means every
  script compile. Keep it to registration; anything slow there is paid on every
  save.
- **Editor state does not survive a domain reload.** A static field set by a
  button click is gone after the next compile. Persist with `EditorPrefs` or a
  `ScriptableSingleton`.

For the runtime side of the boundary, see the `architecture` skill.
