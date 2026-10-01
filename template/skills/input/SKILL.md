---
name: input
description: Unity input — which backend the project is on, the Input System package, action assets versus direct device reads, enable/disable pairing, and rebinding. Use when adding or changing input handling.
---

# Input

## Check the backend before writing anything

**Edit > Project Settings > Player > Active Input Handling**, or
`activeInputHandler` in `ProjectSettings/ProjectSettings.asset`:

| Value | Meaning | Consequence |
| --- | --- | --- |
| `0` | Input Manager (Old) | Input System types are not compiled in |
| `1` | Input System Package (New) | `Input.GetKey` **throws** at runtime |
| `2` | Both | Both work; the project is carrying two systems |

Value `1` is the one that bites: legacy code compiles fine and throws
`InvalidOperationException` the first time the line runs. This plugin's hooks
refuse legacy `Input` in a project set to `1`, and stay out of the way otherwise.

## Action asset or direct read

Two legitimate approaches, and mixing them arbitrarily is what makes input code
hard to follow.

**An `.inputactions` asset** — the default. Actions are data: rebindable,
readable by designers, and switchable by map (gameplay / menu / vehicle). Use it
for anything a player will configure, and for anything with more than a handful
of bindings.

Generate a C# wrapper (Generate C# Class in the asset's inspector) rather than
looking actions up by string. A typo in a string is a runtime null; a typo in a
generated property is a compile error.

**Direct device reads** — `Keyboard.current.spaceKey.wasPressedThisFrame`,
`Gamepad.current.leftStick.ReadValue()`. Honest and fast for a prototype, a debug
key, or a project that will never rebind. No asset to keep in sync. The cost is
that rebinding later means rewriting the call sites.

Every `.current` can be null when the device is absent. Null-check, or accept the
`NullReferenceException` when someone unplugs a controller.

## Enable and disable are a pair

An action map that is never enabled reads nothing and reports nothing — the
single most common "input does not work" cause. An action map that is never
disabled keeps firing into a destroyed object.

```csharp
private PlayerControls controls;

private void Awake() => controls = new PlayerControls();

private void OnEnable()
{
    controls.Gameplay.Enable();
    controls.Gameplay.Jump.performed += OnJump;
}

private void OnDisable()
{
    controls.Gameplay.Jump.performed -= OnJump;
    controls.Gameplay.Disable();
}

private void OnDestroy() => controls.Dispose();
```

Subscribe and unsubscribe in `OnEnable`/`OnDisable`, in mirror order, and
`Dispose` the asset in `OnDestroy`. Anything else leaks.

## Callback or poll

- **Callbacks** (`performed`, `canceled`) for discrete events: jump, fire,
  interact, menu. They fire once, which is what a discrete event wants.
- **Polling** (`ReadValue<Vector2>()` in `Update`) for continuous values: move,
  look, throttle.

Using a callback for continuous movement gives you a value that updates only when
the stick changes, which reads as input that sticks.

## Action maps as modes

Enable exactly one gameplay-facing map at a time. `Gameplay`, `Menu`,
`Dialogue` as separate maps, swapped on state change, removes every `if
(isPaused)` from the input path and makes "the player can still shoot in the
pause menu" structurally impossible.

## Rebinding

`PerformInteractiveRebinding` handles the capture. What it does not handle, and
what you have to:

- Exclude the pointer and the keyboard's `Escape` with `WithControlsExcluding`,
  or the first mouse move completes the rebind.
- Cancel on `Escape` with `WithCancelingThrough`.
- Detect duplicate bindings yourself; the API allows two actions on one control.
- Persist with `SaveBindingOverridesAsJson` and restore with
  `LoadBindingOverridesFromJson`. Restore before the first frame the player can
  act.
- `Dispose()` the rebinding operation when it completes or cancels.

## Mobile and gamepad

- On-screen controls: the `On-Screen Button` and `On-Screen Stick` components
  feed the same actions, so gameplay code does not branch on platform.
- `InputSystem.onDeviceChange` for connect and disconnect — the usual requirement
  is to pause when a gamepad disconnects mid-game.
- Control schemes mark which bindings belong to which device set, and let the UI
  show the right prompts.
