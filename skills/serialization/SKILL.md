---
name: serialization
description: How Unity serialization actually behaves — what gets saved, field renames and FormerlySerializedAs, .meta files and GUIDs, prefab overrides, ScriptableObject instances. Use when adding or changing serialized fields, moving assets, or debugging a value that reset itself.
---

# Serialization

Unity's serializer is the reason most "it worked yesterday" bugs in a Unity
project are not code bugs. It fails silently by design: a value it cannot match
is not an error, it is a default.

## What Unity serializes

A field is serialized when it is `public`, or `private`/`protected` with
`[SerializeField]`, **and** its type is serializable, **and** it is not `static`,
`const` or `readonly`.

Not serialized, whatever you annotate them with:

- Properties, including auto-properties. `[field: SerializeField]` works because
  it puts the attribute on the generated backing field — that is a different
  thing from serializing the property.
- `Dictionary<,>`. Use two lists, a serializable pair type, or
  `ISerializationCallbackReceiver`.
- Interfaces and `object`. A field typed as an interface serializes as nothing.
  Type it as the concrete class, or as `UnityEngine.Object` plus a runtime cast,
  or use `[SerializeReference]`, which does handle polymorphism at the cost of a
  per-instance type record.
- `null` for a plain (non-`UnityEngine.Object`) class field. Unity replaces it
  with a default-constructed instance on deserialize, so a nullable nested class
  is not nullable after a domain reload.

## Renames drop data

Serialized values are keyed by field name. Rename `speed` to `moveSpeed` and
every value already set in every scene, prefab and asset is dropped on the next
deserialize; the field comes back as `0`. Nothing errors, nothing logs.

```csharp
using UnityEngine.Serialization;

[FormerlySerializedAs("speed")]
[SerializeField] private float moveSpeed = 3.5f;
```

The attribute has to land in the same change as the rename, before anyone opens
the project. Once someone saves a scene with the new name unmatched, the old
value is gone from that file and the attribute has nothing left to recover.

Leave it in place for at least one release cycle. It is cheap, and removing it
early re-creates the bug for anyone on an older branch.

The same applies to renaming the **class**: a MonoBehaviour reference is a script
GUID plus a class name, so renaming the type without renaming the file, or moving
it between assemblies, can produce a missing script on every instance.

## .meta files and GUIDs

Every asset under `Assets/` has a `.meta` beside it holding a GUID. Every
reference anywhere in the project — a prefab pointing at a script, a scene
pointing at a material, an asset pointing at another asset — is that GUID, not
the path.

What follows from that:

- Moving or renaming an asset **in the Editor** keeps the GUID, so references
  survive.
- Moving it in a shell or a file browser without the `.meta` gives it a new GUID
  on reimport. Every reference to it becomes a missing reference, across every
  scene and prefab, at once.
- Deleting only the `.meta` does the same to an asset that never moved.
- `.meta` files belong in version control. A repository that ignores them
  produces different GUIDs on every machine.

## Prefabs

- A change to a prefab instance in a scene is an **override**, stored in the
  scene, on that instance. It does not reach the other instances, and it survives
  changes to the prefab — which is usually the surprise.
- A newly added serialized field appears on instances at its default, not at the
  value the prefab asset holds, until the prefab asset is saved with it.
- Nested and variant prefabs resolve overrides from the base up. Two layers of
  override on one field is a bug waiting to be found by someone else.

Check the Overrides dropdown in the inspector before concluding that the value in
the prefab is the value that runs.

## ScriptableObjects

- A ScriptableObject asset is **one instance, shared**. A field mutated at
  runtime stays mutated in the editor after play mode ends, and resets in a
  build. Treat them as read-only configuration unless you mean otherwise.
- `[CreateAssetMenu]` is what makes an asset creatable from the Project window;
  without it the type is only usable from code.
- Deleting the C# class orphans every asset of that type: the assets keep their
  data and show as a missing script. This is why a script's `.meta` matters as
  much as the script.

## When a value resets itself

Work through it in this order, because each step is cheaper than the next:

1. Was the field renamed, or its type changed, in a recent commit?
2. Is the value set on the prefab asset, or only as an override on one instance?
3. Is something writing it at runtime — an `Awake`, an `OnValidate`, a
   ScriptableObject mutated in play mode?
4. Is the field serialized at all? (Property? `readonly`? Interface-typed?)
5. Did the file move outside the Editor?
