import * as React from "react";
import type { AnimalKey } from "@/lib/avatars";

/*
  The animal chai club artwork: flat SVG animals on a 48x48 grid, drawn to
  stay distinct at 20px — species silhouette first (ears, mane, eye bumps),
  markings second, expression third — the wild crew keep the expressions
  they actually wear (calm, regal, jowly), never cartoon anger. Every
  animal holds the same little kulhad. The person's colour shows through
  as the circle behind
  them (the Avatar root paints it), so the art itself is transparent.
*/

const INK = "#43302E";

function Kulhad({ paw }: { paw: string }) {
  return (
    <g>
      <g stroke="#FFF7EA" strokeWidth="1.1" strokeLinecap="round" fill="none" opacity="0.9">
        <path d="M21.3 34.6c.9-1.2-.7-1.9 0-3.2" />
        <path d="M26.7 34.6c-.9-1.2.7-1.9 0-3.2" />
      </g>
      <ellipse cx="17.4" cy="40.6" rx="2.1" ry="2.7" fill={paw} />
      <ellipse cx="30.6" cy="40.6" rx="2.1" ry="2.7" fill={paw} />
      <path d="M18.6 37.6h10.8l-.9 6.1a2 2 0 0 1-2 1.7h-5a2 2 0 0 1-2-1.7l-.9-6.1Z" fill="#C07A3E" />
      <ellipse cx="24" cy="37.6" rx="5.4" ry="1.7" fill="#A8622C" />
      <ellipse cx="24" cy="37.4" rx="4.4" ry="1.2" fill="#7C4A21" />
    </g>
  );
}

function Blush({ y = 27.5 }: { y?: number }) {
  return (
    <g fill="#F2A18A" opacity="0.75">
      <circle cx="14.6" cy={y} r="1.8" />
      <circle cx="33.4" cy={y} r="1.8" />
    </g>
  );
}

function Body({ color }: { color: string }) {
  return <path d="M7.5 48a16.5 11 0 0 1 33 0Z" fill={color} />;
}

const ART: Record<AnimalKey, React.ReactNode> = {
  fox: (
    <>
      <Body color="#C85A24" />
      <path d="M11 17.5 13.4 5.5 21 12Z" fill="#E07B39" />
      <path d="M37 17.5 34.6 5.5 27 12Z" fill="#E07B39" />
      <path d="M13.4 14.8 14.7 9.2l3.8 3.4Z" fill="#F6C39A" />
      <path d="M34.6 14.8 33.3 9.2l-3.8 3.4Z" fill="#F6C39A" />
      <circle cx="24" cy="23" r="12.5" fill="#E8833A" />
      <ellipse cx="24" cy="28.5" rx="7.5" ry="5.5" fill="#FFF1DC" />
      <g stroke={INK} strokeWidth="1.5" strokeLinecap="round" fill="none">
        <path d="M15.5 22q2.5-2.6 5 0" />
        <path d="M27.5 22q2.5-2.6 5 0" />
        <path d="M22.2 29.2q1.8 1.6 3.6 0" />
      </g>
      <ellipse cx="24" cy="26.6" rx="1.8" ry="1.3" fill={INK} />
      <Blush />
      <path d="M11.8 33.2q12.2 5 24.4 0l0 3.8q-12.2 4.4-24.4 0Z" fill="#B3492E" />
      <Kulhad paw="#E8833A" />
    </>
  ),
  panda: (
    <>
      <Body color="#3E3A38" />
      <circle cx="12.5" cy="12.5" r="4.6" fill="#3E3A38" />
      <circle cx="35.5" cy="12.5" r="4.6" fill="#3E3A38" />
      <circle cx="24" cy="23" r="12.5" fill="#FFFFFF" stroke="#E7DCCB" strokeWidth="0.8" />
      <ellipse cx="18" cy="22.5" rx="3" ry="4.4" fill="#3E3A38" transform="rotate(18 18 22.5)" />
      <ellipse cx="30" cy="22.5" rx="3" ry="4.4" fill="#3E3A38" transform="rotate(-18 30 22.5)" />
      <circle cx="18" cy="22.3" r="1.7" fill="#FFFFFF" />
      <circle cx="30" cy="22.3" r="1.7" fill="#FFFFFF" />
      <circle cx="18" cy="22.3" r="0.95" fill="#2B2725" />
      <circle cx="30" cy="22.3" r="0.95" fill="#2B2725" />
      <ellipse cx="24" cy="26.6" rx="1.6" ry="1.1" fill="#3E3A38" />
      <path d="M22.4 29q1.6 1.4 3.2 0" stroke={INK} strokeWidth="1.3" strokeLinecap="round" fill="none" />
      <g fill="#F7C8D3" opacity="0.9">
        <circle cx="14.4" cy="27.6" r="1.6" />
        <circle cx="33.6" cy="27.6" r="1.6" />
      </g>
      <g fill="#F27D9D">
        <path d="M34.2 10.6 29.8 7.4a2.4 2.4 0 1 0 0 6.2Z" />
        <path d="M34.2 10.6l4.4-3.2a2.4 2.4 0 1 1 0 6.2Z" />
        <circle cx="34.2" cy="10.6" r="1.5" />
      </g>
      <Kulhad paw="#3E3A38" />
    </>
  ),
  owl: (
    <>
      <Body color="#8A5A38" />
      <ellipse cx="24" cy="25" rx="13" ry="13.5" fill="#9C6B4A" />
      <ellipse cx="24" cy="31.5" rx="8" ry="6.8" fill="#D9B98C" />
      <circle cx="18.5" cy="21" r="5.6" fill="#F3E3C2" />
      <circle cx="29.5" cy="21" r="5.6" fill="#F3E3C2" />
      <ellipse cx="24" cy="25" rx="6" ry="4.8" fill="#F3E3C2" />
      <g stroke="#5A4028" strokeWidth="1.5" strokeLinecap="round" fill="none">
        <path d="M15.8 21q2.7 2.4 5.4 0" />
        <path d="M26.8 21q2.7 2.4 5.4 0" />
      </g>
      <path d="M24 24.6l-2.1 2.7h4.2Z" fill="#E8A13C" />
      <ellipse cx="11.6" cy="30" rx="2.6" ry="6" fill="#8A5A38" transform="rotate(12 11.6 30)" />
      <ellipse cx="36.4" cy="30" rx="2.6" ry="6" fill="#8A5A38" transform="rotate(-12 36.4 30)" />
      <path d="M11.2 17.6q12.8-12.8 25.6 0l-1.9 3.8q-10.9-9.6-21.8 0Z" fill="#5F7D4F" />
      <circle cx="24" cy="6.4" r="3" fill="#5F7D4F" />
      <Kulhad paw="#8A5A38" />
    </>
  ),
  cat: (
    <>
      <Body color="#75808D" />
      <path d="M11.5 16.5 13 6l7.5 5.5Z" fill="#8E97A3" />
      <path d="M36.5 16.5 35 6l-7.5 5.5Z" fill="#8E97A3" />
      <path d="M13.6 13.8l.8-4.4 3.4 2.7Z" fill="#F2B8C6" />
      <path d="M34.4 13.8l-.8-4.4-3.4 2.7Z" fill="#F2B8C6" />
      <circle cx="24" cy="23" r="12.5" fill="#97A1AC" />
      <g stroke="#6E7784" strokeWidth="1.6" strokeLinecap="round">
        <path d="M20 12.4v3.4" />
        <path d="M24 11.8v3.8" />
        <path d="M28 12.4v3.4" />
      </g>
      <ellipse cx="24" cy="28.8" rx="6.4" ry="4.6" fill="#EDF0F2" />
      <circle cx="18" cy="23" r="1.5" fill={INK} />
      <circle cx="30" cy="23" r="1.5" fill={INK} />
      <g stroke="#D9A441" strokeWidth="1.5" fill="#FFFFFF" fillOpacity="0.12">
        <circle cx="18" cy="23" r="4.8" />
        <circle cx="30" cy="23" r="4.8" />
        <path d="M22.8 22.4h2.4" fill="none" />
      </g>
      <path d="M22.9 26.4h2.2l-1.1 1.5Z" fill="#E88CA0" />
      <g stroke="#C7CDD4" strokeWidth="1" strokeLinecap="round">
        <path d="M7.8 26h5" />
        <path d="M8.6 29.2l4.4-.8" />
        <path d="M40.2 26h-5" />
        <path d="M39.4 29.2l-4.4-.8" />
      </g>
      <Kulhad paw="#75808D" />
    </>
  ),
  bunny: (
    <>
      <Body color="#D9CFC4" />
      <ellipse cx="16.5" cy="9" rx="3.6" ry="8.5" fill="#FBF6EF" stroke="#E7DCCB" transform="rotate(-14 16.5 9)" />
      <ellipse cx="31.5" cy="9" rx="3.6" ry="8.5" fill="#FBF6EF" stroke="#E7DCCB" transform="rotate(14 31.5 9)" />
      <ellipse cx="16.9" cy="10" rx="1.8" ry="5.4" fill="#F5B8C4" transform="rotate(-14 16.9 10)" />
      <ellipse cx="31.1" cy="10" rx="1.8" ry="5.4" fill="#F5B8C4" transform="rotate(14 31.1 10)" />
      <circle cx="36.9" cy="15.8" r="1.3" fill="#E9B44C" />
      <circle cx="24" cy="25" r="12" fill="#FBF6EF" stroke="#E7DCCB" strokeWidth="0.8" />
      <circle cx="18.5" cy="24" r="1.5" fill={INK} />
      <circle cx="29.5" cy="24" r="1.5" fill={INK} />
      <path d="M22.9 27.2h2.2l-1.1 1.6Z" fill="#F28BB4" />
      <path d="M24 28.8q0 1.9-2 2.1M24 28.8q0 1.9 2 2.1" stroke="#C98A94" strokeWidth="1.2" strokeLinecap="round" fill="none" />
      <g fill="#F7C8D3">
        <circle cx="14.8" cy="28.5" r="1.8" />
        <circle cx="33.2" cy="28.5" r="1.8" />
      </g>
      <Kulhad paw="#D9CFC4" />
    </>
  ),
  tiger: (
    <>
      <Body color="#D97A26" />
      <circle cx="12.5" cy="12.5" r="4.6" fill="#F09A3E" />
      <circle cx="35.5" cy="12.5" r="4.6" fill="#F09A3E" />
      <circle cx="12.5" cy="12.5" r="2.2" fill="#FFD9A8" />
      <circle cx="35.5" cy="12.5" r="2.2" fill="#FFD9A8" />
      <circle cx="24" cy="23" r="12.5" fill="#F49E45" />
      <g stroke="#4A2C14" strokeWidth="2" strokeLinecap="round">
        <path d="M20 11.6v3.8" />
        <path d="M24 11v4.4" />
        <path d="M28 11.6v3.8" />
        <path d="M11.9 21.6l3.4 1.1" />
        <path d="M12.3 25.8l3.2.5" />
        <path d="M36.1 21.6l-3.4 1.1" />
        <path d="M35.7 25.8l-3.2.5" />
      </g>
      <ellipse cx="24" cy="28.8" rx="7" ry="5" fill="#FFF1DC" />
      <ellipse cx="24" cy="26.4" rx="1.9" ry="1.3" fill="#7A3B2E" />
      <circle cx="18.5" cy="24" r="1.4" fill={INK} />
      <circle cx="29.5" cy="24" r="1.4" fill={INK} />
      <path d="M22 31.8q2 1.5 4 0" stroke={INK} strokeWidth="1.4" strokeLinecap="round" fill="none" />
      <Kulhad paw="#D97A26" />
    </>
  ),
  lion: (
    <>
      <Body color="#B85E22" />
      <g fill="#C96A26">
        <circle cx="24" cy="23" r="15.5" />
        <circle cx="24" cy="8.6" r="3.6" />
        <circle cx="34.2" cy="11.4" r="3.6" />
        <circle cx="38.6" cy="20" r="3.6" />
        <circle cx="36.8" cy="29.6" r="3.6" />
        <circle cx="11.2" cy="29.6" r="3.6" />
        <circle cx="9.4" cy="20" r="3.6" />
        <circle cx="13.8" cy="11.4" r="3.6" />
      </g>
      <circle cx="15" cy="13.5" r="2.6" fill="#F2C078" />
      <circle cx="33" cy="13.5" r="2.6" fill="#F2C078" />
      <circle cx="24" cy="23" r="10.8" fill="#F2C078" />
      <ellipse cx="24" cy="27.8" rx="5.8" ry="4.2" fill="#FBE7C0" />
      <ellipse cx="24" cy="25.8" rx="1.7" ry="1.2" fill="#7A3B2E" />
      <circle cx="18.8" cy="23" r="1.3" fill={INK} />
      <circle cx="29.2" cy="23" r="1.3" fill={INK} />
      <path d="M22 30.4q2 1.5 4 0" stroke={INK} strokeWidth="1.3" strokeLinecap="round" fill="none" />
      <Kulhad paw="#B85E22" />
    </>
  ),
  bulldog: (
    <>
      <Body color="#A87F57" />
      <ellipse cx="10.6" cy="15" rx="3.4" ry="5" fill="#8A6242" transform="rotate(18 10.6 15)" />
      <ellipse cx="37.4" cy="15" rx="3.4" ry="5" fill="#8A6242" transform="rotate(-18 37.4 15)" />
      <ellipse cx="24" cy="23" rx="13.5" ry="12" fill="#C8A075" />
      <path d="M17.5 15.6q6.5-2.6 13 0" stroke="#A87F57" strokeWidth="1.5" strokeLinecap="round" fill="none" />
      <ellipse cx="24" cy="28.6" rx="8.6" ry="6" fill="#EBDCC4" />
      <ellipse cx="24" cy="25" rx="3.2" ry="2" fill="#4A3A30" />
      <circle cx="17.5" cy="21.6" r="1.3" fill="#3A2E26" />
      <circle cx="30.5" cy="21.6" r="1.3" fill="#3A2E26" />
      <g stroke="#A87F57" strokeWidth="1.7" strokeLinecap="round">
        <path d="M13.6 19.9l6.8.9" />
        <path d="M34.4 19.9l-6.8.9" />
      </g>
      <path d="M18 33.4h12" stroke="#8A6242" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M19.6 33.4l1.4 2.9 1.4-2.9Z" fill="#FFFFFF" />
      <path d="M26.6 33.4l1.4 2.9 1.4-2.9Z" fill="#FFFFFF" />
      <Kulhad paw="#A87F57" />
    </>
  ),
  wolf: (
    <>
      <Body color="#5F7186" />
      <path d="M11 16.5 12.5 3.5 20 10.5Z" fill="#7C8DA6" />
      <path d="M37 16.5 35.5 3.5 28 10.5Z" fill="#7C8DA6" />
      <path d="M13.4 13.2l.9-5 3.2 2.8Z" fill="#C9D4E0" />
      <path d="M34.6 13.2l-.9-5-3.2 2.8Z" fill="#C9D4E0" />
      <circle cx="24" cy="23" r="12.5" fill="#8FA2B8" />
      <path d="M11.9 23.8l4.6 2.1-1.6 4.1Z" fill="#DCE5EE" />
      <path d="M36.1 23.8l-4.6 2.1 1.6 4.1Z" fill="#DCE5EE" />
      <ellipse cx="24" cy="28.8" rx="7" ry="5.2" fill="#DCE5EE" />
      <ellipse cx="24" cy="26.4" rx="1.9" ry="1.3" fill="#37424F" />
      <circle cx="18.5" cy="24" r="1.3" fill="#2E3947" />
      <circle cx="29.5" cy="24" r="1.3" fill="#2E3947" />
      <path d="M22 31.9q2 1.3 4 0" stroke="#37424F" strokeWidth="1.4" strokeLinecap="round" fill="none" />
      <Kulhad paw="#5F7186" />
    </>
  ),
  monkey: (
    <>
      <Body color="#7A4E2A" />
      <circle cx="10.5" cy="22" r="4.6" fill="#96683C" />
      <circle cx="37.5" cy="22" r="4.6" fill="#96683C" />
      <circle cx="10.5" cy="22" r="2.3" fill="#EFD3A7" />
      <circle cx="37.5" cy="22" r="2.3" fill="#EFD3A7" />
      <circle cx="24" cy="22.5" r="12.5" fill="#9C6B3F" />
      <ellipse cx="24" cy="24.5" rx="9.2" ry="8.2" fill="#F0D6A8" />
      <g stroke="#7A4E2A" strokeWidth="1.6" strokeLinecap="round" fill="none">
        <path d="M19.2 11.6q1.4-3.4 3.4-1.4" />
        <path d="M23.2 10.8q1.2-3.6 3.2-1.6" />
        <path d="M27.2 11.6q2-2.6 3.4-.8" />
      </g>
      <circle cx="18.5" cy="23.5" r="1.4" fill={INK} />
      <circle cx="29.5" cy="23.5" r="1.4" fill={INK} />

      <circle cx="22.8" cy="27.2" r="0.7" fill="#B98E5F" />
      <circle cx="25.2" cy="27.2" r="0.7" fill="#B98E5F" />
      <path d="M20.6 29.8q3.4 2.8 6.8 0" stroke={INK} strokeWidth="1.5" strokeLinecap="round" fill="none" />
      <g fill="#E8A58C" opacity="0.7">
        <circle cx="14.6" cy="27.2" r="1.6" />
        <circle cx="33.4" cy="27.2" r="1.6" />
      </g>
      <Kulhad paw="#7A4E2A" />
    </>
  ),
};

/** The full-bleed animal drawing for an avatar circle. */
export function AnimalArt({ animal, className }: { animal: AnimalKey; className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden focusable="false">
      {ART[animal]}
    </svg>
  );
}
