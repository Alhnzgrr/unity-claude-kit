"use strict";
// End-to-end check of the project-mode install (node tests/install.js): build a throwaway Unity
// project, install into it, run the installed hooks from where they landed,
// re-run the installer, and confirm nothing stacked or got clobbered.

const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const KIT = path.join(__dirname, "..");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "unity-kit-install-"));
const project = path.join(root, "Game");

let pass = 0;
const fail = [];
const check = (label, actual, expected) => {
  if (actual === expected) { pass++; console.log(`  ok    ${label}`); }
  else { fail.push(label); console.log(`  FAIL  ${label} (expected ${expected}, got ${actual})`); }
};

// --- a Unity project ------------------------------------------------------
fs.mkdirSync(path.join(project, "Assets", "Scripts"), { recursive: true });
fs.mkdirSync(path.join(project, "ProjectSettings"), { recursive: true });
fs.mkdirSync(path.join(project, "Packages"), { recursive: true });
fs.writeFileSync(path.join(project, "ProjectSettings", "ProjectVersion.txt"), "m_EditorVersion: 6000.0.32f1\n");
fs.writeFileSync(path.join(project, "ProjectSettings", "ProjectSettings.asset"), "PlayerSettings:\n  activeInputHandler: 1\n");
fs.writeFileSync(path.join(project, "Packages", "manifest.json"),
  JSON.stringify({ dependencies: { "com.unity.inputsystem": "1.11.2", "com.unity.render-pipelines.universal": "17.0.3" } }));

// a settings.json and an agent the project already owns
fs.mkdirSync(path.join(project, ".claude", "agents"), { recursive: true });
fs.writeFileSync(path.join(project, ".claude", "settings.json"), JSON.stringify({
  env: { MY_VAR: "keep me" },
  hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo mine" }] }] },
}, null, 2));
fs.writeFileSync(path.join(project, ".claude", "agents", "code-reviewer.md"), "---\nname: code-reviewer\n---\nmine\n");

const install = (...extra) =>
  spawnSync(process.execPath, [path.join(KIT, "install.js"), project, ...extra], { encoding: "utf8" });

// --- first install --------------------------------------------------------
console.log("\nfirst install");
const first = install();
check("exits 0", first.status, 0);
check("writes CLAUDE.md", fs.existsSync(path.join(project, ".claude/CLAUDE.md")), true);
check("writes the manifest", fs.existsSync(path.join(project, ".claude/.unity-kit.json")), true);
check("writes 6 hooks", fs.readdirSync(path.join(project, ".claude/hooks")).filter(f => f.endsWith(".js")).length, 6);
check("writes the hook library", fs.existsSync(path.join(project, ".claude/hooks/lib/hook-io.js")), true);
check("writes 5 rules", fs.readdirSync(path.join(project, ".claude/rules")).length, 5);
check("writes 9 skills", fs.readdirSync(path.join(project, ".claude/skills")).length, 9);
check("keeps the project's own agent", fs.readFileSync(path.join(project, ".claude/agents/code-reviewer.md"), "utf8").trim().endsWith("mine"), true);
check("still adds the other two agents", fs.existsSync(path.join(project, ".claude/agents/architect.md")), true);
check("backs up settings.json", fs.existsSync(path.join(project, ".claude/settings.json.bak")), true);

const settings = () => JSON.parse(fs.readFileSync(path.join(project, ".claude/settings.json"), "utf8"));
check("preserves unrelated settings", settings().env.MY_VAR, "keep me");
check("preserves the project's own Bash hook",
  settings().hooks.PreToolUse.filter(e => e.hooks.some(h => h.command === "echo mine")).length, 1);
check("wires SessionStart", (settings().hooks.SessionStart || []).length, 1);
check("wires PostToolUse", (settings().hooks.PostToolUse || []).length, 1);

const kitEntries = () => settings().hooks.PreToolUse.filter(e =>
  e.hooks.some(h => (h.args || []).join(" ").includes("/.claude/hooks/")));
check("adds 2 PreToolUse matcher groups", kitEntries().length, 2);

// --- rules are path-scoped ------------------------------------------------
console.log("\nrules");
const ruleText = fs.readFileSync(path.join(project, ".claude/rules/shaders.md"), "utf8");
check("rules carry paths frontmatter", /^---\npaths:/.test(ruleText), true);
const claudeMd = fs.readFileSync(path.join(project, ".claude/CLAUDE.md"), "utf8");
check("CLAUDE.md is under 200 lines", claudeMd.split("\n").length < 200, true);

// --- the installed hooks actually run from their new home -----------------
console.log("\ninstalled hooks run in place");
const runInstalled = (script, payload) => {
  const r = spawnSync(process.execPath, [path.join(project, ".claude/hooks", script)],
    { input: JSON.stringify(payload), encoding: "utf8" });
  const out = (r.stdout || "").trim();
  return { status: r.status, json: out ? JSON.parse(out) : null };
};

const ctx = runInstalled("session-context.js", { hook_event_name: "SessionStart", source: "startup", cwd: project });
check("session-context exits 0", ctx.status, 0);
check("session-context reports the editor version",
  (ctx.json?.hookSpecificOutput?.additionalContext || "").includes("6000.0.32f1"), true);

const prefab = runInstalled("guard-serialized-assets.js", {
  hook_event_name: "PreToolUse", tool_name: "Write", cwd: project,
  tool_input: { file_path: path.join(project, "Assets/Enemy.prefab"), content: "x" },
});
check("prefab edit is denied", prefab.json?.hookSpecificOutput?.permissionDecision, "deny");

const legacyInput = runInstalled("guard-runtime-code.js", {
  hook_event_name: "PreToolUse", tool_name: "Write", cwd: project,
  tool_input: { file_path: path.join(project, "Assets/Scripts/P.cs"),
    content: "using UnityEngine;\npublic class P : MonoBehaviour { void Update() { Input.GetKey(KeyCode.W); } }\n" },
});
check("legacy Input is denied", legacyInput.json?.hookSpecificOutput?.permissionDecision, "deny");

// --- the ${CLAUDE_PROJECT_DIR} placeholder --------------------------------
const argPath = settings().hooks.SessionStart[0].hooks[0].args[0];
check("hook args use CLAUDE_PROJECT_DIR", argPath.startsWith("${CLAUDE_PROJECT_DIR}/.claude/hooks/"), true);

// --- second install -------------------------------------------------------
console.log("\nsecond install (idempotency)");
// Edit CLAUDE.md the way a user would, before re-running.
fs.appendFileSync(path.join(project, ".claude/CLAUDE.md"), "\n- MY PROJECT NOTE\n");
const second = install();
check("exits 0", second.status, 0);
check("still 2 kit matcher groups, not 4", kitEntries().length, 2);
check("still preserves the project's Bash hook",
  settings().hooks.PreToolUse.filter(e => e.hooks.some(h => h.command === "echo mine")).length, 1);
check("still preserves env", settings().env.MY_VAR, "keep me");
check("still keeps the project's own agent",
  fs.readFileSync(path.join(project, ".claude/agents/code-reviewer.md"), "utf8").trim().endsWith("mine"), true);
// The regression this file exists for: a second install must not revert an
// edited CLAUDE.md. It did, once.
check("does not revert an edited CLAUDE.md",
  fs.readFileSync(path.join(project, ".claude/CLAUDE.md"), "utf8").includes("MY PROJECT NOTE"), true);
check("does not write CLAUDE.unity-kit.md beside its own file",
  fs.existsSync(path.join(project, ".claude/CLAUDE.unity-kit.md")), false);

// --- refuses a non-Unity directory ---------------------------------------
console.log("\nguards");
const notUnity = spawnSync(process.execPath, [path.join(KIT, "install.js"), root], { encoding: "utf8" });
check("refuses a directory that is not a Unity project", notUnity.status, 1);

const broken = path.join(root, "Broken");
fs.mkdirSync(path.join(broken, "Assets"), { recursive: true });
fs.mkdirSync(path.join(broken, "ProjectSettings"), { recursive: true });
fs.mkdirSync(path.join(broken, ".claude"), { recursive: true });
fs.writeFileSync(path.join(broken, ".claude/settings.json"), "{ not json");
const brokenRun = spawnSync(process.execPath, [path.join(KIT, "install.js"), broken], { encoding: "utf8" });
check("refuses rather than clobbering an unparseable settings.json", brokenRun.status, 1);
check("left the unparseable file alone", fs.readFileSync(path.join(broken, ".claude/settings.json"), "utf8"), "{ not json");

fs.rmSync(root, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail.length} failed`);
if (fail.length) { for (const f of fail) console.log(`  - ${f}`); process.exit(1); }
