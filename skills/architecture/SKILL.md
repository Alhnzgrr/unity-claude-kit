---
name: architecture
description: Structuring Unity code — assembly definitions, composition over singletons, keeping logic testable outside play mode, ScriptableObjects as configuration, and what belongs in a MonoBehaviour. Use when adding a system, wiring dependencies, or asked how to organise a Unity project.
---

# Architecture

The constraint that shapes everything else: Unity owns object construction. You
never call `new` on a MonoBehaviour, so constructor injection does not exist and
every dependency arrives through the inspector, through a lookup, or through
something you wrote. Which of those you pick is most of the architecture.

## Assembly definitions first

An `.asmdef` is the only real boundary Unity offers. Without one, everything
compiles into `Assembly-CSharp`: every script change recompiles the project,
nothing can reference anything selectively, and nothing can be tested without
starting the editor.

A layout that pays for itself in a project of any size:

```
Assets/Scripts/
  Core/        Game.Core.asmdef          no UnityEngine reference at all
  Gameplay/    Game.Gameplay.asmdef      references Core
  Presentation/Game.Presentation.asmdef  references Core, Gameplay
  Editor/      Game.Editor.asmdef        Editor platform only
Tests/
  EditMode/    Game.Tests.EditMode.asmdef
  PlayMode/    Game.Tests.PlayMode.asmdef
```

`Core` holding rules, state and calculations with no `UnityEngine` reference is
the highest-value line to draw. It makes that code testable in milliseconds in
edit mode, and it makes the dependency direction a compiler error rather than a
convention.

The `Editor` assembly must set Platforms to Editor only. That is what stops
editor code reaching a player build — a stronger guarantee than `#if
UNITY_EDITOR` scattered through files.

## Composition over singletons

`Singleton<T>` with a static `Instance` is the default answer in Unity and it is
usually the wrong one. It hides dependencies from the signature, ties every
consumer to one implementation, keeps state across play sessions in the editor,
and makes ordering an emergent property of which `Awake` ran first.

Prefer, roughly in this order:

1. **A serialized reference.** The dependency is visible in the inspector, the
   wiring is data, and a missing one is a null you can report by name at `Awake`.
2. **A composition root**: one object per scene that builds the graph and hands
   the pieces to what needs them. Explicit, ordered, and testable.
3. **A ScriptableObject** that both sides reference — good for configuration and
   for event channels between objects that must not know each other.
4. **A DI container** (VContainer, Zenject) once the graph is large enough that
   the composition root is doing real work. Not before.

If a singleton is genuinely right — one audio service, one save system — keep the
static as a *locator for a plain C# object*, not as a MonoBehaviour that also
contains the logic. Then the logic is still testable.

## What belongs in a MonoBehaviour

Almost nothing. A MonoBehaviour is an adapter: it receives Unity's lifecycle and
its inspector values, and forwards to plain C# that knows nothing about Unity.

```csharp
public sealed class PlayerController : MonoBehaviour
{
    [SerializeField] private PlayerConfig config;
    [SerializeField] private Rigidbody body;

    private PlayerMovement movement;   // plain C#, unit-testable

    private void Awake() => movement = new PlayerMovement(config.ToSettings());

    private void FixedUpdate()
    {
        var velocity = movement.Step(ReadInput(), Time.fixedDeltaTime);
        body.linearVelocity = velocity;
    }
}
```

`PlayerMovement` is testable in edit mode in milliseconds. `PlayerController` is
five lines you read once.

## ScriptableObjects as configuration

Tunable numbers belong in assets, not in fields on prefabs scattered through
scenes. One `EnemyConfig` asset per enemy type means a designer changes balance
without touching a scene, and a diff on a balance change is readable.

Two cautions, both from the same fact — the asset is one shared instance:

- Never mutate one at runtime unless you mean every user of it to see the change,
  and know that the change persists in the editor after play mode ends.
- Copy the values into a plain struct at `Awake` if the runtime needs its own
  mutable state.

## Dependency direction

Draw the arrows once and keep them:

```
Presentation  ->  Gameplay  ->  Core
     (views)      (systems)     (rules, state, data)
```

Nothing points back. `Core` does not know a view exists; `Gameplay` raises events
and `Presentation` listens. When an arrow needs to reverse, it is almost always a
missing event or a misplaced piece of logic, not a reason to add a reference.

Assembly definitions turn that diagram into something the compiler enforces,
which is the only kind of architecture documentation that stays true.

## Null checks

A dependency guaranteed by construction does not need a defensive null check at
every use — a check that silently returns turns a wiring mistake into a feature
that quietly does nothing. Validate once, at `Awake`, and fail loudly:

```csharp
private void Awake()
{
    if (config == null)
        Debug.LogError($"{nameof(config)} is not assigned on {name}", this);
}
```

The `this` argument makes the object clickable in the Console, which is the
difference between a two-minute fix and a twenty-minute search.
