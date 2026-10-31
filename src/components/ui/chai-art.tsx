import * as React from "react";
import type { AvatarKey } from "@/lib/avatars";

/*
  The chai set: five flat, single-colour glyphs on a 48x48 grid — a kulhad,
  a glass of cutting chai, a ketli, a sprig of chai patti and an elaichi
  pod. Minimal on purpose: one cream ink on the person's colour (the Avatar
  root paints the circle), with fine detail as a darker line only where it
  helps the shape read, so each stays recognisable at 20px.
*/

const INK = "#FFF8EE";
const LINE = "rgba(43, 26, 16, 0.28)";

const ART: Record<AvatarKey, React.ReactNode> = {
  kulhad: (
    <>
      <g fill="none" stroke={INK} strokeWidth={1.7} strokeLinecap="round" opacity={0.75}>
        <path d="M21 17c-1.6-1.8 1.6-2.8 0-4.6s1.6-2.8 0-4.6" />
        <path d="M27 17c-1.6-1.8 1.6-2.8 0-4.6s1.6-2.8 0-4.6" />
      </g>
      <path d="M14.6 21.4h18.8l-2.2 13.8a3 3 0 0 1-3 2.5h-8.4a3 3 0 0 1-3-2.5Z" fill={INK} />
      <rect x={13.4} y={19.2} width={21.2} height={3.2} rx={1.6} fill={INK} />
      <path d="M15.4 26.4h17.2" stroke={LINE} strokeWidth={1.1} />
    </>
  ),
  cutting: (
    <>
      <path
        d="M16.6 10.5h14.8l-1.7 25.3a2.3 2.3 0 0 1-2.3 2.2h-6.8a2.3 2.3 0 0 1-2.3-2.2Z"
        fill="none"
        stroke={INK}
        strokeWidth={1.7}
        strokeLinejoin="round"
      />
      <path d="M17.7 19.5h12.6l-1.08 16.1a1.3 1.3 0 0 1-1.3 1.2h-7.84a1.3 1.3 0 0 1-1.3-1.2Z" fill={INK} />
      <g stroke={INK} strokeWidth={1.1} strokeLinecap="round" opacity={0.55}>
        <path d="M21 12.5v5" />
        <path d="M24 12.5v5" />
        <path d="M27 12.5v5" />
      </g>
      <path d="M17.9 22.2h12.2" stroke={LINE} strokeWidth={1} />
    </>
  ),
  ketli: (
    <>
      <circle cx={24} cy={14.6} r={1.9} fill={INK} />
      <path d="M17.6 18.6c1.6-1.6 3.8-2.3 6.4-2.3s4.8.7 6.4 2.3Z" fill={INK} />
      <path d="M14.4 25.2c0-4.4 4-6.6 9.6-6.6s9.6 2.2 9.6 6.6v4.2c0 5-4.4 7.6-9.6 7.6s-9.6-2.6-9.6-7.6Z" fill={INK} />
      <path d="M33.2 26.4l5.4-6.2a1 1 0 0 1 1.6 1.1l-4.6 8.6-2.4.6Z" fill={INK} />
      <path d="M14.8 22.6c-3.6.2-5.4 2.4-5 5.4.4 2.8 2.6 4.2 5.2 4" fill="none" stroke={INK} strokeWidth={1.8} strokeLinecap="round" />
      <path d="M15 24.6h18" stroke={LINE} strokeWidth={1.1} />
    </>
  ),
  patti: (
    <>
      <path d="M24 33v7" stroke={INK} strokeWidth={1.8} strokeLinecap="round" />
      <path d="M24 36c-9.6-1.6-13.6-9.8-11.8-18.2 8 1.2 13 8.4 11.8 18.2Z" fill={INK} />
      <path d="M24 36c9.6-1.6 13.6-9.8 11.8-18.2-8 1.2-13 8.4-11.8 18.2Z" fill={INK} />
      <path d="M24 31c-3.4-6.6-3.4-14.4 0-21.6 3.4 7.2 3.4 15 0 21.6Z" fill={INK} />
      <g fill="none" stroke={LINE} strokeWidth={0.9} strokeLinecap="round">
        <path d="M23.4 34.6c-3.2-4.4-6.2-8.8-9.4-14" />
        <path d="M24.6 34.6c3.2-4.4 6.2-8.8 9.4-14" />
        <path d="M24 28.6V13" />
      </g>
    </>
  ),
  elaichi: (
    <g transform="rotate(24 24 24)">
      <path d="M23.1 7.6h1.8v4h-1.8Z" fill={INK} />
      <path d="M24 10.8c7.4 2.2 9.4 14.8 4.4 23.6-1.8 3.2-7 3.2-8.8 0-5-8.8-3-21.4 4.4-23.6Z" fill={INK} />
      <g fill="none" stroke={LINE} strokeWidth={1} strokeLinecap="round">
        <path d="M21.4 14.6c-1.8 5.4-1.8 12.4.6 18.6" />
        <path d="M26.6 14.6c1.8 5.4 1.8 12.4-.6 18.6" />
      </g>
    </g>
  ),
};

/** The full-bleed chai illustration for an avatar circle. */
export function ChaiArt({ avatar, className }: { avatar: AvatarKey; className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden focusable="false">
      {ART[avatar]}
    </svg>
  );
}
