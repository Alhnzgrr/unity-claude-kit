# Unity Kit for Claude Code

A `.claude/` you drop into a Unity project. From the next session on, Claude
knows what the project actually is, cannot text-edit your scenes and prefabs,
and reviews every C# file it writes for the costs a general C# reading of the
file has no reason to notice.

```bash
git clone https://github.com/Alhnzgrr/unity-claude-kit.git
node unity-claude-kit/install.js "C:/Path/To/YourUnityProject"
```

Then restart the session in that project. Nothing is installed globally, nothing
is copied into `Assets/`, and the whole setup is committed with the repository,
so everyone who clones it gets the same rules.

Requires Node.js on `PATH`, which Claude Code's own install already provides.

```
YourUnityProject/
└── .claude/
    ├── CLAUDE.md        loaded every session — the rules and the division of labour
    ├── settings.json    wires the hooks onto Write, Edit and Bash
    ├── rules/           loaded only when Claude touches a matching file
    ├── hooks/           six guardrails
    ├── skills/          nine Unity references, loaded when the work needs them
    └── agents/          three read-only reviewers
```

`install.js` is safe to re-run and safe on a project that already has a
`.claude/`. It records what it wrote in `.claude/.unity-kit.json` and only ever
replaces files on that list — your own agent or rule with the same name is left
alone and reported. Your `settings.json` is merged, not overwritten, and backed
up first.

<details>
<summary>Prefer it installed once for every project? There is a plugin form.</summary>

```bash
claude plugin marketplace add Alhnzgrr/unity-claude-kit
claude plugin install unity-kit@unity-claude-kit
```

Same hooks, same skills, same agents, from the same files. What the plugin
cannot do is `CLAUDE.md`: a plugin's instructions have to be a skill, and a
skill loads when it is relevant rather than every session. If you want the rules
always on, install into the project.

</details>

---

## It reads the project instead of guessing

The first thing a model does in an unfamiliar Unity repository is assume — the
editor version, the render pipeline, whether input goes through the new package
or the old one — and it assumes from whatever was most common in its training
data, which for Unity means code several years out of date.

At session start a hook reads `ProjectVersion.txt`, `manifest.json` and
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

Everything else reads those same facts. `FindObjectOfType` is only reported as
obsolete in a Unity 6 project. Legacy `Input` is only refused when
`activeInputHandler` is `1`, where it genuinely throws at runtime — in a project
that still has the old backend it is correct code and the hook says nothing.

A rule that is wrong some of the time gets switched off all of the time.

## It refuses the edits that break things silently

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
surfaced, and what to do instead — and points at the `editor-handoff` skill,
which turns the change into a checklist precise enough for a person to follow in
the Editor.

That division has a side effect worth having: in a repository built this way,
"the scenes and prefabs were wired by a person" is a fact you can check rather
than a claim in a README.

## It reviews the C# it just wrote

After every write to a `.cs` file, a hook reads the result back and reports what
is wrong with it *as Unity code*, attached to the tool result while the file is
still in mind:

```
- Assets/Scripts/Enemy.cs:34 — `GetComponent<Rigidbody>` runs every frame inside
  `Update`. Resolve the component once in Awake and cache it in a field.
- Assets/Scripts/Enemy.cs:41 — Comparing `Vector3.Distance` against a threshold
  takes a square root for nothing. Compare `(a - b).sqrMagnitude` against the
  squared threshold.
- Assets/Scripts/Enemy.cs:52 — `async void DoWork` cannot be awaited and its
  exceptions are unobservable — a throw inside it is lost.
```

It blocks nothing. Comments and string literals are stripped before matching, so
a rule written in a doc comment does not trip its own check.

---

## What loads, and when

Three tiers, so the always-on cost stays small:

**`CLAUDE.md` — every session, ~120 lines.** The division of labour between you
and the Editor, ten hard rules, and a table of what to reach for when. Open it
after installing and fill in the bracketed lines at the top: your DI container,
your async library, where your code lives. A vague CLAUDE.md is the one that
gets ignored.

**`rules/` — only when Claude touches a matching file.** Each rule carries
`paths:` frontmatter, so nothing is in context until it is relevant:

| Rule | Loads when Claude reads |
| --- | --- |
| `serialized-assets.md` | a `.unity`, `.prefab`, `.asset`, `.meta`, `.mat` or `.controller` — how to read fileIDs, GUIDs and `m_Modifications`, and what to do instead of writing |
| `editor-code.md` | anything under `Editor/` — `SerializedProperty`, Undo, domain reload, `OnInspectorGUI` cost |
| `tests.md` | a test file — edit mode first, test assemblies, what is worth testing |
| `assembly-definitions.md` | an `.asmdef` — references, platforms, `noEngineReferences`, what adding the first one does |
| `shaders.md` | a `.shader` or `.hlsl` — pipeline mismatch, `UnityPerMaterial` and the SRP Batcher, variant explosion |

**`skills/` — when the work calls for them,** or by name as `/serialization`,
`/performance`, and so on:

`editor-handoff` · `project-report` · `serialization` · `performance` ·
`architecture` · `async-and-lifetime` · `input` · `testing` · `dots`

**`agents/` — each in its own context, with read-only tools.** The model that
wrote the code is the worst available judge of it.

- `code-reviewer` — serialization, lifecycle, editor/runtime split, API currency
  for this project's editor version
- `performance-auditor` — per-frame cost, plus the measurement plan that would
  confirm or kill each finding
- `architect` — plans a feature against the project's existing patterns,
  including the Editor work the plan implies

---

## Verification

Hooks that have never been seen to fire are decoration.

```bash
node tests/run.js        # 98 assertions — the hooks
node tests/install.js    # 31 assertions — the install
```

The hook suite runs each hook as a child process with a real payload on stdin,
against fixture Unity projects built on disk — including the
`ProjectVersion.txt` and `ProjectSettings.asset` the hooks read, because a test
that stubs that reading would not be testing what ships. It covers what each
hook refuses, what it allows, and what it must stay quiet about: a rule
mentioned in a comment, a variable whose name ends in `Input`, a
`#if UNITY_EDITOR` guard that does not cover the line, an
`#if UNITY_EDITOR || UNITY_STANDALONE` that guarantees nothing, a
`WaitForSeconds` cached in a field, an edit mode test assembly that references
`UnityEditor` legitimately, and an API obsolete in Unity 6 but current in 2021.
Every hook is also checked for exiting `0` on empty stdin, malformed input, and
a payload naming no file — a guardrail that crashes must get out of the way
rather than block every edit in the session.

The install suite builds a Unity project that already has its own
`settings.json`, its own `code-reviewer` agent and an unrelated `env` key, then
installs, runs the installed hooks from where they landed, and installs again.
It asserts the project's own files survive, the hook entries do not stack, and
an unparseable `settings.json` stops the install rather than being overwritten.

Three of the cases in those suites came from running the hooks over real Unity
projects rather than from writing tests:

- An edit mode test assembly has no `Editor` folder in its path, so the plugin
  reads the nearest `.asmdef` for `includePlatforms: ["Editor"]` instead of
  matching on folder names.
- Matching paths absolutely meant a project checked out under a folder named
  `Temp` switched its own guardrails off.
- The first dry run of `install.js` against a real project was about to
  overwrite a hand-written `code-reviewer` agent. That is why the installer
  keeps a manifest: "replaces the files it owns" has to mean something
  checkable.

**Not verified here:** the hooks firing inside a live Claude Code session. They
are verified by direct execution, the installed layout is verified end to end,
and the plugin form installs and validates (`claude plugin validate .`). The
one-step check after installing: restart the session and ask for an edit to any
`.prefab`.

---

## Deliberately not included

- **A folder-name architecture rule.** Refusing `UnityEngine` inside `Core/`
  only works in projects with a folder called `Core`. The boundary that is real
  is the assembly definition, which the compiler already enforces; the
  `architecture` skill argues for drawing it.
- **A formatter or a style rule set.** Naming, `var`, braces — those belong to
  the project. Put them in your `CLAUDE.md`, which is yours after install.
- **Anything that edits scenes or prefabs for you.** That is the one thing this
  kit exists to prevent.

## Related

[unity-ai-workflow-kit](https://github.com/Alhnzgrr/unity-ai-workflow-kit) is
the tool-agnostic version: the same engineering rules as portable Markdown with
adapters for Claude, Codex and Cursor. This repository is the Claude-native
one — it gives up portability and spends it on hooks that read the project and
refuse things.

MIT licensed.
