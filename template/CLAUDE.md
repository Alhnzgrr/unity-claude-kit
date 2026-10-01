# Unity project

<!-- Fill in the bracketed lines below for this project, then delete this comment.
     Everything else in this file applies to any Unity project. The three things
     worth the two minutes are the stack, the folder layout, and the language
     rule -- they are what a vague CLAUDE.md gets wrong. -->

- **Stack**: [DI: Zenject / VContainer / composition root / none] ·
  [async: UniTask / Awaitable / coroutines] · [tests: edit mode / play mode / none]
- **Code lives in**: [`Assets/_Project/`]
- **Language**: code, identifiers and commit messages in English.
  [Docs and chat: … ]

The editor version, render pipeline, input backend and installed packages are
read from the project and put in context at session start — do not guess them,
and do not re-derive them by reading `manifest.json` yourself.

## Division of labour

**You write code. The user does everything inside the Unity Editor.**

You do:

- `.cs`, `.asmdef`, and plain-text project files.
- Explain what the code does and why.
- Hand over an ordered checklist of the Editor work the change needs.

You do not:

- Edit `.unity`, `.prefab`, `.asset`, `.mat`, `.controller` or `.meta` files.
  A hook refuses these. The meaning in them lives in fileIDs and GUIDs, so an
  edit that reads correctly can detach a reference that surfaces days later, in
  a different file, as a missing script.
- Create scenes, GameObjects, components or asset instances.
- Assign inspector references, change Project Settings, install packages.
- Enter play mode or run tests.

This is a division of work, not a restriction on the task. When a change needs
Editor work, use the **`editor-handoff`** skill and write the checklist. Then
carry on with the C# side.

### Report honestly

You have not compiled or run anything. Never write "tests pass", "compiles
clean", or "verified" about code you only wrote. Say what you did — "wrote X" —
and then say plainly what still needs checking. If the user reports an error,
fix it and hand back a new checklist.

## Hard rules

These hold in every Unity project. The first four are enforced by hooks; the
rest are not, and are yours to keep.

1. **Never text-edit a serialized asset or a `.meta` file.** The Editor is the
   only safe writer.
2. **No `UnityEditor` in runtime code without `#if UNITY_EDITOR`** covering the
   line, including the `using`. It compiles, runs in play mode, and breaks on
   build day. An `Editor/` folder or an `includePlatforms: ["Editor"]` assembly
   is the better answer.
3. **Renaming a serialized field needs `[FormerlySerializedAs("oldName")]` in
   the same edit.** Unity keys serialized data by name; without it, every value
   already set in every scene and prefab is dropped and the field returns as the
   type default, with no error anywhere.
4. **Match the project's input backend.** The legacy `Input` class throws at
   runtime in a project built with the Input System backend alone.
5. **Nothing per-frame that can be done once.** `GetComponent`, `Camera.main`
   and scene searches belong in `Awake`, cached in a field.
6. **`OnEnable` and `OnDisable` are a pair.** Every `+=`, every action map
   `Enable()`, every `CancellationTokenSource` is created in one and undone in
   the other.
7. **No `async void`** outside a Unity event method — it cannot be awaited and
   its exceptions are lost. Every `await` in a MonoBehaviour takes a token tied
   to the object's lifetime.
8. **Dependencies are guaranteed at setup, not defended at runtime.** A
   `[SerializeField]`, an injected service or a `[RequireComponent]` component is
   never null-checked with a fallback — a missing reference is a wiring bug, and
   a silent fallback turns it into a feature that quietly does nothing. Validate
   once in `Awake` and log loudly with `this` as the context object. Null checks
   on genuinely optional values — raycast hits, `TryGetComponent`, dictionary
   lookups, deserialized data — are correct code, not defensive code.
9. **Logic belongs outside MonoBehaviours.** A MonoBehaviour adapts Unity's
   lifecycle and inspector to plain C# that can be constructed in a test. If the
   interesting part of a change cannot be exercised by an edit mode test, the
   design is not finished.
10. **Smallest change that does the job.** No speculative abstraction, no
    interface with one implementation, no spec or plan document unless asked.

## After you write C#

A hook reads the file back and reports Unity-specific problems in it — per-frame
costs, lifetime traps, APIs obsolete in this project's editor version. Those are
review comments, not errors. Fix the ones that apply, and say why if you are
leaving one.

## When to reach for what

| Situation | |
| --- | --- |
| The change needs Editor work | `editor-handoff` skill |
| Unfamiliar project, or checking the setup | `project-report` skill |
| Serialized fields, renames, `.meta`, prefab overrides | `serialization` skill |
| Frame rate, stutter, GC, draw calls, mobile | `performance` skill, then the `performance-auditor` agent |
| Where a new system goes, which assembly, what is a MonoBehaviour | `architecture` skill, or the `architect` agent for a whole feature |
| Delays, sequences, loading, cancellation | `async-and-lifetime` skill |
| Input handling | `input` skill |
| Adding tests, or "is this testable" | `testing` skill |
| ECS, systems, jobs, Burst | `dots` skill |
| A feature is written and about to be called done | `code-reviewer` agent |

The agents run in their own context with read-only tools. The model that wrote
the code is the worst available judge of it.

## How to work

- Verify a non-obvious API against the installed package version before writing
  against it. Unity's API moves, and the most common wrong answer is a correct
  answer from three versions ago.
- When intent is genuinely ambiguous, ask in a sentence. Do not guess, and do
  not write a document about it.
- Commit only when asked. Never push.
