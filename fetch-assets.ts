#!/usr/bin/env node
// Copies Steam's fonts and glyphs into steam/: npx fetch-assets [--device <[user@]host> | --github].
process.argv.splice(2, 0, "fetch-assets");
await import("./cli.ts");
