"use strict";
/**
 * Reading the Unity project the session is sitting in.
 *
 * Every guardrail in this plugin asks the project before it asks a rulebook.
 * "Never use the legacy Input API" is wrong in a project that never installed
 * the Input System, and a rule that is wrong some of the time gets disabled all
 * of the time -- so the facts come from ProjectVersion.txt, manifest.json and
 * ProjectSettings.asset, and the rules read them.
 */

const fs = require("fs");
const path = require("path");

const read = (file) => {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
};

/**
 * Walk up from `startDir` for a directory holding both Assets and
 * ProjectSettings. Returns null when the session is not in a Unity project,
 * which is the signal for every hook to stand down.
 */
function findProjectRoot(startDir) {
  let dir = path.resolve(startDir || process.cwd());
  for (let depth = 0; depth < 12; depth++) {
    if (fs.existsSync(path.join(dir, "Assets")) && fs.existsSync(path.join(dir, "ProjectSettings"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** "6000.0.32f1" from ProjectSettings/ProjectVersion.txt, or null. */
function editorVersion(root) {
  const text = read(path.join(root, "ProjectSettings", "ProjectVersion.txt"));
  const match = text && text.match(/m_EditorVersion:\s*(\S+)/);
  return match ? match[1] : null;
}

/** Major version as a number: 6000.0.32f1 -> 6000, 2022.3.1f1 -> 2022. */
function majorVersion(version) {
  const match = String(version || "").match(/^(\d+)/);
  return match ? Number(match[1]) : 0;
}

/** The dependencies map from Packages/manifest.json. */
function packages(root) {
  const text = read(path.join(root, "Packages", "manifest.json"));
  if (!text) return {};
  try {
    return JSON.parse(text).dependencies || {};
  } catch {
    return {};
  }
}

/**
 * Which input backends the player is built with, from ProjectSettings.asset.
 *
 * 0 = legacy only, 1 = Input System only, 2 = both. The value decides whether
 * `Input.GetKey` is a style preference or a guaranteed runtime exception, so it
 * is worth reading rather than assuming.
 */
function activeInputHandler(root) {
  const text = read(path.join(root, "ProjectSettings", "ProjectSettings.asset"));
  const match = text && text.match(/activeInputHandler:\s*(\d)/);
  return match ? Number(match[1]) : null;
}

/** The render pipeline in use, inferred from the installed packages. */
function renderPipeline(deps) {
  if (deps["com.unity.render-pipelines.high-definition"]) return "HDRP";
  if (deps["com.unity.render-pipelines.universal"]) return "URP";
  return "Built-in";
}

/** Assembly definition files, which say where the project's real seams are. */
function assemblyDefinitions(root, limit = 40) {
  const found = [];
  const walk = (dir, depth) => {
    if (depth > 8 || found.length >= limit) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (found.length >= limit) return;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "Plugins" || entry.name.startsWith(".")) continue;
        walk(full, depth + 1);
      } else if (entry.name.endsWith(".asmdef")) {
        found.push(path.relative(root, full).split(path.sep).join("/"));
      }
    }
  };
  walk(path.join(root, "Assets"), 0);
  return found;
}

/**
 * Whether the file compiles into an editor-only assembly.
 *
 * The `Editor/` folder name is the convention, but the authority is the nearest
 * .asmdef: `includePlatforms: ["Editor"]` is what actually keeps the assembly
 * out of a player build. Test assemblies are the case that proves it -- they sit
 * in Tests/EditMode, reference UnityEditor legitimately, and have no Editor
 * folder anywhere in their path.
 */
function isEditorOnlyAssembly(file, root) {
  let dir = path.dirname(path.resolve(file));
  const stop = path.resolve(root);

  for (let depth = 0; depth < 12; depth++) {
    let entries;
    try {
      entries = fs.readdirSync(dir).filter((name) => name.endsWith(".asmdef"));
    } catch {
      entries = [];
    }

    if (entries.length) {
      const text = read(path.join(dir, entries[0]));
      if (text) {
        try {
          const platforms = JSON.parse(text).includePlatforms;
          return Array.isArray(platforms) && platforms.length === 1 && platforms[0] === "Editor";
        } catch {
          return false;
        }
      }
      return false;
    }

    if (path.resolve(dir) === stop) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return false;
}

/** Immediate subfolders of Assets, as a cheap map of how the project is laid out. */
function assetFolders(root, limit = 20) {
  try {
    return fs
      .readdirSync(path.join(root, "Assets"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => entry.name)
      .slice(0, limit);
  } catch {
    return [];
  }
}

/** Everything the hooks and the session summary need, read once. */
function facts(root) {
  const deps = packages(root);
  const version = editorVersion(root);
  const inputHandler = activeInputHandler(root);

  const notable = [
    ["com.unity.inputsystem", "Input System"],
    ["com.unity.entities", "Entities (DOTS)"],
    ["com.unity.burst", "Burst"],
    ["com.unity.collections", "Collections"],
    ["com.unity.addressables", "Addressables"],
    ["com.unity.netcode.gameobjects", "Netcode for GameObjects"],
    ["com.unity.netcode", "Netcode for Entities"],
    ["com.unity.test-framework", "Test Framework"],
    ["com.unity.cinemachine", "Cinemachine"],
    ["com.unity.timeline", "Timeline"],
    ["com.unity.localization", "Localization"],
    ["com.unity.ai.navigation", "AI Navigation"],
    ["com.unity.xr.interaction.toolkit", "XR Interaction Toolkit"],
  ]
    .filter(([id]) => deps[id])
    .map(([id, label]) => `${label} ${deps[id]}`);

  return {
    root,
    version,
    major: majorVersion(version),
    pipeline: renderPipeline(deps),
    inputHandler,
    hasInputSystem: Boolean(deps["com.unity.inputsystem"]),
    hasEntities: Boolean(deps["com.unity.entities"]),
    hasUniTask: Boolean(deps["com.cysharp.unitask"]),
    hasTestFramework: Boolean(deps["com.unity.test-framework"]),
    packages: notable,
    packageCount: Object.keys(deps).length,
    asmdefs: assemblyDefinitions(root),
    folders: assetFolders(root),
  };
}

/** How the project's input setting reads in a sentence. */
function inputHandlerLabel(handler) {
  if (handler === 0) return "legacy Input Manager only";
  if (handler === 1) return "Input System only";
  if (handler === 2) return "both backends";
  return "unknown";
}

/**
 * Files Unity owns: serialized YAML whose meaning lives in fileIDs and GUIDs
 * rather than in the text. Editing one by hand is the single cheapest way to
 * break a project in a manner that surfaces days later and somewhere else.
 */
const UNITY_SERIALIZED_EXTENSIONS = new Set([
  ".unity", ".prefab", ".asset", ".mat", ".controller", ".overridecontroller",
  ".anim", ".mask", ".playable", ".signal", ".terrainlayer", ".spriteatlas",
  ".spriteatlasv2", ".physicmaterial", ".physicsmaterial2d", ".physicmaterial2d",
  ".lighting", ".giparams", ".cubemap", ".rendertexture", ".mixer", ".preset",
  ".guiskin", ".fontsettings", ".flare", ".brush", ".shadervariants",
]);

/** Text formats that are editable, but whose edits have consequences. */
const SENSITIVE_TEXT_FILES = new Set(["manifest.json", "packages-lock.json"]);

module.exports = {
  findProjectRoot,
  editorVersion,
  majorVersion,
  packages,
  activeInputHandler,
  inputHandlerLabel,
  renderPipeline,
  assemblyDefinitions,
  isEditorOnlyAssembly,
  assetFolders,
  facts,
  UNITY_SERIALIZED_EXTENSIONS,
  SENSITIVE_TEXT_FILES,
};
