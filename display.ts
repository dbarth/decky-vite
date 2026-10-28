// Serves the size of the Mac's screens at /__display, so the page can draw the device's screen at
// its physical size. macOS reads each screen's width in millimetres from its EDID.
import { execFile } from "node:child_process";
import type { Plugin } from "vite";

export interface Screen {
  // Frame in points, as the browser's screen object gives it at 100 % zoom.
  x: number;
  y: number;
  w: number;
  h: number;
  mmw: number;
  mmh: number;
  // Pixels per point.
  scale: number;
}

const SWIFT = `
import AppKit
var out: [[String: Double]] = []
for s in NSScreen.screens {
    let id = s.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as! CGDirectDisplayID
    let mm = CGDisplayScreenSize(id)
    out.append(["x": s.frame.origin.x, "y": s.frame.origin.y, "w": s.frame.width, "h": s.frame.height,
                "mmw": mm.width, "mmh": mm.height, "scale": s.backingScaleFactor])
}
print(String(data: try! JSONSerialization.data(withJSONObject: out), encoding: .utf8)!)
`;

function screens(): Promise<Screen[]> {
  if (process.platform !== "darwin") return Promise.resolve([]);
  return new Promise((resolve) => {
    const child = execFile("swift", ["-"], (error, stdout) => {
      try {
        resolve(error ? [] : (JSON.parse(stdout) as Screen[]).filter((s) => s.mmw > 0));
      } catch {
        resolve([]);
      }
    });
    child.stdin!.end(SWIFT);
  });
}

export function display(): Plugin {
  // The Swift interpreter takes about 3 s: start it with the server.
  let found: Promise<Screen[]> | null = null;
  return {
    name: "decky-vite-display",
    configureServer(server) {
      found ??= screens();
      server.middlewares.use("/__display", async (_req, res) => {
        res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        res.end(JSON.stringify(await found));
      });
    },
  };
}
