---
name: performance
description: Unity performance work — per-frame allocation, the Update tax, draw calls and batching, physics, and how to measure before changing anything. Use when asked about frame rate, stutter, GC spikes, draw calls, or mobile performance.
---

# Performance

Unity performance problems are nearly always one of four things: garbage
collection, too many `Update` calls, too many draw calls, or physics doing work
nobody asked for. Which one it is, is a measurement, not a guess.

## Measure first

Do not optimise from reading code. The profiler names the frame and the method.

- **Profiler window**, Deep Profile *off* first. Deep Profile changes the shape
  of the frame and will point you somewhere wrong.
- **Profile a build**, not the editor. Editor overhead is not the game's.
  Development Build with Autoconnect Profiler.
- **Frame Debugger** for draw calls: it shows what broke batching and why.
- **Memory Profiler** package for allocation, rather than the Profiler's memory
  tab.
- Watch **GC Alloc** per frame in the CPU module. The target is zero in steady
  state; any repeating non-zero number is a stutter with a schedule.

Say what you measured when you report a result. "This should be faster" is not a
finding.

## Allocation

Every allocation is a future collection pause. In something that runs every
frame, a few bytes is a spike every few seconds.

The repeat offenders:

- `GetComponent` in `Update`. Cache it in `Awake`.
- `Camera.main` in `Update` — it is a scene search by tag.
- String work: concatenation, interpolation, `ToString()` on a number,
  `.tag == "Player"`. Anything feeding a per-frame UI label. Use `CompareTag`,
  and set text only when the value actually changes.
- `new WaitForSeconds(...)` inside a coroutine loop. Cache one instance and yield
  the same one.
- `Physics.RaycastAll`, `GetComponentsInChildren`, `FindObjectsByType`: all
  return fresh arrays. Use the `NonAlloc` variants, or the `List<T>` overloads
  that fill a buffer you own.
- Lambdas that capture. A closure allocates once per creation, not once per
  program.
- LINQ in a hot path. Fine in startup code, never per frame.
- `foreach` over an interface-typed collection, which boxes the enumerator.

## The Update tax

Unity calls `Update` on every enabled MonoBehaviour that declares one, across an
interop boundary. A thousand components with a one-line `Update` cost more than
the work inside them.

- Delete empty `Update`, `Start` and `FixedUpdate` bodies. Unity still calls
  them.
- For many similar objects, one manager iterating a list beats one component
  each.
- Work that does not need 60 Hz should not run at 60 Hz: stagger by index, or
  run it on a timer.
- `FixedUpdate` runs at its own rate — several times per frame when the frame
  rate is low. Physics only.

## Draw calls and batching

- **SRP Batcher** (URP/HDRP) batches by shader variant, not by material. It is on
  by default; confirm it in the Frame Debugger before hand-optimising materials.
- **GPU Instancing** for many copies of one mesh and material.
- **Static batching** for geometry that never moves, at the cost of build size.
- `MaterialPropertyBlock` changes a renderer's colour without creating a material
  instance. Assigning to `renderer.material` clones the material — every clone is
  another draw call and a leak.
- Overdraw on mobile is usually transparency: particles and full-screen UI.
- Canvas: any change to any element rebuilds the whole canvas. Put moving
  elements on their own canvas, and turn off Raycast Target on everything that is
  not interactive.

## Physics

- Set up the **layer collision matrix**. Most projects test far more pairs than
  they need.
- Move Rigidbodies with `MovePosition` or `velocity` in `FixedUpdate`, not by
  writing `transform.position`, which teleports through collisions.
- A collider on a moving object with no Rigidbody is a static collider being
  rebuilt every frame. Add a kinematic Rigidbody.
- Mesh colliders: convex, or replaced with primitives.
- `Physics.Raycast` with a `layerMask` and a `maxDistance`, and the `NonAlloc`
  overload.

## Mobile

- Fill rate is the budget. Resolution, overdraw and post-processing first;
  polygon count almost never.
- Texture compression: ASTC, and check the actual per-platform override rather
  than trusting the default.
- Keep the frame time *stable* rather than low. `Application.targetFrameRate =
  60` with a steady 60 beats an average of 75 with spikes.
- Test on the slowest device you support, on battery, warm. Thermal throttling is
  the real budget.
