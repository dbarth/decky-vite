// The handhelds the studio draws, by the model id the settings name.

export interface Device {
  name: string;
  // The size Steam lays out in, the screen's pixels and its diagonal in inches.
  css: [number, number];
  panel: [number, number];
  diagonal: number;
  // The body in millimetres, approximate, and where its controls sit.
  body: [number, number];
  radius: number;
  layout: "portal" | "deck";
}

export const DEVICES: Record<string, Device> = {
  deck: { name: "Steam Deck", css: [1280, 800], panel: [1280, 800], diagonal: 7, body: [298, 117], radius: 36,
    layout: "deck" },
  "deck-oled": { name: "Deck OLED", css: [1280, 800], panel: [1280, 800], diagonal: 7.4, body: [298, 117], radius: 36,
    layout: "deck" },
  "odin2-portal": { name: "Odin 2 Portal", css: [946, 533], panel: [1920, 1080], diagonal: 7, body: [252, 94],
    radius: 18, layout: "portal" },
};
