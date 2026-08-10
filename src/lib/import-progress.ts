/**
 * Faux-progress for the ~1-minute import. The scrape + LLM pass is one blocking
 * call with no real progress events, so this is an NProgress-style trickle (fast
 * at first, crawling toward ~92%, completes on done) plus a rotating status line
 * — enough that it clearly feels "going". Operates on elements the caller
 * already rendered, so no classes are injected (no Tailwind purge surprises).
 */
const MESSAGES = [
  'Opening the profile…',
  'Reading her services & prices…',
  'Translating to English…',
  'Matching to our categories…',
  'Almost there…',
];

export function startImportProgress(bar: HTMLElement, msg?: HTMLElement | null): { done: () => void } {
  let pct = 6;
  bar.style.width = `${pct}%`;
  if (msg) msg.textContent = MESSAGES[0]!;

  const trickle = setInterval(() => {
    pct += Math.max(0.25, (92 - pct) * 0.02); // ease toward ~92%, never reach 100 until done
    if (pct > 92) pct = 92;
    bar.style.width = `${pct}%`;
  }, 600);

  let mi = 0;
  const cycle = setInterval(() => {
    mi = Math.min(mi + 1, MESSAGES.length - 1);
    if (msg) msg.textContent = MESSAGES[mi]!;
  }, 8000);

  return {
    done() {
      clearInterval(trickle);
      clearInterval(cycle);
      bar.style.width = '100%';
    },
  };
}
