"use strict";
/**
 * PostToolUse: read back the C# that was just written and report what is
 * specifically wrong with it as Unity code.
 *
 * This blocks nothing. It attaches findings to the tool result, so the model
 * sees them at the moment it still has the file in mind, instead of in a review
 * pass after the design has set. Most of these are not bugs — they are the
 * per-frame costs and the late-failure patterns that a general-purpose C#
 * reading of the file has no reason to notice.
 */

const io = require("./lib/hook-io.js");
const unity = require("./lib/unity-project.js");

const MAX_FINDINGS = 12;

/** Body ranges of the methods Unity calls every frame. */
function perFrameRanges(code) {
  const ranges = [];
  const signature = /(?<![\w.])(?:void|IEnumerator)\s+(Update|LateUpdate|FixedUpdate|OnGUI|OnAnimatorIK|OnRenderObject)\s*\(/g;
  for (const hit of io.findAll(code, signature)) {
    const open = code.indexOf("{", hit.index);
    if (open === -1) continue;
    let depth = 0;
    let end = -1;
    for (let i = open; i < code.length; i++) {
      if (code[i] === "{") depth++;
      else if (code[i] === "}") {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
    if (end !== -1) ranges.push({ name: hit.groups[1], start: open, end, body: code.slice(open + 1, end) });
  }
  return ranges;
}

const inRange = (ranges, index) => ranges.find((r) => index > r.start && index < r.end);

io.run((payload) => {
  const file = io.targetFile(payload);
  if (!file || !file.toLowerCase().endsWith(".cs")) return null;

  const root = unity.findProjectRoot(io.path.dirname(file)) || unity.findProjectRoot(payload.cwd);
  if (!root) return null;

  const text = io.currentContent(payload) || io.prospectiveContent(payload).text;
  if (!text) return null;

  const code = io.stripNonCode(text);
  const ranges = perFrameRanges(code);
  const findings = [];
  const seen = new Set();
  const add = (line, message) => {
    const key = `${line}:${message}`;
    if (seen.has(key)) return; // two hits on one line say the same thing twice
    seen.add(key);
    if (findings.length < MAX_FINDINGS) findings.push({ line, message });
  };

  const scan = (pattern, handler) => {
    for (const hit of io.findAll(code, pattern)) handler(hit, inRange(ranges, hit.index));
  };

  // --- per-frame cost -----------------------------------------------------
  scan(/(?<![\w.])(?:GetComponent|GetComponentInChildren|GetComponentInParent|GetComponents|GetComponentsInChildren)\s*</g, (hit, frame) => {
    if (frame) add(hit.line, `\`${hit.text.trim()}…\` runs every frame inside \`${frame.name}\`. Resolve the component once in Awake and cache it in a field.`);
  });

  scan(/(?<![\w.])Camera\s*\.\s*main\b/g, (hit, frame) => {
    if (frame) add(hit.line, `\`Camera.main\` inside \`${frame.name}\` searches every tagged object each call. Cache the camera in Awake.`);
  });

  scan(/(?<![\w.])(?:GameObject\s*\.\s*Find\w*|FindObjectOfType|FindObjectsOfType|FindFirstObjectByType|FindAnyObjectByType|FindObjectsByType)\s*[<(]/g, (hit, frame) => {
    if (frame) add(hit.line, `\`${hit.text.trim()}\` inside \`${frame.name}\` walks the scene graph every frame. Wire the reference in the inspector, or resolve it once at startup.`);
  });

  scan(/(?<![\w.])(?:Instantiate|Destroy)\s*\(/g, (hit, frame) => {
    if (frame) add(hit.line, `\`${hit.text.trim().replace(/\($/, "")}\` inside \`${frame.name}\` allocates and collects every frame. Pool the objects instead.`);
  });

  scan(/(?<![\w.])Debug\s*\.\s*Log\w*\s*\(/g, (hit, frame) => {
    if (frame) add(hit.line, `Logging inside \`${frame.name}\` costs a string allocation and a stack trace every frame, in builds too. Guard it or remove it.`);
  });

  // Only the yielded form: `new WaitForSeconds(...)` cached in a field is the
  // fix, not the problem, and flagging it would fire on correct code.
  scan(/yield\s+return\s+new\s+(WaitForSeconds|WaitForSecondsRealtime)\s*\(/g, (hit) => {
    add(hit.line, `\`yield return new ${hit.groups[1]}(...)\` allocates on every iteration. Cache one instance in a readonly field and yield that.`);
  });

  scan(/(?<![\w.])Vector[23]\s*\.\s*Distance\s*\([^;]{0,120}?\)\s*[<>]/g, (hit) => {
    add(hit.line, "Comparing `Vector3.Distance` against a threshold takes a square root for nothing. Compare `(a - b).sqrMagnitude` against the squared threshold.");
  });

  scan(/\.\s*tag\s*(?:==|!=)\s*"/g, (hit) => {
    add(hit.line, "`.tag ==` allocates a string on access. Use `CompareTag(\"…\")`.");
  });

  // --- correctness and lifetime -------------------------------------------
  scan(/(?<![\w.])async\s+void\s+(\w+)/g, (hit) => {
    const name = hit.groups[1];
    if (/^(Start|Awake|OnEnable|OnDisable|OnDestroy)$/.test(name)) return;
    add(hit.line, `\`async void ${name}\` cannot be awaited and its exceptions are unobservable — a throw inside it is lost. Return \`Task\`${hit.line ? "" : ""}, or \`UniTaskVoid\` for a deliberate fire-and-forget.`);
  });

  scan(/(?<![\w.])(?:StartCoroutine|Invoke|InvokeRepeating|CancelInvoke|SendMessage|SendMessageUpwards|BroadcastMessage)\s*\(\s*"/g, (hit) => {
    add(hit.line, `\`${hit.text.trim().replace(/\s*\(\s*"$/, "")}\` with a string name resolves by reflection and survives a rename silently. Pass the method directly, or use an event.`);
  });

  scan(/(?<![\w.])Resources\s*\.\s*Load/g, (hit) => {
    add(hit.line, "`Resources.Load` keeps everything under Resources/ in the build and out of dependency tracking. Serialize a direct reference, or use Addressables.");
  });

  if (unity.majorVersion(unity.editorVersion(root)) >= 6000) {
    scan(/(?<![\w.])FindObjectsOfType\s*</g, (hit) => {
      add(hit.line, "`FindObjectsOfType` is obsolete in Unity 6. Use `FindObjectsByType<T>(FindObjectsSortMode.None)` — sorting is what made the old call slow.");
    });
    scan(/(?<![\w.])FindObjectOfType\s*</g, (hit) => {
      add(hit.line, "`FindObjectOfType` is obsolete in Unity 6. Use `FindFirstObjectByType<T>()`.");
    });
  }

  // --- methods Unity calls for nothing ------------------------------------
  for (const frame of ranges) {
    if (frame.body.trim() === "") {
      add(io.lineAt(code, frame.start), `\`${frame.name}\` is empty. Unity still calls it on every instance every frame; delete it.`);
    }
  }

  if (!findings.length) return null;

  const relative = io.normalize(io.path.relative(root, file));
  const body = findings
    .sort((a, b) => a.line - b.line)
    .map((f) => `- ${relative}:${f.line} — ${f.message}`)
    .join("\n");

  return io.note(
    "PostToolUse",
    `Unity review of the file just written:\n\n${body}\n\n` +
      "These are review comments, not errors. Fix the ones that apply to what this " +
      "code is for; say why if you are leaving one."
  );
});
