// Бэкенд опросника: приём анкет в D1 + выдача по паролю (Cloudflare Worker).
// Настройка — worker/README.md. URL фронтенда указывается в ALLOWED_ORIGINS (wrangler.toml).

function json(body, status, cors){
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors },
  });
}

function corsFor(env, request){
  const origin = request.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  if(!allowed.includes(origin)) return { 'Vary': 'Origin' };
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Key',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Vary': 'Origin',
  };
}

function isAuthorized(request, env){
  const key = request.headers.get('X-Admin-Key') || '';
  return !!env.ADMIN_KEY && key === env.ADMIN_KEY;
}

export default {
  async fetch(request, env){
    const cors = corsFor(env, request);
    const url = new URL(request.url);

    if(request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    // Приём анкеты: открытый (но ограниченный) эндпоинт, пишет одну строку в D1.
    if(url.pathname === '/submit' && request.method === 'POST'){
      if(request.headers.get('Content-Length') && +request.headers.get('Content-Length') > 200000){
        return json({ ok: false, error: 'too large' }, 413, cors);
      }
      let p;
      try { p = await request.json(); } catch { return json({ ok: false, error: 'bad json' }, 400, cors); }
      // без согласия на обработку ПДн не сохраняем
      if(!p || typeof p !== 'object' || !p.pdConsent || p.pdConsent.given !== true){
        return json({ ok: false, error: 'consent required' }, 400, cors);
      }
      if(!String(p.companyName || '').trim() && !String(p.contactInfo || '').trim()){
        return json({ ok: false, error: 'empty submission' }, 400, cors);
      }
      const { results } = await env.DB.prepare(
        'INSERT INTO responses (created_at, ip, company, contact, contact_info, main_task, pain_score, commercial_score, verdict, payload) VALUES (?,?,?,?,?,?,?,?,?,?) RETURNING id'
      ).bind(
        String(p.timestamp || new Date().toISOString()),
        request.headers.get('CF-Connecting-IP') || '',
        String(p.companyName || '').slice(0, 300),
        String(p.contactName || '').slice(0, 300),
        String(p.contactInfo || '').slice(0, 300),
        String(p.mainTask || '').slice(0, 2000),
        Number(p.painScore) || 0,
        Number(p.commercialScore) || 0,
        String(p.verdict || '').slice(0, 100),
        JSON.stringify(p)
      ).all();
      return json({ ok: true, id: results[0].id }, 200, cors);
    }

    // Просмотр списка анкет — только по ключу админа.
    if(url.pathname === '/answers' && request.method === 'GET'){
      if(!isAuthorized(request, env)) return json({ error: 'unauthorized' }, 401, cors);
      const { results } = await env.DB.prepare(
        'SELECT id, created_at, company, contact, contact_info, main_task, pain_score, commercial_score, verdict, payload FROM responses ORDER BY id DESC LIMIT 500'
      ).all();
      return json({ items: results }, 200, cors);
    }

    // Удаление анкеты (изъятие согласия) — только по ключу админа.
    if(url.pathname === '/answers' && request.method === 'DELETE'){
      if(!isAuthorized(request, env)) return json({ error: 'unauthorized' }, 401, cors);
      const id = Number(url.searchParams.get('id'));
      if(!id) return json({ error: 'bad id' }, 400, cors);
      await env.DB.prepare('DELETE FROM responses WHERE id = ?').bind(id).run();
      return json({ ok: true }, 200, cors);
    }

    return json({ ok: true, service: 'survey backend' }, 200, cors);
  },
};
