(() => {
  'use strict';
  const $ = id => document.getElementById(id), M = window.MaisonModel, esc = M.escape;
  const dialog = $('catalog-dialog'), catalog = window.MAISON_CATALOG;
  const allServices = catalog.groups.flatMap(g => g.services), serviceMap = new Map(allServices.map(s => [String(s.id), s]));
  const snapshot = new Map(allServices.map(s => [String(s.id), {price:s.price,duration:s.duration}]));
  const fallbackStaff = [
    { id: 'snapshot-0', name: 'Вікторія', specialization: 'Косметолог', photo: '' },
    { id: 'snapshot-1', name: 'Балюк Олена', specialization: 'Електролог', photo: 'assets/olena.png' },
    { id: 'snapshot-2', name: 'Карпенко Зінаїда', specialization: 'Шугаринг, воскова депіляція, масаж', photo: 'assets/zinaida.png' },
    { id: 'snapshot-3', name: 'Іваніцька Євгенія', specialization: 'Лазарист', photo: 'assets/yevheniia.png' }
  ];
  const state = { selected: new Set(), step: 'services', staff: '0', preferredName: '', date: M.today(), slot: null, session: null, connected: false, staffList: fallbackStaff, dates: [], slots: [], epoch: 0, busy: false, uncertain: false, confirmed: false };
  let opener, settings = {}, liveServices = new Map(), slotRequest = 0, priceRequest = 0;
  const steps = ['services', 'staff', 'time', 'details'];
  const selected = () => [...state.selected].map(id => serviceMap.get(id)).filter(Boolean);
  const formatDate = d => new Intl.DateTimeFormat('uk-UA', { day: 'numeric', month: 'long' }).format(new Date(d + 'T12:00:00Z'));
  const formatTime = value => new Intl.DateTimeFormat('uk-UA', { timeZone: 'Europe/Kyiv', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
  const params = extra => { const p = new URLSearchParams(extra); state.selected.forEach(id => p.append('service_ids[]', id)); return '?' + p; };
  async function api(route, data) {
    if (document.querySelector('meta[name="maison-booking-mode"]')?.content === 'static') throw Object.assign(new Error('Онлайн-календар зараз недоступний. Для запису зателефонуйте в Maison: +380 93 170 75 54.'), { code: 'DISCONNECTED' });
    if (!['http:', 'https:'].includes(location.protocol)) throw Object.assign(new Error('Для календаря відкрийте сайт Maison у браузері за його адресою. Автономний файл містить каталог і вибір послуг.'), { code: 'OFFLINE' });
    let response; const recording = route === 'records';
    try { response = await fetch('/api/booking/' + route, { method: data ? 'POST' : 'GET', headers: data ? { 'Content-Type': 'application/json' } : {}, ...(data ? { body: JSON.stringify(data) } : {}), signal: AbortSignal.timeout(data ? 25000 : 15000) }); }
    catch { throw Object.assign(new Error(recording ? 'Результат надсилання невідомий. Уточніть запис у Maison телефоном перед повторною спробою.' : 'Не вдалося отримати відповідь системи. Спробуйте ще раз.'), { code: recording ? 'RESULT_UNKNOWN' : 'NETWORK' }); }
    let json; try { json = await response.json(); } catch { throw Object.assign(new Error(recording ? 'Результат запису невідомий. Уточніть його в Maison перед повторною спробою.' : 'Онлайн-запис тимчасово недоступний. Зателефонуйте в Maison.'), { code: recording ? 'RESULT_UNKNOWN' : 'UNAVAILABLE' }); }
    if (!response.ok) throw Object.assign(new Error(json.message || 'Не вдалося завершити дію.'), { code: json.error });
    return json;
  }
  function notice(message = '') { $('booking-notice').textContent = message; $('booking-notice').hidden = !message; }
  function invalidate() { state.epoch++; state.slot = null; state.slots = []; state.dates = []; state.session = null; state.uncertain = false; state.confirmed = false; $('booking-code').value = ''; }
  function summary() {
    const items = selected(), total = M.total(items);
    $('booking-selected').innerHTML = items.map(s => `<li><span>${esc(s.name)}<small>${esc(s.price)} · ${esc(s.duration || 'Час уточнюється')}</small></span><button type="button" data-remove-service="${esc(s.id)}" aria-label="Прибрати послугу: ${esc(s.name)}">×</button></li>`).join('');
    $('booking-selected-empty').hidden = items.length > 0;
    $('summary-price').textContent = items.length ? total.price : '—';
    $('summary-duration').textContent = items.length ? total.duration : '—';
    $('summary-staff').textContent = state.slot?.staffName || state.staffList.find(s => String(s.id) === state.staff)?.name || 'Будь-який доступний';
    $('summary-time').textContent = state.slot ? formatDate(state.slot.datetime.slice(0,10)) + ' · ' + formatTime(state.slot.datetime) : 'Ще не обрано';
    $('booking-footer-summary').textContent = items.length ? `${items.length} посл. · ${total.duration} · ${total.price}` : 'Оберіть послуги для вашого візиту.';
    const next = $('booking-next');
    next.textContent = state.busy ? 'Перевіряємо…' : ({ services: 'Обрати фахівця →', staff: 'Обрати час →', time: 'До контактів →', details: 'Підтвердити запис' }[state.step] || '');
    next.disabled = state.busy || state.uncertain || (state.step === 'services' || state.step === 'staff' ? !items.length : state.step === 'time' ? !state.slot || !items.length : !state.session);
    $('booking-back').hidden = state.step === 'services' || state.step === 'success';
    $('booking-next').hidden = state.step === 'success';
    $('booking-back').disabled = state.busy || state.uncertain;
    dialog.querySelectorAll('[data-remove-service]').forEach(b => { b.disabled = state.busy || state.uncertain || state.confirmed; });
    dialog.querySelectorAll('[data-booking-step]').forEach(b => { b.disabled = state.busy || state.uncertain || state.confirmed; });
    dialog.querySelectorAll('[data-select-date],[data-select-slot],[data-select-staff],#booking-date,#nearest-date,#retry-calendar').forEach(b => {
      const unavailableStaff = b.dataset.selectStaff && b.dataset.selectStaff !== '0' && state.connected && !state.staffList.find(s => String(s.id) === b.dataset.selectStaff)?.bookable;
      b.disabled = state.busy || state.uncertain || state.confirmed || !!unavailableStaff;
    });
  }
  function show(step, focus = true) {
    state.step = step;
    dialog.querySelectorAll('[data-booking-pane]').forEach(p => { p.hidden = p.dataset.bookingPane !== step; });
    dialog.querySelectorAll('[data-booking-step]').forEach(b => {
      if (b.dataset.bookingStep === step) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
    });
    summary(); dialog.scrollTop = 0;
    dialog.querySelectorAll('.booking-layout, .booking-content').forEach(container => { container.scrollTop = 0; });
    if (focus) (step === 'services' ? $('service-search') : $(step === 'staff' ? 'staff-title' : step === 'time' ? 'time-title' : step === 'details' ? 'details-title' : 'success-title'))?.focus({ preventScroll: true });
  }
  async function connection() {
    try { state.connected = (await api('status')).connected === true; } catch { state.connected = false; }
    $('booking-call').hidden = state.connected;
    return state.connected;
  }
  function renderStaff() {
    const list = state.staffList;
    $('booking-staff-list').innerHTML = `<button class="booking-staff-card${state.staff === '0' ? ' is-selected' : ''}" data-select-staff="0" type="button" aria-pressed="${state.staff === '0'}"><span class="staff-initial" aria-hidden="true">M</span><span><strong>Будь-який доступний</strong><small>Знайдемо фахівця на зручний час</small></span><span aria-hidden="true">${state.staff === '0' ? '✓' : '+'}</span></button>` + list.map(s => {
      const chosen = String(s.id) === state.staff, photo = fallbackStaff.find(f => f.name === s.name)?.photo;
      return `<button class="booking-staff-card${chosen ? ' is-selected' : ''}" data-select-staff="${esc(s.id)}" type="button" aria-pressed="${chosen}" ${state.connected && !s.bookable ? 'disabled' : ''}>${photo ? `<img src="${photo}" alt="" width="48" height="48">` : `<span class="staff-initial" aria-hidden="true">${esc(s.name[0])}</span>`}<span><strong>${esc(s.name)}</strong><small>${esc(s.specialization || '')}${state.connected && !s.bookable ? ' · Немає вільного часу' : ''}</small></span><span aria-hidden="true">${chosen ? '✓' : '+'}</span></button>`;
    }).join('');
  }
  async function loadStaff() {
    const epoch = state.epoch;
    $('booking-staff-list').setAttribute('aria-busy', 'true');
    try {
      if (!(await connection())) {
        if (epoch !== state.epoch) return;
        state.staffList = fallbackStaff;
        notice('Можна обрати процедури й бажаного фахівця. Онлайн-календар зараз недоступний; для запису зателефонуйте в Maison: +380 93 170 75 54.');
      } else {
        const data = (await api('staff' + params({}))).data;
        if (epoch !== state.epoch) return;
        if (!Array.isArray(data)) throw new Error('Не вдалося отримати список фахівців.');
        state.staffList = data;
        if (!data.length) notice('Для цих послуг немає спільного фахівця. Змініть набір процедур або зателефонуйте в Maison.');
        else notice();
      }
      if (state.preferredName) {
        const preferred = state.staffList.find(s => s.name === state.preferredName);
        state.staff = preferred ? String(preferred.id) : '0'; state.preferredName = '';
      } else if (state.staff !== '0' && !state.staffList.some(s => String(s.id) === state.staff)) { state.staff = '0'; }
      renderStaff(); summary();
    } catch (e) { if (epoch === state.epoch) { notice(e.message); state.staffList = []; renderStaff(); } }
    finally { $('booking-staff-list').removeAttribute('aria-busy'); }
  }
  function renderDates() {
    $('booking-dates').innerHTML = state.dates.slice(0,14).map(d => `<button type="button" data-select-date="${d}" class="${state.date === d ? 'is-selected' : ''}" aria-pressed="${state.date === d}">${esc(formatDate(d))}</button>`).join('');
  }
  function renderSlots() {
    $('booking-slots').innerHTML = state.slots.map((s,i) => `<button type="button" data-select-slot="${i}" aria-pressed="${state.slot?.datetime === s.datetime && state.slot?.staff_id === s.staff_id}" class="${state.slot?.datetime === s.datetime && state.slot?.staff_id === s.staff_id ? 'is-selected' : ''}"><strong>${esc(formatTime(s.datetime))}</strong><small>${esc(s.staffName)}</small></button>`).join('');
  }
  async function loadSlots() {
    if (state.busy || state.uncertain || state.confirmed) return;
    const epoch = state.epoch, day = state.date, request = ++slotRequest;
    $('booking-slots').innerHTML = ''; $('booking-time-status').textContent = 'Шукаємо вільний час…';
    state.slot = null; summary();
    try {
      const staff = state.staffList.filter(s => s.bookable && (state.staff === '0' || String(s.id) === state.staff));
      const lists = await Promise.all(staff.map(async s => {
        const data = (await api('times' + params({ staff_id: String(s.id), date: day }))).data;
        if (!Array.isArray(data)) throw new Error('Календар повернув неповну відповідь.');
        return data.filter(t => t.datetime && Date.parse(t.datetime) > Date.now()).map(t => ({ ...t, staff_id: s.id, staffName: s.name }));
      }));
      if (epoch !== state.epoch || day !== state.date || request !== slotRequest) return;
      state.slots = lists.flat().sort((a,b) => Date.parse(a.datetime) - Date.parse(b.datetime));
      $('booking-time-status').textContent = state.slots.length ? 'Оберіть вільну годину.' : 'На цю дату вільних годин немає. Спробуйте іншу дату або найближчий час.';
      renderSlots();
    } catch (e) { if (epoch === state.epoch && day === state.date && request === slotRequest) { state.slots = []; $('booking-time-status').textContent = e.message; } }
  }
  async function loadCalendar() {
    if (state.busy || state.uncertain || state.confirmed) return;
    state.slot = null; state.session = null; state.epoch++; const epoch = state.epoch;
    $('booking-slots').innerHTML = ''; $('booking-dates').innerHTML = ''; summary(); notice();
    if (!state.selected.size) { $('booking-time-status').textContent = 'Оберіть процедури, щоб перевірити вільний час для вашого візиту.'; return; }
    $('booking-time-status').textContent = 'Завантажуємо календар…';
    try {
      if (!(await connection())) throw new Error('Онлайн-календар зараз недоступний. Для запису зателефонуйте в Maison: +380 93 170 75 54.');
      const staff = (await api('staff' + params({}))).data;
      if (epoch !== state.epoch) return;
      state.staffList = staff;
      if (state.staff !== '0' && !staff.some(s => String(s.id) === state.staff && s.bookable)) { state.staff = '0'; notice('Обраний фахівець недоступний. Показуємо час інших сумісних фахівців.'); }
      const end = new Date(M.today() + 'T12:00:00Z'); end.setUTCDate(end.getUTCDate() + 90);
      const dates = (await api('dates' + params({ staff_id: state.staff, date_from: M.today(), date_to: end.toISOString().slice(0,10) }))).data;
      if (epoch !== state.epoch) return;
      state.dates = [...new Set(dates.booking_dates || [])].filter(d => d >= M.today()).sort(); renderDates(); summary();
      if (!state.dates.length) { $('booking-time-status').textContent = 'Поки немає доступних дат для цих процедур. Спробуйте інший набір або зателефонуйте в Maison.'; return; }
      await loadSlots();
    } catch (e) { if (epoch === state.epoch) $('booking-time-status').textContent = e.message; }
  }
  function chooseDate(day) {
    if (state.busy || state.uncertain || state.confirmed) { $('booking-date').value = state.date; return; }
    state.date = day; $('booking-date').value = day; state.slot = null; state.session = null; renderDates(); summary(); if (state.connected && state.selected.size) loadSlots();
  }
  async function prepare() {
    if (!state.slot || !state.selected.size || state.busy) return;
    state.busy = true; summary(); notice(); let recover = false;
    try {
      const data = (await api('prepare', { services: [...state.selected].map(Number), staff_id: state.slot.staff_id, datetime: state.slot.datetime })).data;
      state.session = data.session; settings = data;
      $('booking-sms').hidden = !data.phoneConfirmation; $('booking-code').required = data.phoneConfirmation;
      $('booking-comment').required = data.commentRequired; $('comment-optional').textContent = data.commentRequired ? 'обов’язково' : 'необов’язково';
      $('booking-policy-note').textContent = data.notification || '';
      show('details');
    } catch (e) { notice(e.message); if (e.code === 'SLOT_TAKEN') { state.slot = null; state.session = null; state.slots = []; renderSlots(); recover = true; } }
    finally { state.busy = false; summary(); if (recover) await loadSlots(); }
  }
  async function navigate(step) {
    if (state.busy || state.uncertain || state.confirmed) return;
    notice();
    if (step === 'details') { await prepare(); return; }
    show(step);
    if (step === 'staff') await loadStaff();
    if (step === 'time') await loadCalendar();
  }
  function toggle(id) {
    if (state.busy || state.uncertain || state.confirmed || !serviceMap.has(id)) return;
    if (state.selected.has(id)) state.selected.delete(id);
    else if (state.selected.size >= 20) { notice('Для одного запису можна обрати до 20 послуг.'); return; }
    else state.selected.add(id);
    invalidate(); notice(); summary(); document.dispatchEvent(new Event('maison:selection'));
    if (state.step !== 'services') { show('services'); notice('Склад візиту змінився. Перевірте фахівця й час для нового набору процедур.'); }
  }
  async function refreshPrices() {
    if (!state.connected) return;
    const epoch = state.epoch, request = ++priceRequest;
    try {
      const data = (await api('services' + params(state.staff === '0' || state.staff.startsWith('snapshot') ? {} : { staff_id: state.staff }))).data;
      if (epoch !== state.epoch || request !== priceRequest) return;
      liveServices = new Map(data.services.map(s => [String(s.id), s]));
      $('catalog-price-note').textContent = liveServices.size ? 'Ціни вибраних послуг оновлено' : 'Ціни на 04.10.2026';
      for (const s of allServices) {
        Object.assign(s, snapshot.get(String(s.id)));
        const live = liveServices.get(String(s.id)); if (!live || !Number.isFinite(live.price_min) || !Number.isFinite(live.price_max)) continue;
        s.price = `${new Intl.NumberFormat('uk-UA').format(live.price_min)}${live.price_max !== live.price_min ? '–' + new Intl.NumberFormat('uk-UA').format(live.price_max) : ''} ₴`;
        if (live.seance_length) s.duration = Math.ceil(live.seance_length / 60) + ' хв';
      }
      document.dispatchEvent(new Event('maison:selection')); summary();
    } catch { /* The timestamped catalog remains readable while the calendar fails closed. */ }
  }
  window.MaisonBooking = { has: id => state.selected.has(String(id)), close: () => {
    if (state.busy) { notice('Зачекайте відповіді системи.'); return; }
    dialog.close();
  }, open: async (entry = 'services', button, name = '') => {
    opener = button; state.preferredName = name;
    if (!dialog.open) dialog.showModal(); document.dispatchEvent(new Event('maison:booking-open'));
    if (state.confirmed || state.uncertain) { show(state.confirmed ? 'success' : state.step); return; }
    await navigate(entry); await connection(); await refreshPrices();
  } };
  document.addEventListener('click', e => {
    const open = e.target.closest('[data-open-booking]');
    if (open) { e.preventDefault(); window.MaisonBooking.open(open.dataset.openBooking, open, open.dataset.preferredStaff || ''); return; }
    const service = e.target.closest('[data-select-service],[data-remove-service]');
    if (service) { const id = service.dataset.selectService || service.dataset.removeService; toggle(id); if (state.step === 'services') dialog.querySelector(`[data-select-service="${id}"]`)?.focus({ preventScroll: true }); return; }
    const staff = e.target.closest('[data-select-staff]');
    if (staff && !state.busy) { state.staff = staff.dataset.selectStaff; invalidate(); notice(); renderStaff(); summary(); refreshPrices(); return; }
    const day = e.target.closest('[data-select-date]'); if (day) { chooseDate(day.dataset.selectDate); return; }
    const slot = e.target.closest('[data-select-slot]'); if (slot) { state.slot = state.slots[Number(slot.dataset.selectSlot)]; state.session = null; notice(); renderSlots(); summary(); return; }
    const step = e.target.closest('[data-booking-step]'); if (step) navigate(step.dataset.bookingStep);
  });
  $('booking-date').min = M.today(); $('booking-date').value = state.date;
  $('booking-date').addEventListener('change', () => { const day = $('booking-date').value; if (!day || day < M.today()) { notice('Оберіть сьогоднішню або майбутню дату.'); return; } chooseDate(day); });
  $('retry-calendar').addEventListener('click', loadCalendar);
  $('nearest-date').addEventListener('click', async () => {
    if (state.busy || state.uncertain || state.confirmed) return;
    if (!state.dates.length) await loadCalendar();
    for (const day of state.dates.slice(0,7)) { state.date = day; $('booking-date').value = day; await loadSlots(); if (state.slots.length) break; }
    renderDates();
  });
  $('booking-next').addEventListener('click', () => {
    if (state.step === 'details') $('booking-form').requestSubmit();
    else navigate(steps[steps.indexOf(state.step) + 1]);
  });
  $('booking-back').addEventListener('click', () => navigate(steps[Math.max(0, steps.indexOf(state.step) - 1)]));
  $('send-booking-code').addEventListener('click', async () => {
    const phone = M.phone($('booking-phone').value);
    if (!phone || !$('booking-name').checkValidity()) { notice('Вкажіть ім’я та український номер телефону.'); $('booking-phone').focus(); return; }
    const button = $('send-booking-code'); button.disabled = true;
    try { await api('code', { session: state.session, phone, fullname: $('booking-name').value }); $('sms-status').textContent = 'Код надіслано. Наступний код можна отримати через хвилину.'; $('booking-code').focus(); }
    catch (e) { notice(e.message); }
    finally { setTimeout(() => { button.disabled = false; }, 60000); }
  });
  $('booking-phone').addEventListener('input', () => { $('booking-code').value = ''; $('sms-status').textContent = ''; });
  $('booking-form').addEventListener('submit', async e => {
    e.preventDefault(); if (state.busy || state.uncertain || !state.session) return;
    const phone = M.phone($('booking-phone').value);
    if (!phone) { notice('Вкажіть український номер у форматі +380 або 0XX XXX XX XX.'); $('booking-phone').focus(); return; }
    const body = { session: state.session, fullname: $('booking-name').value.trim(), phone, email: $('booking-email').value.trim(), comment: $('booking-comment').value.trim(), consent: $('booking-consent').checked, ...(settings.phoneConfirmation ? { code: $('booking-code').value.trim() } : {}) };
    state.busy = true; summary(); notice(); let recover = false;
    try {
      const data = (await api('records', body)).data;
      if (!data?.confirmed || !data.record_id) throw Object.assign(new Error('Система не підтвердила запис. Уточніть його в Maison телефоном.'), { code: 'RESULT_UNKNOWN' });
      state.confirmed = true;
      $('booking-confirmation').textContent = `${formatDate(state.slot.datetime.slice(0,10))} о ${formatTime(state.slot.datetime)} · ${state.slot.staffName}. Запис №${data.record_id} підтверджено.`;
      $('booking-form').reset(); show('success');
    } catch (e) { notice(e.message); if (['RESULT_UNKNOWN', 'PENDING'].includes(e.code)) state.uncertain = true; if (['SLOT_TAKEN', 'EXPIRED'].includes(e.code)) { state.session = null; state.slot = null; state.slots = []; state.dates = []; renderSlots(); renderDates(); show('time'); recover = true; } }
    finally { state.busy = false; summary(); if (recover) await loadCalendar(); }
  });
  const preventBusyClose = e => { if (state.busy) { e.preventDefault(); e.stopImmediatePropagation(); notice('Зачекайте відповіді системи.'); } };
  $('close-catalog').addEventListener('click', preventBusyClose, { capture: true });
  dialog.addEventListener('cancel', preventBusyClose);
  dialog.addEventListener('keydown', e => { if (e.key === 'Escape') preventBusyClose(e); }, { capture: true });
  dialog.addEventListener('close', () => { state.epoch++; opener?.focus({ preventScroll: true }); if (state.confirmed) { state.selected.clear(); state.confirmed = false; state.slot = null; state.session = null; summary(); document.dispatchEvent(new Event('maison:selection')); } });
  $('finish-booking').addEventListener('click', () => dialog.close());
  renderStaff(); summary();
})();
