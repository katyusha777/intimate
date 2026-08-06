/**
 * Shared client logic for the profile editor AND the setup wizard — they render
 * the SAME section components (dashboard/editor/*), so the field-reading lives
 * here once. `readProfilePatch(form)` reads whatever profile fields are PRESENT
 * in a form into a partial patch, so the full editor (all sections) and a
 * one-section wizard step both save through the same account.saveProfile.
 * Browser-only — imported from component <script>s.
 */
type Patch = Record<string, unknown>;

const numOf = (el: Element | null): number | undefined => {
  const v = (el as HTMLInputElement | null)?.value.trim();
  return !v ? undefined : Number(v);
};

function readHours(form: HTMLFormElement): Record<string, unknown> {
  const oh: Record<string, unknown> = {};
  form.querySelectorAll<HTMLElement>('[data-hours-row]').forEach((r) => {
    oh[r.dataset.day!] = {
      closed: r.querySelector<HTMLInputElement>('[data-hours-closed]')!.checked,
      allDay: r.querySelector<HTMLInputElement>('[data-hours-allday]')!.checked,
      from: r.querySelector<HTMLInputElement>('[data-hours-from]')!.value,
      to: r.querySelector<HTMLInputElement>('[data-hours-to]')!.value,
    };
  });
  return oh;
}

function readRates(form: HTMLFormElement): Array<Record<string, unknown>> {
  const rates: Array<Record<string, unknown>> = [];
  const priced = (incall?: number, outcall?: number, base: Record<string, unknown> = {}) => {
    if (incall === undefined && outcall === undefined) return;
    if (incall !== undefined) base.incall = incall;
    if (outcall !== undefined) base.outcall = outcall;
    rates.push(base);
  };
  // Preset duration rows: a typed price = intent to offer it, so a row counts
  // when it has a price OR is ticked (priced() no-ops without a price). This is
  // why "I filled a price but can't continue" happened — an unticked row was
  // silently dropped even with a price in it.
  form.querySelectorAll<HTMLElement>('[data-rate-row]').forEach((r) => {
    const incall = numOf(r.querySelector('[data-rate-incall]'));
    const outcall = numOf(r.querySelector('[data-rate-outcall]'));
    const on = r.querySelector<HTMLInputElement>('[data-rate-on]')!.checked;
    if (!on && incall === undefined && outcall === undefined) return;
    priced(incall, outcall, { duration: r.dataset.duration });
  });
  // Her custom line items, in DOM order (= her chosen order); need a label + a price.
  form.querySelectorAll<HTMLElement>('[data-custom-row]').forEach((r) => {
    const label = r.querySelector<HTMLInputElement>('[data-custom-label]')!.value.trim();
    if (label) priced(numOf(r.querySelector('[data-custom-incall]')), numOf(r.querySelector('[data-custom-outcall]')), { label });
  });
  return rates;
}

/** Partial profile patch from whatever fields exist in `form` (editor: all; step: one section). */
export function readProfilePatch(form: HTMLFormElement): Patch {
  const fd = new FormData(form);
  const patch: Patch = {};
  const has = (n: string) => form.querySelector(`[name="${n}"]`) != null;
  const str = (n: string) => String(fd.get(n) ?? '');
  const optStr = (n: string) => {
    const v = str(n).trim();
    return v === '' ? undefined : v;
  };
  const list = (n: string) => fd.getAll(n).map(String);

  if (has('name')) patch.name = str('name');
  if (has('birthDate')) patch.birthDate = str('birthDate');
  if (has('gender')) patch.gender = str('gender');
  if (has('city')) patch.city = str('city');
  // Contact handles: send '' when cleared (not undefined) so removing one saves.
  if (has('phone')) patch.phone = str('phone').trim();
  if (has('whatsapp')) patch.whatsapp = str('whatsapp').trim();
  if (has('telegram')) patch.telegram = str('telegram').trim();
  if (has('instagram')) patch.instagram = str('instagram').trim();
  // Appearance selects: empty option → undefined. ponytail: once set, re-picking
  // "—" can't null the column (patch skips undefined) — nullable plumbing isn't
  // worth it for optional vanity fields; switch value, don't clear.
  if (has('appearance')) patch.appearance = optStr('appearance');
  if (has('bodyType')) patch.bodyType = optStr('bodyType');
  if (has('hairColor')) patch.hairColor = optStr('hairColor');
  if (has('cupSize')) patch.cupSize = optStr('cupSize');
  if (has('heightCm')) {
    const v = str('heightCm').trim();
    patch.heightCm = v ? Number(v) : undefined;
  }
  if (has('availableFor')) patch.availableFor = list('availableFor');
  if (has('services')) patch.services = list('services');
  if (has('languages')) patch.languages = list('languages');
  if (has('incallLocations')) patch.incallLocations = list('incallLocations');
  if (has('amenities')) patch.amenities = list('amenities');
  if (has('paymentMethods')) patch.paymentMethods = list('paymentMethods');
  if (has('depositPolicy')) patch.depositPolicy = optStr('depositPolicy');
  if (has('extrasNote')) patch.extrasNote = optStr('extrasNote');
  if (has('description')) patch.description = str('description');
  // meetingTypes has a min(1) rule — omit when empty so a partial save still lands.
  if (has('meetingTypes')) {
    const mt = list('meetingTypes');
    if (mt.length) patch.meetingTypes = mt;
  }
  if (form.querySelector('[data-rate-row],[data-custom-row]')) patch.rates = readRates(form);
  if (form.querySelector('[data-hours-row]')) patch.openingHours = readHours(form);
  return patch;
}

/** Progressive-disclosure (opening hours) + custom-rate-row add/remove/reorder for any form that has them. */
export function initEditorInteractions(form: HTMLFormElement): void {
  const syncHoursRow = (r: HTMLElement) => {
    const closed = r.querySelector<HTMLInputElement>('[data-hours-closed]')!.checked;
    const allDay = r.querySelector<HTMLInputElement>('[data-hours-allday]')!.checked;
    r.querySelector<HTMLElement>('[data-hours-openonly]')!.style.display = closed ? 'none' : '';
    r.querySelector<HTMLElement>('[data-hours-times]')!.style.display = closed || allDay ? 'none' : '';
  };
  form.querySelectorAll<HTMLElement>('[data-hours-row]').forEach((r) => {
    syncHoursRow(r);
    r.querySelectorAll('[data-hours-closed],[data-hours-allday]').forEach((c) =>
      c.addEventListener('change', () => syncHoursRow(r)),
    );
  });

  // Typing a preset-row price auto-ticks its row, so the visual state matches
  // what will be saved (and the row is unmistakably "on").
  form.querySelectorAll<HTMLElement>('[data-rate-row]').forEach((r) => {
    const on = r.querySelector<HTMLInputElement>('[data-rate-on]');
    r.querySelectorAll<HTMLInputElement>('[data-rate-incall],[data-rate-outcall]').forEach((inp) =>
      inp.addEventListener('input', () => {
        if (on && inp.value.trim()) on.checked = true;
      }),
    );
  });

  const customList = form.querySelector<HTMLElement>('[data-custom-list]');
  const customTpl = form.querySelector<HTMLTemplateElement>('[data-custom-template]');
  form.querySelector('[data-add-custom]')?.addEventListener('click', () => {
    if (!customList || !customTpl) return;
    customList.appendChild(customTpl.content.cloneNode(true));
    customList.querySelector<HTMLInputElement>('[data-custom-row]:last-child [data-custom-label]')?.focus();
  });
  customList?.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('button[data-act]');
    if (!btn) return;
    const row = btn.closest('[data-custom-row]')!;
    if (btn.dataset.act === 'remove') row.remove();
    else if (btn.dataset.act === 'up' && row.previousElementSibling)
      customList.insertBefore(row, row.previousElementSibling);
    else if (btn.dataset.act === 'down' && row.nextElementSibling)
      customList.insertBefore(row.nextElementSibling, row);
  });
}
