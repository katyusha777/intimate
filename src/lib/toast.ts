/**
 * Minimal transient toast — bottom-center, auto-dismisses. No component/markup
 * needed (callable from any island). Inline styles so there's nothing for
 * Tailwind to purge; colours track the design (online green / brand pink).
 */
export function toast(message: string, opts: { variant?: 'success' | 'error' } = {}): void {
  let host = document.querySelector<HTMLElement>('[data-toast-host]');
  if (!host) {
    host = document.createElement('div');
    host.setAttribute('data-toast-host', '');
    host.style.cssText =
      'position:fixed;left:50%;bottom:calc(1rem + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:100;display:flex;flex-direction:column;gap:.5rem;align-items:center;pointer-events:none';
    document.body.appendChild(host);
  }
  const ok = opts.variant !== 'error';
  const el = document.createElement('div');
  el.textContent = message;
  el.style.cssText = `pointer-events:auto;max-width:90vw;padding:.65rem 1.1rem;border-radius:.6rem;font-size:.875rem;font-weight:600;color:#fff;background:${ok ? '#1a7f37' : '#e5397f'};box-shadow:0 10px 34px rgba(0,0,0,.4);opacity:0;transform:translateY(10px);transition:opacity .2s ease,transform .2s ease`;
  host.appendChild(el);
  requestAnimationFrame(() => {
    el.style.opacity = '1';
    el.style.transform = 'translateY(0)';
  });
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(10px)';
    setTimeout(() => el.remove(), 250);
  }, ok ? 2200 : 4000);
}
