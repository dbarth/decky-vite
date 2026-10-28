"""Runs the plugin's backend outside Decky for the dev harness.

Reads one JSON request per line on stdin, {"id", "method", "args"}, and writes one reply per line on
stdout, {"id", "result"} or {"id", "error"}. Methods that start with "_" read Steam's own files.
DEV holds the plugin in plugin/ and copies of its settings and runtime folders, made from those in
Decky's folder at the first start.
Usage: python3 -I -u bridge.py DEV SLUG DECKY
"""
import asyncio
import base64
import glob
import json
import logging
import os
import re
import shutil
import sys
import types

HOME = os.path.expanduser("~")
STEAM = os.path.join(HOME, ".local", "share", "Steam")
GRID_FILE = re.compile(r"^\d+(p|_hero|_logo|_icon)?\.(png|jpg|jpeg|webp|ico)$")
SHORTCUT_FIELDS = {"appid": "appid", "appname": "name", "exe": "exe", "startdir": "start_dir",
                   "launchoptions": "launch_options", "icon": "icon", "lastplaytime": "last_played"}


def sandbox(real, copy):
    """Return the copy of one of the plugin's folders under Decky's, made at the first start."""
    if not os.path.isdir(copy):
        if os.path.isdir(real):
            shutil.copytree(real, copy, symlinks=True)
        else:
            os.makedirs(copy)
    return copy


def fake_decky(dev, slug, decky_dir):
    """Give the backend the module Decky injects. Its writes go to copies of the plugin's folders."""
    logging.basicConfig(stream=sys.stderr, level=logging.INFO, format="%(levelname)s %(message)s")
    decky = types.ModuleType("decky")
    decky.DECKY_PLUGIN_DIR = os.path.join(dev, "plugin")
    decky.DECKY_PLUGIN_SETTINGS_DIR = sandbox(os.path.join(decky_dir, "settings", slug), os.path.join(dev, "settings"))
    decky.DECKY_PLUGIN_RUNTIME_DIR = sandbox(os.path.join(decky_dir, "data", slug), os.path.join(dev, "data"))
    decky.DECKY_USER_HOME = HOME
    decky.DECKY_HOME = decky_dir
    decky.logger = logging.getLogger(slug)
    sys.modules["decky"] = decky


def vdf(data, i=0):
    """Parse Steam's binary KeyValues from offset i. Returns the map and the offset after it."""
    out = {}
    while True:
        kind = data[i]
        i += 1
        if kind == 8:
            return out, i
        end = data.index(b"\0", i)
        key = data[i:end].decode(errors="replace")
        i = end + 1
        if kind == 0:
            out[key], i = vdf(data, i)
        elif kind == 1:
            end = data.index(b"\0", i)
            out[key] = data[i:end].decode(errors="replace")
            i = end + 1
        elif kind == 2:
            out[key] = int.from_bytes(data[i:i + 4], "little")
            i += 4
        else:
            raise ValueError(f"KeyValues type {kind} at {i - 1}")


def user_config():
    """Return the config folder of the Steam user who last changed their shortcuts."""
    found = glob.glob(os.path.join(STEAM, "userdata", "*", "config", "shortcuts.vdf"))
    return os.path.dirname(max(found, key=os.path.getmtime)) if found else None


def steam_state():
    """Return the shortcuts, the custom images and the collections, as Steam stores them."""
    config = user_config()
    if not config:
        return {"shortcuts": [], "grid": [], "collections": []}
    with open(os.path.join(config, "shortcuts.vdf"), "rb") as f:
        tree, _ = vdf(f.read())
    shortcuts = []
    played = live_playtimes() or {}
    for entry in tree.get("shortcuts", {}).values():
        fields = {SHORTCUT_FIELDS[k.lower()]: v for k, v in entry.items() if k.lower() in SHORTCUT_FIELDS}
        if fields.get("appid") in played:
            fields["playtime"], fields["last_played"] = played[fields["appid"]]
        shortcuts.append(fields)
    grid_dir = os.path.join(config, "grid")
    grid = sorted(f for f in os.listdir(grid_dir) if GRID_FILE.match(f)) if os.path.isdir(grid_dir) else []
    collections = []
    cloud = os.path.join(config, "cloudstorage", "cloud-storage-namespace-1.json")
    if os.path.isfile(cloud):
        with open(cloud) as f:
            for key, item in json.load(f):
                if key.startswith("user-collections.") and not item.get("is_deleted") and item.get("value"):
                    c = json.loads(item["value"])
                    collections.append({"id": c.get("id"), "name": c.get("name"), "apps": c.get("added", [])})
    live = live_collections()
    if live:
        collections = [c for c in collections if c["id"] not in live]
        collections += [{"id": id, "name": id, "apps": apps} for id, apps in live.items()]
    return {"shortcuts": shortcuts, "grid": grid, "collections": collections}


def live(expression):
    """Return the JSON an expression gives in Steam now, or None when its debug port is closed."""
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    try:
        from cdp import evaluate
        return json.loads(evaluate(expression))
    except Exception:
        return None


def live_collections():
    """Return the hidden and favorite apps Steam holds now, or None.

    Steam's file listed none of the 9 apps hidden on the Odin."""
    got = live('JSON.stringify(["hidden", "favorite"].map((id) => '
               '[id, (collectionStore.GetCollection(id)?.allApps ?? []).map((a) => a.appid)]))')
    return dict(got) if got is not None else None


def live_playtimes():
    """Return {appid: ([minutes, minutes in the last two weeks], last played)} of the shortcuts, or None.

    Steam records the playtime of a shortcut but keeps it out of shortcuts.vdf."""
    got = live('(async () => JSON.stringify(await Promise.all(appStore.allApps'
               '.filter((a) => a.app_type === 1073741824).map(async (a) => {'
               ' const p = await SteamClient.Apps.GetPlaytime(a.appid);'
               ' return [a.appid, p.nPlaytimeForever, p.nPlaytimeLastTwoWeeks, p.rtLastTimePlayed]; }))))()')
    return {a: ([m, recent], last) for a, m, recent, last in got} if got is not None else None


def grid_image(name):
    if not GRID_FILE.match(name):
        raise ValueError(f"not a grid image: {name}")
    with open(os.path.join(user_config(), "grid", name), "rb") as f:
        return base64.b64encode(f.read()).decode()


LOCAL = {"_steam": steam_state, "_grid": grid_image}


async def main():
    dev = os.path.abspath(sys.argv[1])
    fake_decky(dev, sys.argv[2], os.path.expanduser(sys.argv[3]))
    plugin_dir = os.path.join(dev, "plugin")
    sys.path[:0] = [plugin_dir, os.path.join(plugin_dir, "py_modules")]
    import main as plugin_main
    plugin = plugin_main.Plugin()
    await plugin._main()

    def reply(message):
        sys.stdout.write(json.dumps(message) + "\n")
        sys.stdout.flush()

    async def handle(request):
        try:
            if request["method"] in LOCAL:
                result = await asyncio.to_thread(LOCAL[request["method"]], *request["args"])
            else:
                result = await getattr(plugin, request["method"])(*request["args"])
            reply({"id": request["id"], "result": result})
        except Exception as e:
            logging.exception(request["method"])
            reply({"id": request["id"], "error": f"{type(e).__name__}: {e}"})

    loop = asyncio.get_running_loop()
    reader = asyncio.StreamReader(limit=1 << 26)
    await loop.connect_read_pipe(lambda: asyncio.StreamReaderProtocol(reader), sys.stdin)
    reply({"ready": True})
    tasks = set()
    while line := await reader.readline():
        task = asyncio.create_task(handle(json.loads(line)))
        tasks.add(task)
        task.add_done_callback(tasks.discard)


if __name__ == "__main__":
    asyncio.run(main())
