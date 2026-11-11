// BackgroundHero: full-viewport shark image background with parallax mouse +
// slow drift animation layers. MotionSites-inspired.
import { useEffect, useRef } from "react";

export default function BackgroundHero() {
  const containerRef = useRef(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    let start = 0;
    let raf = 0;
    const driftPhase = Math.random() * Math.PI * 2;

    const tick = (time) => {
      if (!start) start = time;
      const elapsed = (time - start) / 1000;

      // slow breathing drift on the whole background — subtle left/right + up/down
      const driftX = Math.sin(elapsed * 0.04 + driftPhase) * 2;
      const driftY = Math.cos(elapsed * 0.025 + driftPhase * 1.3) * 1.5;

      container.style.setProperty("--parallax-x", driftX);
      container.style.setProperty("--parallax-y", driftY);

      raf = requestAnimationFrame(tick);
    };

    const onMove = (e) => {
      const x = (e.clientX / window.innerWidth - 0.5) * 2;
      const y = (e.clientY / window.innerHeight - 0.5) * 2;
      // combine mouse parallax with drift
      const baseX = parseFloat(container.style.getPropertyValue("--parallax-x")) || 0;
      const baseY = parseFloat(container.style.getPropertyValue("--parallax-y")) || 0;
      container.style.setProperty("--parallax-x", baseX + x * 3);
      container.style.setProperty("--parallax-y", baseY + y * 2);
    };

    window.addEventListener("pointermove", onMove);
    raf = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div className="hero-bg" ref={containerRef} aria-hidden="true">
      <div className="hero-bg__overlay" />

      <div className="hero-bg__layer hero-bg__layer--back" />
      <div className="hero-bg__layer hero-bg__layer--mid" />
      <div className="hero-bg__layer hero-bg__layer--front" />

      <div className="hero-shimmer" />
    </div>
  );
}
