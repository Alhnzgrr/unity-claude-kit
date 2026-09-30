---
name: testing
description: Testing Unity code — edit mode versus play mode, test assembly definitions, making logic testable without the engine, and what is worth testing in a game. Use when adding tests, setting up the Test Framework, or asked whether something is testable.
---

# Testing

Most Unity code is untestable for one reason: the logic is inside a
MonoBehaviour, so exercising it requires a scene, a play mode entry, and a frame.
The fix is not a testing framework. It is moving the logic out.

## Edit mode or play mode

**Edit mode** tests run in the editor with no scene, no frame, no play mode
entry. They complete in milliseconds. Everything that is plain C# — damage
formulas, state machines, inventory rules, save serialisation, pathfinding
maths — belongs here.

**Play mode** tests enter play mode, run frames, and cost seconds each. They are
worth it for what genuinely needs the engine: physics behaviour, animation
events, scene loading, a coroutine sequence, an integration path through several
components.

A suite that is mostly play mode tests is usually a suite that never gets run.

## Assemblies

Tests need their own assembly definitions, referencing the code under test plus
`UnityEngine.TestRunner` and `UnityEditor.TestRunner`, with `nunit.framework.dll`
as an assembly reference and **Test Assemblies** ticked.

```
Tests/EditMode/  Game.Tests.EditMode.asmdef   Editor platform only
Tests/PlayMode/  Game.Tests.PlayMode.asmdef   any platform
```

The Editor-only platform on the edit mode assembly is what keeps tests out of the
player build.

If the project has no `.asmdef` at all, that is the first thing to fix — test
assemblies cannot reference `Assembly-CSharp` cleanly, and without assemblies
there is nothing to isolate.

## Make it testable by moving it

```csharp
// Untestable: needs a GameObject, a scene, and a frame.
public class Health : MonoBehaviour
{
    public int current;
    public void TakeDamage(int amount, float armour)
    {
        current -= Mathf.Max(1, Mathf.RoundToInt(amount * (1f - armour)));
        if (current <= 0) Destroy(gameObject);
    }
}

// Testable: a value type with rules, and an adapter that owns the engine call.
public readonly struct Damage
{
    public static int After(int amount, float armour) =>
        Mathf.Max(1, Mathf.RoundToInt(amount * (1f - Mathf.Clamp01(armour))));
}
```

`Damage.After` is testable in an edit mode test with no setup at all, including
the cases that matter: zero armour, full armour, armour above 1, a rounding
boundary, the minimum-one-damage rule.

## What is worth testing in a game

Test the things that are **wrong in a way nobody notices**:

- Damage, cost, reward and progression formulas. Off-by-one in a level curve is
  invisible in play and obvious in a test.
- State machines: every transition, especially the ones that should not happen.
- Save and load round-trips, including a save from the previous version.
- Inventory, currency, and anything involving a limit or a stack size.
- Parsing and validation of data assets.

Do not write tests for: whether Unity calls `Start`, whether a serialized field
holds the value you typed into the inspector, or the exact output of a physics
step. The first two test the engine; the third tests a number that is allowed to
change.

## Play mode tests that behave

```csharp
[UnityTest]
public IEnumerator Projectile_hits_target_within_two_seconds()
{
    var scene = SceneManager.LoadSceneAsync("TestRange", LoadSceneMode.Additive);
    yield return scene;

    var target = Object.FindFirstObjectByType<Target>();
    yield return new WaitForSeconds(2f);

    Assert.IsTrue(target.WasHit);
    yield return SceneManager.UnloadSceneAsync("TestRange");
}
```

- A dedicated test scene, loaded additively and unloaded at the end. Tests that
  depend on the main scene break every time a designer touches it.
- `yield return null` for one frame; `WaitForSeconds` only when the thing being
  tested is genuinely time-based.
- Clean up what you create. The Test Runner does not reset the scene between
  tests in the same assembly.

## Running them

- Window > General > Test Runner, or `-runTests -testPlatform EditMode` on the
  command line for CI.
- CI needs a licence activation step and `-batchmode -nographics`; play mode
  tests need graphics on some platforms.
- Test results land in an NUnit XML file that most CI systems read directly.
