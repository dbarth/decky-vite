// Stands in for @decky/api in the harness. Backend calls go to the dev server, which runs main.py.
import { ComponentType } from "react";
import { shell, toast } from "./shell";

export function callable<A extends unknown[], R>(method: string): (...args: A) => Promise<R> {
  return async (...args: A) => {
    const res = await fetch(`/rpc/${method}`, { method: "POST", body: JSON.stringify(args) });
    const reply = await res.json();
    if (reply.error) throw new Error(reply.error);
    return reply.result as R;
  };
}

export const routerHook = {
  addRoute(path: string, component: ComponentType) {
    shell.routes.set(path, component);
  },
  removeRoute(path: string) {
    shell.routes.delete(path);
  },
};

export const toaster = { toast };

// Decky's file picker browses the device. The harness has none: the pick fails with a toast.
export async function openFilePicker(): Promise<{ path: string; realpath: string }> {
  toast({ title: "decky-vite", body: "No file picker in the harness" });
  throw new Error("decky-vite has no file picker");
}

export function definePlugin<T>(fn: () => T): () => T {
  return fn;
}
