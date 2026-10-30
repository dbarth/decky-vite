// Gamepad navigation in the manner of Steam: the D-pad moves the focus to the nearest focusable
// element in its direction, A activates, B cancels, X and Y call the secondary and options
// handlers. The keyboard and any controller the browser sees drive it.

export interface NodeProps {
  onActivate?: (e?: unknown) => void;
  onClick?: (e?: unknown) => void;
  onCancel?: (e?: unknown) => void;
  onSecondaryButton?: (e?: unknown) => void;
  onOptionsButton?: (e?: unknown) => void;
  onOKActionDescription?: string;
  onCancelActionDescription?: string;
  onSecondaryActionDescription?: string;
  onOptionsActionDescription?: string;
  focusClassName?: string;
  onGamepadFocus?: () => void;
  onGamepadBlur?: () => void;
  onButtonDown?: (e: ButtonEvent) => void;
  // decky-vite's own: a slider takes left and right, and returns true to keep the focus.
  onDirection?: (dir: Dir) => boolean;
}

export interface ButtonEvent {
  detail: { button: number };
  stopPropagation: () => void;
}

// The latest props of each element a shim rendered, read when a button acts on it.
const nodes = new WeakMap<Element, { current: NodeProps }>();
let current: HTMLElement | null = null;
const listeners = new Set<() => void>();

export function register(el: Element, props: { current: NodeProps }) {
  nodes.set(el, props);
}

export function props(el: Element | null): NodeProps {
  return (el && nodes.get(el)?.current) || {};
}

export function focused(): HTMLElement | null {
  return current?.isConnected ? current : null;
}

export function onFocusChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Tells the footer that the focused element rendered again: its hints may have changed.
export function rendered(el: Element | null) {
  if (el && el === focused()) listeners.forEach((l) => l());
}

// Modals sit above the side menu, which sits above the page.
function layer(): Element {
  const layers = document.querySelectorAll("[data-layer]");
  return layers[layers.length - 1] ?? document.body;
}

function targets(): HTMLElement[] {
  return [...layer().querySelectorAll<HTMLElement>("[data-focusable]")]
    .filter((el) => !(el as HTMLButtonElement).disabled && el.getClientRects().length > 0);
}

function ancestors(el: Element, fn: (a: Element) => void) {
  for (let a = el.parentElement; a; a = a.parentElement) fn(a);
}

function mark(el: HTMLElement, on: boolean) {
  const cls = props(el).focusClassName;
  for (const c of ["gpfocus", cls]) if (c && el.classList.contains(c) !== on) el.classList.toggle(c, on);
  ancestors(el, (a) => a.classList.contains("gpfocuswithin") !== on && a.classList.toggle("gpfocuswithin", on));
}

// React rewrites the class attribute when a focused element renders again: mark it again.
new MutationObserver(() => current?.isConnected && mark(current, true))
  .observe(document, { subtree: true, attributes: true, attributeFilter: ["class"] });

// Steam's nodes take the gamepad focus when the browser focuses them, as when a page calls focus().
document.addEventListener("focusin", (e) => {
  const el = (e.target as Element).closest?.<HTMLElement>("[data-focusable]");
  if (el && el !== current) focus(el);
});

// Steam draws a ring around the focused element, or around the element its focusRingSizeElementID
// names, unless it sets noFocusRing. data-ring holds that id, empty for the element itself. Steam
// measures the target at each frame for 500 ms after a change of focus: the ring follows a zoom.
// A new ring starts its animations again.
let ring: HTMLDivElement | null = null;

function placeRing() {
  const el = focused();
  const id = el?.dataset.ring;
  const box = el?.closest("[data-layer]");
  if (!el || id === undefined || !box || !ring) return;
  const target = (id && document.getElementById(id)) || el;
  const a = target.getBoundingClientRect();
  const b = box.getBoundingClientRect();
  Object.assign(ring.style, { left: `${a.left - b.left}px`, top: `${a.top - b.top}px`, width: `${a.width}px`,
    height: `${a.height}px`, borderRadius: id ? getComputedStyle(target).borderRadius : "" });
}

function drawRing(el: HTMLElement | null) {
  ring?.remove();
  ring = null;
  const box = el?.closest("[data-layer]");
  if (!el || el.dataset.ring === undefined || !box) return;
  ring = document.createElement("div");
  ring.className = "dv-focusring";
  box.append(ring);
  const start = performance.now();
  const step = () => {
    placeRing();
    if (ring && performance.now() - start <= 500) requestAnimationFrame(step);
  };
  step();
}

document.addEventListener("scroll", placeRing, true);
window.addEventListener("resize", placeRing);

export function focus(el: HTMLElement | null) {
  if (el === current) return;
  const old = current;
  if (old) {
    mark(old, false);
    props(old).onGamepadBlur?.();
  }
  current = el;
  if (el) {
    mark(el, true);
    el.focus({ preventScroll: true });
    // An element the browser cannot focus leaves a text field focused, which would take the keys.
    if (document.activeElement !== el) (document.activeElement as HTMLElement | null)?.blur();
    el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
    props(el).onGamepadFocus?.();
  }
  drawRing(el);
  listeners.forEach((l) => l());
}

// The focused element's rank among the focusable ones and its first class, to focus the same place
// after a reload or a return to the page.
export interface Place {
  index: number;
  kind: string;
}

export function place(): Place | null {
  const el = focused();
  return el ? { index: targets().indexOf(el), kind: el.classList[0] ?? "" } : null;
}

// Focuses the element at the place. When the page has lost one before it, focuses the closest
// element of the same class at or before that rank.
export function focusPlace(p: Place) {
  const all = targets();
  const same = all.filter((el, i) => i <= p.index && el.classList[0] === p.kind);
  focus(all[p.index]?.classList[0] === p.kind ? all[p.index] : same.pop() ?? all[0] ?? null);
}

// Focuses the preferred element of a container, or of the top layer, else its first.
export function focusFirst(within?: Element | null) {
  const all = targets().filter((el) => !within || within.contains(el));
  focus(all.find((el) => el.hasAttribute("data-preferred")) ?? all[0] ?? null);
}

export type Dir = "up" | "down" | "left" | "right";

// Picks the closest element past the focused one's edge, with a penalty for drifting sideways. As
// in Steam, a row's left and right and a column's up and down stay inside it while it has an
// element that way, from the innermost row or column out.
function nearest(from: HTMLElement, dir: Dir): HTMLElement | null {
  const flow = dir === "left" || dir === "right" ? "row" : "column";
  const all = targets();
  for (let box = from.parentElement?.closest<HTMLElement>(`[data-flow="${flow}"]`); box;
    box = box.parentElement?.closest<HTMLElement>(`[data-flow="${flow}"]`)) {
    const inside = closest(from, dir, all.filter((el) => box!.contains(el)));
    if (inside) return inside;
  }
  return closest(from, dir, all);
}

function closest(from: HTMLElement, dir: Dir, all: HTMLElement[]): HTMLElement | null {
  const a = from.getBoundingClientRect();
  let best: HTMLElement | null = null;
  let score = Infinity;
  for (const el of all) {
    if (el === from || el.contains(from) || from.contains(el)) continue;
    const b = el.getBoundingClientRect();
    let along: number;
    let across: number;
    if (dir === "down" || dir === "up") {
      along = dir === "down" ? b.top - a.bottom : a.top - b.bottom;
      across = Math.max(0, b.left - a.right, a.left - b.right);
    } else {
      along = dir === "right" ? b.left - a.right : a.left - b.right;
      across = Math.max(0, b.top - a.bottom, a.top - b.bottom);
    }
    if (along < -4) continue;
    const s = Math.max(0, along) + across * 3;
    if (s < score) {
      score = s;
      best = el;
    }
  }
  return best;
}

// A container with data-entry takes the focus on the child its selector names, as Steam's tab
// row focuses the shown tab.
export function move(dir: Dir) {
  const from = focused();
  if (!from || !layer().contains(from)) return focusFirst();
  if (props(from).onDirection?.(dir)) return;
  const to = nearest(from, dir);
  const entry = to?.closest<HTMLElement>("[data-entry]");
  if (entry && !entry.contains(from)) focus(entry.querySelector<HTMLElement>(entry.dataset.entry!) ?? to);
  else if (to) focus(to);
}

// Gives the focus to the page when nothing has it: the preferred element, the first element of a
// container marked data-autofocus once it has one, else the first of the top layer.
export function claim() {
  // The page removed the focused element: Steam's ring and the footer's hints go with it.
  if (current && !current.isConnected) {
    current = null;
    drawRing(null);
    listeners.forEach((l) => l());
  }
  if (focused() && layer().contains(focused())) return;
  const all = targets();
  const auto = [...layer().querySelectorAll("[data-autofocus]")];
  const pick = all.find((el) => el.hasAttribute("data-preferred"))
    ?? (auto.length ? all.find((el) => auto.some((a) => a.contains(el))) : all[0]);
  if (pick) focus(pick);
}

export type Button = "A" | "B" | "X" | "Y";

// Calls the handler of the focused element or of its nearest ancestor that has one.
function handler(button: Button): (() => void) | null {
  const key = { A: "onActivate", B: "onCancel", X: "onSecondaryButton", Y: "onOptionsButton" }[button] as keyof NodeProps;
  for (let el: Element | null = focused(); el; el = el.parentElement) {
    if ((el as HTMLButtonElement).disabled) return null;
    const p = props(el);
    const fn = p[key] ?? (button === "A" ? p.onClick : undefined);
    // Steam's event names the element, which a page reads to open a menu next to it.
    if (typeof fn === "function") return () => (fn as (e?: unknown) => void)({ target: el, currentTarget: el });
    if (button === "A" && el instanceof HTMLButtonElement) return () => el.click();
  }
  return null;
}

// Returns whether an element handled the button. B falls back to the shell.
export function press(button: Button): boolean {
  const fn = handler(button);
  fn?.();
  return !!fn;
}

// Sends a button to the onButtonDown handlers from the focused element up, as Steam bubbles its
// gamepad events. Returns whether a handler stopped it.
export function buttonDown(button: number): boolean {
  let stopped = false;
  const e = { detail: { button }, stopPropagation: () => void (stopped = true) };
  for (let el: Element | null = focused(); el && !stopped; el = el.parentElement) props(el).onButtonDown?.(e);
  return stopped;
}

// The footer's hints for the focused element.
export function hints(): [Button, string][] {
  const out: [Button, string][] = [];
  const find = (key: keyof NodeProps) => {
    for (let el: Element | null = focused(); el; el = el.parentElement) {
      const p = props(el);
      if (p[key]) return p;
    }
    return null;
  };
  const p = props(focused());
  if (focused()) out.push(["A", p.onOKActionDescription ?? "Select"]);
  const x = find("onSecondaryButton");
  if (x?.onSecondaryActionDescription) out.push(["X", x.onSecondaryActionDescription]);
  const y = find("onOptionsButton");
  if (y?.onOptionsActionDescription) out.push(["Y", y.onOptionsActionDescription]);
  out.push(["B", find("onCancel")?.onCancelActionDescription ?? "Back"]);
  return out;
}
