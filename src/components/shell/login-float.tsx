"use client";
import * as React from "react";

/**
 * The sign-in card, floating over the chai video. With a mouse it leans a few
 * degrees toward the pointer; touch screens and reduced motion leave it at rest.
 * The bob, the rise-in and the shadow below are CSS (globals.css, "Sign in").
 */
export function LoginFloat({ children }: { children: React.ReactNode }) {
  const card = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)");
    let frame = 0;
    const onMove = (e: PointerEvent) => {
      if (frame || reduce.matches || !fine.matches) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const el = card.current;
        if (!el) return;
        const x = e.clientX / window.innerWidth - 0.5;
        const y = e.clientY / window.innerHeight - 0.5;
        el.style.setProperty("--tilt-y", `${(x * 7).toFixed(2)}deg`);
        el.style.setProperty("--tilt-x", `${(-y * 6).toFixed(2)}deg`);
      });
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(frame);
    };
  }, []);
  return (
    <div className="login-float">
      <div ref={card} className="login-card dark">
        {children}
      </div>
    </div>
  );
}
