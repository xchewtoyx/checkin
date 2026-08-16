// Renders the feelings taxonomy (src/feelings-wheel.ts) as a sunburst SVG.
// Everything is derived from WHEEL — geometry (60° sectors, 10° middle arcs,
// 10/6° outer arcs), ring tints, and per-wedge label ink — so the diagram
// regenerates faithfully after any vocabulary change.
//
//   npm run wheel-svg          # writes docs/feelings-wheel.svg
//
// Requires Node ≥ 22.6 (uses --experimental-strip-types to import the
// TypeScript data module directly; no build step, no dependencies).
import { WHEEL } from "../src/feelings-wheel.ts";
import { writeFileSync } from "node:fs";

const OUT = new URL("../docs/feelings-wheel.svg", import.meta.url);
const SURFACE = "#fcfcfb";
const INK = "#26262b";
const R = { coreIn: 95, coreOut: 235, midOut: 372, outOut: 568 };
const SIZE = 1180; // viewBox is square, centred on 0,0

const rad = (deg) => ((deg - 90) * Math.PI) / 180; // 0° = 12 o'clock, clockwise
const px = (r, a) => [r * Math.cos(rad(a)), r * Math.sin(rad(a))];
const f = (n) => n.toFixed(2);

function annular(a0, a1, r0, r1) {
  const large = a1 - a0 > 180 ? 1 : 0;
  const [x0o, y0o] = px(r1, a0);
  const [x1o, y1o] = px(r1, a1);
  const [x1i, y1i] = px(r0, a1);
  const [x0i, y0i] = px(r0, a0);
  return [
    `M${f(x0o)},${f(y0o)}`,
    `A${r1},${r1} 0 ${large} 1 ${f(x1o)},${f(y1o)}`,
    `L${f(x1i)},${f(y1i)}`,
    `A${r0},${r0} 0 ${large} 0 ${f(x0i)},${f(y0i)}`,
    "Z",
  ].join(" ");
}

const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const rgbHex = (c) =>
  "#" + c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
const tint = (h, t) => rgbHex(hexRgb(h).map((v) => v + (255 - v) * t));

function luminance(h) {
  const [r, g, b] = hexRgb(h).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// whichever of white/ink contrasts better against the wedge fill
function inkOn(h) {
  const L = luminance(h);
  const white = 1.05 / (L + 0.05);
  const dark = (L + 0.05) / (luminance(INK) + 0.05);
  return dark >= white ? INK : "#ffffff";
}

// radial label (reads outward; flipped on the left half so it's never upside-down)
function radialText(angle, r, text, size, weight, fill) {
  const flip = angle >= 180;
  const transform = `rotate(${f(angle - 90)}) translate(${f(r)},0)${flip ? " rotate(180)" : ""}`;
  const anchor = flip ? "end" : "start";
  return `<text transform="${transform}" text-anchor="${anchor}" dominant-baseline="middle" font-size="${size}" font-weight="${weight}" fill="${fill}">${text}</text>`;
}

// tangential label for the cores (along the arc, upright on the bottom half)
function tangentText(angle, r, text, size, weight, fill) {
  const [x, y] = px(r, angle);
  const rot = angle > 90 && angle < 270 ? angle + 180 : angle;
  return `<text transform="translate(${f(x)},${f(y)}) rotate(${f(rot)})" text-anchor="middle" dominant-baseline="middle" font-size="${size}" font-weight="${weight}" fill="${fill}">${text}</text>`;
}

const parts = [];
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

WHEEL.forEach((sector, i) => {
  const a0 = i * 60;
  const midFill = tint(sector.hue, 0.38);
  const outFill = tint(sector.hue, 0.66);

  parts.push(
    `<path d="${annular(a0, a0 + 60, R.coreIn, R.coreOut)}" fill="${sector.hue}" stroke="${SURFACE}" stroke-width="2.5"><title>${esc(sector.core)} (${sector.valence})</title></path>`,
  );
  parts.push(
    tangentText(a0 + 30, (R.coreIn + R.coreOut) / 2 + 4, esc(sector.core), 30, 650, inkOn(sector.hue)),
  );

  sector.feelings.forEach((feeling, j) => {
    const m0 = a0 + j * 10;
    parts.push(
      `<path d="${annular(m0, m0 + 10, R.coreOut, R.midOut)}" fill="${midFill}" stroke="${SURFACE}" stroke-width="2"><title>${esc(sector.core)} &gt; ${esc(feeling.word)}</title></path>`,
    );
    parts.push(radialText(m0 + 5, R.coreOut + 10, esc(feeling.word), 16.5, 600, INK));

    feeling.finer.forEach((word, k) => {
      const o0 = m0 + (k * 10) / 6;
      parts.push(
        `<path d="${annular(o0, o0 + 10 / 6, R.midOut, R.outOut)}" fill="${outFill}" stroke="${SURFACE}" stroke-width="1.5"><title>${esc(sector.core)} &gt; ${esc(feeling.word)} &gt; ${esc(word)}</title></path>`,
      );
      parts.push(radialText(o0 + 10 / 12, R.midOut + 8, esc(word), 10.5, 450, INK));
    });
  });
});

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-SIZE / 2} ${-SIZE / 2} ${SIZE} ${SIZE}" width="${SIZE}" height="${SIZE}" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif">
<rect x="${-SIZE / 2}" y="${-SIZE / 2}" width="${SIZE}" height="${SIZE}" fill="${SURFACE}"/>
${parts.join("\n")}
<circle r="${R.coreIn - 6}" fill="${SURFACE}"/>
<text text-anchor="middle" dominant-baseline="middle" y="-14" font-size="22" font-weight="650" fill="${INK}">checkin</text>
<text text-anchor="middle" dominant-baseline="middle" y="12" font-size="13" fill="#6b6b70">feelings wheel</text>
<text text-anchor="middle" dominant-baseline="middle" y="32" font-size="12" fill="#6b6b70">6 × 36 × 216</text>
</svg>
`;

writeFileSync(OUT, svg);
console.log(`wrote ${OUT.pathname} (${svg.length} bytes)`);
