// The modules vite.config.ts gives the page.

declare module "virtual:decky-vite/plugin" {
  // The plugin's definePlugin() result.
  const definition: () => unknown;
  export default definition;
}

// The module the plugin's settings name in hooks, else an empty one.
declare module "virtual:decky-vite/hooks" {
  // Runs once the fake Steam has started and the plugin is defined.
  export const setup: (() => unknown) | undefined;
  // Saves the plugin's state before a full reload and restores it after.
  export const persist: { save(): object; restore(saved: object): void } | undefined;
}

declare module "virtual:decky-vite/settings" {
  const settings: { name: string; model: string; route: string | null };
  export default settings;
}
