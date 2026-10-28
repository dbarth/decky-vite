// Serves the plugin's backend calls to the harness. The backend runs on the device over ssh, from
// the plugin's working copy. Every answer is saved under fixtures/ to replay when the device is off.
import { ChildProcess, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { IncomingMessage, ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import type { Plugin, ViteDevServer } from "vite";
import { HERE, type Settings, quote, sshOptions } from "./settings.ts";

// An error the plugin's backend raised: the device answered.
class BackendError extends Error {}

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
}

class Device {
  private child: ChildProcess | null = null;
  private ready: Promise<void> | null = null;
  private pending = new Map<number, Pending>();
  private next = 1;
  private failedAt = 0;

  constructor(private s: Settings & { device: string }) {}

  // Copies the plugin and the bridge to ~/.cache/decky-vite/<slug>/plugin on the device and starts
  // the bridge there.
  private async start(): Promise<void> {
    const ssh = sshOptions(this.s);
    const dev = `.cache/decky-vite/${this.s.slug}`;
    await run(this.s.plugin, "rsync", [
      "-a", "--delete", "--exclude", "__pycache__", `--rsync-path=mkdir -p ${dev}/plugin && rsync`,
      "-e", ["ssh", ...ssh].join(" "),
      ...this.s.backend.filter((f) => existsSync(join(this.s.plugin, f))), join(HERE, "bridge.py"), join(HERE, "cdp.py"),
      `${this.s.device}:${dev}/plugin/`,
    ]);
    const command = ["python3", "-I", "-u", `${dev}/plugin/bridge.py`, dev, this.s.slug, this.s.decky];
    const child = spawn("ssh", [...ssh, this.s.device, command.map(quote).join(" ")]);
    this.child = child;
    child.stderr!.on("data", (d) => process.stderr.write(`[device] ${d}`));
    return new Promise((resolve, reject) => {
      createInterface({ input: child.stdout!, crlfDelay: Infinity }).on("line", (line) => {
        const msg = JSON.parse(line);
        if (msg.ready) return resolve();
        const p = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) p?.reject(new BackendError(msg.error));
        else p?.resolve(msg.result);
      });
      child.on("exit", (code) => {
        reject(new Error(`bridge exited with ${code}`));
        for (const p of this.pending.values()) p.reject(new Error("bridge exited"));
        this.pending.clear();
        if (this.child === child) {
          this.child = null;
          this.ready = null;
        }
      });
    });
  }

  // Waits 10 s after a failure before the next try, so an asleep device costs one timeout.
  call(method: string, args: unknown[]): Promise<unknown> {
    if (!this.ready) {
      if (Date.now() - this.failedAt < 10_000) return Promise.reject(new Error("device offline"));
      this.ready = this.start().catch((e) => {
        console.warn(`[device] ${e.message}`);
        this.failedAt = Date.now();
        this.ready = null;
        this.child?.kill();
        throw e;
      });
    }
    return this.ready.then(() => new Promise((resolve, reject) => {
      const id = this.next++;
      this.pending.set(id, { resolve, reject });
      this.child!.stdin!.write(JSON.stringify({ id, method, args }) + "\n");
    }));
  }

  // The next call starts the bridge again.
  stop() {
    this.child?.kill();
    this.child = null;
    this.ready = null;
    this.failedAt = 0;
  }
}

// Runs a command in a folder without blocking the dev server.
function run(cwd: string, command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd });
    let errors = "";
    child.stderr.on("data", (d) => (errors += d));
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${command}: ${errors.trim()}`))));
  });
}

function fixture(slug: string, method: string, args: unknown[]): string {
  const key = createHash("sha1").update(JSON.stringify(args)).digest("hex").slice(0, 16);
  return join(HERE, "fixtures", slug, method, `${key}.json`);
}

function body(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
  });
}

function send(res: ServerResponse, status: number, type: string, data: string | Buffer) {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(data);
}

const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };

export function backend(settings: Settings): Plugin {
  const device = settings.device ? new Device({ ...settings, device: settings.device }) : null;
  // Images the harness's fake Steam set or cleared, by grid file name. null marks a cleared one.
  const grid = new Map<string, Buffer | null>();

  // Whether the last call reached the device, for the studio's status: null before any call.
  let online: boolean | null = null;

  // Replays the answer to the same call when the device does not answer.
  async function call(method: string, args: unknown[]): Promise<unknown> {
    const file = fixture(settings.slug, method, args);
    try {
      if (!device) throw new Error("no device");
      const result = await device.call(method, args);
      online = true;
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify(result));
      return result;
    } catch (e) {
      if (e instanceof BackendError) {
        online = true;
        throw e;
      }
      if (device) online = false;
      if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));
      throw new Error(`${device ? "device offline" : "no device"}, no fixture`);
    }
  }

  return {
    name: "decky-vite-backend",
    configureServer(server: ViteDevServer) {
      // Vite closes the server when its config changes and starts a new one with a new bridge.
      server.httpServer?.once("close", () => device?.stop());
      // A change to the backend restarts the bridge and reloads the page.
      const watched = settings.backend.map((f) => join(settings.plugin, f).replace(/\/$/, ""));
      watched.push(join(HERE, "bridge.py"));
      server.watcher.add(watched);
      server.watcher.on("change", (path) => {
        if (path.includes("__pycache__") || !watched.some((w) => path === w || path.startsWith(`${w}/`))) return;
        device?.stop();
        server.ws.send({ type: "full-reload" });
      });
      server.middlewares.use(async (req, res, nextMiddleware) => {
        const url = new URL(req.url!, "http://x");
        if (url.pathname === "/__backend") {
          return send(res, 200, "application/json", JSON.stringify({ host: settings.device, online }));
        }
        try {
          if (url.pathname.startsWith("/rpc/")) {
            const method = url.pathname.slice(5);
            const result = await call(method, JSON.parse(await body(req)));
            return send(res, 200, "application/json", JSON.stringify({ result }));
          }
          if (url.pathname.startsWith("/__grid/")) {
            const name = url.pathname.slice(8);
            if (req.method === "PUT") {
              grid.set(name, Buffer.from(await body(req), "base64"));
              return send(res, 204, "text/plain", "");
            }
            if (req.method === "DELETE") {
              grid.set(name, null);
              return send(res, 204, "text/plain", "");
            }
            const type = MIME[name.split(".").pop()!] ?? "application/octet-stream";
            if (grid.has(name)) {
              const data = grid.get(name);
              return data ? send(res, 200, type, data) : send(res, 404, "text/plain", "cleared");
            }
            const data = await call("_grid", [name]);
            return send(res, 200, type, Buffer.from(String(data), "base64"));
          }
        } catch (e) {
          if (url.pathname.startsWith("/rpc/")) return send(res, 200, "application/json", JSON.stringify({ error: String(e) }));
          return send(res, 404, "text/plain", String(e));
        }
        nextMiddleware();
      });
    },
  };
}
