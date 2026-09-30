# Unity Kit for Claude Code

A Claude Code plugin that reads your Unity project before it writes anything,
refuses the edits that break serialized assets, and reviews every C# file it
writes for the costs a general C# reading of the file has no reason to notice.

```bash
claude plugin marketplace add Alhnzgrr/unity-claude-kit
claude plugin install unity-kit@unity-claude-kit
```

That is the whole installation. No script to run against the project, nothing
copied into `Assets/`, nothing to keep in sync. Restart the session and it is on.

Requires Node.js on `PATH`, which Claude Code's npm install already provides.

---

## What it actually does

### It reads the project instead of guessing

The first thing a model does in an unfamiliar Unity repository is assume — the
editor version, the render pipeline, whether input goes through the new package
or the old one — and it assumes from whatever was most common in its training
data, which for Unity means code several years out of date.

At session start this plugin reads `ProjectVersion.txt`, `manifest.json` and
`ProjectSettings.asset` and puts the answers in context:

```
## Unity project

- Editor: 6000.3.3f1 (URP render pipeline)
- Input: both backends
- Packages of note: Input System 1.17.0, Entities (DOTS) 1.4.4, Netcode for Entities 1.10.0
- 48 direct package dependencies
- No assembly definitions: all runtime code compiles into Assembly-CSharp
- Assets/: GameFolders, Resources, Settings
```

Everything else in the plugin reads those same facts. `FindObjectOfType` is only
reported as obsolete in a Unity 6 project. Legacy `Input` is only refused when
`activeInputHandler` is `1`, where it genuinely throws at runtime — in a project
that still has the old backend it is correct code and the hook says nothing. A
rule that is wrong some of the time gets switched off all of the time.

### It refuses the edits that break things silently

| Refused | Why |
| --- | --- |
| Text edits to `.unity`, `.prefab`, `.asset`, `.mat`, `.controller`, … | The meaning lives in fileIDs and GUIDs, not in the text. An edit that reads correctly can detach a reference that surfaces days later, in a different file, as a missing script |
| Any edit to a `.meta` file | The GUID in it is the identity every scene and prefab points at. Hand-writing one orphans every reference to that asset at once |
| Text edits to `ProjectSettings/*.asset` | Several fields are index-based, so a hand edit shifts unrelated settings |
| `UnityEditor` in a runtime assembly with no `UNITY_EDITOR` guard | The editor assembly does not ship in a player build. It compiles, runs in play mode, and breaks on build day |
| The legacy `Input` class when the player is Input System only | Throws `InvalidOperationException` the first time the line runs |

And two it asks about rather than refusing, because the answer depends on
something only the person with the project open knows:

- **A serialized field losing its name.** Unity keys serialized data by field
  name, so a rename drops every value already set in every scene and prefab, and
  the field comes back as `0` with no error anywhere. The question names the
  field and offers the `[FormerlySerializedAs]` line.
- **`rm` or `mv` on anything under `Assets/` in a shell.** An asset and its
  `.meta` have to move together or the GUID changes and every reference breaks.

A refusal is not a dead end. Each one explains what breaks, when it would have
surfaced, and what to do instead — and points at `/unity-kit:editor-handoff`,
which turns the change into a checklist precise enough for a person to follow in
the Editor.

That division has a side effect worth having: in a repository built this way,
"the scenes and prefabs were wired by a person" is a fact you can check rather
than a claim in a README.

### It reviews the C# it just wrote

After every write to a `.cs` file, a hook reads the result back and reports what
is specifically wrong with it *as Unity code*, attached to the tool result while
the file is still in mind:

```
- Assets/Scripts/Enemy.cs:34 — `GetComponent<Rigidbody>` runs every frame inside
  `Update`. Resolve the component once in Awake and cache it in a field.
- Assets/Scripts/Enemy.cs:41 — Comparing `Vector3.Distance` against a threshold
  takes a square root for nothing. Compare `(a - b).sqrMagnitude` against the
  squared threshold.
- Assets/Scripts/Enemy.cs:52 — `async void DoWork` cannot be awaited and its
  exceptions are unobservable — a throw inside it is lost.
```

It blocks nothing. It covers per-frame allocation and lookups, `Camera.main` and
scene searches in `Update`, string-based `Invoke`/`SendMessage`, uncached
`WaitForSeconds`, `.tag ==`, `Resources.Load`, empty lifecycle methods Unity
still calls, and APIs obsolete in the project's own editor version.

Comments and string literals are stripped before matching, so a rule written in a
doc comment does not trip its own check.

---

## Skills

Loaded when the work needs them, and runnable by name.

| Skill | |
| --- | --- |
| `/unity-kit:editor-handoff` | Turns a change into the exact Editor steps a person performs — object paths, values, and what they should see when it is right. The counterpart to the hooks that refuse scene edits |
| `/unity-kit:project-report` | What this project actually is, and what is wrong with it: assembly layout, input backend, tracked `Library/`, scenes missing from the build list |
| `serialization` | What Unity serializes and what it silently does not, renames and `FormerlySerializedAs`, `.meta` and GUIDs, prefab overrides, ScriptableObject sharing |
| `performance` | Measure first; then allocation, the Update tax, draw calls, physics, mobile |
| `architecture` | Assembly definitions as the only real boundary, composition over singletons, keeping logic testable outside play mode |
| `async-and-lifetime` | Coroutines vs `Awaitable` vs UniTask, cancellation tied to object lifetime, `async void`, the domain-reload trap |
| `input` | Which backend the project is on, action assets vs direct device reads, enable/disable pairing, rebinding |
| `testing` | Edit mode vs play mode, test assemblies, and what is worth testing in a game |
| `dots` | Systems and jobs, `[BurstCompile]` on the struct, structural change and command buffers, `ComponentLookup` aliasing, baking |

## Agents

Each runs in its own context with read-only tools. The model that just wrote the
code is the worst available judge of it.

- `unity-kit:code-reviewer` — serialization, lifecycle, editor/runtime split,
  API currency for this project's editor version
- `unity-kit:performance-auditor` — per-frame cost, plus the measurement plan
  that would confirm or kill each finding
- `unity-kit:architect` — plans a feature against the project's existing
  patterns, including the Editor work the plan implies

---

## Verification

Hooks that have never been seen to fire are decoration. These are tested by
running each one as a child process with a real payload on stdin, against
fixture Unity projects built on disk — including the `ProjectVersion.txt` and
`ProjectSettings.asset` the hooks read, because a test that stubs that reading
would not be testing what ships.

```bash
node tests/run.js      # 98 assertions
```

The suite covers what each hook refuses, what it allows, and what it must stay
quiet about: a rule mentioned in a comment, a variable whose name ends in
`Input`, a `#if UNITY_EDITOR` guard that does not cover the line, an
`#if UNITY_EDITOR || UNITY_STANDALONE` that guarantees nothing, a
`WaitForSeconds` cached in a field, an edit mode test assembly that references
`UnityEditor` legitimately, and an API obsolete in Unity 6 but current in 2021.
Every hook is also checked for exiting `0` on empty stdin, malformed input, and a
payload naming no file — a guardrail that crashes must get out of the way rather
than block every edit in the session.

Two of those cases came out of running the hooks over three real Unity projects
rather than out of the test file: an edit mode test assembly has no `Editor`
folder in its path, so the plugin reads the nearest `.asmdef` for
`includePlatforms: ["Editor"]` instead of matching on folder names; and matching
paths absolutely meant a project checked out under a folder named `Temp`
switched its own guardrails off.

**Not verified here:** the hooks firing inside a live Claude Code session. They
are verified by direct execution and the plugin installs and validates
(`claude plugin validate .`), but the in-session path was not exercised. The
one-step check: install, restart the session in a Unity project, and ask for an
edit to any `.prefab`.

---

## Deliberately not included

- **A folder-name architecture rule.** Refusing `UnityEngine` inside `Core/` only
  works in projects with a folder called `Core`. The boundary that is real is the
  assembly definition, which the compiler already enforces; the `architecture`
  skill argues for drawing it.
- **A formatter or a style rule set.** Those belong to the project, not to a
  Unity plugin.
- **Anything that edits scenes or prefabs for you.** That is the one thing this
  plugin exists to prevent.

## Related

[unity-ai-workflow-kit](https://github.com/Alhnzgrr/unity-ai-workflow-kit) is the
tool-agnostic version: the same engineering rules as portable Markdown with
adapters for Claude, Codex and Cursor. This repository is the Claude-native one —
it gives up portability and spends it on hooks that read the project and refuse
things.

MIT licensed.
