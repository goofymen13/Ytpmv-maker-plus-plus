/* Generates option rows from the schema in options.js. */
(function (YT) {
  'use strict';
  const { el } = YT.util;

  function fmt(meta, value) {
    const step = meta.step || 1;
    const decimals = step >= 1 ? 0 : step >= .1 ? 1 : step >= .01 ? 2 : 3;
    return `${(+value).toFixed(decimals)}${meta.unit ? (meta.unit === '%' || meta.unit === '°' || meta.unit === '×' ? '' : ' ') + meta.unit : ''}`;
  }

  function row(meta, get, set) {
    const value = get(meta.id);
    const help = meta.help ? el('div', { class: 'opt-help' }, meta.help) : null;
    const reset = () => { set(meta.id, meta.def); return meta.def; };
    switch (meta.type) {
      case 'range': {
        const val = el('span', { class: 'val' }, fmt(meta, value));
        const input = el('input', { type: 'range', min: meta.min, max: meta.max, step: meta.step, value, 'aria-label': meta.label });
        input.value = value;
        input.addEventListener('input', () => {
          val.textContent = fmt(meta, input.value);
          set(meta.id, +input.value);
        });
        const top = el('div', { class: 'opt-top', title: 'Double-click to reset' }, el('span', null, meta.label), val);
        top.addEventListener('dblclick', () => { input.value = reset(); val.textContent = fmt(meta, input.value); });
        return el('div', { class: 'opt', dataset: { id: meta.id } }, top, input, help);
      }
      case 'select': {
        const select = el('select', { 'aria-label': meta.label }, meta.choices.map(([v, label]) => el('option', { value: v }, label)));
        select.value = value;
        select.addEventListener('change', () => set(meta.id, select.value));
        return el('div', { class: 'opt', dataset: { id: meta.id } }, el('div', { class: 'opt-top' }, el('span', null, meta.label)), select, help);
      }
      case 'check': {
        const input = el('input', { type: 'checkbox' });
        input.checked = !!value;
        input.addEventListener('change', () => set(meta.id, input.checked));
        return el('div', null, el('label', { class: 'opt check-row', dataset: { id: meta.id } }, input, el('span', null, meta.label)), help);
      }
      case 'color': {
        const input = el('input', { type: 'color', value, 'aria-label': meta.label });
        input.addEventListener('input', () => set(meta.id, input.value));
        return el('label', { class: 'opt inline', dataset: { id: meta.id } }, el('span', null, meta.label), input);
      }
      case 'text': {
        const input = el('input', { type: 'text', value, 'aria-label': meta.label });
        input.addEventListener('input', () => set(meta.id, input.value));
        return el('div', { class: 'opt', dataset: { id: meta.id } }, el('div', { class: 'opt-top' }, el('span', null, meta.label)), input, help);
      }
    }
    return null;
  }

  const openState = new Map();

  function group(title, items, get, set, { open = false, key = title } = {}) {
    const isOpen = openState.has(key) ? openState.get(key) : open;
    const details = el('details', { class: 'group', open: isOpen || undefined },
      el('summary', null, el('span', null, title), el('span', { class: 'count' }, items.length)),
      el('div', { class: 'group-body' }, items.map(m => row(m, get, set)))
    );
    details.addEventListener('toggle', () => openState.set(key, details.open));
    return details;
  }

  YT.forms = { row, group, fmt };
})(window.YT);
