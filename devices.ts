// The handhelds the studio draws, by the model id the settings name.

export interface Device {
  name: string;
  // The size Steam lays out in, the screen's pixels and its diagonal in inches.
  css: [number, number];
  panel: [number, number];
  diagonal: number;
  // The body in millimetres, approximate, and where its controls sit. "retroid" puts the D-pad and
  // the face buttons above the sticks. nintendo swaps the face buttons' letters: A on the right.
  body: [number, number];
  radius: number;
  layout: "portal" | "deck" | "retroid";
  nintendo?: boolean;
}

export const DEVICES: Record<string, Device> = {
  deck: { name: "Steam Deck", css: [1280, 800], panel: [1280, 800], diagonal: 7, body: [298, 117], radius: 14,
    layout: "deck" },
  "deck-oled": { name: "Deck OLED", css: [1280, 800], panel: [1280, 800], diagonal: 7.4, body: [298, 117], radius: 14,
    layout: "deck" },
  "odin2-portal": { name: "Odin Portal", css: [946, 533], panel: [1920, 1080], diagonal: 7, body: [252, 94],
    radius: 23.5, layout: "portal" },
  rp5: { name: "Retroid Pocket", css: [946, 533], panel: [1920, 1080], diagonal: 5.5, body: [199.2, 78.5],
    radius: 36, layout: "retroid", nintendo: true },
};
