---
name: project-report
description: Report what this Unity project actually is — editor version, render pipeline, input backend, packages, assembly layout, scenes, and the state of the plugin's own guardrails. Use when starting on an unfamiliar Unity project or when checking that the plugin is wired.
---

# Project report

Read the project and report it. Do not guess any of these; read the file named
for each one.

## Read

| What | Where |
| --- | --- |
| Editor version | `ProjectSettings/ProjectVersion.txt` -> `m_EditorVersion` |
| Render pipeline | `Packages/manifest.json` -> `com.unity.render-pipelines.universal` / `.high-definition`, else Built-in |
| Input backend | `ProjectSettings/ProjectSettings.asset` -> `activeInputHandler` (0 legacy, 1 Input System, 2 both) |
| Colour space, API level, backend | `ProjectSettings/ProjectSettings.asset` |
| Packages | `Packages/manifest.json` -> `dependencies` |
| Assembly layout | every `*.asmdef` under `Assets/` |
| Scenes in the build | `ProjectSettings/EditorBuildSettings.asset` |
| Script count and shape | `*.cs` under `Assets/`, excluding `Plugins/` |
| Version control mode | `ProjectSettings/VersionControlSettings.asset`; `.gitignore` for `Library/`, `Temp/`, `Logs/` |

## Report

Write it as a short table plus a findings list. The findings are the point;
the table is context for them.

Things worth reporting as findings:

- **No assembly definitions.** Everything compiles into `Assembly-CSharp`, so
  every script change recompiles the whole project and nothing can be tested
  without the editor. The first `.asmdef` is usually the highest-value change in
  a project of any size.
- **`activeInputHandler: 2`** with only one backend used in code — the project
  carries both input systems for no reason.
- **Editor version against package versions.** A package version that predates
  the editor's release usually means the manifest was copied from an older
  project.
- **`Library/` or `Temp/` tracked in git.** Multi-gigabyte, regenerated, and a
  constant source of conflicts.
- **Scenes not in `EditorBuildSettings`.** A scene that loads by name at runtime
  and is not in the build list works in the editor and fails in the build.
- **No `com.unity.test-framework`, or no test assemblies.** Say so plainly rather
  than recommending a testing strategy.

## Then check the plugin itself

- `/plugin` lists `unity` as enabled.
- Ask for an edit to any `.prefab` in the project and confirm it is refused. A
  guardrail nobody has seen fire is a guardrail nobody knows is off.
