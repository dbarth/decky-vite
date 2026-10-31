// The parts of Steam's game mode around the plugin: routes, history, modals, the Quick Access
// menu and toasts. The route lives in the URL hash so a reload stays on the same page.
import { ComponentType, ReactElement, ReactNode, cloneElement, isValidElement, useEffect, useReducer } from "react";
import { Place, focus, focusFirst, focusPlace, focused, place } from "./focus";

export const HOME = "/library/home";

interface Modal {
  id: number;
  element: ReactNode;
  // The element focused before the modal opened, focused again when it closes.
  from: HTMLElement | null;
}

interface Toast {
  id: number;
  title: ReactNode;
  body: ReactNode;
}

const top = window.parent;

export const shell = {
  history: [{ path: location.hash.slice(1) || top.location.hash.slice(1) || HOME, place: null as Place | null }],
  routes: new Map<string, ComponentType>(),
  modals: [] as Modal[],
  qam: false,
  qamFrom: null as HTMLElement | null,
  toasts: [] as Toast[],
};

let nextId = 1;
const listeners = new Set<() => void>();

function changed() {
  history.replaceState(null, "", `#${path()}`);
  if (top !== window) top.history.replaceState(null, "", `#${path()}`);
  listeners.forEach((l) => l());
}

export function useShell() {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    listeners.add(bump);
    return () => {
      listeners.delete(bump);
    };
  }, []);
  return shell;
}

export function path(): string {
  return shell.history[shell.history.length - 1].path;
}

// Runs after React has drawn the change.
function afterRender(fn: () => void) {
  requestAnimationFrame(() => requestAnimationFrame(fn));
}

export function navigate(to: string) {
  shell.history[shell.history.length - 1].place = place();
  shell.history.push({ path: to, place: null });
  changed();
  afterRender(() => focused() || focusFirst());
}

// Steam's history.replace(): the new page takes the place of the one on screen, which B then skips.
export function replace(to: string) {
  shell.history[shell.history.length - 1] = { path: to, place: null };
  changed();
  afterRender(() => focused() || focusFirst());
}

// Steam focuses the element the page had when it was left.
export function back() {
  if (shell.history.length > 1) shell.history.pop();
  else shell.history = [{ path: HOME, place: null }];
  changed();
  const was = shell.history[shell.history.length - 1].place;
  afterRender(() => (was ? focusPlace(was) : focused() || focusFirst()));
}

// Steam hands the modal's root element a closeModal prop.
function withClose(element: ReactNode, id: number): ReactNode {
  if (!isValidElement(element)) return element;
  return cloneElement(element as ReactElement<{ closeModal?: () => void }>, { closeModal: () => closeModal(id) });
}

export function openModal(element: ReactNode) {
  const id = nextId++;
  shell.modals = [...shell.modals, { id, element: withClose(element, id), from: focused() }];
  changed();
  return {
    Close: () => closeModal(id),
    Update: (next: ReactNode) => {
      shell.modals = shell.modals.map((m) => (m.id === id ? { ...m, element: withClose(next, id) } : m));
      changed();
    },
  };
}

export function closeModal(id?: number) {
  const gone = id == null ? shell.modals[shell.modals.length - 1] : shell.modals.find((m) => m.id === id);
  if (!gone) return;
  shell.modals = shell.modals.filter((m) => m !== gone);
  changed();
  if (gone.from?.isConnected) focus(gone.from);
}

export function setQam(open: boolean) {
  if (open === shell.qam) return;
  if (open) shell.qamFrom = focused();
  shell.qam = open;
  changed();
  if (open) afterRender(() => shell.qam && focusFirst());
  else if (shell.qamFrom?.isConnected) focus(shell.qamFrom);
}

export function toast(t: { title: ReactNode; body: ReactNode; duration?: number }) {
  const id = nextId++;
  shell.toasts = [...shell.toasts, { id, title: t.title, body: t.body }];
  changed();
  setTimeout(() => {
    shell.toasts = shell.toasts.filter((x) => x.id !== id);
    changed();
  }, t.duration ?? 4000);
}
