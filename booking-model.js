/* Shared calculations. Personal details are never persisted. */
globalThis.MaisonModel = Object.freeze({
  duration(value) {
    if (!value) return null;
    const hours = String(value).match(/(\d+)\s*г/), minutes = String(value).match(/(\d+)\s*хв/);
    return hours || minutes ? Number(hours?.[1] || 0) * 60 + Number(minutes?.[1] || 0) : null;
  },
  prices(value) {
    const clean = String(value).replace(/[\s\u00a0\u202f]/g, '');
    const numbers = clean.match(/\d+(?:[.,]\d+)?/g)?.map(n => Number(n.replace(',', '.'))) || [];
    return numbers.length ? { min: numbers[0], max: numbers[1] ?? numbers[0], from: /від/i.test(clean) } : null;
  },
  total(services) {
    let min = 0, max = 0, minutes = 0, unknownPrice = false, unknownDuration = false, from = false;
    for (const s of services) {
      const price = this.prices(s.price), duration = this.duration(s.duration);
      if (price) { min += price.min; max += price.max; from ||= price.from; } else unknownPrice = true;
      if (duration === null) unknownDuration = true; else minutes += duration;
    }
    const fmt = n => new Intl.NumberFormat('uk-UA').format(n);
    return { count: services.length, min, max, minutes, unknownDuration,
      price: unknownPrice ? 'Вартість уточнюється' : `${from ? 'від ' : ''}${fmt(min)}${max !== min ? '–' + fmt(max) : ''} ₴`,
      duration: unknownDuration ? `${minutes ? minutes + ' хв + ' : ''}час уточнюється` : `${minutes} хв` };
  },
  phone(value) {
    let digits = String(value).replace(/\D/g, '');
    if (/^0\d{9}$/.test(digits)) digits = '38' + digits;
    return /^380\d{9}$/.test(digits) ? '+' + digits : null;
  },
  today() {
    return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  },
  escape(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
});
