import * as React from "react";
import type { AnimalKey } from "@/lib/avatars";

/*
  The animal chai club, futuristic edition: each animal is a faceted,
  low-poly head on a 48x48 grid — lit from the top left, so the left
  facets are the light tone and the right ones the shade — with glowing
  eyes and a glassy sheen over the whole disc.

  Drawn to stay distinct at 20px: the silhouette (ears, mane, tufts) and
  the head's own colour carry the species; facets and glow are the finish
  you see at full size. The person's colour shows through as the circle
  behind them (the Avatar root paints it), so the art keeps transparent
  corners, with only a soft light behind the head to lift it off any
  colour.
*/

type Pt = readonly [number, number];
type Tone = { hi: string; mid: string; lo: string };

const INK = "#17142A";

const pts = (p: readonly Pt[]) => p.map(([x, y]) => `${x},${y}`).join(" ");
const flip = (p: readonly Pt[]): Pt[] => p.map(([x, y]) => [48 - x, y] as const);

/** A facet; the hairline stroke in its own colour hides the seam with its neighbour. */
function F({ p, fill, opacity }: { p: readonly Pt[]; fill: string; opacity?: number }) {
  return <polygon points={pts(p)} fill={fill} stroke={fill} strokeWidth={0.35} strokeLinejoin="round" opacity={opacity} />;
}

/** A shape and its mirror image: the left lit, the right in shade. */
function Pair({ p, left, right }: { p: readonly Pt[]; left: string; right?: string }) {
  return (
    <>
      <F p={p} fill={left} />
      <F p={flip(p)} fill={right ?? left} />
    </>
  );
}

/*
  The shared head: eight facets around a centre, its width and chin set
  per animal. Top-left facets take the highlight, bottom-right the shade.
*/
function Head({ tone, w = 1, top = 11, chin = 38.5 }: { tone: Tone; w?: number; top?: number; chin?: number }) {
  const C: Pt = [24, 26];
  const T: Pt = [24, top];
  const UL: Pt = [24 - 11 * w, 16];
  const L: Pt = [24 - 13 * w, 26];
  const CL: Pt = [24 - 7.5 * w, 35.5];
  const B: Pt = [24, chin];
  const UR: Pt = [24 + 11 * w, 16];
  const R: Pt = [24 + 13 * w, 26];
  const CR: Pt = [24 + 7.5 * w, 35.5];
  return (
    <>
      <F p={[T, UL, C]} fill={tone.hi} />
      <F p={[T, UR, C]} fill={tone.mid} />
      <F p={[UL, L, C]} fill={tone.mid} />
      <F p={[UR, R, C]} fill={tone.lo} />
      <F p={[L, CL, C]} fill={tone.hi} />
      <F p={[R, CR, C]} fill={tone.lo} />
      <F p={[CL, B, C]} fill={tone.mid} />
      <F p={[CR, B, C]} fill={tone.lo} />
      {/* Rim light along the lit edge. */}
      <polyline
        points={pts([L, UL, T])}
        fill="none"
        stroke="#FFFFFF"
        strokeOpacity={0.45}
        strokeWidth={0.6}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </>
  );
}

/** Glowing eyes: a soft halo, a bright lens, a hot core. */
function Eyes({ glow, y = 24, dx = 5.4, tilt = 12, rx = 2, ry = 1.25 }: { glow: string; y?: number; dx?: number; tilt?: number; rx?: number; ry?: number }) {
  return (
    <>
      {[-1, 1].map((side) => {
        const cx = 24 + side * dx;
        return (
          <g key={side} transform={`rotate(${side * tilt} ${cx} ${y})`}>
            <ellipse cx={cx} cy={y} rx={rx + 1.4} ry={ry + 1.2} fill={glow} opacity={0.3} />
            <ellipse cx={cx} cy={y} rx={rx} ry={ry} fill={glow} />
            <ellipse cx={cx - side * 0.3} cy={y - 0.2} rx={rx * 0.45} ry={ry * 0.45} fill="#FFFFFF" />
          </g>
        );
      })}
    </>
  );
}

function Nose({ x = 24, y = 29.6, w = 1.6, h = 2, fill = INK }: { x?: number; y?: number; w?: number; h?: number; fill?: string }) {
  return <F p={[[x - w, y], [x + w, y], [x, y + h]]} fill={fill} />;
}

// ── The crew ─────────────────────────────────────────────────────────────────

const GLOW = {
  cyan: "#6FF3FF",
  mint: "#7CFFC4",
  gold: "#FFE27A",
  amber: "#FFC24D",
  pink: "#FF9FD2",
  ice: "#B4F4FF",
};

const ART: Record<AnimalKey, React.ReactNode> = {
  fox: (
    <>
      <Pair p={[[12.5, 18], [14, 4.5], [17, 15]]} left="#FF9A4D" right="#C9561B" />
      <Pair p={[[14, 4.5], [21, 13], [17, 15]]} left="#F07A2C" right="#B24A14" />
      <Pair p={[[14.8, 15], [15.1, 8.6], [18.4, 12.8]]} left="#FFE1C4" right="#F2C29C" />
      <Head tone={{ hi: "#FF9A4D", mid: "#F07A2C", lo: "#C9561B" }} />
      <F p={[[16.5, 29], [24, 29.6], [24, 38.5]]} fill="#FFF6EC" />
      <F p={[[31.5, 29], [24, 29.6], [24, 38.5]]} fill="#E9DCCF" />
      <Eyes glow={GLOW.cyan} tilt={16} />
      <Nose />
    </>
  ),
  panda: (
    <>
      <Pair p={[[9, 11.5], [12, 7.5], [16.5, 8.5], [18, 13], [13.5, 17]]} left="#34323F" right="#22212B" />
      <Head tone={{ hi: "#FFFFFF", mid: "#EEF0F6", lo: "#D3D7E3" }} />
      <Pair p={[[14.2, 21], [20.4, 20.6], [21.4, 26.6], [15.6, 28.6]]} left="#2B2936" right="#1F1E28" />
      <Eyes glow={GLOW.mint} y={24} dx={6} tilt={-14} rx={1.7} ry={1.1} />
      <Nose y={29.4} w={1.4} h={1.7} />
      <Pair p={[[13, 30.5], [15.4, 30.2], [14.4, 32]]} left="#FF9EC7" />
    </>
  ),
  owl: (
    <>
      <Pair p={[[12.2, 18.5], [11, 5], [19.5, 13.5]]} left="#B07E52" right="#7E5333" />
      <Head tone={{ hi: "#C99A6B", mid: "#A87447", lo: "#7E5333" }} top={13} chin={39} />
      <Pair
        p={[[18.4, 18.2], [22.8, 20.2], [23.6, 24.6], [21.6, 28.8], [16.8, 29.6], [13.4, 26.4], [13.4, 21.4]]}
        left="#F5E6CF"
        right="#E1CDB2"
      />
      <Eyes glow={GLOW.amber} y={24} dx={5.4} tilt={0} rx={2.4} ry={2.4} />
      <F p={[[22.5, 28], [25.5, 28], [24, 32.4]]} fill="#FFB13D" />
      <g stroke="#7E5333" strokeWidth={0.7} strokeLinecap="round" fill="none" opacity={0.7}>
        <polyline points="20,34.6 21.4,35.8 22.8,34.6" />
        <polyline points="25.2,34.6 26.6,35.8 28,34.6" />
      </g>
    </>
  ),
  cat: (
    <>
      <Pair p={[[12.5, 18.5], [13.4, 6], [20.5, 13.5]]} left="#B9B3D6" right="#756DA2" />
      <Pair p={[[14.6, 15.6], [15, 9.4], [18.4, 13.4]]} left="#F7C9E6" right="#E7AFD2" />
      <Head tone={{ hi: "#B9B3D6", mid: "#9A93C2", lo: "#756DA2" }} />
      <F p={[[19.4, 28.6], [24, 28.8], [24, 34.4]]} fill="#EFEBFA" />
      <F p={[[28.6, 28.6], [24, 28.8], [24, 34.4]]} fill="#DCD6F0" />
      <Eyes glow={GLOW.mint} tilt={14} rx={2.1} ry={1.15} />
      <Nose y={28.8} w={1.3} h={1.6} fill="#FF7FB0" />
      <g stroke={GLOW.mint} strokeWidth={0.5} strokeLinecap="round" opacity={0.85}>
        <line x1="9.4" y1="28.2" x2="17.4" y2="29.6" />
        <line x1="9.8" y1="31.8" x2="17.4" y2="30.8" />
        <line x1="38.6" y1="28.2" x2="30.6" y2="29.6" />
        <line x1="38.2" y1="31.8" x2="30.6" y2="30.8" />
      </g>
    </>
  ),
  bunny: (
    <>
      <Pair p={[[16, 15], [14.2, 1.6], [19.6, 1.8], [21.4, 13.6]]} left="#FFFFFF" right="#D9D0E6" />
      <Pair p={[[16.8, 12.6], [15.9, 4.4], [18.6, 4.5], [19.6, 12.2]]} left="#FFC2DA" right="#F2A8C6" />
      <Head tone={{ hi: "#FFFFFF", mid: "#F1ECF7", lo: "#D9D0E6" }} top={13} />
      <Eyes glow={GLOW.pink} y={24.4} tilt={0} rx={1.8} ry={1.8} />
      <Nose y={29} w={1.2} h={1.4} fill="#FF7FB0" />
      <Pair p={[[13, 29.6], [15.8, 29.4], [14.6, 31.4]]} left="#FFB8D6" />
      <g stroke="#B9AECB" strokeWidth={0.55} strokeLinecap="round" fill="none">
        <polyline points="22.2,31.6 24,32.6 25.8,31.6" />
      </g>
    </>
  ),
  tiger: (
    <>
      <Pair p={[[10.4, 15.4], [12, 9.6], [17.4, 9.8], [18.6, 13.4], [14.2, 17.6]]} left="#F28A2A" right="#C25F14" />
      <Pair p={[[12.6, 14.6], [13.4, 11.4], [16.2, 11.6], [15.4, 14.8]]} left="#FFF3E0" right="#F1DFC6" />
      <Head tone={{ hi: "#FFA54A", mid: "#F28A2A", lo: "#CF6516" }} w={1.04} />
      <F p={[[15.4, 28.4], [24, 29], [24, 38.5]]} fill="#FFF6EC" />
      <F p={[[32.6, 28.4], [24, 29], [24, 38.5]]} fill="#ECDCCB" />
      <F p={[[24, 11.4], [22.4, 15.6], [24, 18.2], [25.6, 15.6]]} fill="#2A1A12" />
      <Pair p={[[19.2, 13.4], [20.8, 13.2], [20.2, 17.2]]} left="#2A1A12" />
      <Pair p={[[10.8, 22], [16.4, 23.2], [11.4, 24.8]]} left="#2A1A12" />
      <Pair p={[[11.2, 27.4], [16.2, 27.8], [12, 30]]} left="#2A1A12" />
      <Eyes glow={GLOW.cyan} y={23.6} tilt={10} />
      <Nose y={29.4} w={1.8} h={2} fill="#3B2018" />
    </>
  ),
  lion: (
    <>
      {/* The mane: a ring of spikes behind the head, alternately lit and shaded. */}
      {Array.from({ length: 14 }, (_, i) => {
        const a0 = (i / 14) * Math.PI * 2;
        const a1 = ((i + 0.5) / 14) * Math.PI * 2;
        const a2 = ((i + 1) / 14) * Math.PI * 2;
        const at = (a: number, r: number): Pt => [24 + Math.cos(a) * r, 25.5 + Math.sin(a) * r];
        const lit = Math.cos(a1 + Math.PI * 0.75) > 0;
        return <F key={i} p={[at(a0, 12), at(a1, 19.5), at(a2, 12), [24, 25.5]]} fill={lit ? "#D9862A" : "#A65A18"} />;
      })}
      <Head tone={{ hi: "#FFD27A", mid: "#F2B85A", lo: "#D49A3E" }} w={0.9} top={12.5} chin={37.5} />
      <F p={[[17.6, 28.6], [24, 29.2], [24, 37.5]]} fill="#FFF1D6" />
      <F p={[[30.4, 28.6], [24, 29.2], [24, 37.5]]} fill="#EEDBB8" />
      <Eyes glow={GLOW.gold} y={23.8} dx={5} tilt={8} rx={1.9} ry={1.15} />
      <Nose y={29.2} w={1.7} h={2} fill="#5A2E14" />
    </>
  ),
  bulldog: (
    <>
      <Head tone={{ hi: "#E8C9A4", mid: "#D2AE84", lo: "#B38C62" }} w={1.14} top={13} chin={38} />
      <Pair p={[[10.4, 15.6], [7, 23.4], [12.6, 23], [15.6, 17]]} left="#8A6544" right="#6E4E33" />
      <F p={[[13.6, 28.6], [24, 29], [24, 38], [17.4, 37]]} fill="#FFF6EC" />
      <F p={[[34.4, 28.6], [24, 29], [24, 38], [30.6, 37]]} fill="#E9DCCF" />
      <g stroke="#9C7754" strokeWidth={0.6} strokeLinecap="round" fill="none" opacity={0.8}>
        <polyline points="19.6,17.6 24,16.4 28.4,17.6" />
        <polyline points="21,19.6 24,18.8 27,19.6" />
      </g>
      <Eyes glow={GLOW.cyan} y={23.8} dx={6.2} tilt={-6} rx={1.8} ry={1.2} />
      <F p={[[21.6, 28.2], [26.4, 28.2], [25.3, 30.6], [22.7, 30.6]]} fill={INK} />
      <polyline points="20.6,33.6 24,35 27.4,33.6" stroke={INK} strokeWidth={0.7} fill="none" strokeLinecap="round" />
    </>
  ),
  wolf: (
    <>
      <Pair p={[[12.8, 17.8], [13.4, 3.4], [20.8, 12.8]]} left="#9FB3CC" right="#5D7190" />
      <Pair p={[[14.6, 15.4], [14.9, 7.8], [18.6, 12.6]]} left="#E1EAF5" right="#C6D3E3" />
      <Head tone={{ hi: "#9FB3CC", mid: "#7F94B0", lo: "#5D7190" }} w={0.96} chin={39.5} />
      <F p={[[24, 13.4], [22, 18.6], [24, 21.6], [26, 18.6]]} fill="#C9D6E6" />
      <F p={[[17.6, 26.4], [24, 26.8], [24, 39.5]]} fill="#EEF3F9" />
      <F p={[[30.4, 26.4], [24, 26.8], [24, 39.5]]} fill="#D6DFEA" />
      <Eyes glow={GLOW.ice} y={23.2} dx={5.2} tilt={18} rx={2.1} ry={1.05} />
      <Nose y={31.6} w={1.7} h={2} />
    </>
  ),
  monkey: (
    <>
      <Pair p={[[6, 22.6], [8.6, 19.4], [12.8, 20.4], [13.2, 28], [9, 29.6], [6.2, 27]]} left="#9C6B4A" right="#643F26" />
      <Pair p={[[8.4, 23], [11.2, 22.4], [11.4, 26.8], [8.8, 27.4]]} left="#F6D2B0" right="#E2B994" />
      <Head tone={{ hi: "#9C6B4A", mid: "#835536", lo: "#643F26" }} w={0.98} />
      <F p={[[16, 20], [20.5, 18.4], [24, 21], [24, 36], [19.4, 35.6], [15, 28.4]]} fill="#F6D2B0" />
      <F p={[[32, 20], [27.5, 18.4], [24, 21], [24, 36], [28.6, 35.6], [33, 28.4]]} fill="#E8BE98" />
      <Eyes glow={GLOW.amber} y={24} dx={4.6} tilt={6} rx={1.8} ry={1.25} />
      <circle cx={22.8} cy={29.4} r={0.65} fill="#7A4E2A" />
      <circle cx={25.2} cy={29.4} r={0.65} fill="#7A4E2A" />
      <polyline points="20.8,32.2 24,33.8 27.2,32.2" stroke="#7A4E2A" strokeWidth={0.75} fill="none" strokeLinecap="round" />
    </>
  ),
};

/** The full-bleed animal drawing for an avatar circle. */
export function AnimalArt({ animal, className }: { animal: AnimalKey; className?: string }) {
  // Gradient ids must be unique per drawing: a board shows dozens at once.
  const id = React.useId().replace(/:/g, "");
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden focusable="false">
      <defs>
        <radialGradient id={`${id}-halo`} cx="50%" cy="54%" r="50%">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity={0.4} />
          <stop offset="100%" stopColor="#FFFFFF" stopOpacity={0} />
        </radialGradient>
        <linearGradient id={`${id}-glass`} x1="0" y1="0" x2="0.9" y2="1">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity={0.38} />
          <stop offset="45%" stopColor="#FFFFFF" stopOpacity={0} />
          <stop offset="100%" stopColor="#0B0A1A" stopOpacity={0.22} />
        </linearGradient>
      </defs>
      <circle cx="24" cy="26" r="22" fill={`url(#${id}-halo)`} />
      {ART[animal]}
      {/* Glass over the whole disc: a highlight top left, a little depth bottom right. */}
      <rect width="48" height="48" fill={`url(#${id}-glass)`} />
    </svg>
  );
}
