#!/usr/bin/env node
"use strict";
/**
 * Copies template/ into a Unity project as .claude/.
 *
 *   node install.js "C:/Path/To/UnityProject"
 *   node install.js ../MyGame --dry-run
 *
 * Safe to re-run, and safe to run on a project that already has a .claude/.
 *
 * It records what it installed in .claude/.unity-kit.json and will only ever
 * replace a file listed there. A file with the same name that it did not write
 * -- your own agent, your own rule -- is left alone and reported. The first
 * dry run of this script against a real project found it about to overwrite a
 * hand-written code-reviewer agent, which is the whole reason the manifest
 * exists: "replaces the files it owns" has to mean something checkable.
 */

const fs = require("fs");
const path = require("path");

const TEMPLATE = path.join(__dirname, "template");
const MANIFEST = ".unity-kit.json";

const positional = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const dryRun = process.argv.includes("--dry-run");

if (!positional.length) {
  console.error("usage: node install.js <path-to-unity-project> [--dry-run]");
  process.exit(2);
}

const project = path.resolve(positional[0]);
const claude = path.join(project, ".claude");

if (!fs.existsSync(path.join(project, "Assets")) || !fs.existsSync(path.join(project, "ProjectSettings"))) {
  console.error(`Not a Unity project (no Assets/ and ProjectSettings/): ${project}`);
  process.exit(1);
}

// --- what a previous run installed ----------------------------------------

const manifestPath = path.join(claude, MANIFEST);
let owned = new Set();
try {
  owned = new Set(JSON.parse(fs.readFileSync(manifestPath, "utf8")).files || []);
} catch {
  owned = new Set();
}

const added = [];
const updated = [];
const kept = [];
const installed = [];
const notes = [];

const posix = (p) => p.split(path.sep).join("/");

/** Write one template file, unless it exists and belongs to someone else. */
function place(relative, write) {
  const destination = path.join(claude, relative);
  const key = posix(relative);
  const exists = fs.existsSync(destination);

  if (exists && !owned.has(key)) {
    kept.push(key);
    return false;
  }

  if (!dryRun) {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    write(destination);
  }
  (exists ? updated : added).push(key);
  installed.push(key);
  return true;
}

function placeTree(folder) {
  const from = path.join(TEMPLATE, folder);
  if (!fs.existsSync(from)) return;

  const walk = (dir, relative) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const source = path.join(dir, entry.name);
      const rel = path.join(relative, entry.name);
      if (entry.isDirectory()) walk(source, rel);
      else place(rel, (destination) => fs.copyFileSync(source, destination));
    }
  };

  walk(from, folder);
}

// --- hooks, rules, skills, agents -----------------------------------------

for (const folder of ["hooks", "rules", "skills", "agents"]) placeTree(folder);

// --- project instructions --------------------------------------------------

const wroteClaudeMd = place("CLAUDE.md", (destination) =>
  fs.copyFileSync(path.join(TEMPLATE, "CLAUDE.md"), destination)
);

if (wroteClaudeMd) {
  notes.push("Open .claude/CLAUDE.md and fill in the bracketed lines at the top.");
} else {
  place("CLAUDE.unity-kit.md", (destination) =>
    fs.copyFileSync(path.join(TEMPLATE, "CLAUDE.md"), destination)
  );
  notes.push(
    "You already have a .claude/CLAUDE.md. It was left alone and ours is beside it\n" +
      "as CLAUDE.unity-kit.md — fold in the parts you want, or add\n" +
      "`@CLAUDE.unity-kit.md` to your own file to load it whole."
  );
}

// --- settings: merged, never replaced --------------------------------------

const settingsPath = path.join(claude, "settings.json");
const ours = JSON.parse(fs.readFileSync(path.join(TEMPLATE, "settings.json"), "utf8"));

/**
 * Drop whatever a previous run of this installer put in, then append the
 * current set, so re-running leaves one copy rather than a stack. Everything
 * else in the file is preserved, including other people's hooks.
 */
function merge(existing) {
  const isOurs = (entry) =>
    (entry.hooks || []).some((hook) =>
      [hook.command, ...(hook.args || [])].join(" ").includes("/.claude/hooks/")
    );

  existing.hooks = existing.hooks || {};
  for (const [event, matchers] of Object.entries(ours.hooks)) {
    const others = (existing.hooks[event] || []).filter((entry) => !isOurs(entry));
    existing.hooks[event] = others.concat(matchers);
  }
  return existing;
}

if (fs.existsSync(settingsPath)) {
  let existing;
  try {
    existing = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  } catch (error) {
    console.error(`\n.claude/settings.json is not valid JSON, so it was not touched:\n  ${error.message}`);
    process.exit(1);
  }
  const merged = merge(existing);
  if (!dryRun) {
    fs.copyFileSync(settingsPath, `${settingsPath}.bak`);
    fs.writeFileSync(settingsPath, `${JSON.stringify(merged, null, 2)}\n`);
  }
  updated.push("settings.json (merged)");
  installed.push("settings.json");
  notes.push("Your previous settings.json is at .claude/settings.json.bak");
} else {
  if (!dryRun) {
    fs.mkdirSync(claude, { recursive: true });
    fs.writeFileSync(settingsPath, `${JSON.stringify(ours, null, 2)}\n`);
  }
  added.push("settings.json");
  installed.push("settings.json");
}

if (!dryRun) {
  fs.writeFileSync(
    manifestPath,
    `${JSON.stringify({ installed: new Date().toISOString().slice(0, 10), files: installed.sort() }, null, 2)}\n`
  );
}

// --- report ----------------------------------------------------------------

console.log(`${dryRun ? "Would install" : "Installed"} into ${posix(project)}/.claude/\n`);

const section = (label, list) => {
  if (!list.length) return;
  console.log(`${label} (${list.length})`);
  for (const item of list.slice(0, 40)) console.log(`  ${item}`);
  if (list.length > 40) console.log(`  … and ${list.length - 40} more`);
  console.log("");
};

section("added", added);
section("updated", updated);
section("kept — yours, not overwritten", kept);

if (kept.length) {
  notes.push(
    "The files under 'kept' already existed and were not written by this kit, so\n" +
      "they were left as they are. Compare them against template/ if you want ours."
  );
}

if (!dryRun) {
  console.log("Restart the Claude Code session in this project — hooks and instructions");
  console.log("load at session start.");
}
for (const note of notes) console.log(`\n${note}`);
