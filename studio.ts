// The studio around the device's screen: the toolbar, a sketch of the handheld drawn to scale,
// and the scale itself, physical or fitted to the window.
import page from "virtual:decky-vite/settings";
import { DEVICES, Device } from "./devices";

// The shoulder buttons stand this far above the body, in millimetres.
const SHOULDER = 4;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const frame = $<HTMLIFrameElement>("screen");
const stage = $("stage");
const slot = $("slot");
const legend = $("legend");
const box = $("device");
const sketch = $("sketch");

function stored(key: string, fallback: string): string {
  try {
    return localStorage.getItem(`decky-vite-${key}`) ?? fallback;
  } catch {
    return fallback;
  }
}

function store(key: string, value: string) {
  try {
    localStorage.setItem(`decky-vite-${key}`, value);
  } catch {
    // Private windows refuse storage.
  }
}

// A model picked here holds until the settings name another one.
if (stored("model-setting", "") !== page.model) {
  store("model-setting", page.model);
  store("model", page.model);
}

const settings = {
  model: DEVICES[stored("model", "")] ? stored("model", "") : page.model,
  size: stored("size", "physical"),
  frame: stored("frame", "on"),
};

function send(button: string) {
  frame.contentWindow?.postMessage({ deckyVite: button }, location.origin);
  frame.contentWindow?.focus();
}

// Screen geometry: pixels per inch, screen size in millimetres, device CSS pixels per millimetre.
function geometry(d: Device) {
  const ppi = Math.hypot(...d.panel) / d.diagonal;
  const screen = [d.panel[0] / ppi * 25.4, d.panel[1] / ppi * 25.4];
  return { ppi, screen, perMm: d.css[0] / screen[0] };
}

function control(button: string, part: string, label = "") {
  const text = label ? `<text x="0" y="0">${label}</text>` : "";
  return `<g class="control" data-button="${button}">${part}${text}</g>`;
}

function at(x: number, y: number, inner: string) {
  return `<g transform="translate(${x} ${y})">${inner}</g>`;
}

function stick(x: number, y: number, r: number) {
  return at(x, y, `<circle class="pad" r="${r}"/><circle class="stick-cap" r="${r - 3}"/>`);
}

function dpad(x: number, y: number) {
  const w = 7.5;
  const arm = (dx: number, dy: number) => {
    const rx = dx === 0 ? -w / 2 : dx < 0 ? -11 : w / 2;
    const ry = dy === 0 ? -w / 2 : dy < 0 ? -11 : w / 2;
    const [rw, rh] = dx === 0 ? [w, 11 - w / 2] : [11 - w / 2, w];
    return `<rect class="part" x="${rx}" y="${ry}" width="${rw}" height="${rh}" rx="1.2"/>`;
  };
  return at(x, y, [
    `<rect class="pad" x="${-w / 2}" y="${-w / 2}" width="${w}" height="${w}"/>`,
    control("up", arm(0, -1)), control("down", arm(0, 1)), control("left", arm(-1, 0)), control("right", arm(1, 0)),
  ].join(""));
}

function face(x: number, y: number) {
  const button = (name: string, dx: number, dy: number) =>
    at(dx, dy, control(name, `<circle class="part" r="4.2"/>`, name));
  return at(x, y, button("Y", 0, -7) + button("X", -7, 0) + button("B", 7, 0) + button("A", 0, 7));
}

function small(x: number, y: number, label: string, button = "") {
  const part = `<rect class="part" x="-4" y="-2.4" width="8" height="4.8" rx="2.4"/>`;
  return at(x, y, button ? control(button, part, label) : `<g class="deco">${part}<text>${label}</text></g>`);
}

function shoulder(x: number, w: number, label: string) {
  return control(label, `<rect class="part" x="${x}" y="${-SHOULDER}" width="${w}" height="${SHOULDER + 6}" rx="3"/>` +
    `<text x="${x + w / 2}" y="${-SHOULDER / 2}">${label}</text>`);
}

// A generic handheld: the controls of the Odin's Portal layout or of the Steam Deck.
function draw(d: Device, screen: number[]) {
  const [w, h] = d.body;
  const side = (w - screen[0]) / 2;
  const left = side / 2;
  const right = w - side / 2;
  const top = (h - screen[1]) / 2;
  const parts = [shoulder(d.radius * 0.5, 46, "L1"), shoulder(w - d.radius * 0.5 - 46, 46, "R1"),
    `<rect class="body" width="${w}" height="${h}" rx="${d.radius}"/>`,
    `<rect class="glass" x="${side - 1.5}" y="${top - 1.5}" width="${screen[0] + 3}" height="${screen[1] + 3}" rx="2"/>`];
  if (d.layout === "portal") {
    parts.push(stick(left, h * 0.3, 10), dpad(left, h * 0.67), face(right, h * 0.3), stick(right, h * 0.67, 10),
      small(left - 9, h - 7, "⧉"), small(left + 9, h - 7, "⌂"), small(right - 9, h - 7, "···", "QAM"),
      small(right + 9, h - 7, "≡"));
  } else {
    const pad = (x: number) => `<rect class="pad" x="${x - 17}" y="${h - 46}" width="34" height="34" rx="6"/>`;
    parts.push(stick(left + 14, 26, 11), dpad(left - 16, 54), pad(left), face(right + 16, 54), stick(right - 14, 26, 11),
      pad(right), small(side - 9, top + 4, "⧉"), small(w - side + 9, top + 4, "≡"),
      small(side - 9, h - top - 4, "S"), small(w - side + 9, h - top - 4, "···", "QAM"));
  }
  return parts.join("");
}

let screensOfMac: { w: number; h: number; mmw: number; scale: number }[] = [];

// Points per inch of the Mac screen under the window, at the page's zoom.
function pointsPerInch(): number | null {
  for (const s of screensOfMac) {
    const zoom = devicePixelRatio / s.scale;
    const near = (a: number, b: number) => Math.abs(a - b) <= 2;
    if ((near(screen.width, s.w) || near(screen.width * zoom, s.w)) &&
        (near(screen.height, s.h) || near(screen.height * zoom, s.h))) {
      return s.w / (s.mmw / 25.4) / zoom;
    }
  }
  return null;
}

let last = "";

function layout() {
  const d = DEVICES[settings.model];
  const g = geometry(d);
  const framed = settings.frame === "on";
  const [cw, ch] = framed ? [d.body[0] * g.perMm, (d.body[1] + SHOULDER) * g.perMm] : d.css;
  // The stage pads the device by 40 px on each side; fitting leaves room for the legend.
  const em = parseFloat(getComputedStyle(legend).fontSize);
  const room = Math.min((stage.clientWidth - 80) / cw, (stage.clientHeight - 80 - legend.offsetHeight - em) / ch);
  const perInch = pointsPerInch();
  let scale = room;
  let mac = "";
  if (settings.size === "physical" && perInch) {
    scale = perInch / (25.4 * g.perMm);
    mac = `${Math.round(g.ppi)} ppi (×${scale.toFixed(2)})`;
  } else if (settings.size === "physical") {
    mac = "Size of this Mac's screen unknown";
  }
  const key = `${settings.model}${framed}${scale}`;
  if (key === last) return space();
  last = key;
  $("screen-facts").innerHTML =
    `<b>Display:</b> ${d.diagonal}" (${g.screen.map(Math.round).join("×")} mm) - ${d.panel.join("×")}`;
  $("mac-facts").textContent = mac;
  Object.assign(slot.style, { width: `${cw * scale}px`, height: `${ch * scale}px` });
  Object.assign(box.style, { width: `${cw}px`, height: `${ch}px`, transform: `scale(${scale})` });
  space();
  // A device larger than the window shows its middle first.
  requestAnimationFrame(() => {
    stage.scrollLeft = (stage.scrollWidth - stage.clientWidth) / 2;
    stage.scrollTop = (stage.scrollHeight - stage.clientHeight) / 2;
  });
  const [sx, sy] = framed ? [(d.body[0] - g.screen[0]) / 2 * g.perMm, (SHOULDER + (d.body[1] - g.screen[1]) / 2) * g.perMm]
    : [0, 0];
  Object.assign(frame.style, { left: `${sx}px`, top: `${sy}px`, width: `${d.css[0]}px`, height: `${d.css[1]}px` });
  sketch.style.display = framed ? "" : "none";
  if (framed) {
    sketch.setAttribute("viewBox", `0 ${-SHOULDER} ${d.body[0]} ${d.body[1] + SHOULDER}`);
    sketch.innerHTML = draw(d, g.screen);
  }
}

// Puts the legend 5 em under the device, down to 1 em when the stage is short.
function space() {
  const em = parseFloat(getComputedStyle(legend).fontSize);
  const free = stage.clientHeight - 80 - slot.offsetHeight - legend.offsetHeight;
  legend.style.marginTop = `${Math.min(5 * em, Math.max(em, free))}px`;
}

function segments(id: string, key: keyof typeof settings, options: [string, string][]) {
  const el = $(id);
  el.innerHTML = options.map(([v, label]) => `<button data-value="${v}">${label}</button>`).join("");
  const mark = () => el.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed",
    String(b.dataset.value === settings[key])));
  el.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest("button");
    if (!b) return;
    settings[key] = b.dataset.value!;
    store(key, settings[key]);
    mark();
    layout();
    frame.contentWindow?.focus();
  });
  mark();
}

segments("devices", "model", Object.entries(DEVICES).map(([id, d]) => [id, d.name]));
// A button that switches a setting between two values, pressed on the first.
function toggle(id: string, key: keyof typeof settings, on: string, off: string) {
  const button = $(id);
  button.setAttribute("aria-pressed", String(settings[key] === on));
  button.addEventListener("click", () => {
    settings[key] = settings[key] === on ? off : on;
    store(key, settings[key]);
    button.setAttribute("aria-pressed", String(settings[key] === on));
    layout();
    frame.contentWindow?.focus();
  });
}

toggle("frame", "frame", "on", "off");
toggle("physical", "size", "physical", "fit");

$("reload").addEventListener("click", () => frame.contentWindow?.location.reload());

sketch.addEventListener("click", (e) => {
  const control = (e.target as Element).closest<SVGGElement>("[data-button]");
  if (!control) return;
  send(control.dataset.button!);
  control.classList.add("pressed");
  setTimeout(() => control.classList.remove("pressed"), 150);
});

function showName(name: string) {
  $("plugin").textContent = name;
  document.title = `${name} · decky-vite`;
}

// plugin.json names the plugin until the screen has loaded it.
showName(page.name);
addEventListener("message", (e) => {
  if (e.origin === location.origin && e.data?.deckyVite === "plugin") showName(e.data.name);
});

async function showStatus() {
  const el = $("status");
  try {
    const s = await (await fetch("/__backend")).json();
    el.dataset.state = !s.host ? "none" : s.online === false ? "offline" : "online";
    $("status-text").textContent = s.host ?? "No device";
    el.title = !s.host ? "No device: the screen replays fixtures"
      : s.online === false ? "The device does not answer: the screen replays fixtures" : "The backend runs on the device";
  } catch {
    el.dataset.state = "offline";
    $("status-text").textContent = "Dev server stopped";
  }
}

addEventListener("resize", layout);
// A move to another screen or a zoom changes the scale without an event.
setInterval(layout, 1000);
setInterval(showStatus, 3000);
showStatus();
screensOfMac = await fetch("/__display").then((r) => r.json()).catch(() => []);
layout();
frame.src = `screen.html${location.hash}`;
frame.addEventListener("load", () => frame.contentWindow?.focus());
