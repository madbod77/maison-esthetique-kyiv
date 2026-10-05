import { randomUUID } from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createBookingState} from './booking-state.mjs';

const COMPANY = 1328326, FORM = 1394458;
const API = 'https://api.alteg.io/api/v1';
const fail = (status, code, message) => Object.assign(new Error(message), { status, code });
const integer = value => /^\d+$/.test(String(value)) && Number.isSafeInteger(Number(value));
const date = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().startsWith(value);
const timestamp = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value) && Number.isFinite(Date.parse(value));

export function createBookingAPI({ token = process.env.ALTEGIO_PARTNER_TOKEN || '', transport = fetch, stateDirectory = process.env.MAISON_STATE_DIR || fileURLToPath(new URL('../.maison-state/',import.meta.url)) } = {}) {
  // Reservations and idempotency remain on the server; the browser receives no credentials.
  const sessions = new Map(), results = new Map(), intents = new Map(), smsLimits = new Map();
  const budgets = new Map(); let journal;
  const storage=()=>journal ||= createBookingState(stateDirectory);
  function budget(key,limit,period=60000) {
    const now=Date.now();
    for(const [k,v] of budgets)if(v.expires<=now)budgets.delete(k);
    let current=budgets.get(key);
    if(!current){if(budgets.size>=10000)throw fail(429,'RATE_LIMIT','Забагато запитів. Спробуйте пізніше.');current={count:0,expires:now+period};budgets.set(key,current);}
    if(current.count>=limit)throw fail(429,'RATE_LIMIT','Забагато запитів. Спробуйте пізніше.');current.count++;
  }
  async function upstream(path, method = 'GET', body) {
    if (!token) throw fail(503, 'NOT_CONNECTED', 'Онлайн-календар тимчасово недоступний. Зателефонуйте в Maison або спробуйте пізніше.');
    const isRecord = method === 'POST' && path.startsWith('/book_record/');
    let response;
    try { response = await transport(API + path, { method, headers: { Accept: 'application/vnd.api.v2+json', 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(12000) }); }
    catch { throw fail(503, isRecord ? 'RESULT_UNKNOWN' : 'UPSTREAM_UNAVAILABLE', isRecord ? 'Результат надсилання невідомий. Не повторюйте запис; уточніть його в Maison телефоном.' : 'Система тимчасово недоступна. Спробуйте ще раз.'); }
    let json;
    try {
      const raw = await response.text();
      if (!raw.trim() && response.status === 201 && path.startsWith('/book_check/')) return null;
      json = JSON.parse(raw);
    } catch { throw fail(502, isRecord ? 'RESULT_UNKNOWN' : 'UPSTREAM_UNAVAILABLE', isRecord ? 'Результат запису невідомий. Уточніть його в Maison перед повторною спробою.' : 'Система запису повернула неповну відповідь.'); }
    if (!json || typeof json !== 'object' || Array.isArray(json)) throw fail(502, isRecord ? 'RESULT_UNKNOWN' : 'UPSTREAM_UNAVAILABLE', 'Система повернула неповну відповідь. Уточніть результат у Maison.');
    if (isRecord && (response.status >= 500 || (response.ok && json.success !== true))) throw fail(502, 'RESULT_UNKNOWN', 'Результат запису невідомий. Уточніть його в Maison перед повторною спробою.');
    if (!response.ok || json.success !== true) throw fail(response.status === 401 || response.status === 403 ? 503 : 409, 'BOOKING_REJECTED', response.status === 401 || response.status === 403 ? 'Онлайн-запис тимчасово недоступний. Зателефонуйте в Maison.' : 'Система не підтвердила дію. Перевірте код або оберіть інший час.');
    return json.data;
  }
  const query = (url, allow) => {
    const p = new URLSearchParams();
    const ids = url.searchParams.getAll('service_ids[]');
    if (ids.length > 20 || ids.some(id => !integer(id) || Number(id) < 1)) throw fail(400, 'INVALID_SELECTION', 'Перевірте вибрані послуги.');
    ids.forEach(id => p.append('service_ids[]', id));
    for (const name of allow) {
      const value = url.searchParams.get(name);
      if (!value) continue;
      if (name === 'staff_id' ? !integer(value) : name === 'datetime' ? !timestamp(value) : !date(value)) throw fail(400, 'INVALID_SELECTION', 'Перевірте дату та фахівця.');
      p.set(name, value);
    }
    const from = p.get('date_from'), to = p.get('date_to');
    if (!!from !== !!to || (from && from > to)) throw fail(400, 'INVALID_SELECTION', 'Оберіть початок і кінець діапазону дат.');
    return p.toString() ? '?' + p : '';
  };
  async function settings() {
    const form = await upstream(`/bookform/${FORM}`);
    if (form.company_id !== COMPANY) throw fail(503, 'CONFIG_MISMATCH', 'Налаштування запису потребують перевірки. Зателефонуйте в Maison.');
    // Chain forms keep phone/SMS rules in the chosen location, not in the form.
    const location = await upstream(`/locations/${COMPANY}?forBooking=1&bookform_id=${FORM}`);
    const phoneConfirmation = form.group_id ? location.phone_confirmation : form.phone_confirmation;
    if (location.id !== COMPANY || typeof phoneConfirmation !== 'boolean' || typeof form.comment_required !== 'boolean' || location.record_type_id !== 1) throw fail(503, 'CONFIG_MISMATCH', 'Налаштування запису потребують перевірки. Зателефонуйте в Maison.');
    // This adapter supports the Maison appointment configuration previously observed as 1;
    // unknown types require an authorized integration check, not a guessed enum mapping.
    if (!location.payment_policy || typeof location.payment_policy.type !== 'string') throw fail(503, 'CONFIG_MISMATCH', 'Умови запису потребують перевірки. Зателефонуйте в Maison.');
    if (location.payment_policy.type !== 'none') throw fail(503, 'PAYMENT_REQUIRED', 'Для цього запису потрібне підтвердження оплати. Зателефонуйте в Maison.');
    return { phoneConfirmation, smsEnabled: typeof location.sms_enabled === 'boolean' ? location.sms_enabled : form.sms_enabled === true, commentRequired: form.comment_required,
      notification: typeof form.booking_notify_text === 'string' ? form.booking_notify_text.replace(/<[^>]*>/g, '') : '',
      // Additional agreements/payment flows must be supported explicitly before accepting a booking.
      supported: !form.is_client_agreements_feature_enabled };
  }
  async function readBody(req) {
    let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 16000) throw fail(413, 'TOO_LARGE', 'Запит завеликий.'); }
    try { const data=JSON.parse(body); if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(); return data; } catch { throw fail(400, 'INVALID_BODY', 'Не вдалося прочитати дані.'); }
  }
  function appointment(body) {
    if (!Array.isArray(body.services) || !body.services.length || body.services.length > 20 || body.services.some(id => !integer(id) || Number(id) < 1) || new Set(body.services.map(String)).size !== body.services.length || !integer(body.staff_id) || Number(body.staff_id) < 1 || typeof body.datetime !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(body.datetime) || !Number.isFinite(Date.parse(body.datetime)) || Date.parse(body.datetime) <= Date.now()) throw fail(400, 'INVALID_SELECTION', 'Оберіть послуги, фахівця та майбутній час.');
    return { id: 1, services: body.services.map(Number), staff_id: Number(body.staff_id), datetime: body.datetime };
  }
  async function verifySlot(a) {
    const p = new URLSearchParams(); a.services.forEach(id => p.append('service_ids[]', id));
    const slots = await upstream(`/book_times/${COMPANY}/${a.staff_id}/${a.datetime.slice(0,10)}?${p}`);
    if (!Array.isArray(slots) || !slots.some(s => s.datetime === a.datetime)) throw fail(409, 'SLOT_TAKEN', 'Цей час уже недоступний. Оберіть інший.');
    await upstream(`/book_check/${COMPANY}`, 'POST', { appointments: [a] });
  }
  return async (req, res, url) => {
    const send = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(data)); };
    try {
      const route = url.pathname.replace('/api/booking/', '');
      if (req.method === 'GET' && route === 'status') return send(200, { connected: !!token });
      if (!token) throw fail(503, 'NOT_CONNECTED', 'Онлайн-календар тимчасово недоступний. Зателефонуйте в Maison або спробуйте пізніше.');
      if (req.method === 'GET') {
        if (route === 'settings') return send(200, { data: await settings() });
        if (route === 'services') {
          const d = await upstream(`/book_services/${COMPANY}${query(url, ['staff_id', 'datetime'])}`);
          return send(200, { data: { services: (d.services || []).map(s => ({ id: s.id, title: s.title, price_min: s.price_min, price_max: s.price_max, seance_length: s.seance_length, prepaid: s.prepaid })), categories: d.category || [] } });
        }
        if (route === 'staff') {
          const d = await upstream(`/book_staff/${COMPANY}${query(url, ['datetime'])}`);
          return send(200, { data: d.map(s => ({ id: s.id, name: s.name, specialization: s.specialization, bookable: s.bookable, seance_date: s.seance_date, prepaid: s.prepaid })) });
        }
        if (route === 'dates') return send(200, { data: await upstream(`/book_dates/${COMPANY}${query(url, ['staff_id', 'date_from', 'date_to'])}`) });
        if (route === 'times') {
          const staff = url.searchParams.get('staff_id'), day = url.searchParams.get('date');
          if (!integer(staff) || Number(staff) < 1 || !date(day)) throw fail(400, 'INVALID_SELECTION', 'Оберіть дату й фахівця.');
          return send(200, { data: await upstream(`/book_times/${COMPANY}/${staff}/${day}${query(url, [])}`) });
        }
      }
      if (req.method !== 'POST' || !['prepare', 'code', 'records'].includes(route)) throw fail(404, 'NOT_FOUND', 'Невідомий запит.');
      // Reject cross-origin mutation requests, including simple form submissions.
      if (req.headers.origin !== url.origin || !req.headers['content-type']?.startsWith('application/json')) throw fail(403, 'ORIGIN', 'Запит має надійти зі сторінки Maison.');
      const body = await readBody(req);
      const source=req.socket?.remoteAddress || 'unknown';
      if (route === 'prepare') {
        budget('prepare:'+source,30);
        for(const [k,v] of sessions)if(v.expires<Date.now())sessions.delete(k);
        if(sessions.size>=10000)throw fail(429,'RATE_LIMIT','Забагато запитів. Спробуйте пізніше.');
        const a = appointment(body), s = await settings();
        if (!s.supported) throw fail(503, 'AGREEMENTS_REQUIRED', 'Умови запису потребують підтвердження адміністратора. Зателефонуйте в Maison.');
        const p = new URLSearchParams({ staff_id: String(a.staff_id) });
        const services = await upstream(`/book_services/${COMPANY}?${p}`);
        const selected = a.services.map(id => services.services?.find(s => s.id === id));
        if (selected.some(s => !s)) throw fail(409, 'INCOMPATIBLE', 'Вибрані послуги недоступні цьому фахівцю.');
        const staffQuery = new URLSearchParams({datetime:a.datetime}); a.services.forEach(id=>staffQuery.append('service_ids[]',String(id)));
        const staff = await upstream(`/book_staff/${COMPANY}?${staffQuery}`);
        const chosenStaff = Array.isArray(staff) && staff.find(s=>s.id === a.staff_id);
        if (!chosenStaff) throw fail(409, 'INCOMPATIBLE', 'Вибрані послуги недоступні цьому фахівцю.');
        if ([...selected, chosenStaff].some(s => s.prepaid && !['forbidden', 'allowed', 'optional'].includes(s.prepaid))) throw fail(503, 'PAYMENT_REQUIRED', 'Для цього запису потрібна передоплата. Зателефонуйте в Maison.');
        await verifySlot(a);
        const id = randomUUID(); sessions.set(id, { appointment: a, settings: s, expires: Date.now() + 15 * 60000 });
        for (const [k,v] of sessions) if(v.expires < Date.now()) sessions.delete(k);
        return send(200, { data: { session: id, ...s } });
      }
      const session = sessions.get(body.session);
      if (!session || session.expires < Date.now()) throw fail(409, 'EXPIRED', 'Перевірте час ще раз — сесія запису завершилася.');
      if (!/^\+380\d{9}$/.test(body.phone || '')) throw fail(400, 'PHONE', 'Вкажіть український номер у форматі +380.');
      if (route === 'code') {
        if (!session.settings.phoneConfirmation || !session.settings.smsEnabled) throw fail(409, 'SMS_UNAVAILABLE', 'Підтвердження SMS зараз недоступне.');
        if (Date.now() - (smsLimits.get(body.phone) || 0) < 60000) throw fail(429, 'SMS_WAIT', 'Наступний код можна отримати через хвилину.');
        if (session.phone && session.phone !== body.phone) throw fail(409, 'PHONE_CHANGED', 'Для іншого номера перевірте час і розпочніть підтвердження знову.');
        budget('sms:'+source,3); budget('sms-hour:'+source,10,3600000); budget('sms-company',10); budget('sms-company-hour',100,3600000);
        for(const [k,v] of smsLimits)if(Date.now()-v>60000)smsLimits.delete(k);
        if(smsLimits.size>=10000)throw fail(429,'RATE_LIMIT','Забагато запитів. Спробуйте пізніше.');
        smsLimits.set(body.phone, Date.now());
        session.phone = body.phone;
        await upstream(`/book_code/${COMPANY}`, 'POST', { phone: body.phone, fulname: String(body.fullname || '').slice(0,100) });
        session.phone = body.phone;
        return send(200, { data: { sent: true } });
      }
      if (body.consent !== true || typeof body.fullname !== 'string' || body.fullname.trim().length < 2 || body.fullname.length > 100 || typeof body.comment !== 'string' || body.comment.length > 1000 || (body.email && (body.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)))) throw fail(400, 'CONTACTS', 'Перевірте ім’я, контакти та згоду на обробку даних.');
      if (session.settings.commentRequired && !body.comment.trim()) throw fail(400, 'COMMENT', 'Додайте коментар до запису.');
      if (session.settings.phoneConfirmation && (session.phone !== body.phone || !/^\d{4,8}$/.test(body.code || ''))) throw fail(400, 'CODE', 'Отримайте та введіть SMS-код для цього номера.');
      const a=session.appointment;
      const intent=JSON.stringify([body.phone,a.staff_id,a.datetime,[...a.services].sort((x,y)=>x-y)]);
      const previous=results.get(intents.get(intent)) || results.get(body.session);
      if (previous) { if (previous.pending) throw fail(409, 'PENDING', 'Попередній запис обробляється. Не надсилайте його повторно.'); return send(previous.status, previous.body); }
      if (intents.size >= 10000) throw fail(503, 'CAPACITY', 'Онлайн-запис тимчасово недоступний. Зателефонуйте в Maison.');
      intents.set(intent, body.session);
      results.set(body.session, { pending: true });
      let writeAttempted=false, claimed=false;
      try {
        await verifySlot(session.appointment);
        let previous;
        try { previous=storage().claim(intent); } catch { throw fail(503,'STATE_STORAGE','Онлайн-запис тимчасово недоступний. Спробуйте пізніше.'); }
        if(previous){
          const saved=previous.status==='confirmed' ? {status:201,body:{data:{confirmed:true,record_id:previous.record_id}}} : {status:409,body:{error:'RESULT_UNKNOWN',message:'Попередній запис має невідомий результат. Уточніть його в Maison перед повторною спробою.'}};
          results.set(body.session,saved);return send(saved.status,saved.body);
        }
        claimed=true; writeAttempted=true;
        const d = await upstream(`/book_record/${COMPANY}`, 'POST', { phone: body.phone, fullname: body.fullname.trim(), email: body.email || '', comment: body.comment, type: 'web', ...(session.settings.phoneConfirmation ? { code: Number(body.code) } : {}), appointments: [session.appointment] });
        if (!Array.isArray(d) || !d.length || !Number.isSafeInteger(d[0].record_id) || d[0].record_id<1) throw fail(502, 'RESULT_UNKNOWN', 'Результат запису невідомий. Уточніть його в Maison перед повторною спробою.');
        try{storage().save(intent,{status:'confirmed',record_id:d[0].record_id});}catch{throw fail(503,'RESULT_UNKNOWN','Результат запису потребує перевірки. Зателефонуйте в Maison перед повторною спробою.');}
        const answer = { data: { confirmed: true, record_id: d[0].record_id } };
        results.set(body.session, { status: 201, body: answer }); return send(201, answer);
      } catch (e) {
        // Keep uncertain writes locked; explicit rejections may be corrected without duplicating a record.
        if(writeAttempted && !['BOOKING_REJECTED','RESULT_UNKNOWN'].includes(e.code))e=fail(503,'RESULT_UNKNOWN','Результат запису невідомий. Уточніть його в Maison.');
        if (e.code === 'RESULT_UNKNOWN') {try{if(claimed)storage().save(intent,{status:'unknown'});}catch{/* Existing pending journal remains a durable lock. */}results.set(body.session, { status: e.status, body: { error: e.code, message: e.message } });}
        else {if(claimed)try{storage().remove(intent);}catch{}results.delete(body.session); intents.delete(intent);}
        throw e;
      }
    } catch (e) { send(e.status || 502, { error: e.code || 'UNAVAILABLE', message: e.status ? e.message : 'Система запису тимчасово недоступна. Зателефонуйте в Maison.' }); }
  };
}
