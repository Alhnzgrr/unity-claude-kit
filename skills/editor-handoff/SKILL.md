---
name: editor-handoff
description: Write the exact Unity Editor steps a person must perform for a change — scene wiring, prefab edits, inspector references, ScriptableObject instances, project settings. Use whenever a task needs Editor work, and whenever a hook refuses an edit to a scene, prefab or asset.
---

# Editor handoff

Hooks in this plugin refuse text edits to scenes, prefabs and serialized assets.
That is not a dead end — it is a division of labour, and this skill is the other
half of it. The code is written here; the Editor work is written down precisely
enough that the person doing it never has to guess.

A handoff that says "add the component and hook up the references" is worthless.
The person has to reconstruct the design from the code. Write the one they can
follow without reading anything.

## What to produce

A numbered checklist, in the order the steps must happen, where each step names:

- **The object**: the full hierarchy path (`Level/Systems/SpawnDirector`), or the
  asset path (`Assets/Data/Enemies/Grunt.asset`). Not "the spawner object".
- **The action**: add component, set field, drag reference, create asset, change
  a setting. One action per step.
- **The value**: the literal value or the exact object to drag, and where that
  object is. `Waves` -> `Assets/Data/Waves/Forest.asset`, not "the wave data".
- **What it is for**, in a short clause, so a wrong value is noticed rather than
  entered.

End with a **verification** section: what the person should see when it is right.
A count in the inspector, something visible in play mode, a log line. Without it
the only test of the wiring is the bug.

## Shape

```markdown
## Editor steps

1. **Create the data asset.** Right-click `Assets/Data/Enemies` >
   Create > Game > Enemy Data. Name it `Grunt`.
2. **Fill it in.** Select `Assets/Data/Enemies/Grunt.asset`:
   - Max Health: `30`
   - Move Speed: `3.5`  (metres per second, used by EnemyFollowSystem)
   - Contact Damage: `10`
3. **Add the spawner.** Select `Level/Systems/SpawnDirector` in the Hierarchy,
   Add Component > Enemy Spawner.
4. **Wire it.** On that Enemy Spawner:
   - Enemy Data: drag `Assets/Data/Enemies/Grunt.asset`
   - Spawn Radius: `18`
   - Max Alive: `60`
5. **Save.** Ctrl+S for the scene; the asset saves itself.

## Verify

- Enter play mode. Enemies appear at the ring edge within two seconds.
- The Hierarchy shows at most 60 `Grunt(Clone)` objects at any time.
- No `NullReferenceException` in the Console on entering play mode.
```

## Rules

- **Say what you already know.** If a field's default in the C# is correct,
  say "leave at default" rather than omitting it — omission reads as an
  oversight and gets queried.
- **New serialized fields need a step.** A field you just added to a
  MonoBehaviour is unset on every existing instance in every scene and prefab.
  Name each object that needs it, or say explicitly that the default is fine.
- **Prefab before scene.** A change made on a prefab instance in a scene does not
  reach the other instances, and gets overwritten by the next prefab apply. Say
  which one you mean.
- **Renamed a field?** It needs `[FormerlySerializedAs]` in the code, not a step
  here. Re-entering values by hand is a step you can delete by writing one
  attribute.
- **Keep it in the repository.** Write the checklist into the task's notes or the
  PR description, not only into the chat, so the person doing the wiring has it
  in front of them.

## While you wait

The handoff does not stop the coding. Finish the C# side, leave the serialized
references unset, and make sure the failure when they are unset is a clear
message rather than a `NullReferenceException` from somewhere unrelated — a
`[SerializeField]` that is null at `Awake` is worth one explicit log naming the
field and the object.
