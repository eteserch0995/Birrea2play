/**
 * wc-sync-results — Edge Function (Mundial 2026)
 * Deploy con: supabase functions deploy wc-sync-results --no-verify-jwt
 *
 * Automatiza la carga de resultados desde api-football. Reemplaza el
 * tecleo manual del admin: para cada fixture, llama al RPC
 * wc_sync_apply_match_result, que respeta admin_override y dispara la
 * cascada Polla + Survivor.
 *
 * Auth: se invoca desde pg_cron (header x-sync-secret) o manual desde el
 * panel admin (header x-sync-secret tambien). NO usa JWT de usuario.
 *
 * Modos (query ?mode= o body.mode):
 *   sync      (default) — trae fixtures de una fecha y aplica resultados.
 *   backfill            — mapea api_football_id en wc_teams y wc_matches
 *                         (reconcilia grupos/fechas). Correr UNA vez antes
 *                         de habilitar el cron.
 *
 * Proveedor (env API_FOOTBALL_PROVIDER): 'apisports' (default, directo
 * dashboard.api-football.com) o 'rapidapi' (marketplace). Cambia base URL
 * y headers; el resto del codigo es identico.
 *
 * Secrets (supabase secrets set ...):
 *   API_FOOTBALL_KEY        — la key de RapidAPI o api-sports.
 *   API_FOOTBALL_PROVIDER   — 'apisports' | 'rapidapi'  (default apisports)
 *   WC_LEAGUE_ID            — id de liga del Mundial (default '1')
 *   WC_SEASON              — temporada (default '2026')
 *   WC_SYNC_SECRET          — secreto compartido para autorizar el llamado
 *   (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY ya existen en el runtime)
 */
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SVC = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const PROVIDER    = (Deno.env.get('API_FOOTBALL_PROVIDER') ?? 'apisports').toLowerCase();
const API_KEY     = Deno.env.get('API_FOOTBALL_KEY') ?? Deno.env.get('RAPIDAPI_KEY') ?? '';
const LEAGUE_ID   = Deno.env.get('WC_LEAGUE_ID') ?? '1';
const SEASON      = Deno.env.get('WC_SEASON') ?? '2026';
const SYNC_SECRET = Deno.env.get('WC_SYNC_SECRET') ?? '';
const SYNC_TIMEZONE = Deno.env.get('WC_SYNC_TIMEZONE') ?? 'America/Panama';

const supabase = createClient(SUPABASE_URL, SUPABASE_SVC, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-sync-secret',
};
const ok  = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });
const err = (b: unknown, s = 400) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

// ── Proveedor: base URL + headers ───────────────────────────
function apiConfig() {
  if (PROVIDER === 'rapidapi') {
    return {
      base: 'https://api-football-v1.p.rapidapi.com/v3',
      headers: { 'x-rapidapi-key': API_KEY, 'x-rapidapi-host': 'api-football-v1.p.rapidapi.com' },
    };
  }
  // apisports directo (dashboard.api-football.com)
  return {
    base: 'https://v3.football.api-sports.io',
    headers: { 'x-apisports-key': API_KEY },
  };
}

async function apiGet(path: string): Promise<any> {
  const { base, headers } = apiConfig();
  const res = await fetch(`${base}${path}`, { headers });
  const json = await res.json();
  // api-football devuelve { errors: {...}, response: [...] }
  if (json?.errors && Object.keys(json.errors).length > 0) {
    throw new Error(`api-football errors: ${JSON.stringify(json.errors)}`);
  }
  return json;
}

function dateInTimezone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function fixturesPath(params: Record<string, string>) {
  const search = new URLSearchParams({
    league: LEAGUE_ID,
    season: SEASON,
    timezone: SYNC_TIMEZONE,
    ...params,
  });
  return `/fixtures?${search.toString()}`;
}

// ── Mapeo de estado del API -> enum interno ─────────────────
// Codigos api-football v3: fixture.status.short
function normalizeStatus(short: string): string {
  const s = (short ?? '').toUpperCase();
  if (['FT', 'AET', 'PEN'].includes(s)) return 'finished';
  if (['1H', '2H', 'HT', 'ET', 'BT', 'P', 'LIVE', 'INT', 'SUSP'].includes(s)) return 'live';
  if (s === 'PST') return 'postponed';
  if (['CANC', 'ABD', 'AWD', 'WO'].includes(s)) return 'cancelled';
  return 'scheduled'; // TBD, NS, ...
}

// ── Mapeo fixture -> marcador oficial ───────────────────────
// VALIDAR contra la primera respuesta real (paso post-key).
// Regla del torneo: marcador oficial = 90' + tiempo extra (goals.*),
// los penales van aparte y NO afectan el marcador para scoring.
function extractScore(fx: any) {
  const goalsHome = fx?.goals?.home ?? null;
  const goalsAway = fx?.goals?.away ?? null;
  const penHome   = fx?.score?.penalty?.home ?? null;
  const penAway   = fx?.score?.penalty?.away ?? null;
  return {
    score_home: goalsHome,
    score_away: goalsAway,
    pen_home: (penHome != null && penAway != null) ? penHome : null,
    pen_away: (penHome != null && penAway != null) ? penAway : null,
  };
}

// ============================================================
// MODO SYNC — aplica resultados de una fecha
// ── Helper: procesa los fixtures de UNA fecha y acumula resultados ──
async function syncDateFixtures(
  date: string,
  byApiId: Map<number, { id: string; phase: string; status: string }>,
  detail: any[]
) {
  let fixturesSeen = 0, matched = 0, finished = 0, pollaTotal = 0, surfDays = 0, errors = 0;
  const data = await apiGet(fixturesPath({ date }));
  const fixtures: any[] = data?.response ?? [];
  fixturesSeen = fixtures.length;

  for (const fx of fixtures) {
    const apiId = fx?.fixture?.id;
    const our = apiId != null ? byApiId.get(apiId) : undefined;
    if (!our) continue;
    matched++;

    const short = fx?.fixture?.status?.short;
    const newStatus = normalizeStatus(short);
    const { score_home, score_away, pen_home, pen_away } = extractScore(fx);

    try {
      const { data: rpcRes, error: rpcErr } = await supabase.rpc('wc_sync_apply_match_result', {
        p_match_id: our.id,
        p_new_status: newStatus,
        p_api_status: short,
        p_score_home: score_home,
        p_score_away: score_away,
        p_penalties_home: pen_home,
        p_penalties_away: pen_away,
        p_api_raw: fx,
      });
      if (rpcErr) throw rpcErr;
      if (newStatus === 'finished') finished++;
      pollaTotal += rpcRes?.polla_resolved ?? 0;
      if (rpcRes?.survivor_settled) surfDays++;
      detail.push({ date, match: our.id, apiId, status: newStatus, ...rpcRes });
    } catch (e) {
      errors++;
      detail.push({ date, match: our.id, apiId, error: (e as Error).message });
      console.error('WC_SYNC_RPC_ERROR', { date, match: our.id, apiId, error: (e as Error).message });
    }
  }
  return { fixturesSeen, matched, finished, pollaTotal, surfDays, errors };
}

// ============================================================
async function runSync(source: string, dateOverride: string | null) {
  const t0 = Date.now();
  const detail: any[] = [];
  let fixturesSeen = 0, matched = 0, finished = 0, pollaTotal = 0, surfDays = 0, errors = 0;

  // Mapa api_football_id -> nuestro match.id (solo los ya backfilleados)
  const { data: ourMatches, error: mErr } = await supabase
    .from('wc_matches')
    .select('id, api_football_id, phase, status')
    .not('api_football_id', 'is', null);
  if (mErr) throw new Error(`leyendo wc_matches: ${mErr.message}`);
  const byApiId = new Map<number, { id: string; phase: string; status: string }>();
  (ourMatches ?? []).forEach((m: any) => byApiId.set(m.api_football_id, m));

  if (byApiId.size === 0) {
    return { ok: false, note: 'No hay wc_matches con api_football_id. Corre mode=backfill primero.' };
  }

  // Fecha primaria (hoy en zona configurada, o override manual).
  const today = dateOverride ?? dateInTimezone(new Date(), SYNC_TIMEZONE);

  // Fechas a sincronizar: hoy + cualquier jornada pasada no resuelta que ya empezó.
  // Esto captura partidos nocturnos que cruzaron la medianoche (ej: Australia vs Turquía
  // a las 11pm Panamá — la jornada del 13-jun sigue sin cerrarse a las 12:01am del 14-jun).
  const datesToSync = new Set<string>([today]);
  if (!dateOverride) {
    const { data: staleDays } = await supabase
      .from('wc_match_days')
      .select('date')
      .eq('is_settled', false)
      .lte('first_kickoff_at', new Date().toISOString())
      .lt('date', today);
    (staleDays ?? []).forEach((d: any) => datesToSync.add(d.date));
  }

  // Sincronizar cada fecha
  for (const date of datesToSync) {
    const r = await syncDateFixtures(date, byApiId, detail);
    fixturesSeen += r.fixturesSeen;
    matched      += r.matched;
    finished     += r.finished;
    pollaTotal   += r.pollaTotal;
    surfDays     += r.surfDays;
    errors       += r.errors;
  }

  await supabase.from('wc_sync_logs').insert({
    source,
    fixtures_seen: fixturesSeen,
    matches_matched: matched,
    matches_finished: finished,
    polla_predictions: pollaTotal,
    survivor_days_settled: surfDays,
    errors,
    detail,
    duration_ms: Date.now() - t0,
  });

  return { ok: true, dates: [...datesToSync], timezone: SYNC_TIMEZONE, fixturesSeen, matched, finished, pollaTotal, surfDays, errors };
}

// ============================================================
// MODO BACKFILL — mapea api_football_id en teams + matches
// ============================================================
// "API manda y reconcilia": setea api_football_id y, donde difiera,
// reconcilia grupo/fecha. Reporta lo no mapeado para revision manual.
// VALIDAR contra respuesta real antes de confiar el mapeo por nombre.
async function runBackfill() {
  const t0 = Date.now();
  const report: any = { teams: { matched: 0, unmatched: [] }, matches: { matched: 0, unmatched_api: [], unmatched_ours: [] } };

  // 1) Teams del Mundial en el API
  const teamsData = await apiGet(`/teams?league=${LEAGUE_ID}&season=${SEASON}`);
  const apiTeams: any[] = teamsData?.response ?? [];

  const { data: ourTeams } = await supabase.from('wc_teams').select('id, code, name, name_es, api_football_id');
  // Quita acentos sin regex de combining-marks (NFD + filtro por code point 0x300-0x36f).
  const norm = (s: string) => (s ?? '').normalize('NFD')
    .split('').filter((c) => { const k = c.charCodeAt(0); return k < 0x300 || k > 0x36f; }).join('')
    .toLowerCase().trim();
  const apiTeamIdByOurId = new Map<string, number>();

  for (const ot of ourTeams ?? []) {
    // match por code (3 letras) o por nombre normalizado (en + es)
    const hit = apiTeams.find((at: any) => {
      const atName = norm(at?.team?.name);
      const atCode = (at?.team?.code ?? '').toUpperCase();
      return (ot.code && atCode === ot.code.toUpperCase()) ||
             atName === norm(ot.name) || atName === norm(ot.name_es);
    });
    if (hit) {
      apiTeamIdByOurId.set(ot.id, hit.team.id);
      await supabase.from('wc_teams').update({ api_football_id: hit.team.id }).eq('id', ot.id);
      report.teams.matched++;
    } else {
      report.teams.unmatched.push({ id: ot.id, code: ot.code, name: ot.name });
    }
  }

  // 2) Fixtures del Mundial -> mapear a nuestros wc_matches por (home,away api ids)
  const fxData = await apiGet(`/fixtures?league=${LEAGUE_ID}&season=${SEASON}`);
  const fixtures: any[] = fxData?.response ?? [];

  const { data: ourMatches } = await supabase
    .from('wc_matches')
    .select('id, phase, group_letter, team_home_id, team_away_id, scheduled_at, api_football_id');

  const matchedApiIds = new Set<number>();
  for (const m of ourMatches ?? []) {
    const homeApi = m.team_home_id ? apiTeamIdByOurId.get(m.team_home_id) : undefined;
    const awayApi = m.team_away_id ? apiTeamIdByOurId.get(m.team_away_id) : undefined;
    if (homeApi == null || awayApi == null) continue; // KO con placeholders: se mapea por ronda/fecha despues

    const hit = fixtures.find((fx: any) =>
      fx?.teams?.home?.id === homeApi && fx?.teams?.away?.id === awayApi);
    if (hit) {
      matchedApiIds.add(hit.fixture.id);
      await supabase.from('wc_matches').update({
        api_football_id: hit.fixture.id,
        // reconcilia el horario oficial del API (timestamptz)
        scheduled_at: hit?.fixture?.date ?? m.scheduled_at,
        venue: hit?.fixture?.venue?.name ?? null,
        city: hit?.fixture?.venue?.city ?? null,
      }).eq('id', m.id);
      report.matches.matched++;
    } else {
      report.matches.unmatched_ours.push({ id: m.id, phase: m.phase, group: m.group_letter });
    }
  }
  for (const fx of fixtures) {
    if (!matchedApiIds.has(fx?.fixture?.id)) {
      report.matches.unmatched_api.push({
        apiId: fx?.fixture?.id, round: fx?.league?.round,
        home: fx?.teams?.home?.name, away: fx?.teams?.away?.name, date: fx?.fixture?.date,
      });
    }
  }

  await supabase.from('wc_sync_logs').insert({
    source: 'backfill', fixtures_seen: fixtures.length,
    matches_matched: report.matches.matched, detail: report, duration_ms: Date.now() - t0,
  });

  return { ok: true, ...report };
}

// ============================================================
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

  // Auth: secreto compartido (cron y panel admin).
  const provided = req.headers.get('x-sync-secret') ?? '';
  if (!SYNC_SECRET || provided !== SYNC_SECRET) {
    return err({ ok: false, error: 'unauthorized' }, 401);
  }
  if (!API_KEY) return err({ ok: false, error: 'API_FOOTBALL_KEY no configurada' }, 500);

  let body: any = {};
  try { body = req.method === 'POST' ? await req.json() : {}; } catch { body = {}; }
  const url = new URL(req.url);
  const mode = (url.searchParams.get('mode') ?? body.mode ?? 'sync').toLowerCase();
  const source = (body.source ?? 'manual') as string;
  const dateOverride = url.searchParams.get('date') ?? body.date ?? null;

  try {
    if (mode === 'status') {
      // Diagnostico: plan + cupo diario y consumo actual del proveedor api-football.
      const s = await apiGet('/status');
      return ok({ ok: true, status: s?.response ?? s });
    }
    if (mode === 'backfill') return ok(await runBackfill());
    return ok(await runSync(source, dateOverride));
  } catch (e) {
    console.error('WC_SYNC_FATAL', { mode, error: (e as Error).message });
    return err({ ok: false, mode, error: (e as Error).message }, 500);
  }
});
