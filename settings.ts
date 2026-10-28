// Resolves the harness's settings from the command line, then .env in this folder, then the
// plugin's decky-vite.json or the "decky-vite" key of its package.json, then the defaults. cli.ts
// and vite.config.ts both call it.
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { DEVICES } from "./devices.ts";

export const HERE = dirname(fileURLToPath(import.meta.url));

// The command line's options, as cli.ts parses them.
export interface Options {
  plugin?: string;
  device?: string;
  ssh?: string;
  model?: string;
  port?: string;
  route?: string;
}

export interface Target {
  // user@host, or null to replay the fixtures only.
  device: string | null;
  ssh: string[];
}

export interface Settings extends Target {
  // The plugin's folder, its name from plugin.json and its folder name under Decky's from
  // package.json.
  plugin: string;
  // The file that holds the plugin's settings for decky-vite: a change restarts the server.
  config: string;
  name: string;
  slug: string;
  model: string;
  port: number;
  // Absolute paths of the plugin's frontend entry and of its harness hooks.
  entry: string;
  hooks: string | null;
  // What the device runs, relative to the plugin. A trailing slash copies a folder's contents.
  backend: string[];
  // Decky's folder on the device.
  decky: string;
  // The page shown at start. Null shows the plugin's first route.
  route: string | null;
}

interface PluginConfig {
  entry?: string;
  backend?: string[];
  decky?: string;
  route?: string;
  hooks?: string;
  manifest?: string;
}

const CONFIG_KEYS = ["entry", "backend", "decky", "route", "hooks", "manifest"];

function env(): Record<string, string> {
  return loadEnv("development", HERE, "DECKY_VITE_");
}

function readJson(file: string): Record<string, unknown> | null {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw new Error(`${file}: ${(e as Error).message}`);
  }
}

// ssh's options for the harness's connections: no password prompt, and an asleep device costs 4 s.
export function sshOptions(target: Target): string[] {
  return ["-o", "BatchMode=yes", "-o", "ConnectTimeout=4", ...target.ssh];
}

// Quotes a word for the device's shell.
export function quote(word: string): string {
  return `'${word.replaceAll("'", "'\\''")}'`;
}

export function resolveTarget(options: Options): Target {
  const e = env();
  const device = options.device || e.DECKY_VITE_DEVICE || null;
  const ssh = options.ssh ?? e.DECKY_VITE_SSH ?? "";
  return {
    device: device && !device.includes("@") ? `deck@${device}` : device,
    ssh: ssh.split(/\s+/).filter(Boolean),
  };
}

export function resolveSettings(options: Options): Settings {
  const e = env();
  // npm runs scripts in this folder: a relative --plugin is taken from where npm was started, a
  // relative DECKY_VITE_PLUGIN from this folder.
  if (!options.plugin && !e.DECKY_VITE_PLUGIN) {
    throw new Error("no plugin: pass --plugin <folder> or set DECKY_VITE_PLUGIN in .env");
  }
  const plugin = options.plugin ? resolve(process.env.INIT_CWD ?? process.cwd(), options.plugin)
    : resolve(HERE, e.DECKY_VITE_PLUGIN);
  const pkg = readJson(join(plugin, "package.json")) ?? {};
  const own = join(plugin, "decky-vite.json");
  const configFile = existsSync(own) ? own : join(plugin, "package.json");
  const where = existsSync(own) ? "decky-vite.json" : 'package.json\'s "decky-vite"';
  const config = ((existsSync(own) ? readJson(own) : pkg["decky-vite"]) ?? {}) as PluginConfig;
  for (const key of Object.keys(config)) {
    if (!CONFIG_KEYS.includes(key)) throw new Error(`${where}: unknown key ${key}`);
  }
  const manifestFile = resolve(plugin, config.manifest ?? "plugin.json");
  const manifest = readJson(manifestFile);
  if (!manifest) throw new Error(`no ${manifestFile}: point --plugin at a Decky plugin, or set manifest in ${where}`);
  const model = options.model || e.DECKY_VITE_MODEL || "deck";
  if (!DEVICES[model]) throw new Error(`unknown model ${model}: ${Object.keys(DEVICES).join(", ")}`);
  const portText = options.port || e.DECKY_VITE_PORT || "5199";
  const port = Number(portText);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`bad port ${portText}`);
  const entry = resolve(plugin, config.entry ?? "src/index.tsx");
  if (!existsSync(entry)) throw new Error(`no entry ${entry}: set entry in ${where}`);
  const hooks = config.hooks ? resolve(plugin, config.hooks) : null;
  if (hooks && !existsSync(hooks)) throw new Error(`no hooks module ${hooks}`);
  const slug = String(pkg.name ?? basename(plugin));
  return {
    ...resolveTarget(options),
    plugin,
    config: configFile,
    name: String(manifest.name ?? slug),
    slug,
    model,
    port,
    entry,
    hooks,
    backend: config.backend ?? ["main.py", "py_modules", "defaults/"],
    decky: config.decky ?? "~/homebrew",
    route: options.route ?? config.route ?? null,
  };
}
