---
name: async-and-lifetime
description: Asynchronous work in Unity — coroutines, Awaitable, UniTask, cancellation tied to object lifetime, and the destroyed-object and domain-reload traps. Use when writing anything with a delay, a sequence over time, a load, or a cancellation.
---

# Async and lifetime

The Unity-specific problem with asynchronous code is not concurrency. It is that
the object the continuation belongs to can be destroyed while the operation is in
flight, and C# has no opinion about that at all.

```csharp
async void Start()
{
    await Task.Delay(5000);
    transform.position = spawnPoint;   // the GameObject may be gone
}
```

`transform` throws `MissingReferenceException`, or worse, silently operates on a
destroyed object. This is the bug behind most "it only happens when you leave the
scene quickly" reports.

## Pick the mechanism

| Situation | Use |
| --- | --- |
| A sequence over frames, tied to one MonoBehaviour | Coroutine |
| A single delay or frame wait, Unity 6+ | `Awaitable` |
| Real async work: loads, network, parallel | `UniTask` if available, else `Task` with a token |
| Anything that must not run after destroy | Whichever, with a `CancellationToken` |

**Coroutines** stop automatically when the MonoBehaviour is disabled or
destroyed. That is their real advantage, and it is a big one. Their limits: no
return value, no exception propagation, and they stop on *disable*, which is
sometimes not what you want.

**`Awaitable`** (Unity 6) is allocation-free for the common waits and returns to
the main thread properly. `await Awaitable.WaitForSecondsAsync(1f, token)`.

**UniTask** is the answer for anything substantial: allocation-free, has
`GetCancellationTokenOnDestroy()`, integrates with Unity's async operations, and
gives `UniTaskVoid` for a deliberate fire-and-forget that still surfaces its
exceptions.

Plain `Task` works, but `Task.Delay` does not know about `Time.timeScale`, and
`async void` loses exceptions entirely.

## Cancellation is not optional

Every asynchronous operation in a Unity object needs a token tied to that
object's lifetime.

```csharp
public sealed class Spawner : MonoBehaviour
{
    private CancellationTokenSource cts;

    private void OnEnable() => cts = new CancellationTokenSource();

    private void OnDisable()
    {
        cts.Cancel();
        cts.Dispose();
        cts = null;
    }

    private async Awaitable RunWaves(CancellationToken token)
    {
        while (!token.IsCancellationRequested)
        {
            await Awaitable.WaitForSecondsAsync(waveInterval, token);
            SpawnWave();
        }
    }
}
```

With UniTask, `this.GetCancellationTokenOnDestroy()` replaces the whole
`CancellationTokenSource` dance for the destroy case.

`OperationCanceledException` from an awaited call is normal control flow, not an
error. Let it propagate; do not catch and log it as a failure.

## async void

`async void` cannot be awaited, and an exception thrown inside it is never
observed — it does not reach the Console, it does not fail a test, it simply
stops the method. Use it only where the framework demands `void` (a Unity event
method, a UI callback), and even there put a `try`/`catch` around the body.

Everywhere else return `Task`, `Awaitable`, or `UniTaskVoid`.

## Domain reload

With **Enter Play Mode Options** and domain reload disabled — the default for
fast iteration in Unity 6 — statics are *not* reset between play sessions. A
static `CancellationTokenSource`, a cached reference, an event subscription, or a
static bool guard all survive into the next play session with their old values.

If the project disables domain reload, every static needs
`[RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]`
to reset it, or it needs not to be static.

Symptom to recognise: it works the first time you press play after a script
change, and misbehaves on every play after that.

## Events

An event subscription outlives the subscriber unless something removes it, and a
destroyed MonoBehaviour still held by an event handler is a leak plus a
`MissingReferenceException` on the next raise.

Subscribe in `OnEnable`, unsubscribe in `OnDisable`. Always as a pair, in those
two methods, so the symmetry is visible in one screen.

## Checklist for a review

- Does every `await` in a MonoBehaviour have a token that cancels on
  destroy or disable?
- Is there an `async void` that is not a Unity event method?
- Is `OperationCanceledException` being logged as an error?
- Does every `+=` on an event have a matching `-=`?
- Does any static hold state that domain reload would have cleared?
