// Copies Steam's Motiva Sans faces and controller glyphs into steam/, where screen.html and Glyph
// load them. Steam on a device serves both; SteamDatabase's copy of the client on GitHub has the
// glyphs.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HERE, type Target, quote, sshOptions } from "./settings.ts";

export const ASSETS = join(HERE, "steam");

// Steam serves each face of its font pack at /custom_fonts/clientui.uifont?MotivaSans-<face>.
const FACES: Record<string, [number, string]> = {
  Regular: [400, "normal"], RegularItalic: [400, "italic"], Light: [300, "normal"], Medium: [500, "normal"],
  Bold: [700, "normal"], BoldItalic: [700, "italic"], ExtraBold: [800, "normal"], Black: [900, "normal"],
};
const GLYPHS = ["sd_l1", "sd_r1", "sc_button_steam", "shared_button_a", "shared_button_b", "shared_button_x",
  "shared_button_y"];
// The files Steam serves at /steaminputglyphs/.
const GITHUB = "https://raw.githubusercontent.com/SteamDatabase/SteamTracking/master/ClientExtracted/controller_base/" +
  "images/api/knockout";

// Runs in Steam's page: fetches [file, url] pairs and returns [file, base64], null for a failed fetch.
const FETCH = `(files) => Promise.all(files.map(([file, url]) => fetch(url).then(async (r) => {
  if (!r.ok) return [file, null];
  let s = ""; const u = new Uint8Array(await r.arrayBuffer());
  for (let i = 0; i < u.length; i += 32768) s += String.fromCharCode(...u.subarray(i, i + 32768));
  return [file, btoa(s)];
})))`;

export function hasAssets(): boolean {
  return existsSync(ASSETS) && readdirSync(ASSETS).length > 0;
}

// Evaluates an expression in one of Steam's CEF pages on the device, through cdp.py.
function evaluate(target: Target, device: string, expression: string, page: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawn("ssh", [...sshOptions(target), device, `python3 -I - ${quote(expression)} ${quote(page)}`]);
    let out = "";
    let errors = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (errors += d));
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve(JSON.parse(out));
      else reject(new Error(errors.trim().split("\n").pop() || `ssh exited with ${code}`));
    });
    child.stdin.end(readFileSync(join(HERE, "cdp.py")));
  });
}

// Writes the files into steam/ and returns their names. With github, writes the glyphs alone.
export async function fetchAssets(target: Target, github: boolean): Promise<string[]> {
  const written: string[] = [];
  const write = (name: string, data: Buffer) => {
    mkdirSync(ASSETS, { recursive: true });
    writeFileSync(join(ASSETS, name), data);
    written.push(name);
  };
  if (github) {
    for (const name of GLYPHS) {
      const res = await fetch(`${GITHUB}/${name}.svg`);
      if (res.ok) write(`${name}.svg`, Buffer.from(await res.arrayBuffer()));
      else console.warn(`${name}.svg: GitHub answers ${res.status}, the screen shows its letter`);
    }
    return written;
  }
  if (!target.device) throw new Error("no device: pass --device, or --github for the glyphs alone");
  const files = [
    ...Object.keys(FACES).map((f) => [`MotivaSans-${f}.ttf`, `/custom_fonts/clientui.uifont?MotivaSans-${f}`]),
    ...GLYPHS.map((n) => [`${n}.svg`, `/steaminputglyphs/${n}.svg`]),
  ];
  const got = await evaluate(target, target.device, `(${FETCH})(${JSON.stringify(files)})`, "Steam Big Picture Mode");
  for (const [name, data] of got as [string, string | null][]) {
    if (data) write(name, Buffer.from(data, "base64"));
    else console.warn(`${name}: Steam on the device does not serve it`);
  }
  const css = Object.entries(FACES).filter(([f]) => written.includes(`MotivaSans-${f}.ttf`)).map(([f, [weight, style]]) =>
    `@font-face { font-family: "Motiva Sans"; src: url("MotivaSans-${f}.ttf"); font-weight: ${weight}; ` +
    `font-style: ${style}; }`);
  if (css.length) write("fonts.css", Buffer.from(css.join("\n") + "\n"));
  return written;
}
