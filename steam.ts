// A fake of the Steam client objects the plugin calls: SteamClient.Apps, appStore and
// collectionStore. It starts from the device's shortcuts, images and collections, and keeps every
// change in this page. Images the plugin sets go to the dev server, which serves them at the URLs
// appStore hands out.
import { toast } from "./shell";

const SHORTCUT = 1073741824;
// File name suffixes of SetCustomArtworkForApp's asset types.
const ASSET_SUFFIX = ["p", "_hero", "_logo", ""];
const EXTS = ["png", "jpg"];

interface Shortcut {
  appid: number;
  name: string;
  exe: string;
  start_dir: string;
  launch_options: string;
  icon?: string;
  // Unix time, 0 when never played.
  last_played?: number;
  // Minutes in all and in the last two weeks.
  playtime?: [number, number];
}

interface State {
  shortcuts: Shortcut[];
  grid: string[];
  collections: { id: string; name: string; apps: number[] }[];
}

const apps = new Map<number, Shortcut>();
const overviews = new Map<number, object>();
const grid = new Set<string>();
const hidden = new Set<number>();
const favorites = new Set<number>();

function overviewOf(s: Shortcut) {
  let o = overviews.get(s.appid) as { display_name: string } | undefined;
  if (!o) {
    o = {
      appid: s.appid, display_name: s.name, app_type: SHORTCUT, m_gameid: String(BigInt(s.appid) << 32n | 0x02000000n),
      rt_last_time_played: s.last_played ?? 0,
    } as never;
    overviews.set(s.appid, o!);
  }
  o!.display_name = s.name;
  return o;
}

class Collection {
  apps: Map<number, object>;
  constructor(public id: string, public displayName: string, appids: number[]) {
    this.apps = new Map(appids.filter((a) => apps.has(a)).map((a) => [a, overviewOf(apps.get(a)!)]));
  }
  AsDragDropCollection() {
    return { AddApps: (list: { appid: number }[]) => list.forEach((o) => this.apps.set(o.appid, o)) };
  }
  async Save() {
    if (!userCollections.includes(this)) userCollections.push(this);
  }
}

const userCollections: Collection[] = [];

function set(ids: Set<number>, appids: number[], on: boolean) {
  for (const id of appids) {
    if (on) ids.add(id);
    else ids.delete(id);
  }
}

function asCollection(id: string, ids: Set<number>) {
  return { id, apps: { has: (a: number) => ids.has(a) } };
}

const appStore = {
  get allApps() {
    return [...apps.values()].map(overviewOf);
  },
  GetAppOverviewByAppID: (appid: number) => (apps.has(appid) ? overviewOf(apps.get(appid)!) : null),
  GetCustomVerticalCapsuleURLs: (app: { appid: number }) =>
    EXTS.some((e) => grid.has(`${app.appid}p.${e}`)) ? EXTS.map((e) => `/__grid/${app.appid}p.${e}`) : [],
  GetIconURLForApp: (app: { appid: number }) => apps.get(app.appid)?.icon || "",
};

const collectionStore = {
  get userCollections() {
    return userCollections;
  },
  GetCollection(id: string) {
    if (id === "hidden") return asCollection(id, hidden);
    if (id === "favorite") return asCollection(id, favorites);
    return userCollections.find((c) => c.id === id) ?? null;
  },
  BIsHidden: (appid: number) => hidden.has(appid),
  SetAppsAsHidden: (appids: number[], on: boolean) => set(hidden, appids, on),
  SetAppsAsFavorite: (appids: number[], on: boolean) => set(favorites, appids, on),
  NewUnsavedCollection: (name: string, _filter: unknown, appids: number[]) =>
    new Collection(`uc-${Date.now().toString(36)}`, name, appids),
};

async function putImage(name: string, data: string | null) {
  await fetch(`/__grid/${name}`, { method: data == null ? "DELETE" : "PUT", body: data ?? undefined });
  if (data == null) grid.delete(name);
  else grid.add(name);
}

// The app RunGame started last: the harness runs no game, and this one runs until TerminateApp ends
// it or the page reloads.
let running: number | null = null;

export function runningApp() {
  return running != null && apps.has(running) ? overviewOf(apps.get(running)!) : undefined;
}

type Lifetime = { unAppID: number; nInstanceID: number; bRunning: boolean };

// The callbacks of GameSessions.RegisterForAppLifetimeNotifications, told when a game starts or ends.
const lifetimes = new Set<(n: Lifetime) => void>();

function setRunning(appid: number | null) {
  const was = running;
  running = appid;
  if (was != null && was !== appid) lifetimes.forEach((f) => f({ unAppID: was, nInstanceID: 0, bRunning: false }));
  if (appid != null && appid !== was) lifetimes.forEach((f) => f({ unAppID: appid, nInstanceID: 0, bRunning: true }));
}

const GameSessions = {
  RegisterForAppLifetimeNotifications(callback: (n: Lifetime) => void) {
    lifetimes.add(callback);
    return { unregister: () => lifetimes.delete(callback) };
  },
};

function later<T>(value: T, ms = 150): Promise<T> {
  return new Promise((r) => setTimeout(() => r(value), ms));
}

const Apps = {
  async AddShortcut(name: string, exe: string, start_dir: string, _launchOptions: string) {
    const appid = (0x80000000 | (Math.random() * 0x7fffffff)) >>> 0;
    // Steam names a new shortcut after its executable and drops the options.
    apps.set(appid, { appid, name: exe.split("/").pop() ?? name, exe, start_dir, launch_options: "" });
    return later(appid);
  },
  RemoveShortcut(appid: number) {
    apps.delete(appid);
  },
  SetShortcutName: (appid: number, v: string) => void (apps.get(appid) && (apps.get(appid)!.name = v)),
  SetShortcutExe: (appid: number, v: string) => void (apps.get(appid) && (apps.get(appid)!.exe = v)),
  SetShortcutStartDir: (appid: number, v: string) => void (apps.get(appid) && (apps.get(appid)!.start_dir = v)),
  SetShortcutLaunchOptions: (appid: number, v: string) =>
    void (apps.get(appid) && (apps.get(appid)!.launch_options = v)),
  SetShortcutIcon: (appid: number, path: string) => void (apps.get(appid) && (apps.get(appid)!.icon = path)),
  async SetCustomArtworkForApp(appid: number, data: string, ext: string, type: number) {
    const stem = `${appid}${ASSET_SUFFIX[type]}`;
    for (const e of EXTS) if (e !== ext) await putImage(`${stem}.${e}`, null);
    await putImage(`${stem}.${ext}`, data);
    return later(undefined);
  },
  async ClearCustomArtworkForApp(appid: number, type: number) {
    for (const e of EXTS) await putImage(`${appid}${ASSET_SUFFIX[type]}.${e}`, null);
  },
  RegisterForAppDetails(appid: number, cb: (d: object) => void) {
    const timer = setTimeout(() => {
      const s = apps.get(appid);
      if (s) {
        cb({
          strDisplayName: s.name, strShortcutExe: s.exe, strShortcutStartDir: s.start_dir,
          strShortcutLaunchOptions: s.launch_options,
        });
      }
    }, 30);
    return { unregister: () => clearTimeout(timer) };
  },
  async GetPlaytime(appid: number) {
    const s = apps.get(appid);
    return later({
      nPlaytimeForever: s?.playtime?.[0] ?? 0, nPlaytimeLastTwoWeeks: s?.playtime?.[1] ?? 0,
      rtLastTimePlayed: s?.last_played ?? 0,
    }, 30);
  },
  RunGame(gameid: string) {
    const appid = Number(BigInt(gameid) >> 32n) || Number(gameid);
    const s = apps.get(appid);
    setRunning(s ? appid : null);
    toast({ title: "Steam", body: `Runs ${s?.name ?? gameid}: ${s?.launch_options ?? ""}` });
  },
  // The game ends 2 s later, as a game that takes its time to quit.
  TerminateApp(gameid: string) {
    const appid = Number(BigInt(gameid) >> 32n) || Number(gameid);
    setTimeout(() => {
      if (running === appid) setRunning(null);
    }, 2000);
  },
};

export async function startSteam() {
  let state: State = { shortcuts: [], grid: [], collections: [] };
  try {
    const reply = await (await fetch("/rpc/_steam", { method: "POST", body: "[]" })).json();
    if (reply.error) throw new Error(reply.error);
    state = reply.result;
  } catch (e) {
    console.warn("harness: no Steam state from the device", e);
  }
  for (const s of state.shortcuts) apps.set(s.appid, s);
  for (const g of state.grid) grid.add(g);
  for (const c of state.collections) {
    if (c.id === "hidden") set(hidden, c.apps, true);
    else if (c.id === "favorite") set(favorites, c.apps, true);
    else userCollections.push(new Collection(c.id, c.name, c.apps));
  }
  Object.assign(window, { appStore, collectionStore, SteamClient: { Apps, GameSessions } });
}
