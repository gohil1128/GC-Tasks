"use client";
import * as React from "react";

/*
  Chai simmering: an 8-second silent loop filling the sign-in screen. People who
  have asked their device for less motion see the still (the poster) instead.
*/
export function LoginVideo({ className = "" }: { className?: string }) {
  const ref = React.useRef<HTMLVideoElement>(null);
  React.useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.muted = true; // React doesn't always set the attribute, and only muted video may autoplay
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => {
      if (reduce.matches) {
        v.pause();
        return;
      }
      v.preload = "auto";
      v.play().catch(() => {});
    };
    sync();
    reduce.addEventListener("change", sync);
    return () => reduce.removeEventListener("change", sync);
  }, []);
  return (
    <video ref={ref} className={className} muted loop playsInline preload="none" aria-hidden poster="/chai-loop.jpg">
      <source src="/video/chai-loop.webm" type="video/webm" />
      <source src="/video/chai-loop.mp4" type="video/mp4" />
    </video>
  );
}
