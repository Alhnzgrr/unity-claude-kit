---
paths:
  - "**/*.asmdef"
  - "**/*.asmref"
---

# Assembly definitions

This is the only real boundary Unity offers, and the only architecture
documentation that cannot go out of date, so changes here are worth care.

- **`name` must match the file name**, and the file must be the only `.asmdef`
  in its folder. That folder and everything under it, down to the next
  `.asmdef`, is the assembly.
- **`references` uses assembly names.** The GUID form is also valid; keep the
  project consistent with whichever it already uses. A reference that is not
  listed is a compile error, which is the point of the whole mechanism.
- **Circular references are rejected.** When one appears, the fix is an
  interface in the lower assembly with the implementation in the higher one, or
  an event — not another reference.
- **`includePlatforms: ["Editor"]`** is what keeps editor code out of a player
  build, and it is stronger than `#if UNITY_EDITOR` scattered through files.
- **`noEngineReferences: true`** on a core assembly is the strongest statement
  available: the code cannot touch `UnityEngine` at all, so it is testable in
  milliseconds and the dependency direction is enforced by the compiler.
- **`autoReferenced: false`** stops `Assembly-CSharp` picking the assembly up
  implicitly. Use it when the point is that consumers declare the dependency.
- **`defineConstraints`** compiles the assembly only when a define is present —
  the right way to make an integration optional.
- **Adding the first `.asmdef` to a project recompiles everything and surfaces
  every undeclared dependency at once.** Expect a wall of errors; that is the
  boundary being drawn, not a mistake. Do it deliberately, not as a side effect
  of another task.

The `architecture` skill has a layout worth copying.
