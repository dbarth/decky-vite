// Starts the harness, or copies Steam's fonts and glyphs, with the settings from the command line,
// .env and the plugin's decky-vite.json or package.json. Node runs this file and its imports as they are: they use
// no TypeScript syntax beyond types.
import { join } from "node:path";
import { type ParseArgsOptionsConfig, parseArgs } from "node:util";
import { createServer } from "vite";
import { fetchAssets, hasAssets } from "./assets.ts";
import { HERE, type Options, resolveSettings, resolveTarget } from "./settings.ts";

const USAGE = `Usage: npm run dev [-- options]
       npx fetch-assets [--device <[user@]host> | --github]

  --plugin <folder>         the Decky plugin, else DECKY_VITE_PLUGIN in .env
  --device <[user@]host>    run the backend there, as user deck by default; else replay fixtures
  --ssh="<options>"         more ssh options, e.g. --ssh="-o Port=2222"
  --model <model>           deck (default), deck-oled or odin2-portal
  --port <port>             5199 by default
  --route <path>            the page shown at start
  --github                  fetch-assets: take the glyphs from GitHub, without a device`;

const TARGET = { device: { type: "string" }, ssh: { type: "string" }, help: { type: "boolean", short: "h" } } as const;
const DEV = { ...TARGET, plugin: { type: "string" }, model: { type: "string" }, port: { type: "string" },
  route: { type: "string" } } as const;
const FETCH = { ...TARGET, github: { type: "boolean" } } as const;

function fail(message: string): never {
  console.error(`decky-vite: ${message}`);
  process.exit(1);
}

async function dev(options: Options) {
  const settings = resolveSettings(options);
  process.env.DECKY_VITE_ARGS = JSON.stringify(options);
  const server = await createServer({ configFile: join(HERE, "vite.config.ts") });
  await server.listen();
  console.log(`\n  ${settings.name} from ${settings.plugin}`);
  console.log(`  Device: ${settings.device ?? "none, the screen replays fixtures"}`);
  server.printUrls();
  server.bindCLIShortcuts({ print: true });
  // A first start with a device copies Steam's fonts and glyphs.
  if (settings.device && !hasAssets()) {
    fetchAssets(settings, false).then((files) => {
      console.log(`  Steam's fonts and glyphs: ${files.length} files in steam/`);
      server.ws.send({ type: "full-reload" });
    }, (e) => console.warn(`  Steam's fonts and glyphs: ${e.message}`));
  }
}

async function assets(options: Options & { github?: boolean }) {
  const files = await fetchAssets(resolveTarget(options), !!options.github);
  console.log(`${files.length} files in steam/`);
}

const [command = "", ...args] = process.argv.slice(2);

function parse<T extends ParseArgsOptionsConfig>(options: T) {
  try {
    return parseArgs({ args, options, strict: true }).values;
  } catch (e) {
    fail(`${(e as Error).message}\n\n${USAGE}`);
  }
}

if (command === "dev") {
  const { help, ...options } = parse(DEV);
  if (help) console.log(USAGE);
  else await dev(options).catch((e) => fail(e.message));
} else if (command === "fetch-assets") {
  const { help, ...options } = parse(FETCH);
  if (help) console.log(USAGE);
  else await assets(options).catch((e) => fail(e.message));
} else {
  fail(`unknown command ${command}\n\n${USAGE}`);
}
