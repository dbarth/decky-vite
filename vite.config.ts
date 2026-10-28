// The UX harness: the plugin's pages in a browser with hot reload, around fakes of Decky and Steam.
// Run with: npm run dev [-- options]. cli.ts hands its options over in DECKY_VITE_ARGS.
import react from "@vitejs/plugin-react";
import { join } from "node:path";
import { defineConfig, type Plugin } from "vite";
import { backend } from "./backend.ts";
import { display } from "./display.ts";
import { HERE, type Settings, resolveSettings } from "./settings.ts";

const settings = resolveSettings(JSON.parse(process.env.DECKY_VITE_ARGS ?? "{}"));

function exactly(path: string): RegExp {
  return new RegExp(`^${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
}

// Gives the page the plugin's entry, its hooks and the settings it reads, under virtual:decky-vite/.
function modules(s: Settings): Plugin {
  const page = { name: s.name, model: s.model, route: s.route };
  const config = s.config;
  return {
    name: "decky-vite-modules",
    enforce: "pre",
    resolveId(id) {
      if (id === "virtual:decky-vite/plugin") return s.entry;
      if (id === "virtual:decky-vite/hooks") return s.hooks ?? "\0decky-vite-hooks";
      if (id === "virtual:decky-vite/settings") return "\0decky-vite-settings";
    },
    load(id) {
      if (id === "\0decky-vite-hooks") return "export {};";
      if (id === "\0decky-vite-settings") return `export default ${JSON.stringify(page)};`;
    },
    configureServer(server) {
      server.watcher.add(config);
      server.watcher.on("all", (_event, path) => path === config && server.restart());
    },
  };
}

export default defineConfig({
  root: HERE,
  // The plugin's entry exports no component: a change under it goes up to main.ts, which
  // defines the plugin again.
  plugins: [react({ exclude: exactly(settings.entry) }), modules(settings), backend(settings), display()],
  resolve: {
    // The plugin's code imports React from outside this folder: give it this folder's copy.
    dedupe: ["react", "react-dom"],
    alias: {
      "@decky/ui": join(HERE, "decky-ui.tsx"),
      "@decky/api": join(HERE, "decky-api.ts"),
    },
  },
  server: { port: settings.port, strictPort: true, fs: { allow: [HERE, settings.plugin] } },
});
