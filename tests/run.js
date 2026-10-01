"use strict";
/**
 * Runs every hook as Claude Code runs it: a real child process, a JSON payload
 * on stdin, the JSON it prints read back off stdout.
 *
 * Fixture Unity projects are built on disk, because the hooks read
 * ProjectVersion.txt and ProjectSettings.asset to decide what to enforce, and a
 * test that stubs that reading would not be testing the thing that ships.
 *
 *   node tests/run.js
 */

const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const SCRIPTS = path.join(__dirname, "..", "template", "hooks");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "unity-kit-tests-"));

// --- fixture projects ------------------------------------------------------

function makeProject(name, { editorVersion, inputHandler, packages }) {
  const dir = path.join(root, name);
  fs.mkdirSync(path.join(dir, "Assets", "Scripts"), { recursive: true });
  fs.mkdirSync(path.join(dir, "Assets", "Editor"), { recursive: true });
  fs.mkdirSync(path.join(dir, "Assets", "Scenes"), { recursive: true });
  fs.mkdirSync(path.join(dir, "ProjectSettings"), { recursive: true });
  fs.mkdirSync(path.join(dir, "Packages"), { recursive: true });

  fs.writeFileSync(
    path.join(dir, "ProjectSettings", "ProjectVersion.txt"),
    `m_EditorVersion: ${editorVersion}\nm_EditorVersionWithRevision: ${editorVersion} (abc123)\n`
  );
  fs.writeFileSync(
    path.join(dir, "ProjectSettings", "ProjectSettings.asset"),
    `%YAML 1.1\nPlayerSettings:\n  productName: Fixture\n  activeInputHandler: ${inputHandler}\n  colorSpace: 1\n`
  );
  fs.writeFileSync(
    path.join(dir, "Packages", "manifest.json"),
    JSON.stringify({ dependencies: packages }, null, 2)
  );
  return dir;
}

const modern = makeProject("Modern", {
  editorVersion: "6000.0.32f1",
  inputHandler: 1,
  packages: {
    "com.unity.inputsystem": "1.11.2",
    "com.unity.render-pipelines.universal": "17.0.3",
    "com.unity.entities": "1.3.5",
    "com.unity.test-framework": "1.4.5",
  },
});

// Kept pristine for the session-context tests: the guard tests write .asmdef
// files into `modern`, and a fixture that changes underneath an assertion makes
// the suite order-dependent.
const pristine = makeProject("Pristine", {
  editorVersion: "6000.0.32f1",
  inputHandler: 1,
  packages: {
    "com.unity.inputsystem": "1.11.2",
    "com.unity.render-pipelines.universal": "17.0.3",
    "com.unity.entities": "1.3.5",
    "com.unity.test-framework": "1.4.5",
  },
});

const legacy = makeProject("Legacy", {
  editorVersion: "2021.3.40f1",
  inputHandler: 0,
  packages: { "com.unity.textmeshpro": "3.0.6" },
});

// --- harness ---------------------------------------------------------------

let passed = 0;
const failures = [];

/** Run a hook the way Claude Code does and return whatever JSON it printed. */
function runHook(script, payload) {
  const result = spawnSync(process.execPath, [path.join(SCRIPTS, script)], {
    input: JSON.stringify(payload),
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`${script} exited ${result.status}: ${result.stderr}`);
  }
  const stdout = (result.stdout || "").trim();
  if (!stdout) return null;
  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error(`${script} printed non-JSON: ${stdout.slice(0, 200)}`);
  }
}

const decisionOf = (out) => (out && out.hookSpecificOutput && out.hookSpecificOutput.permissionDecision) || "none";
const reasonOf = (out) => (out && out.hookSpecificOutput && out.hookSpecificOutput.permissionDecisionReason) || "";
const contextOf = (out) => (out && out.hookSpecificOutput && out.hookSpecificOutput.additionalContext) || "";

function check(label, actual, expected) {
  if (actual === expected) {
    passed++;
    console.log(`  ok    ${label}`);
  } else {
    failures.push(`${label}\n          expected: ${expected}\n          actual:   ${actual}`);
    console.log(`  FAIL  ${label}  (expected ${expected}, got ${actual})`);
  }
}

function contains(label, haystack, needle) {
  check(label, String(haystack).includes(needle) ? "contains" : `missing "${needle}"`, "contains");
}

const write = (project, relative, content) => {
  const full = path.join(project, relative);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  return full;
};

const preWrite = (project, file, content) => ({
  hook_event_name: "PreToolUse",
  tool_name: "Write",
  cwd: project,
  tool_input: { file_path: file, content },
});

const preEdit = (project, file, oldString, newString) => ({
  hook_event_name: "PreToolUse",
  tool_name: "Edit",
  cwd: project,
  tool_input: { file_path: file, old_string: oldString, new_string: newString },
});

// --- guard-serialized-assets ----------------------------------------------

console.log("\nguard-serialized-assets");
{
  const g = "guard-serialized-assets.js";
  const at = (rel) => path.join(modern, rel);

  check("refuses a scene", decisionOf(runHook(g, preWrite(modern, at("Assets/Scenes/Main.unity"), "%YAML 1.1"))), "deny");
  check("refuses a prefab", decisionOf(runHook(g, preWrite(modern, at("Assets/Prefabs/Enemy.prefab"), "x"))), "deny");
  check("refuses a .asset", decisionOf(runHook(g, preWrite(modern, at("Assets/Data/Enemy.asset"), "x"))), "deny");
  check("refuses a material", decisionOf(runHook(g, preWrite(modern, at("Assets/Art/Rock.mat"), "x"))), "deny");
  check("refuses an animator controller", decisionOf(runHook(g, preWrite(modern, at("Assets/Anim/Player.controller"), "x"))), "deny");
  check("refuses a .meta", decisionOf(runHook(g, preWrite(modern, at("Assets/Scripts/Player.cs.meta"), "guid: 1"))), "deny");
  check("refuses a project settings asset", decisionOf(runHook(g, preWrite(modern, at("ProjectSettings/TagManager.asset"), "x"))), "deny");

  check("allows a C# file", decisionOf(runHook(g, preWrite(modern, at("Assets/Scripts/Player.cs"), "class Player {}"))), "none");
  check("allows a JSON data file", decisionOf(runHook(g, preWrite(modern, at("Assets/StreamingAssets/levels.json"), "{}"))), "none");
  check("allows a shader", decisionOf(runHook(g, preWrite(modern, at("Assets/Art/Water.shader"), "Shader {}"))), "none");
  check("ignores generated Library content", decisionOf(runHook(g, preWrite(modern, at("Library/Bee/artifacts.asset"), "x"))), "none");
  check("ignores files outside the project", decisionOf(runHook(g, preWrite(modern, path.join(root, "notes.prefab"), "x"))), "none");

  check("asks about the package manifest", decisionOf(runHook(g, preWrite(modern, at("Packages/manifest.json"), "{}"))), "ask");
  check("asks about packages-lock.json", decisionOf(runHook(g, preWrite(modern, at("Packages/packages-lock.json"), "{}"))), "ask");

  const sceneReason = reasonOf(runHook(g, preWrite(modern, at("Assets/Scenes/Main.unity"), "x")));
  contains("scene refusal points at the handoff skill", sceneReason, "editor-handoff");
  contains("meta refusal explains the GUID", reasonOf(runHook(g, preWrite(modern, at("Assets/A.png.meta"), "x"))), "GUID");
}

// --- guard-runtime-code: editor in runtime --------------------------------

console.log("\nguard-runtime-code (editor/runtime)");
{
  const g = "guard-runtime-code.js";
  const runtime = path.join(modern, "Assets/Scripts/Tool.cs");
  const editor = path.join(modern, "Assets/Editor/Tool.cs");

  const unguarded = "using UnityEngine;\nusing UnityEditor;\n\npublic class Tool : MonoBehaviour { }\n";
  check("refuses UnityEditor in runtime code", decisionOf(runHook(g, preWrite(modern, runtime, unguarded))), "deny");
  check("allows UnityEditor under an Editor folder", decisionOf(runHook(g, preWrite(modern, editor, unguarded))), "none");

  const guarded =
    "using UnityEngine;\n#if UNITY_EDITOR\nusing UnityEditor;\n#endif\n\npublic class Tool : MonoBehaviour {\n#if UNITY_EDITOR\n  [MenuItem(\"Tools/Go\")] static void Go() { }\n#endif\n}\n";
  check("allows a correctly guarded block", decisionOf(runHook(g, preWrite(modern, runtime, guarded))), "none");

  const guardedElsewhere =
    "using UnityEngine;\nusing UnityEditor;\n\npublic class Tool : MonoBehaviour {\n#if UNITY_EDITOR\n  void Helper() { }\n#endif\n}\n";
  check("still refuses when the guard is somewhere else in the file", decisionOf(runHook(g, preWrite(modern, runtime, guardedElsewhere))), "deny");

  const orGuard =
    "using UnityEngine;\n#if UNITY_EDITOR || UNITY_STANDALONE\nusing UnityEditor;\n#endif\n";
  check("refuses a guard that only sometimes holds", decisionOf(runHook(g, preWrite(modern, runtime, orGuard))), "deny");

  const andGuard =
    "using UnityEngine;\n#if UNITY_EDITOR && !DISABLE_TOOLS\nusing UnityEditor;\n#endif\n";
  check("allows UNITY_EDITOR combined with another condition", decisionOf(runHook(g, preWrite(modern, runtime, andGuard))), "none");

  const negated =
    "using UnityEngine;\n#if !UNITY_EDITOR\nvoid RuntimeOnly() { }\n#else\nusing UnityEditor;\n#endif\n";
  check("allows the else branch of #if !UNITY_EDITOR", decisionOf(runHook(g, preWrite(modern, runtime, negated))), "none");

  const inComment =
    "using UnityEngine;\n// remember to wrap UnityEditor.AssetDatabase calls\npublic class Tool : MonoBehaviour { }\n";
  check("does not fire on a mention in a comment", decisionOf(runHook(g, preWrite(modern, runtime, inComment))), "none");

  const inString =
    "using UnityEngine;\npublic class Tool : MonoBehaviour { string s = \"UnityEditor.AssetDatabase\"; }\n";
  check("does not fire on a mention in a string", decisionOf(runHook(g, preWrite(modern, runtime, inString))), "none");

  // An edit mode test assembly is editor code with no Editor folder in its path.
  // The assembly definition is what says so, so the hook has to read it.
  write(modern, "Assets/Tests/EditMode/Tests.EditMode.asmdef",
    JSON.stringify({ name: "Tests.EditMode", references: [], includePlatforms: ["Editor"] }));
  const editModeTest = path.join(modern, "Assets/Tests/EditMode/AssetTests.cs");
  check(
    "allows UnityEditor in an Editor-only assembly with no Editor folder",
    decisionOf(runHook(g, preWrite(modern, editModeTest, unguarded))),
    "none"
  );

  write(modern, "Assets/Runtime/Gameplay.asmdef",
    JSON.stringify({ name: "Gameplay", references: [], includePlatforms: [] }));
  const runtimeAsm = path.join(modern, "Assets/Runtime/Thing.cs");
  check(
    "still refuses UnityEditor in an all-platforms assembly",
    decisionOf(runHook(g, preWrite(modern, runtimeAsm, unguarded))),
    "deny"
  );
}

// --- guard-runtime-code: legacy input -------------------------------------

console.log("\nguard-runtime-code (input backend)");
{
  const g = "guard-runtime-code.js";
  const source = "using UnityEngine;\npublic class P : MonoBehaviour {\n  void Update() { if (Input.GetKey(KeyCode.W)) { } }\n}\n";

  check(
    "refuses legacy Input when the project is Input System only",
    decisionOf(runHook(g, preWrite(modern, path.join(modern, "Assets/Scripts/P.cs"), source))),
    "deny"
  );
  check(
    "allows legacy Input when the project still has the old backend",
    decisionOf(runHook(g, preWrite(legacy, path.join(legacy, "Assets/Scripts/P.cs"), source))),
    "none"
  );
  check(
    "does not mistake a variable ending in Input for the legacy class",
    decisionOf(runHook(g, preWrite(modern, path.join(modern, "Assets/Scripts/Q.cs"),
      "using UnityEngine;\npublic class Q : MonoBehaviour { PlayerInput playerInput; void Update() { playerInput.GetKey(); } }\n"))),
    "none"
  );
  contains(
    "the refusal names the project setting",
    reasonOf(runHook(g, preWrite(modern, path.join(modern, "Assets/Scripts/P.cs"), source))),
    "Active Input Handling"
  );
}

// --- guard-serialized-rename ----------------------------------------------

console.log("\nguard-serialized-rename");
{
  const g = "guard-serialized-rename.js";
  const file = write(modern, "Assets/Scripts/Mover.cs",
    "using UnityEngine;\npublic class Mover : MonoBehaviour {\n  [SerializeField] private float speed = 3f;\n  public int hits;\n}\n");

  check(
    "asks when a [SerializeField] name disappears",
    decisionOf(runHook(g, preEdit(modern, file, "private float speed", "private float moveSpeed"))),
    "ask"
  );
  check(
    "asks when a public field is renamed",
    decisionOf(runHook(g, preEdit(modern, file, "public int hits", "public int hitCount"))),
    "ask"
  );
  check(
    "stays quiet when FormerlySerializedAs is added in the same edit",
    decisionOf(runHook(g, preEdit(modern, file,
      "  [SerializeField] private float speed = 3f;",
      "  [FormerlySerializedAs(\"speed\")]\n  [SerializeField] private float moveSpeed = 3f;"))),
    "none"
  );
  check(
    "stays quiet when a field is only added",
    decisionOf(runHook(g, preEdit(modern, file, "public int hits;", "public int hits;\n  [SerializeField] private float drag;"))),
    "none"
  );
  check(
    "stays quiet on a body-only change",
    decisionOf(runHook(g, preEdit(modern, file, "public class Mover", "public sealed class Mover"))),
    "none"
  );

  const fresh = path.join(modern, "Assets/Scripts/BrandNew.cs");
  check(
    "stays quiet for a file that does not exist yet",
    decisionOf(runHook(g, preWrite(modern, fresh, "public class BrandNew { [SerializeField] int a; }"))),
    "none"
  );

  contains(
    "the question names the lost field",
    reasonOf(runHook(g, preEdit(modern, file, "private float speed", "private float moveSpeed"))),
    "`speed`"
  );
}

// --- guard-asset-deletion --------------------------------------------------

console.log("\nguard-asset-deletion");
{
  const g = "guard-asset-deletion.js";
  const bash = (command) => ({
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    cwd: modern,
    tool_input: { command },
  });

  check("asks about rm of an asset", decisionOf(runHook(g, bash("rm Assets/Art/Rock.png"))), "ask");
  check("asks about rm of a .meta alone", decisionOf(runHook(g, bash("rm Assets/Art/Rock.png.meta"))), "ask");
  check("asks about mv of an asset", decisionOf(runHook(g, bash("mv Assets/Old/Thing.prefab Assets/New/Thing.prefab"))), "ask");
  check("asks about git rm under Assets", decisionOf(runHook(g, bash("git rm -r Assets/Legacy"))), "ask");
  check("says nothing about builds and logs", decisionOf(runHook(g, bash("rm -rf Library Temp Logs"))), "none");
  check("says nothing about a plain git status", decisionOf(runHook(g, bash("git status --short"))), "none");
  check("says nothing about reading an asset", decisionOf(runHook(g, bash("cat Assets/Art/Rock.png.meta"))), "none");

  contains(
    "the meta-only question explains what breaks",
    reasonOf(runHook(g, bash("rm Assets/Art/Rock.png.meta"))),
    "missing reference"
  );
}

// --- review-csharp ---------------------------------------------------------

console.log("\nreview-csharp");
{
  const g = "review-csharp.js";
  const post = (file) => ({
    hook_event_name: "PostToolUse",
    tool_name: "Write",
    cwd: modern,
    tool_input: { file_path: file },
    tool_output: "ok",
  });

  const bad = write(modern, "Assets/Scripts/Bad.cs", [
    "using UnityEngine;",
    "public class Bad : MonoBehaviour {",
    "  void Update() {",
    "    var r = GetComponent<Rigidbody>();",
    "    var c = Camera.main;",
    "    Debug.Log(\"tick\");",
    "    if (Vector3.Distance(transform.position, c.transform.position) < 5f) { }",
    "    if (gameObject.tag == \"Player\") { }",
    "    Instantiate(gameObject);",
    "  }",
    "  void LateUpdate() { }",
    "  async void DoWork() { }",
    "  void Go() { StartCoroutine(\"Routine\"); Resources.Load<GameObject>(\"x\"); }",
    "  System.Collections.IEnumerator Routine() { yield return new WaitForSeconds(1f); }",
    "  void Old() { var t = FindObjectOfType<Transform>(); }",
    "}",
  ].join("\n"));

  const report = contextOf(runHook(g, post(bad)));
  contains("reports GetComponent in Update", report, "runs every frame inside `Update`");
  contains("reports Camera.main in Update", report, "Camera.main");
  contains("reports logging in Update", report, "Logging inside `Update`");
  contains("reports Distance used as a comparison", report, "sqrMagnitude");
  contains("reports .tag ==", report, "CompareTag");
  contains("reports Instantiate in Update", report, "Pool the objects");
  contains("reports the empty LateUpdate", report, "`LateUpdate` is empty");
  contains("reports async void", report, "async void DoWork");
  contains("reports string-based StartCoroutine", report, "reflection");
  contains("reports Resources.Load", report, "Addressables");
  contains("reports uncached WaitForSeconds", report, "WaitForSeconds");
  contains("reports the Unity 6 obsolete API", report, "obsolete in Unity 6");
  contains("reports line numbers", report, "Bad.cs:4");

  const clean = write(modern, "Assets/Scripts/Clean.cs", [
    "using UnityEngine;",
    "public sealed class Clean : MonoBehaviour {",
    "  [SerializeField] private Rigidbody body;",
    "  private readonly WaitForSeconds wait = new WaitForSeconds(1f);",
    "  private void FixedUpdate() { body.linearVelocity = Vector3.forward; }",
    "}",
  ].join("\n"));
  check("says nothing about clean code", runHook(g, post(clean)), null);

  const commented = write(modern, "Assets/Scripts/Commented.cs", [
    "using UnityEngine;",
    "// Never call GetComponent<Rigidbody>() inside Update.",
    "public sealed class Commented : MonoBehaviour {",
    "  private void Update() { }",
    "}",
  ].join("\n"));
  const commentedReport = contextOf(runHook(g, post(commented)));
  check(
    "does not report a rule written in a comment",
    commentedReport.includes("GetComponent") ? "reported" : "quiet",
    "quiet"
  );

  const legacyFile = write(legacy, "Assets/Scripts/Old.cs",
    "using UnityEngine;\npublic class Old : MonoBehaviour { void Go() { var t = FindObjectOfType<Transform>(); } }\n");
  const legacyReport = contextOf(runHook(g, { ...post(legacyFile), cwd: legacy }));
  check(
    "does not call an API obsolete only in Unity 6 obsolete in a 2021 project",
    legacyReport.includes("obsolete in Unity 6") ? "reported" : "quiet",
    "quiet"
  );
}

// --- session-context -------------------------------------------------------

console.log("\nsession-context");
{
  const g = "session-context.js";
  const start = (cwd) => ({ hook_event_name: "SessionStart", source: "startup", cwd });

  const report = contextOf(runHook(g, start(pristine)));
  contains("reports the editor version", report, "6000.0.32f1");
  contains("reports the render pipeline", report, "URP");
  contains("reports the input backend", report, "Input System only");
  contains("reports notable packages", report, "Entities (DOTS) 1.3.5");
  contains("reports the missing assembly definitions", report, "Assembly-CSharp");
  contains("states the serialized-asset agreement", report, "editor-handoff");
  contains("warns that legacy Input throws here", report, "throws at runtime");
  contains("flags the Unity 6 obsolete APIs", report, "FindFirstObjectByType");

  const legacyReport = contextOf(runHook(g, start(legacy)));
  contains("reports the older editor version", legacyReport, "2021.3.40f1");
  contains("reports the built-in pipeline", legacyReport, "Built-in");
  check(
    "does not give Unity 6 advice to a 2021 project",
    legacyReport.includes("FindFirstObjectByType") ? "advised" : "quiet",
    "quiet"
  );

  check("says nothing outside a Unity project", runHook(g, start(os.tmpdir())), null);
}

// --- robustness ------------------------------------------------------------

console.log("\nrobustness");
{
  const everyHook = [
    "session-context.js",
    "guard-serialized-assets.js",
    "guard-runtime-code.js",
    "guard-serialized-rename.js",
    "guard-asset-deletion.js",
    "review-csharp.js",
  ];

  for (const script of everyHook) {
    const empty = spawnSync(process.execPath, [path.join(SCRIPTS, script)], { input: "", encoding: "utf8" });
    check(`${script} exits 0 on empty stdin`, empty.status, 0);

    const garbage = spawnSync(process.execPath, [path.join(SCRIPTS, script)], { input: "not json", encoding: "utf8" });
    check(`${script} exits 0 on malformed input`, garbage.status, 0);

    const noFile = runHook(script, { hook_event_name: "PreToolUse", tool_name: "Bash", cwd: modern, tool_input: {} });
    check(`${script} survives a payload with no file`, noFile === null || typeof noFile === "object", true);

    const missingFile = runHook(script, {
      hook_event_name: "PreToolUse",
      tool_name: "Edit",
      cwd: modern,
      tool_input: { file_path: path.join(modern, "Assets/Scripts/DoesNotExist.cs"), old_string: "a", new_string: "b" },
    });
    check(`${script} survives an edit to a missing file`, missingFile === null || typeof missingFile === "object", true);
  }
}

// --- result ----------------------------------------------------------------

fs.rmSync(root, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("");
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exit(1);
}
