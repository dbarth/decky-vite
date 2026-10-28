// The keyboard and any controller the browser sees, mapped to Steam's buttons.
import { stepTab } from "./decky-ui";
import { Button, buttonDown, claim, move, press } from "./focus";
import { back, closeModal, setQam, shell } from "./shell";

export type Input = Button | "L1" | "R1" | "QAM";

export function input(button: Input) {
  // Steam numbers L1 and R1 5 and 6. The last tabs on screen switch unless a handler stops the button.
  if (button === "L1" || button === "R1") {
    if (!buttonDown(button === "L1" ? 5 : 6)) stepTab(button === "L1" ? -1 : 1);
    return;
  }
  if (button === "QAM") return setQam(!shell.qam);
  if (press(button) || button !== "B") return;
  if (shell.modals.length) closeModal();
  else if (shell.qam) setQam(false);
  else back();
}

function caretAtEdge(el: HTMLInputElement, dir: "left" | "right") {
  return dir === "left" ? el.selectionStart === 0 : el.selectionEnd === el.value.length;
}

function onKey(e: KeyboardEvent) {
  const typing = e.target instanceof HTMLInputElement ? e.target : null;
  const keys: Record<string, () => void> = {
    ArrowUp: () => move("up"),
    ArrowDown: () => move("down"),
    ArrowLeft: () => move("left"),
    ArrowRight: () => move("right"),
    Escape: () => input("B"),
  };
  if (!typing) {
    Object.assign(keys, {
      Enter: () => input("A"), " ": () => input("A"), Backspace: () => input("B"),
      x: () => input("X"), y: () => input("Y"), "[": () => input("L1"), "]": () => input("R1"), q: () => input("QAM"),
    });
  }
  const fn = keys[e.key];
  if (!fn || e.metaKey || e.ctrlKey) return;
  if (typing && (e.key === "ArrowLeft" || e.key === "ArrowRight") &&
    !caretAtEdge(typing, e.key === "ArrowLeft" ? "left" : "right")) return;
  e.preventDefault();
  fn();
}

// Standard gamepad mapping. A held direction repeats after 400 ms, every 120 ms.
const PAD_BUTTONS: [number, Input][] = [[0, "A"], [1, "B"], [2, "X"], [3, "Y"], [4, "L1"], [5, "R1"], [8, "QAM"]];
const held = new Map<string, number>();

function poll(t: number) {
  claim();
  for (const pad of navigator.getGamepads()) {
    if (!pad) continue;
    const down = (i: number) => !!pad.buttons[i]?.pressed;
    const dirs = {
      up: down(12) || pad.axes[1] < -0.6, down: down(13) || pad.axes[1] > 0.6,
      left: down(14) || pad.axes[0] < -0.6, right: down(15) || pad.axes[0] > 0.6,
    };
    for (const [dir, on] of Object.entries(dirs) as ["up", boolean][]) {
      const key = `${pad.index}${dir}`;
      if (!on) held.delete(key);
      else if (!held.has(key) || t >= held.get(key)!) {
        held.set(key, t + (held.has(key) ? 120 : 400));
        move(dir);
      }
    }
    for (const [i, button] of PAD_BUTTONS) {
      const key = `${pad.index}b${i}`;
      if (!down(i)) held.delete(key);
      else if (!held.has(key)) {
        held.set(key, t);
        input(button);
      }
    }
  }
  requestAnimationFrame(poll);
}

const DIRECTIONS = ["up", "down", "left", "right"];
const BUTTONS = ["A", "B", "X", "Y", "L1", "R1", "QAM"];

// The studio around the screen sends the buttons clicked on its sketch of the device.
function onMessage(e: MessageEvent) {
  const button = e.origin === location.origin ? e.data?.deckyVite : null;
  if (DIRECTIONS.includes(button)) move(button);
  else if (BUTTONS.includes(button)) input(button);
}

export function startInput() {
  addEventListener("keydown", onKey);
  addEventListener("message", onMessage);
  requestAnimationFrame(poll);
}
