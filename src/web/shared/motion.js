// Small helpers for the entrance effects. They only run when the person has not asked for less motion.

/** True when the system is set to reduce motion. Everything then shows its final state at once. */
export const calm = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Counts the number in `el` up from zero to `to`. With reduced motion it just shows the number. */
export function countUp(el, to, decimals = 0, duration = 800) {
  if (!Number.isFinite(to) || calm()) {
    el.textContent = Number.isFinite(to) ? to.toFixed(decimals) : el.textContent;
    return;
  }
  const started = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - started) / duration);
    el.textContent = (to * (1 - (1 - t) ** 3)).toFixed(decimals);
    if (t < 1) requestAnimationFrame(step);
  };
  el.textContent = (0).toFixed(decimals);
  requestAnimationFrame(step);
}
