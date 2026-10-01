---
paths:
  - "**/Tests/**/*.cs"
  - "**/*Tests.cs"
  - "**/*Test.cs"
---

# Tests

- **Edit mode by default.** It runs with no scene, no frame and no play mode
  entry, in milliseconds. Use play mode only for what genuinely needs the
  engine: physics behaviour, animation events, scene loading, a coroutine
  sequence. A suite that is mostly play mode tests is a suite nobody runs.
- **The test assembly is `"includePlatforms": ["Editor"]`** for edit mode, with
  `nunit.framework.dll` in `precompiledReferences` and Test Assemblies ticked.
- **Test the things that are wrong without anyone noticing**: damage and cost
  formulas, state machine transitions that should not happen, save and load
  round trips including a save from the previous version, limits and stack
  sizes, data asset validation.
- **Do not test the engine.** Whether Unity calls `Start`, whether a serialized
  field holds what was typed into the inspector, or the exact output of a
  physics step are not your tests.
- **Clean up.** The Test Runner does not reset the scene between tests in one
  assembly. Load a dedicated test scene additively and unload it at the end;
  destroy what you create.
- **`[UnityTest]` returns `IEnumerator`.** `yield return null` advances one
  frame; `WaitForSeconds` only when the thing under test is time-based.
- **If the code under test needs a GameObject, that is the finding.** Say so.
  The fix is usually to move the logic into a plain C# class, not to build more
  scaffolding around it.

The `testing` skill has the assembly layout and the CI invocation.
