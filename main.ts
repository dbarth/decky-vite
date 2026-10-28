// Starts the harness: the fake Steam, the plugin, the screen and the input. This module holds no
// component, so a change to the plugin stops here and the plugin's state stays.
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import * as hooks from "virtual:decky-vite/hooks";
import definition from "virtual:decky-vite/plugin";
import settings from "virtual:decky-vite/settings";
import { App, Plugin } from "./app";
import { focusPlace, place } from "./focus";
import { startInput } from "./input";
import { HOME, navigate, path, setQam, shell } from "./shell";
import { startSteam } from "./steam";
import "./shell.css";

// Keeps what the plugin's hooks save across the full reloads that a change to its state or its
// backend causes.
const SAVED = "decky-vite-persist";

function restore() {
  const persist = hooks.persist;
  if (!persist) return;
  try {
    const saved = JSON.parse(sessionStorage.getItem(SAVED) ?? "null");
    if (saved) persist.restore(saved);
  } catch {
    // Starts from the plugin's own defaults.
  }
  addEventListener("pagehide", () => {
    try {
      sessionStorage.setItem(SAVED, JSON.stringify(persist.save()));
    } catch {
      // Private windows refuse storage.
    }
  });
}

const root = createRoot(document.getElementById("root")!);

function render(plugin: Plugin) {
  root.render(createElement(App, { plugin }));
}

if (import.meta.hot) {
  // A change to the plugin's code defines it again; the focus goes back to its place.
  import.meta.hot.accept("virtual:decky-vite/plugin", (mod) => {
    if (!mod) return;
    const was = place();
    render(mod.default() as Plugin);
    requestAnimationFrame(() => requestAnimationFrame(() => was && focusPlace(was)));
  });
}

restore();
await startSteam();
const plugin = definition() as Plugin;
render(plugin);
parent.postMessage({ deckyVite: "plugin", name: plugin.name }, location.origin);
hooks.setup?.();
startInput();
// A first start shows the settings' route or the plugin's first, else the library with the Quick
// Access menu open.
if (path() === HOME && !location.hash) {
  const start = settings.route ?? [...shell.routes.keys()][0];
  if (start) navigate(start);
  else setQam(true);
}
