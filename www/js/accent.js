// The accent color: one of the tones of the logo as the primary color of every component. A
// dark tone would vanish on the dark theme (a navy button on a navy-black page), so those carry
// a lighter companion for it; the choice is kept per machine, like the theme.

import { definePrimary, onThemeChange } from "@raylang/elements";
import { $ } from "./util.js";

/// The tones, the default first. `dark`: the one used on the dark theme, when not the same.
export const TONES = [
  { id: "midnight", color: "#1E2B58", dark: "#4A63B8" },
  { id: "cobalt", color: "#3B5BFD" },
  { id: "indigo", color: "#4338CA" },
  { id: "ocean", color: "#0B6E99" },
  { id: "pine", color: "#0F6B5C" },
  { id: "violet", color: "#6D4AFF" },
  { id: "graphite", color: "#1C1F26", dark: "#E4E6EB" },
];

const KEY = "rayreq.accent";

let current = TONES[0];
let applied = null; // the color last given to definePrimary

const isDark = () => {
  const forced = document.documentElement.getAttribute("data-theme");
  return forced ? forced === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
};

/// The tone in use.
export const accent = () => current.id;

function paint() {
  const color = isDark() && current.dark ? current.dark : current.color;
  // definePrimary announces a theme change, which comes back here: only a new color goes on.
  if (color === applied) return;
  applied = color;
  definePrimary(color);
  for (const item of $("accent-menu").querySelectorAll("ray-menu-item")) {
    const on = item.getAttribute("value") === current.id;
    item.toggleAttribute("data-current", on);
    if (on) item.setAttribute("aria-current", "true");
    else item.removeAttribute("aria-current");
  }
}

/// Switches to the tone `id` (an unknown one is the default) and keeps it.
export function setAccent(id) {
  current = TONES.find((t) => t.id === id) || TONES[0];
  try {
    localStorage.setItem(KEY, current.id);
  } catch { /* not kept: fine */ }
  applied = null;
  paint();
}

/// The menu of tones in the top bar, and the saved tone on the page.
export function initAccent() {
  const menu = $("accent-menu");
  for (const tone of TONES) {
    const item = document.createElement("ray-menu-item");
    item.setAttribute("value", tone.id);
    const swatch = document.createElement("span");
    swatch.slot = "left";
    swatch.className = "accent-swatch";
    swatch.style.setProperty("--swatch", tone.color);
    swatch.style.setProperty("--swatch-dark", tone.dark || tone.color);
    const label = document.createElement("span");
    label.dataset.i18n = `accent.${tone.id}`;
    const check = document.createElement("ray-icon");
    check.slot = "right";
    check.className = "accent-check";
    check.setAttribute("name", "check");
    item.append(swatch, label, check);
    menu.append(item);
  }
  menu.addEventListener("ray-select", (e) => setAccent(e.detail.value));
  let saved = null;
  try {
    saved = localStorage.getItem(KEY);
  } catch { /* the default */ }
  current = TONES.find((t) => t.id === saved) || TONES[0];
  paint();
  onThemeChange(paint);
}
