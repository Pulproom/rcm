import { EntityColorSchema } from "@rcm/shared";

const hues = [350, 26, 62, 98, 134, 170, 206, 242, 278, 314];
export function avatarHue(name: string): number {
  let hash = 2166136261;
  for (const char of String(name ?? "").trim().toLocaleLowerCase()) hash = Math.imul(hash ^ char.codePointAt(0)!, 16777619) >>> 0;
  return hues[hash % hues.length]!;
}
const keyOf = (name: string) => String(name).trim().toLocaleLowerCase();
type PersonColor = { hex: string; top: string; h: number; s: number; l: number; darkInk: boolean; custom: boolean };
let colors = new Map<string, PersonColor>();
const toHex = (rgb: number[]) => `#${rgb.map(value => Math.round(value).toString(16).padStart(2, "0")).join("")}`;
const luminance = (rgb: number[]) => rgb.map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
  .reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index]!, 0);
function hslHex(h: number, s: number, l: number): string {
  const sat = s / 100, light = l / 100, a = sat * Math.min(light, 1 - light);
  const channel = (n: number) => { const k = (n + h / 30) % 12; return (light - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255; };
  return toHex([channel(0), channel(8), channel(4)]);
}
function parseColor(value: unknown): PersonColor | undefined {
  const parsed = EntityColorSchema.safeParse(value);
  if (!parsed.success || parsed.data === null) return undefined;
  const hex = parsed.data.toLowerCase(), rgb = [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16));
  const channels = rgb.map(value => value / 255), high = Math.max(...channels), low = Math.min(...channels), delta = high - low;
  const l = (high + low) / 2;
  const h = delta === 0 ? 0 : (high === channels[0] ? (channels[1]! - channels[2]!) / delta : high === channels[1] ? (channels[2]! - channels[0]!) / delta + 2 : (channels[0]! - channels[1]!) / delta + 4) * 60;
  const hue = (h + 360) % 360, sat = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1)) * 100;
  // Same light-top gradient as the default faces: a touch more saturated and up to 16 points lighter than the chosen base.
  // Already-light picks get a smaller lift so the top never washes out to white.
  const top = hslHex(hue, Math.min(100, sat + 10), l * 100 + Math.max(0, Math.min(16, (92 - l * 100) * .55)));
  // White initials like the default faces; only genuinely pale picks (cream, pastel yellow, near white) switch to dark ink.
  return { hex, top, h: hue, s: sat, l: l * 100, darkInk: luminance(rgb) > .55, custom: true };
}
export function defaultPersonColor(name: string): PersonColor {
  const h = avatarHue(name), s = .52, l = .5;
  const a = s * Math.min(l, 1 - l);
  const channel = (n: number) => { const k = (n + h / 30) % 12; return (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255; };
  return { ...parseColor(toHex([channel(0), channel(8), channel(4)]))!, h, s: 52, l: 50, custom: false };
}
/** Presentation registry is replaced per dashboard render/chat; ambiguous names retain their hash default. */
export function setAvatarColors(entities: readonly any[]): void {
  const next = new Map<string, PersonColor>(), owners = new Map<string, string>();
  for (const [index, entity] of entities.entries()) {
    const color = parseColor(entity.color), owner = String(entity.id ?? index);
    for (const name of new Set([entity.name, entity.displayName, entity.internalName, ...(entity.aliases ?? [])].filter(value => typeof value === "string" && value.trim()).map(keyOf))) {
      if (owners.has(name) && owners.get(name) !== owner) { owners.set(name, ""); next.delete(name); continue; }
      owners.set(name, owner); if (color) next.set(name, color);
    }
  }
  colors = next;
}
export const personColor = (name: string): PersonColor => colors.get(keyOf(name)) ?? defaultPersonColor(name);
export function avatarColorStyle(name: string): string {
  const color = personColor(name);
  return color.custom ? `--av-h:${color.h};--av-base:${color.hex};--av-top:${color.top};--av-ink:var(--avatar-${color.darkInk ? "dark" : "light"}-ink)` : `--av-h:${color.h}`;
}
/** Similar chosen colours stay unchanged on avatars; only the second chart line is separated. */
export function chartPersonColors(a: string, b: string): [{ h: number; s: number; l: number }, { h: number; s: number; l: number }] {
  const first = personColor(a), second = personColor(b);
  const hueDistance = Math.min(Math.abs(first.h - second.h), 360 - Math.abs(first.h - second.h));
  return [{ h: first.h, s: Math.max(16, first.s), l: first.l },
    { h: hueDistance < 40 && Math.abs(first.l - second.l) < 15 ? (first.h + 45) % 360 : second.h, s: Math.max(16, second.s), l: second.l }];
}
