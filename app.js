'use strict';
(function () {
  const D = window.NBA_DATA;
  const app = document.getElementById('app');
  if (!D) {
    app.innerHTML = '<div class="card empty">데이터가 없습니다. 터미널에서 <code>python3 update_data.py</code> 를 먼저 실행하세요.</div>';
    return;
  }

  // ---------- 기본 도구 ----------
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (v, d = 1) => (v == null || isNaN(v)) ? '–' : Number(v).toFixed(d);
  const pct = v => (v == null || isNaN(v)) ? '–' : (v * 100).toFixed(1);
  const signed = (v, d = 1) => (v == null || isNaN(v)) ? '–' : (v > 0 ? '+' : '') + v.toFixed(d);
  const load = (k, def) => { try { const v = JSON.parse(localStorage.getItem('nbatoto_' + k)); return v == null ? def : v; } catch (e) { return def; } };
  const save = (k, v) => { try { localStorage.setItem('nbatoto_' + k, JSON.stringify(v)); } catch (e) { /* 저장 불가 환경 */ } };

  function erf(x) { // Abramowitz-Stegun 근사
    const s = Math.sign(x); x = Math.abs(x);
    const t = 1 / (1 + 0.3275911 * x);
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return s * y;
  }
  const Phi = z => 0.5 * (1 + erf(z / Math.SQRT2));

  const KO = {
    ATL: '애틀랜타 호크스', BOS: '보스턴 셀틱스', BRK: '브루클린 네츠', CHO: '샬럿 호네츠', CHI: '시카고 불스',
    CLE: '클리블랜드 캐벌리어스', DAL: '댈러스 매버릭스', DEN: '덴버 너기츠', DET: '디트로이트 피스톤스',
    GSW: '골든스테이트 워리어스', HOU: '휴스턴 로키츠', IND: '인디애나 페이서스', LAC: 'LA 클리퍼스', LAL: 'LA 레이커스',
    MEM: '멤피스 그리즐리스', MIA: '마이애미 히트', MIL: '밀워키 벅스', MIN: '미네소타 팀버울브스',
    NOP: '뉴올리언스 펠리컨스', NYK: '뉴욕 닉스', OKC: '오클라호마시티 썬더', ORL: '올랜도 매직',
    PHI: '필라델피아 76ers', PHO: '피닉스 선즈', POR: '포틀랜드 트레일블레이저스', SAC: '새크라멘토 킹스',
    SAS: '샌안토니오 스퍼스', TOR: '토론토 랩터스', UTA: '유타 재즈', WAS: '워싱턴 위저즈'
  };
  const tName = ab => KO[ab] || (D.teams[ab] || {}).name || ab;
  const TEAMS = Object.keys(D.teams).sort((a, b) => tName(a).localeCompare(tName(b), 'ko'));

  const CUR = D.curSeason, PREV = D.prevSeason;
  const TS = D.teamStats || {};
  const LBL = D.seasonLabels || {};
  const teamRow = (season, ab) => ((TS[season] || {}).teams || {})[ab];
  const league = season => (TS[season] || {}).league || {};
  const teamG = (season, ab) => { const t = teamRow(season, ab); return t ? (t.wins || 0) + (t.losses || 0) : 0; };

  const byTeam = {};
  D.players.forEach(p => { (byTeam[p.team] = byTeam[p.team] || []).push(p); });

  // ---------- 설정 ----------
  const DEFAULTS = { hca: 2.4, sdMargin: 12.5, sdTotal: 18, teamK: 20, rosterW: 0.65, b2b: 1.5, dtdOut: false };
  const SETTINGS_META = [
    ['hca', '홈 어드밴티지 (점)', 0.1, '홈팀이 얻는 점수차 이점. 최근 NBA는 약 2~2.5점.'],
    ['b2b', '백투백 페널티 (점)', 0.1, '전날 경기를 치른 팀이 잃는 점수차.'],
    ['sdMargin', '점수차 표준편차', 0.5, '경기 결과가 예측에서 흔들리는 정도. NBA는 약 12~13점.'],
    ['sdTotal', '총점 표준편차', 0.5, '총점이 예측에서 흔들리는 정도. NBA는 약 17~19점.'],
    ['teamK', '팀 실제 성적 신뢰 기준 (경기)', 1, '이 경기 수만큼 치르면 이번 시즌 팀 실제 성적을 50% 반영.'],
    ['rosterW', '로스터 기반 비중 (0~1)', 0.05, '시즌 전 기준값에서 "현재 로스터 선수 능력" 대 "지난 시즌 팀 성적" 비율.'],
  ];
  let S = Object.assign({}, DEFAULTS, load('settings', {}));
  Object.keys(DEFAULTS).forEach(k => { if (k !== 'dtdOut' && (!Number.isFinite(S[k]) || S[k] < 0 || (['sdMargin','sdTotal','teamK'].includes(k) && S[k] === 0) || (k === 'rosterW' && S[k] > 1))) S[k] = DEFAULTS[k]; });
  let overrides = {};
  let minuteOverrides = {};
  let scenarioScope = '';
  let scenarios = [];
  const scopeKey = () => [D.updated, state.gameId || 'manual', state.home, state.away].join('|');
  function activateScope() {
    const key = scopeKey();
    if (scenarioScope === key) return;
    scenarioScope = key;
    const saved = load('matchup_' + key, {});
    overrides = saved.out || {}; minuteOverrides = saved.minutes || {}; scenarios = saved.scenarios || [];
  }
  function saveMatchup() { save('matchup_' + scenarioScope, {out: overrides, minutes: minuteOverrides, scenarios}); }
  // // eid -> true(결장) / false(출전)

  const defaultOut = p => !!(p.injury && (p.injury.status === 'Out' || (S.dtdOut && p.injury.status === 'Day-To-Day')));
  const isOut = p => (p.eid in overrides) ? overrides[p.eid] : defaultOut(p);

  // ---------- 선수 통계 (시즌/혼합) ----------
  const PG_KEYS = ['mpg', 'fg', 'fga', 'fg3', 'fg3a', 'ft', 'fta', 'orb', 'drb', 'trb', 'ast', 'stl', 'blk', 'tov', 'pf', 'pts'];
  const MIN_KEYS = ['usg_pct', 'per', 'obpm', 'dbpm', 'bpm'];
  const wavg = (a, wa, b, wb) => {
    if (a == null) return b; if (b == null) return a;
    return (wa + wb) > 0 ? (a * wa + b * wb) / (wa + wb) : a;
  };
  const F = NBAForecast;
  const positionGroup = p => /C/.test(p.pos) ? 'C' : /G/.test(p.pos) ? 'G' : 'F';
  const rolePriors = {};
  for (const group of ['G','F','C']) {
    const players = D.players.filter(p => positionGroup(p) === group && F.minutes(p.prev) >= 300);
    rolePriors[group] = {};
    for (const key of ['obpm','dbpm']) {
      const values = players.map(p=>p.prev[key]).filter(Number.isFinite);
      rolePriors[group][key] = values.length ? values.reduce((a,b)=>a+b,0)/values.length : key === 'obpm' ? -1 : -.5;
    }
  }

  function stats(p, mode) {
    const c = p.cur, q = p.prev;
    let o;
    if (mode === 'cur') o = c ? Object.assign({}, c) : null;
    else if (mode === 'prev') o = q ? Object.assign({}, q) : null;
    else if (!c && !q) o = null;
    else if (!c) o = Object.assign({}, q, { g: 0, gPrev: q.g });
    else if (!q) o = Object.assign({}, c, { gPrev: 0 });
    else {
      const wc = F.currentWeight(c, q), wp = 1 - wc;
      o = { g: c.g, gs: c.gs, gPrev: q.g };
      PG_KEYS.forEach(k => { o[k] = wavg(c[k], wc, q[k], wp); });
      const mc = wc, mq = wp;
      MIN_KEYS.forEach(k => { o[k] = wavg(c[k], mc, q[k], mq); });
      o.fg_pct = o.fga > 0 ? o.fg / o.fga : null;
      o.fg3_pct = o.fg3a > 0.05 ? o.fg3 / o.fg3a : null;
      o.ft_pct = o.fta > 0.05 ? o.ft / o.fta : null;
      o.efg_pct = o.fga > 0 ? (o.fg + 0.5 * o.fg3) / o.fga : null;
      o.ts_pct = (o.fga + 0.44 * o.fta) > 0 ? o.pts / (2 * (o.fga + 0.44 * o.fta)) : null;
    }
    return o;
  }

  // Ability uses a season prior; current role minutes are estimated independently.
  const bpmCache = new Map();
  function modelBPM(p) {
    if (bpmCache.has(p.eid)) return bpmCache.get(p.eid);
    const prior = rolePriors[positionGroup(p)];
    const r = {ob: F.ability(p.cur, p.prev, 'obpm', prior.obpm), db: F.ability(p.cur, p.prev, 'dbpm', prior.dbpm)};
    bpmCache.set(p.eid, r);
    return r;
  }
  function projMin(p) { return F.roleMinutes(p.cur, p.prev); }

  // 로테이션 (팀 합계 240분)
  // 1) 건강할 때: 출전 시간이 많은 선수부터 채우고, 240분을 넘는 부분은 로스터 끝자리 선수에서 잘라냄
  //    (지난 시즌 다른 팀 기록까지 합치면 240분을 크게 넘기 때문에 주전 시간이 줄지 않게 함)
  // 2) 결장자의 시간은 남은 선수에게 m×(40−현재 시간) 가중치로 나눔
  //    → 이미 35분 뛰는 주전보다 로테이션·벤치 선수가 더 많이 받음
  const MAX_MIN = 40;
  function rotation(team, outFn, minutes = {}) {
    const list = (byTeam[team] || []).map(p => ({ p, m: Math.min(MAX_MIN, projMin(p)), final: 0 }));
    const sorted = list.filter(x => x.m > 0).sort((a, b) => b.m - a.m);
    const sumM = sorted.reduce((s, x) => s + x.m, 0);
    if (sumM <= 240) {
      const k = sumM > 0 ? 240 / sumM : 0;
      sorted.forEach(x => { x.final = Math.min(MAX_MIN, x.m * k); });
    } else {
      let cum = 0;
      sorted.forEach(x => { x.final = Math.max(0, Math.min(x.m, 240 - cum)); cum += x.final; });
    }
    list.forEach(x => { x.base = x.final; });
    list.forEach(x => {
      x.out = outFn(x.p);
      x.fixed = x.out || Object.hasOwn(minutes, x.p.eid);
      x.final = x.out ? 0 : x.fixed ? Number(minutes[x.p.eid]) : x.base;
    });
    const invalidInput = list.some(x => !Number.isFinite(x.final) || x.final < 0 || x.final > MAX_MIN);
    let remaining = 240 - list.reduce((n, x) => n + x.final, 0);
    const candidates = list.filter(x => !x.fixed && x.m > 0);
    if (remaining < 0) {
      const flexible = candidates.reduce((n, x) => n + x.final, 0);
      const scale = flexible > 0 ? Math.max(0, (flexible + remaining) / flexible) : 0;
      candidates.forEach(x => { x.final *= scale; });
      remaining = 240 - list.reduce((n, x) => n + x.final, 0);
    }
    for (let it = 0; it < list.length && remaining > 0.001; it++) {
      const eligible = candidates.filter(x => x.final < MAX_MIN - 0.001);
      const weight = eligible.reduce((n, x) => n + x.m * (MAX_MIN - x.final), 0);
      if (!weight) break;
      let used = 0;
      eligible.forEach(x => {
        const add = Math.min(MAX_MIN - x.final, remaining * x.m * (MAX_MIN - x.final) / weight);
        x.final += add; used += add;
      });
      remaining -= used;
    }
    const totalMinutes = list.reduce((n, x) => n + x.final, 0);
    const valid = !invalidInput && Math.abs(totalMinutes - 240) < 0.01;
    let off = 0, def = 0;
    list.forEach(x => { const b = modelBPM(x.p); off += b.ob * x.final / 48; def += b.db * x.final / 48; });
    return { list, off, def, totalMinutes, valid };
  }

  const healthyCache = {};
  const noneOut = () => false;
  const healthy = t => healthyCache[t] || (healthyCache[t] = rotation(t, noneOut));
  let OFF_MEAN = 0, DEF_MEAN = 0;
  function recenter() {
    Object.keys(healthyCache).forEach(k => delete healthyCache[k]);
    bpmCache.clear();
    const ts = TEAMS.filter(t => byTeam[t]);
    OFF_MEAN = ts.reduce((s, t) => s + healthy(t).off, 0) / ts.length;
    DEF_MEAN = ts.reduce((s, t) => s + healthy(t).def, 0) / ts.length;
  }

  function leagueBase() {
    const lc = league(CUR), lp = league(PREV);
    const gs = TEAMS.map(t => teamG(CUR, t));
    const gL = gs.reduce((a, b) => a + b, 0) / Math.max(1, gs.length);
    const w = gL / (gL + S.teamK);
    return {
      ortg: wavg(lc.off_rtg, w, lp.off_rtg, 1 - w) || 114,
      pace: wavg(lc.pace, w, lp.pace, 1 - w) || 99,
    };
  }

  // 팀 모델: off/def = 리그 평균 대비 100포제션당 (+ 좋음)
  function teamModel(team, outFn, minutes = {}) {
    const h = healthy(team), r = rotation(team, outFn, minutes);
    const tc = teamRow(CUR, team), tp = teamRow(PREV, team);
    const lc = league(CUR), lp = league(PREV);
    const g = teamG(CUR, team), wa = g / (g + S.teamK);
    const rOff = h.off - OFF_MEAN, rDef = h.def - DEF_MEAN;
    const pOff = tp && lp.off_rtg ? tp.off_rtg - lp.off_rtg : rOff;
    const pDef = tp && lp.off_rtg ? (lp.def_rtg || lp.off_rtg) - tp.def_rtg : rDef;
    const priorOff = S.rosterW * rOff + (1 - S.rosterW) * pOff;
    const priorDef = S.rosterW * rDef + (1 - S.rosterW) * pDef;
    const cOff = tc && g ? tc.off_rtg - lc.off_rtg : priorOff;
    const cDef = tc && g ? (lc.def_rtg || lc.off_rtg) - tc.def_rtg : priorDef;
    const baseOff = wa * cOff + (1 - wa) * priorOff, baseDef = wa * cDef + (1 - wa) * priorDef;
    const dOff = r.off - h.off, dDef = r.def - h.def;
    const pace = wavg(tc && g ? tc.pace : null, wa, tp ? tp.pace : null, 1 - wa) || leagueBase().pace;
    return { team, off: baseOff + dOff, def: baseDef + dDef, baseOff, baseDef, dOff, dDef, pace, rot: r, healthy: h, wa, g };
  }

  function predict(home, away, o) {
    o = o || {};
    const outFn = o.outFn || isOut;
    const H = teamModel(home, outFn, o.minutes || {}), A = teamModel(away, outFn, o.minutes || {});
    const L = leagueBase();
    const pace = H.pace * A.pace / L.pace;
    const rawH = (L.ortg + H.off - A.def) * pace / 100;
    const rawA = (L.ortg + A.off - H.def) * pace / 100;
    let ph = rawH, pa = rawA;
    const hca = o.neutral ? 0 : S.hca;
    ph += hca / 2; pa -= hca / 2;
    if (o.b2bH) { ph -= S.b2b * 2 / 3; pa += S.b2b / 3; }
    if (o.b2bA) { pa -= S.b2b * 2 / 3; ph += S.b2b / 3; }
    ph += o.adjH || 0; pa += o.adjA || 0;
    const margin = ph - pa, total = ph + pa;
    return { valid: H.rot.valid && A.rot.valid, H, A, L, pace, ph, pa, margin, total, pHome: Phi(margin / S.sdMargin), hca };
  }

  // ---------- 경기 일정 ----------
  const games = (D.games || []).slice().sort((a, b) => a.date.localeCompare(b.date));
  const kst = (iso, opt) => new Date(iso).toLocaleString('ko-KR', Object.assign({ timeZone: 'Asia/Seoul' }, opt));
  function isB2B(team, iso) {
    const t = new Date(iso).getTime();
    return games.some(g => (g.home.team === team || g.away.team === team) && g.date !== iso &&
      t - new Date(g.date).getTime() > 0 && t - new Date(g.date).getTime() < 32 * 3600 * 1000);
  }

  // ---------- 상태 ----------
  const state = {
    tab: load('tab', 'predict'), gameId: null,
    home: null, away: null, neutral: false, b2bH: false, b2bA: false, adjH: 0, adjA: 0,
    pMode: 'blend', pTeam: '', pSort: { k: 'pts', dir: -1 }, tSort: { k: 'model', dir: -1 },
  };

  // ---------- 탭 ----------
  function showTab(t) {
    state.tab = t; save('tab', t);
    $$('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === t));
    $$('.tab').forEach(s => s.classList.toggle('active', s.id === 'tab-' + t));
    if (t === 'players') renderPlayers();
    if (t === 'teams') renderTeams();
    if (t === 'history') renderHistory();
  }
  $('#tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) showTab(b.dataset.tab); });

  $('#updated').textContent = '데이터 업데이트: ' + D.updated + ' · ' + (LBL[CUR] || '') + ' 시즌';

  // ---------- 경기 목록 ----------
  function renderGames() {
    activateScope();
    const showFinal = $('#showFinal').checked;
    const list = games.filter(g => showFinal || g.state !== 'post');
    if (!list.length) { $('#gamesList').innerHTML = '<div class="muted" style="padding:10px">표시할 경기가 없어요. 위에서 팀을 직접 고르세요.</div>'; return; }
    let html = '', lastDay = '';
    list.forEach(g => {
      const day = kst(g.date, { month: 'long', day: 'numeric', weekday: 'short' });
      if (day !== lastDay) { html += `<div class="day-label">${esc(day)}</div>`; lastDay = day; }
      const pr = predict(g.home.team, g.away.team, { b2bH: isB2B(g.home.team, g.date), b2bA: isB2B(g.away.team, g.date) });
      const fav = pr.margin >= 0 ? g.home.team : g.away.team;
      const favP = pr.margin >= 0 ? pr.pHome : 1 - pr.pHome;
      const time = kst(g.date, { hour: '2-digit', minute: '2-digit', hour12: false });
      let line = '';
      if (g.line && (g.line.homeSpread != null || g.line.total != null)) {
        line = `시장: ${g.line.homeSpread != null ? g.home.team + ' ' + signed(g.line.homeSpread) : ''} ${g.line.total != null ? '· O/U ' + g.line.total : ''}`;
      }
      const score = g.state !== 'pre' && g.home.score != null ? `${g.away.score} : ${g.home.score}` : '';
      html += `<button class="game ${g.state === 'post' ? 'final' : ''} ${state.gameId === g.id ? 'sel' : ''}" data-id="${esc(g.id)}">
        <div class="g-top"><span>${esc(time)} ${g.state === 'in' ? '· 진행 중' : g.state === 'post' ? '· 종료' : ''}</span><span>${esc(score)}</span></div>
        <div class="g-teams">${esc(g.away.team)} @ ${esc(g.home.team)} <small>${esc(tName(g.away.team).split(' ').pop())} vs ${esc(tName(g.home.team).split(' ').pop())}</small></div>
        <div class="g-model">모델: <b>${esc(fav)} ${(favP * 100).toFixed(0)}%</b> · 총점 ${pr.total.toFixed(1)} · ${esc(g.home.team)} ${signed(-pr.margin)}</div>
        ${line ? `<div class="g-line">${esc(line)}</div>` : ''}
      </button>`;
    });
    $('#gamesList').innerHTML = html;
  }
  $('#showFinal').addEventListener('change', renderGames);
  $('#gamesList').addEventListener('click', e => {
    const b = e.target.closest('.game'); if (!b) return;
    selectGame(games.find(g => g.id === b.dataset.id));
  });

  function selectGame(g) {
    if (!g) return;
    state.gameId = g.id; state.home = g.home.team; state.away = g.away.team; state.neutral = false;
    state.b2bH = isB2B(g.home.team, g.date); state.b2bA = isB2B(g.away.team, g.date);
    state.adjH = 0; state.adjA = 0;
    ['oddAway', 'oddHome', 'oddHcH', 'oddHcA', 'oddOver', 'oddUnder'].forEach(id => { $('#' + id).value = ''; });
    $('#hcLine').value = g.line && g.line.homeSpread != null ? g.line.homeSpread : '';
    $('#ouLine').value = g.line && g.line.total != null ? g.line.total : '';
    syncPickers(); renderGames(); renderPredict();
  }

  // ---------- 매치업 선택 ----------
  const opts = TEAMS.map(t => `<option value="${t}">${esc(tName(t))} (${t})</option>`).join('');
  $('#homeSel').innerHTML = opts; $('#awaySel').innerHTML = opts;
  function syncPickers() {
    $('#homeSel').value = state.home; $('#awaySel').value = state.away;
    $('#neutral').checked = state.neutral; $('#b2bHome').checked = state.b2bH; $('#b2bAway').checked = state.b2bA;
    $('#adjHome').value = state.adjH; $('#adjAway').value = state.adjA;
  }
  function manualChange() {
    state.home = $('#homeSel').value; state.away = $('#awaySel').value;
    const g = games.find(x => x.id === state.gameId);
    if (g && (g.home.team !== state.home || g.away.team !== state.away)) state.gameId = null;
    state.neutral = $('#neutral').checked; state.b2bH = $('#b2bHome').checked; state.b2bA = $('#b2bAway').checked;
    state.adjH = parseFloat($('#adjHome').value) || 0; state.adjA = parseFloat($('#adjAway').value) || 0;
    renderGames(); renderPredict();
  }
  ['homeSel', 'awaySel', 'neutral', 'b2bHome', 'b2bAway', 'adjHome', 'adjAway'].forEach(id => $('#' + id).addEventListener('change', manualChange));
  ['adjHome', 'adjAway'].forEach(id => $('#' + id).addEventListener('input', manualChange));
  $('#swapBtn').addEventListener('click', () => {
    [state.home, state.away] = [state.away, state.home]; [state.b2bH, state.b2bA] = [state.b2bA, state.b2bH];
    [state.adjH, state.adjA] = [state.adjA, state.adjH];
    const hc = parseFloat($('#hcLine').value); if (!isNaN(hc)) $('#hcLine').value = -hc;
    state.gameId = null; syncPickers(); renderGames(); renderPredict();
  });
  $('#resetInj').addEventListener('click', () => { overrides = {}; minuteOverrides = {}; saveMatchup(); renderAll(); });
  ['oddAway', 'oddHome', 'hcLine', 'oddHcH', 'oddHcA', 'ouLine', 'oddOver', 'oddUnder'].forEach(id => $('#' + id).addEventListener('input', () => renderCalc(lastPred)));

  // ---------- 예측 결과 ----------
  let lastPred = null;
  function renderPredict() {
    if (!state.home || !state.away) return;
    activateScope();
    const pr = predict(state.home, state.away, { neutral: state.neutral, b2bH: state.b2bH, b2bA: state.b2bA, adjH: state.adjH, adjA: state.adjA, minutes: minuteOverrides });
    lastPred = pr;
    const g = games.find(x => x.id === state.gameId);
    const pA = 1 - pr.pHome;
    const hName = tName(state.home), aName = tName(state.away);
    const favTeam = pr.margin >= 0 ? state.home : state.away;
    let market = '';
    if (g && g.line && (g.line.homeSpread != null || g.line.total != null)) {
      const parts = [];
      if (g.line.homeSpread != null) {
        const modelLine = -pr.margin, d = modelLine - g.line.homeSpread;
        parts.push(`핸디 ${esc(state.home)} ${signed(g.line.homeSpread)} (모델 ${signed(modelLine)}, <span class="${d < 0 ? 'diff-pos' : 'diff-neg'}">${d < 0 ? '홈 쪽' : '원정 쪽'} ${Math.abs(d).toFixed(1)}점 유리</span>)`);
      }
      if (g.line.total != null) {
        const d = pr.total - g.line.total;
        parts.push(`O/U ${g.line.total} (모델 ${pr.total.toFixed(1)}, <span class="${d > 0 ? 'diff-pos' : 'diff-neg'}">${d > 0 ? '오버' : '언더'} 쪽 ${Math.abs(d).toFixed(1)}점</span>)`);
      }
      if (g.line.homeML || g.line.awayML) parts.push(`머니라인 ${esc(state.away)} ${esc(g.line.awayML || '–')} / ${esc(state.home)} ${esc(g.line.homeML || '–')}`);
      market = `<div class="market"><b>해외 시장 라인 (${esc(g.line.provider || '북메이커')})</b> · ${parts.join(' · ')}</div>`;
    }
    const row = (lb, a, h, d = 1) => `<tr><td>${lb}</td><td>${typeof a === 'string' ? a : signed(a, d)}</td><td>${typeof h === 'string' ? h : signed(h, d)}</td></tr>`;
    const toPts = v => v * pr.pace / 100;
    $('#result').innerHTML = `
      <div class="score-row">
        <div class="team-score away"><div class="nm">원정 · ${esc(aName)}</div><div class="ab">${esc(state.away)}</div><div class="pts">${pr.pa.toFixed(1)}</div></div>
        <div class="vs">예상 스코어</div>
        <div class="team-score home"><div class="nm">홈 · ${esc(hName)}${state.neutral ? ' (중립)' : ''}</div><div class="ab">${esc(state.home)}</div><div class="pts">${pr.ph.toFixed(1)}</div></div>
      </div>
      <div class="probbar">
        <div class="a" style="width:${(pA * 100).toFixed(1)}%">${state.away} ${(pA * 100).toFixed(0)}%</div>
        <div class="h" style="width:${(pr.pHome * 100).toFixed(1)}%">${state.home} ${(pr.pHome * 100).toFixed(0)}%</div>
      </div>
      <div class="kpis">
        <div class="kpi"><div class="lb">예상 총점</div><div class="vl">${pr.total.toFixed(1)}</div><div class="sub">±${S.sdTotal} (표준편차)</div></div>
        <div class="kpi"><div class="lb">예상 점수차</div><div class="vl">${esc(favTeam)} ${Math.abs(pr.margin).toFixed(1)}</div><div class="sub">홈 핸디 환산 ${signed(-pr.margin)}</div></div>
        <div class="kpi"><div class="lb">승리 확률</div><div class="vl">${esc(favTeam)} ${(Math.max(pr.pHome, pA) * 100).toFixed(1)}%</div><div class="sub">공정 배당 ${(1 / Math.max(pr.pHome, pA)).toFixed(2)}</div></div>
        <div class="kpi"><div class="lb">예상 페이스</div><div class="vl">${pr.pace.toFixed(1)}</div><div class="sub">48분당 포제션 (리그 ${pr.L.pace.toFixed(1)})</div></div>
      </div>
      ${market}
      <details class="breakdown"><summary>계산 근거 보기</summary>
        <table>
          <tr><th>항목 (경기당 점수 환산)</th><th>${esc(state.away)}</th><th>${esc(state.home)}</th></tr>
          ${row('기본 공격력 (리그 대비)', toPts(pr.A.baseOff), toPts(pr.H.baseOff))}
          ${row('기본 수비력 (리그 대비, +가 좋음)', toPts(pr.A.baseDef), toPts(pr.H.baseDef))}
          ${row('결장자로 인한 공격 변화', toPts(pr.A.dOff), toPts(pr.H.dOff))}
          ${row('결장자로 인한 수비 변화', toPts(pr.A.dDef), toPts(pr.H.dDef))}
          ${row('팀 페이스', pr.A.pace.toFixed(1), pr.H.pace.toFixed(1))}
          ${row('이번 시즌 실제 성적 반영 비율', (pr.A.wa * 100).toFixed(0) + '% (' + pr.A.g + '경기)', (pr.H.wa * 100).toFixed(0) + '% (' + pr.H.g + '경기)')}
          ${row('홈 어드밴티지', state.neutral ? '0' : (-pr.hca / 2).toFixed(1), state.neutral ? '0' : '+' + (pr.hca / 2).toFixed(1))}
          ${row('백투백', state.b2bA ? '적용' : '–', state.b2bH ? '적용' : '–')}
          ${row('직접 보정', state.adjA, state.adjH)}
        </table>
        <p>리그 평균 공격 효율 ${pr.L.ortg.toFixed(1)}점/100포제션 기준. 예상 득점 = (리그 평균 + 우리 공격 − 상대 수비) × 페이스 ÷ 100 + 홈/백투백/보정.</p>
      </details>`;
    if (!pr.valid || state.home === state.away) $('#result').innerHTML = '<p class=quality-warning>예측 보류: 서로 다른 팀을 선택하고 양 팀 출전시간을 각각 240분으로 맞춰 주세요.</p>';
    renderCalc(pr);
    renderRoster('away', state.away, pr.A, pr);
    renderRoster('home', state.home, pr.H, pr);
  }

  // ---------- 배당 계산기 ----------
  const num = id => { const v = parseFloat($('#' + id).value); return isNaN(v) ? null : v; };
  function betRows(items) {
    // items: [{pick, p, odds}]
    const rule = $('#settlement').value;
    let h = '<div class="bet"><span class="h">선택</span><span class="h">원래 → 적용 확률</span><span class="h">모델 공정 배당</span><span class="h">모델 기대값</span>';
    items.forEach(x => {
      const equal = x.equal || 0;
      const unresolved = equal > 0 && rule === 'unknown';
      const refund = rule === 'refund' ? equal : 0;
      const validOdds = Number.isFinite(x.odds) && x.odds > 1;
      const fair = unresolved ? '정산 선택' : x.p > 0 ? ((1-refund)/x.p).toFixed(2) : '–';
      const value = F.expectedValue({above:x.p,equal}, x.odds, rule);
      const ev = unresolved ? '정산 선택' : validOdds && value !== null ? signed(value*100) + '%' : '배당 > 1 입력';
      h += `<span>${esc(x.pick)}</span><span>${x.rawP == null ? "" : pct(x.rawP)+"% → "}${pct(x.p)}%</span><span>${fair}</span><span>${ev}</span>`;
    });
    h += '</div>';
    if (items[0].equal > 0) h += `<p class="muted">기준점과 같을 확률 ${pct(items[0].equal)}%. 동점 정산 규칙을 선택해야 배당·기대값을 계산합니다.</p>`;
    return h;
  }

  function renderCalc(pr) {
    if (!pr) return;
    refreshCalibration();
    renderScenarios();
    renderCalibration();
    if (!pr.valid || state.home === state.away) { ['outML','outHC','outOU','lineTables'].forEach(id => $('#' + id).innerHTML = '출전시간 또는 팀 선택을 확인하세요.'); return; }
    const pH = pr.pHome, pA = 1 - pH;
    $('#outML').innerHTML = betRows([{ pick: state.away + ' 승', p: pA, odds: num('oddAway') }, { pick: state.home + ' 승', p: pH, odds: num('oddHome') }]);
    const hc = num('hcLine');
    if (hc != null) {
      const rawHp = marketProb(pr.margin, S.sdMargin, -hc);
      const hp = adjustedProbability(pr, "margin", -hc), pc = hp.above;
      $('#outHC').innerHTML = betRows([{ pick: `${state.home} ${signed(hc)} 핸디 승`, p: pc, rawP: rawHp.above, equal: hp.equal, odds: num('oddHcH') }, { pick: `${state.away} ${signed(-hc)} (핸디 패)`, p: hp.below, rawP: rawHp.below, equal: hp.equal, odds: num('oddHcA') }]);
    } else $('#outHC').innerHTML = '<div class="muted">홈 핸디 기준점을 입력하세요.</div>';
    const ou = num('ouLine');
    if (ou != null) {
      const rawOp = marketProb(pr.total, S.sdTotal, ou);
      const op = adjustedProbability(pr, "total", ou), po = op.above;
      $('#outOU').innerHTML = betRows([{ pick: `오버 ${ou}`, p: po, rawP: rawOp.above, equal: op.equal, odds: num('oddOver') }, { pick: `언더 ${ou}`, p: op.below, rawP: rawOp.below, equal: op.equal, odds: num('oddUnder') }]);
    } else $('#outOU').innerHTML = '<div class="muted">기준점을 입력하세요.</div>';

    // 기준점별 확률표
    let hcRows = '';
    for (let i = -6; i <= 6; i++) {
      const L = Math.floor(-pr.margin) + 0.5 + i * 1;
      const p = adjustedProbability(pr, "margin", -L).above;
      hcRows += `<tr class="${Math.abs(L + pr.margin) < 0.76 ? 'near' : ''}"><td>${esc(state.home)} ${signed(L)}</td><td>${(p * 100).toFixed(1)}%</td><td>${(1 / p).toFixed(2)}</td><td>${((1 - p) * 100).toFixed(1)}%</td><td>${(1 / (1 - p)).toFixed(2)}</td></tr>`;
    }
    let ouRows = '';
    for (let i = -6; i <= 6; i++) {
      const L = Math.floor(pr.total) + 0.5 + i * 2;
      const p = adjustedProbability(pr, "total", L).above;
      ouRows += `<tr class="${Math.abs(L - pr.total) < 1.01 ? 'near' : ''}"><td>${L.toFixed(1)}</td><td>${(p * 100).toFixed(1)}%</td><td>${(1 / p).toFixed(2)}</td><td>${((1 - p) * 100).toFixed(1)}%</td><td>${(1 / (1 - p)).toFixed(2)}</td></tr>`;
    }
    $('#lineTables').innerHTML = `
      <div><h4>핸디캡 기준점별 확률 <small>(홈 기준)</small></h4><table class="mini"><tr><th>기준점</th><th>핸디 승</th><th>공정배당</th><th>핸디 패</th><th>공정배당</th></tr>${hcRows}</table></div>
      <div><h4>언더오버 기준점별 확률</h4><table class="mini"><tr><th>기준점</th><th>오버</th><th>공정배당</th><th>언더</th><th>공정배당</th></tr>${ouRows}</table></div>`;
  }

  // Normal approximation to integer scores: equality occupies a one-point bin.
  function marketProb(mean, sd, threshold) { return F.probabilities(mean, sd, threshold); }
  function scenarioPrediction(out, minutes, options = state) {
    return predict(state.home, state.away, {neutral: options.neutral, b2bH: options.b2bH,
      b2bA: options.b2bA, adjH: options.adjH, adjA: options.adjA, minutes,
      outFn: p => Object.hasOwn(out, p.eid) ? out[p.eid] : defaultOut(p)});
  }
  function renderScenarios() {
    const base = scenarioPrediction({}, {});
    const entries = [
      {name: '원본 부상정보 · 자동 시간', prediction: base},
      {name: '현재 조정', prediction: scenarioPrediction(overrides, minuteOverrides)},
      ...scenarios.map(x => ({name: x.name, prediction: scenarioPrediction(x.out, x.minutes, x.options)}))
    ];
    const hc = num('hcLine'), ou = num('ouLine');
    $('#scenarioRows').innerHTML = entries.map((x, i) => {
      const p = x.prediction;
      const action = i > 1 ? `<button class="ghost small" data-remove="${i-2}">삭제</button>` : '';
      if (!p.valid || state.home === state.away) return `<tr><td>${esc(x.name)} ${action}</td><td colspan="7">240분 배분 / 팀 선택 확인 필요</td></tr>`;
      const hp = hc === null ? null : adjustedProbability(p, "margin", -hc);
      const op = ou === null ? null : adjustedProbability(p, "total", ou);
      const probability = v => v ? `${pct(v.above)}% / ${pct(v.below)}% / ${pct(v.equal)}%` : '기준점 입력';
      return `<tr><td>${esc(x.name)} ${action}</td><td>${p.pa.toFixed(1)} : ${p.ph.toFixed(1)}</td>
        <td>${signed(p.margin)}<br><small>변화 ${base.valid ? signed(p.margin-base.margin) : '–'}</small></td>
        <td>${p.total.toFixed(1)}<br><small>변화 ${base.valid ? signed(p.total-base.total) : '–'}</small></td>
        <td>${hc === null ? '–' : signed(p.margin+hc)}</td><td>${ou === null ? '–' : signed(p.total-ou)}</td>
        <td>${probability(hp)}</td><td>${probability(op)}</td></tr>`;
    }).join('');
    $('#scenarioNote').textContent = '현재 입력한 기준점과 모델 설정으로 비교합니다. 저장한 시나리오는 결장·출전시간·홈/백투백·직접 보정을 보존합니다. 확률 순서: 홈 핸디 승/패/동점, 오버/언더/동점. 점수는 원모델 추정, 확률은 보정 상태에 표시된 설정입니다.';
  }
  $('#saveScenario').addEventListener('click', () => {
    if (!lastPred || !lastPred.valid || state.home === state.away) return;
    if (scenarios.length >= 3) { $('#scenarioNote').textContent = '최대 3개입니다. 기존 시나리오를 삭제한 뒤 저장하세요.'; return; }
    const name = $('#scenarioName').value.trim() || `시나리오 ${scenarios.length + 1}`;
    scenarios.push({name, out: {...overrides}, minutes: {...minuteOverrides}, options: {...state}});
    saveMatchup(); renderScenarios();
  });
  $('#scenarioRows').addEventListener('click', e => {
    const button = e.target.closest('[data-remove]'); if (!button) return;
    scenarios.splice(Number(button.dataset.remove), 1); saveMatchup(); renderScenarios();
  });
  $('#settlement').addEventListener('change', () => renderCalc(lastPred));
  function renderQuality() {
    const missing = D.players.filter(p => !p.cur && !p.prev);
    const noCurrent = D.players.filter(p => !p.cur).length;
    const seen = new Set(), duplicates = [];
    D.players.forEach(p => { if (p.bref && seen.has(p.bref)) duplicates.push(p.name); seen.add(p.bref); });
    const timezoneKnown = /(?:Z|[+-]\d{2}:\d{2})$/.test(D.updated);
    const age = timezoneKnown ? (Date.now() - Date.parse(D.updated))/3600000 : null;
    $('#dataQuality').innerHTML = `<h3>데이터 상태</h3><p>자료 시각: ${esc(D.updated)} ${timezoneKnown ? '(시간대 포함)' : '— 시간대 미기록: 최신 여부 확인 필요'}${age !== null && age > 6 ? ' · 6시간 이상 지난 자료' : ''}</p>
      <p>${Object.keys(D.teams).length}개 팀 · ${D.players.length}명 · 이번 시즌 기록 없음 ${noCurrent}명 · 두 시즌 모두 없음 ${missing.length}명 · 중복 통계 ID ${duplicates.length}건</p>
      <details><summary>통계 없는 선수 / 확인 사항</summary><p>${missing.map(p => esc(p.name)+' ('+esc(p.team)+')').join(', ')}</p>
      <p>미출전·신인·수집 실패를 아직 자동 구분하지 않습니다. 부상 보고 시각은 선수 상태에 마우스를 올리면 확인할 수 있습니다. 자료 시각과 부상 보고 시각은 서로 다릅니다.</p></details>
      <p class="muted">실력은 작년 중심, 예상 출전시간은 현재 시즌 역할 중심입니다. 확률의 보정 여부는 분석 패널에서 확인하세요. 총점·점수차 변화와 데이터 상태를 함께 확인하세요.</p>`;
  }

  // ---------- 로스터 / 부상자 선택 ----------
  function statusChip(p) {
    const inj = p.injury;
    const man = p.eid in overrides && overrides[p.eid] !== defaultOut(p);
    let h = '';
    if (inj) {
      const tip = [inj.date ? '부상 보고 ' + inj.date : '보고 시각 없음', inj.type, inj.returnDate ? '복귀 예상 ' + inj.returnDate : '', inj.comment].filter(Boolean).join(' · ');
      h += `<span class="chip ${inj.status === 'Out' ? 'out' : 'dtd'}" title="${esc(tip)}">${inj.status === 'Out' ? '결장' : '불투명'}${inj.type ? ' · ' + esc(inj.type) : ''}</span>`;
    }
    if (man) h += ` <span class="chip man">직접 ${overrides[p.eid] ? '제외' : '포함'}</span>`;
    return h;
  }
  function renderRoster(side, team, M, pr) {
    const el = $(side === 'home' ? '#rosterHome' : '#rosterAway');
    const h = M.healthy, cur = M.rot;
    const finalBy = new Map(cur.list.map(x => [x.p.eid, x.final]));
    const healthyBy = new Map(h.list.map(x => [x.p.eid, x.final]));
    const ppace = pr.pace / 100;
    const rows = (byTeam[team] || []).slice().sort((a, b) => (healthyBy.get(b.eid) || 0) - (healthyBy.get(a.eid) || 0) || ((b.prev || b.cur || {}).pts || 0) - ((a.prev || a.cur || {}).pts || 0));
    // 결장자 손실 요약
    const outs = rows.filter(isOut);
    let lostPts = 0, lostReb = 0, lostAst = 0, lostMin = 0;
    outs.forEach(p => { const s = stats(p, 'blend') || {}; lostPts += s.pts || 0; lostReb += s.trb || 0; lostAst += s.ast || 0; lostMin += healthyBy.get(p.eid) || 0; });
    const teamPtsEffect = (M.dOff) * ppace, oppPtsEffect = -(M.dDef) * ppace;

    let body = '';
    rows.forEach(p => {
      const s = stats(p, 'blend') || {};
      const out = isOut(p);
      const hm = healthyBy.get(p.eid) || 0, fm = finalBy.get(p.eid) || 0;
      let impact = '';
      if (hm > 2) {
        const solo = rotation(team, x => x.eid === p.eid);
        const d = ((solo.off - h.off) + (solo.def - h.def)) * ppace;
        impact = `<span class="imp ${d < -0.05 ? 'diff-neg' : d > 0.05 ? 'diff-pos' : ''}">${signed(d)}</span>`;
      }
      const minCell = out ? `${hm.toFixed(0)} → 0` : (fm - hm > 0.5 ? `${hm.toFixed(0)} → <span class="mins-up">${fm.toFixed(0)}</span>` : fm.toFixed(0));
      body += `<tr class="${out ? 'out' : ''}">
        <td class="t keep"><input type="checkbox" data-eid="${esc(p.eid)}" ${out ? 'checked' : ''} title="결장 처리"></td>
        <td class="t sticky">${esc(p.name)} <small>${esc(p.pos)}</small></td>
        <td class="t keep">${statusChip(p)}<br><small>평가 혼합: 이번 ${(F.currentWeight(p.cur,p.prev)*100).toFixed(0)}% / 작년 ${((1-F.currentWeight(p.cur,p.prev))*100).toFixed(0)}%${!p.prev ? " · 작년 자료 없음, 역할 평균 보완" : ""}</small>${!p.cur && !p.prev ? '<span class=chip>통계 없음 · 추정</span>' : !p.cur ? '<span class=chip>지난 시즌만</span>' : ''}</td>
        <td>${minCell}<br><input class=minutes type=number min=0 max=40 step=0.5 data-minutes="${esc(p.eid)}" aria-label="${esc(p.name)} 예상 출전시간" placeholder="자동" value="${minuteOverrides[p.eid] ?? ''}" ${out ? 'disabled' : ''}></td>
        <td>${fmt(s.pts)}</td><td>${fmt(s.trb)}</td><td>${fmt(s.ast)}</td><td>${fmt(s.stl)}</td><td>${fmt(s.blk)}</td>
        <td>${pct(s.fg_pct)}</td><td>${pct(s.fg3_pct)}</td><td>${fmt(s.bpm)}</td>
        <td class="keep">${impact}</td></tr>`;
    });
    el.innerHTML = `
      <h3><span>${side === 'home' ? '홈' : '원정'} · ${esc(tName(team))}</span><small>체크 = 결장 처리 · 통계는 시즌 평균 혼합 · 출전시간은 현재 역할 별도 추정</small></h3>
      <p class="rotation-total">출전 합계 ${cur.totalMinutes.toFixed(1)} / 240분 ${cur.valid ? "✓" : "— 시간 조정 필요"} · 입력한 분은 고정, 빈칸은 자동 배분 (최대 40분). 통계 없는 선수도 직접 시간을 지정할 수 있습니다.</p><div class="lost">${outs.length ? `결장 <b>${outs.length}명</b>: ${outs.map(p => esc(p.name)).join(', ')}<br>
        빠지는 기록 합계 <b>${lostPts.toFixed(1)}점 · ${lostReb.toFixed(1)}리바 · ${lostAst.toFixed(1)}어시</b> (출전 ${lostMin.toFixed(0)}분)
        → 다른 선수가 메운 뒤 예상 영향: 팀 득점 <b class="${teamPtsEffect < 0 ? 'diff-neg' : ''}">${signed(teamPtsEffect)}</b>, 상대 득점 <b class="${oppPtsEffect > 0 ? 'diff-neg' : ''}">${signed(oppPtsEffect)}</b>` : '결장자 없음 (체크박스로 지정하세요)'}</div>
      <div class="table-wrap"><table class="grid">
        <thead><tr><th class="t">결장</th><th class="t sticky">선수</th><th class="t">상태</th><th title="부상 반영 전 → 후 예상 출전 시간">출전(분)</th>
        <th>득점</th><th>리바</th><th>어시</th><th>스틸</th><th>블록</th><th>야투%</th><th>3점%</th><th>BPM</th>
        <th title="이 선수 혼자 빠질 때 팀 점수차 변화(경기당)">결장 영향</th></tr></thead>
        <tbody>${body}</tbody></table></div>`;
  }
  ['#rosterHome', '#rosterAway'].forEach(sel => $(sel).addEventListener('change', e => {
    const input = e.target.closest('[data-minutes]');
    if (input) {
      if (input.value === '') delete minuteOverrides[input.dataset.minutes];
      else if (input.checkValidity()) minuteOverrides[input.dataset.minutes] = Number(input.value);
      else { input.reportValidity(); return; }
      saveMatchup(); renderPredict(); return;
    }
    const cb = e.target.closest('input[type=checkbox][data-eid]'); if (!cb) return;
    const p = D.players.find(x => x.eid === cb.dataset.eid);
    if (cb.checked === defaultOut(p)) delete overrides[p.eid]; else overrides[p.eid] = cb.checked;
    saveMatchup();
    renderGames(); renderPredict();
  }));

  // ---------- 선수 통계 표 ----------
  const COLS = [
    { k: 'rk', t: '#', nosort: 1 },
    { k: 'name', t: '선수', text: 1, sticky: 1 },
    { k: 'team', t: '팀', text: 1 },
    { k: 'pos', t: '포지션', text: 1 },
    { k: 'status', t: '상태', text: 1 },
    { k: 'g', t: '경기', d: 0 },
    { k: 'gPrev', t: '지난시즌 경기', d: 0, only: 'blend' },
    { k: 'mpg', t: '출전(분)', d: 1 },
    { k: 'pts', t: '득점', d: 1, heat: 1 },
    { k: 'trb', t: '리바운드', d: 1, heat: 1 },
    { k: 'orb', t: '공격리바', d: 1 },
    { k: 'drb', t: '수비리바', d: 1 },
    { k: 'ast', t: '어시스트', d: 1, heat: 1 },
    { k: 'stl', t: '스틸', d: 1, heat: 1 },
    { k: 'blk', t: '블록', d: 1, heat: 1 },
    { k: 'tov', t: '턴오버', d: 1, heat: -1 },
    { k: 'fg', t: '야투성공', d: 1 },
    { k: 'fga', t: '야투시도', d: 1 },
    { k: 'fg_pct', t: '야투율', pct: 1, heat: 1, minAtt: ['fga', 4] },
    { k: 'fg3', t: '3점성공', d: 1 },
    { k: 'fg3a', t: '3점시도', d: 1 },
    { k: 'fg3_pct', t: '3점슛%', pct: 1, heat: 1, minAtt: ['fg3a', 2] },
    { k: 'ft', t: '자유투성공', d: 1 },
    { k: 'fta', t: '자유투시도', d: 1 },
    { k: 'ft_pct', t: '자유투%', pct: 1, heat: 1, minAtt: ['fta', 1.5] },
    { k: 'efg_pct', t: 'eFG%', pct: 1 },
    { k: 'ts_pct', t: 'TS%', pct: 1, heat: 1, minAtt: ['fga', 4] },
    { k: 'usg_pct', t: 'USG%', d: 1 },
    { k: 'per', t: 'PER', d: 1 },
    { k: 'obpm', t: 'OBPM', d: 1 },
    { k: 'dbpm', t: 'DBPM', d: 1 },
    { k: 'bpm', t: 'BPM', d: 1, heat: 1 },
    { k: 'pmin', t: '예상 출전', d: 1, title: '모델이 쓰는 다음 경기 예상 출전 시간(부상 반영 전)' },
  ];
  const modeSel = $('#pMode');
  modeSel.innerHTML = `<option value="blend">혼합 (${esc(LBL[CUR])} + ${esc(LBL[PREV])}, 모델 기준)</option><option value="cur">${esc(LBL[CUR])} (이번 시즌)</option><option value="prev">${esc(LBL[PREV])} (지난 시즌)</option>`;
  $('#pTeam').innerHTML += TEAMS.map(t => `<option value="${t}">${esc(tName(t))} (${t})</option>`).join('');
  const statusText = p => isOut(p) ? '결장' : (p.injury ? '불투명' : '');

  function playerRows() {
    const mode = $('#pMode').value, team = $('#pTeam').value, q = $('#pSearch').value.trim().toLowerCase();
    const minG = parseFloat($('#pMinG').value) || 0, injOnly = $('#pInjOnly').checked;
    const rows = [];
    D.players.forEach(p => {
      if (team && p.team !== team) return;
      if (q && !p.name.toLowerCase().includes(q)) return;
      if (injOnly && !p.injury && !isOut(p)) return;
      const s = stats(p, mode);
      const g = s ? (mode === 'blend' ? (s.g || 0) + (s.gPrev || 0) : s.g || 0) : 0;
      if (g < minG) return;
      rows.push(Object.assign({}, s || {}, { _p: p, name: p.name, team: p.team, pos: p.pos, status: statusText(p), pmin: projMin(p) }));
    });
    const { k, dir } = state.pSort;
    const col = COLS.find(c => c.k === k) || {};
    rows.sort((a, b) => {
      const va = a[k], vb = b[k];
      if (col.text) return dir * String(va || '').localeCompare(String(vb || ''), 'ko');
      if (va == null && vb == null) return 0; if (va == null) return 1; if (vb == null) return -1;
      return dir * (va - vb);
    });
    return { rows, mode };
  }

  function heatStyle(c, v, row, range) {
    if (!c.heat || v == null || !range || range.max === range.min) return '';
    if (c.minAtt && !(row[c.minAtt[0]] >= c.minAtt[1])) return '';
    let t = (v - range.min) / (range.max - range.min);
    t = Math.max(0, Math.min(1, t));
    if (c.heat < 0) return `background-color: rgba(var(--heat-neg), ${(t * 0.4).toFixed(3)})`;
    return `background-color: rgba(var(--heat), ${(t * 0.45).toFixed(3)})`;
  }

  function renderPlayers() {
    const { rows, mode } = playerRows();
    const cols = COLS.filter(c => !c.only || c.only === mode);
    const heatOn = $('#pHeat').checked;
    const ranges = {};
    if (heatOn) cols.filter(c => c.heat).forEach(c => {
      const vals = rows.filter(r => (r.mpg || 0) >= 12 && (!c.minAtt || r[c.minAtt[0]] >= c.minAtt[1])).map(r => r[c.k]).filter(v => v != null).sort((a, b) => a - b);
      if (vals.length > 3) ranges[c.k] = { min: vals[Math.floor(vals.length * 0.05)], max: vals[Math.floor(vals.length * 0.95)] };
    });
    const { k, dir } = state.pSort;
    let h = '<table class="grid"><thead><tr>' + cols.map(c =>
      `<th class="${c.text ? 't' : ''} ${c.sticky ? 'sticky' : ''} ${c.k === k ? 'sorted' : ''}" data-k="${c.k}" ${c.title ? `title="${esc(c.title)}"` : ''}>${esc(c.t)}${c.k === k ? `<span class="arr">${dir < 0 ? '▼' : '▲'}</span>` : ''}</th>`).join('') + '</tr></thead><tbody>';
    const limit = 600;
    rows.slice(0, limit).forEach((r, i) => {
      h += '<tr>' + cols.map(c => {
        if (c.k === 'rk') return `<td class="rk">${i + 1}</td>`;
        if (c.k === 'status') return `<td class="t">${r.status ? `<span class="chip ${r.status === '결장' ? 'out' : 'dtd'}" title="${esc(r._p.injury ? [r._p.injury.type, r._p.injury.comment].filter(Boolean).join(' · ') : '직접 지정')}">${r.status}</span>` : ''}</td>`;
        if (c.k === 'team') return `<td class="t"><a class="tlink" data-team="${esc(r.team)}">${esc(r.team)}</a></td>`;
        if (c.text) return `<td class="t ${c.sticky ? 'sticky' : ''}">${esc(r[c.k])}</td>`;
        const v = r[c.k];
        return `<td style="${heatOn ? heatStyle(c, v, r, ranges[c.k]) : ''}">${c.pct ? pct(v) : fmt(v, c.d)}</td>`;
      }).join('') + '</tr>';
    });
    h += '</tbody></table>';
    $('#pTableWrap').innerHTML = h;
    $('#pCount').textContent = `${rows.length}명` + (rows.length > limit ? ` (상위 ${limit}명 표시)` : '');
  }
  ['pMode', 'pTeam', 'pMinG', 'pInjOnly', 'pHeat'].forEach(id => $('#' + id).addEventListener('change', renderPlayers));
  $('#pSearch').addEventListener('input', renderPlayers);
  $('#pTableWrap').addEventListener('click', e => {
    const a = e.target.closest('a.tlink');
    if (a) { $('#pTeam').value = a.dataset.team; renderPlayers(); return; }
    const th = e.target.closest('th[data-k]'); if (!th || th.dataset.k === 'rk') return;
    const k = th.dataset.k, c = COLS.find(x => x.k === k);
    state.pSort = { k, dir: state.pSort.k === k ? -state.pSort.dir : (c.text ? 1 : -1) };
    renderPlayers();
  });

  function downloadCSV(name, header, rows) {
    const q = v => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const text = '﻿' + [header, ...rows].map(r => r.map(q).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  $('#pCsv').addEventListener('click', () => {
    const { rows, mode } = playerRows();
    const cols = COLS.filter(c => c.k !== 'rk' && (!c.only || c.only === mode));
    downloadCSV(`선수통계_${mode}_${$('#pTeam').value || '전체'}.csv`, cols.map(c => c.t),
      rows.map(r => cols.map(c => { const v = r[c.k]; if (c.text) return v; if (v == null) return ''; return c.pct ? (v * 100).toFixed(1) : Number(v).toFixed(c.d == null ? 1 : c.d); })));
  });

  // ---------- 팀 통계 표 ----------
  const TCOLS = [
    { k: 'rk', t: '#' }, { k: 'name', t: '팀', text: 1, sticky: 1 }, { k: 'rec', t: LBL[CUR] + ' 전적', text: 1 },
    { k: 'ppg', t: '득점', d: 1 }, { k: 'oppg', t: '실점', d: 1 }, { k: 'ortg', t: '공격 레이팅', d: 1 }, { k: 'drtg', t: '수비 레이팅', d: 1 },
    { k: 'net', t: '넷 레이팅', d: 1 }, { k: 'pace', t: '페이스', d: 1 },
    { k: 'precRec', t: LBL[PREV] + ' 전적', text: 1 }, { k: 'pnet', t: LBL[PREV] + ' 넷', d: 1 },
    { k: 'roster', t: '로스터 레이팅(건강 시)', d: 1, title: '현재 로스터 선수들의 BPM×예상 출전시간 합 (리그 평균 0)' },
    { k: 'outs', t: '결장자', d: 0 },
    { k: 'model', t: '모델 레이팅(부상 반영)', d: 1, title: '중립 경기 기준 100포제션당 기대 점수 마진' },
  ];
  function teamRows() {
    return TEAMS.map(t => {
      const c = teamRow(CUR, t) || {}, p = teamRow(PREV, t) || {};
      const M = teamModel(t, isOut);
      return {
        team: t, name: tName(t), rec: c.wins != null ? `${c.wins}-${c.losses}` : '–', ppg: c.ppg, oppg: c.opp_ppg,
        ortg: c.off_rtg, drtg: c.def_rtg, net: c.net_rtg, pace: c.pace,
        precRec: p.wins != null ? `${p.wins}-${p.losses}` : '–', pnet: p.net_rtg,
        roster: (M.healthy.off - OFF_MEAN) + (M.healthy.def - DEF_MEAN),
        outs: (byTeam[t] || []).filter(isOut).length, model: M.off + M.def,
      };
    });
  }
  function renderTeams() {
    const rows = teamRows();
    const { k, dir } = state.tSort, col = TCOLS.find(c => c.k === k) || {};
    rows.sort((a, b) => col.text ? dir * String(a[k]).localeCompare(String(b[k]), 'ko') : dir * ((a[k] == null ? -999 : a[k]) - (b[k] == null ? -999 : b[k])));
    let h = '<table class="grid"><thead><tr>' + TCOLS.map(c => `<th class="${c.text ? 't' : ''} ${c.sticky ? 'sticky' : ''} ${c.k === k ? 'sorted' : ''}" data-k="${c.k}" ${c.title ? `title="${esc(c.title)}"` : ''}>${esc(c.t)}${c.k === k ? `<span class="arr">${dir < 0 ? '▼' : '▲'}</span>` : ''}</th>`).join('') + '</tr></thead><tbody>';
    rows.forEach((r, i) => {
      h += '<tr>' + TCOLS.map(c => {
        if (c.k === 'rk') return `<td class="rk">${i + 1}</td>`;
        if (c.k === 'name') return `<td class="t sticky"><a class="tlink" data-team="${r.team}">${esc(r.name)}</a> <small>${r.team}</small></td>`;
        if (c.text) return `<td class="t">${esc(r[c.k])}</td>`;
        const v = r[c.k];
        const cls = (c.k === 'net' || c.k === 'pnet' || c.k === 'model' || c.k === 'roster') && v != null ? (v > 0 ? 'diff-pos' : 'diff-neg') : '';
        return `<td class="${cls}">${(c.k === 'net' || c.k === 'pnet' || c.k === 'model' || c.k === 'roster') ? signed(v, c.d) : fmt(v, c.d)}</td>`;
      }).join('') + '</tr>';
    });
    $('#tTableWrap').innerHTML = h + '</tbody></table>';
  }
  $('#tTableWrap').addEventListener('click', e => {
    const a = e.target.closest('a.tlink');
    if (a) { $('#pTeam').value = a.dataset.team; showTab('players'); return; }
    const th = e.target.closest('th[data-k]'); if (!th || th.dataset.k === 'rk') return;
    const k = th.dataset.k, c = TCOLS.find(x => x.k === k);
    state.tSort = { k, dir: state.tSort.k === k ? -state.tSort.dir : (c.text ? 1 : -1) };
    renderTeams();
  });
  $('#tCsv').addEventListener('click', () => {
    const rows = teamRows().sort((a, b) => b.model - a.model);
    const cols = TCOLS.filter(c => c.k !== 'rk');
    downloadCSV('팀통계.csv', cols.map(c => c.t), rows.map(r => cols.map(c => { const v = r[c.k]; return c.text ? v : (v == null ? '' : Number(v).toFixed(c.d)); })));
  });

  // ---------- 설정 / 설명 ----------
  function renderSettings() {
    let h = SETTINGS_META.map(([k, lb, step, tip]) => `<label>${esc(lb)} <input type="number" data-s="${k}" step="${step}" value="${S[k]}"><small>${esc(tip)}</small></label>`).join('');
    h += `<label class="chk" style="display:flex"><input type="checkbox" data-s="dtdOut" ${S.dtdOut ? 'checked' : ''}> '출전 불투명(Day-To-Day)' 선수도 기본으로 결장 처리</label>`;
    $('#settingsForm').innerHTML = h;
  }
  $('#settingsForm').addEventListener('change', e => {
    const el = e.target.closest('[data-s]'); if (!el) return;
    const k = el.dataset.s;
    if (el.type === 'checkbox') S[k] = el.checked;
    else { const v = Number(el.value); const valid = Number.isFinite(v) && (['sdMargin','sdTotal','teamK'].includes(k) ? v > 0 : v >= 0) && (k !== 'rosterW' || v <= 1); if (!valid) { renderSettings(); return; } S[k] = v; }
    save('settings', S); recenter(); renderAll();
  });
  $('#resetSettings').addEventListener('click', () => { S = Object.assign({}, DEFAULTS); save('settings', S); renderSettings(); recenter(); renderAll(); });

  $('#helpText').innerHTML = `
    <h2>이 프로그램이 예측하는 방법</h2>
    <p>각 팀의 <b>공격력·수비력</b>을 "리그 평균 대비 100포제션당 몇 점 더/덜"로 계산하고, 두 팀의 <b>페이스(경기 속도)</b>로 실제 점수로 바꿉니다.</p>
    <h3>1. 팀 기본 전력</h3>
    <ul>
      <li><b>이번 시즌 실제 성적</b> (공격/수비 레이팅): 경기를 많이 치를수록 비중이 커집니다. 기본값은 ${S.teamK}경기를 치르면 50%.</li>
      <li><b>시즌 전 기준값</b> = 현재 로스터 선수들의 능력(BPM × 예상 출전시간) ${Math.round(S.rosterW * 100)}% + 지난 시즌 팀 성적 ${Math.round((1 - S.rosterW) * 100)}%. 비시즌 이적이 반영됩니다.</li>
    </ul>
    <h3>2. 부상자 반영</h3>
    <ul>
      <li>결장 체크된 선수의 예상 출전 시간(분)을 빼고, 남은 선수들에게 240분을 비례해서 다시 나눠 줍니다 (1인 최대 40분).</li>
      <li>각 선수의 <b>OBPM/DBPM</b>(100포제션당 공격·수비 기여도)에 바뀐 출전 시간을 곱해 팀 전력을 다시 계산합니다. 그래서 주전이 빠지면 벤치 선수가 시간을 더 받는 효과까지 들어갑니다.</li>
      <li>단순히 "그 선수 평균 득점만큼 빠진다"가 아니라, 대체 선수가 일부를 메운 뒤의 순수 손실을 계산합니다. 로스터 표의 <b>결장 영향</b> 열이 그 선수 혼자 빠질 때의 점수차 변화입니다.</li>
      <li>ESPN 부상자 명단에서 '결장(Out)'인 선수는 자동으로 체크됩니다. 체크박스로 직접 바꿀 수 있고, 바꾼 내용은 이 브라우저에 저장됩니다.</li>
      <li>실력 평가는 20경기·평균 15분 전에는 작년 중심입니다 (이번 시즌 최대 15%, 150분 미만이면 더 낮게). 두 조건 또는 누적 600분 이후에는 비중을 점진적으로 늘립니다. BPM 표본이 적으면 작년 기록이 충분한 같은 포지션 선수들의 평균으로 보완합니다.</li>
    </ul>
    <h3>3. 점수와 확률</h3>
    <ul>
      <li>예상 득점 = (리그 평균 효율 + 우리 공격 − 상대 수비) × 예상 페이스 ÷ 100, 여기에 홈 어드밴티지(${S.hca}점)와 백투백(${S.b2b}점), 직접 보정을 더합니다.</li>
      <li>승리 확률은 실제 점수차가 예상에서 표준편차 ${S.sdMargin}점 정도로 흔들린다고 보고 계산합니다 (정규분포). 언더오버는 총점 표준편차 ${S.sdTotal}점을 씁니다.</li>
      <li><b>기대값</b> = 모델 확률 × 배당 − 1. +5%면 1만 원당 평균 500원 이득이라는 뜻이지만, 정수 기준점은 동점 확률과 선택한 정산 규칙을 추가로 반영합니다. 원모델 확률은 검증 전 추정입니다. 동일 모델·설정의 경기 전 기록으로 학습 100경기와 후속 검증 30경기 이상을 확보하고, 오차·분포·확률 검증을 통과한 항목만 보정을 적용합니다.</li>
    </ul>
    <h3>4. 한계</h3>
    <ul>
      <li>시즌 초반에는 이번 시즌 표본이 적어서 지난 시즌 기록 비중이 큽니다.</li>
      <li>코칭, 동기 부여, 경기 당일 컨디션, 출전 제한은 로스터의 예상 출전시간으로 지정하세요. 포지션별 대체와 라인업 효과는 자동으로 판단하지 못합니다.</li>
      <li>이름 표기가 달라 통계가 연결되지 않은 선수(주로 신인)는 자동 출전시간은 0입니다. 직접 시간을 입력하면 포지션별 사전 평가값으로 계산됩니다.</li>
      <li>해외 시장 라인과 큰 차이가 나면 모델이 모르는 정보(부상 소식 등)가 있을 가능성도 생각하세요.</li>
    </ul>
    <h3>데이터 업데이트</h3>
    <p>폴더 안의 <code>시작하기.command</code>를 더블클릭하거나 터미널에서 <code>python3 update_data.py</code>를 실행하면 최신 통계·부상자·일정을 받아옵니다. 경기 전날·당일에 한 번씩 업데이트하는 걸 추천해요.</p>`;

  // Immutable pregame snapshots; result entry is separate from the prediction.
  const loadedHistory = load('forecast_history_v2', []);
  let history = Array.isArray(loadedHistory) ? loadedHistory.filter(F.validRecord) : [];
  let calibrationSnapshot = null;
  function modelSignature() {
    return F.VERSION + '/' + CUR + '/' + JSON.stringify(Object.fromEntries(Object.keys(DEFAULTS).sort().filter(k=>k!=='dtdOut').map(k=>[k,S[k]])));
  }
  function refreshCalibration() {
    const game = games.find(g=>g.id===state.gameId);
    const cutoff = Math.min(Date.now(), game ? Date.parse(game.date) : Infinity);
    const signature = modelSignature();
    calibrationSnapshot = {margin:F.calibrate(history,signature,'margin',cutoff), total:F.calibrate(history,signature,'total',cutoff)};
  }
  function adjustedProbability(pr, kind, threshold) {
    const c = calibrationSnapshot?.[kind];
    return F.probabilities(pr[kind] + (c?.bias || 0), c?.sd || S[kind==='margin'?'sdMargin':'sdTotal'], threshold);
  }
  function calibrationText(kind, c) {
    const title = kind === 'margin' ? '핸디캡' : '언더오버';
    let status = c.applied ? '별도 검증 통과 · 경험적 오차 보정 적용' : c.reason === 'waiting' ? '표본 부족 · 보정 전' : c.reason === 'chronology' ? '시간 순서상 학습 자료 부족 · 보정 전' : '검증 개선 조건 미충족 · 보정 전';
    let detail = `${c.n}경기 (동일 모델·설정, 경기당 1건)`;
    if (c.before) detail += ` · 학습 ${c.trainN} / 후속 검증 ${c.holdN} · 검증 MAE ${c.before.mae.toFixed(2)} → ${c.after.mae.toFixed(2)}점 · 확률 검증 ${c.after.lineCount}건 · Brier ${c.before.brier == null ? '–' : c.before.brier.toFixed(3)} → ${c.after.brier == null ? '–' : c.after.brier.toFixed(3)}`;
    if (c.applied) detail += ` · 평균 보정 ${signed(c.bias)}점 / 오차 표준편차 ${c.sd.toFixed(1)}점`;
    return `<p><b>${title}: ${status}</b><br><small>${detail}</small></p>`;
  }
  function renderCalibration() {
    $('#calibrationStatus').innerHTML = ['margin','total'].map(k=>calibrationText(k,calibrationSnapshot[k])).join('') +
      '<p class="muted">학습 100경기 + 이후 검증 30경기 이상에서 분포 오차·평균 절대오차·기준점 확률을 비교합니다. 보정 전에는 기존 변동폭을 유지하며 임의로 확률을 낮추지 않습니다. 점수 표시와 승패 확률은 원모델입니다.</p>';
  }
  function persistHistory(next) {
    try {
      localStorage.setItem('nbatoto_forecast_history_v2', JSON.stringify(next));
      history = next;
      return true;
    } catch (_) {
      $('#recordMessage').textContent = '브라우저 저장 실패. 기록을 백업하고 저장 공간/권한을 확인하세요.';
      $('#historyMessage').textContent = '저장 실패: 변경 내용을 보관하지 못했습니다.';
      return false;
    }
  }
  $('#recordPrediction').addEventListener('click', () => {
    const message = $('#recordMessage'), game = games.find(g=>g.id===state.gameId);
    const now = new Date();
    if (!game || game.state !== 'pre' || !(Date.parse(game.date) > now.getTime())) {
      message.textContent = '시작 전 일정에서 경기를 선택해야 기록할 수 있습니다. 지난 경기를 소급 저장하지 않습니다.'; return;
    }
    if (!lastPred?.valid || state.home === state.away) { message.textContent='출전시간·팀 선택을 먼저 확인하세요.'; return; }
    if (history.some(r=>r.gameId===game.id)) { message.textContent='이미 기록한 경기입니다. 최초 예측을 유지합니다.'; return; }
    const hc = num('hcLine'), ou = num('ouLine');
    if (hc == null && ou == null) { message.textContent='핸디 또는 총점 기준점을 하나 이상 입력하세요.'; return; }
    if (history.length >= 2000) { message.textContent='기록 한도(2,000경기)에 도달했습니다. 백업 후 저장 공간을 정리하세요.'; return; }
    const snapshot = (teamModel) => ({off:teamModel.off, def:teamModel.def, pace:teamModel.pace,
      rotation:teamModel.rot.list.map(x=>({eid:x.p.eid, name:x.p.name, minutes:x.final, out:!!x.out, ability:modelBPM(x.p), currentWeight:F.currentWeight(x.p.cur,x.p.prev)}))});
    const record = {id:crypto.randomUUID(), gameId:game.id, version:F.VERSION, signature:modelSignature(), savedAt:now.toISOString(), start:game.date,
      home:state.home, away:state.away, dataUpdated:D.updated, settings:{...S}, overrides:{...overrides}, minutes:{...minuteOverrides},
      options:{neutral:state.neutral,b2bH:state.b2bH,b2bA:state.b2bA,adjH:state.adjH,adjA:state.adjA},
      raw:{margin:lastPred.margin,total:lastPred.total,sdMargin:S.sdMargin,sdTotal:S.sdTotal},
      lines:{margin:hc==null?null:-hc,total:ou}, settlement:$('#settlement').value,
      odds:{home:num('oddHcH'),away:num('oddHcA'),over:num('oddOver'),under:num('oddUnder')},
      applied:{margin:hc==null?null:adjustedProbability(lastPred,'margin',-hc),total:ou==null?null:adjustedProbability(lastPred,'total',ou)},
      calibration:JSON.parse(JSON.stringify(calibrationSnapshot)), teams:{home:snapshot(lastPred.H),away:snapshot(lastPred.A)},result:null};
    if (persistHistory([...history,record])) {
      message.textContent='경기 전 예측을 저장했습니다. 예측 기록 · 검증 탭에서 정규시간 결과를 입력하세요.';
      renderHistory();
    }
  });
  function renderHistory() {
    $('#historySummary').innerHTML = `<p>저장 ${history.length}경기 · 결과 입력 ${history.filter(r=>r.result).length}경기. 아래는 최근 100건입니다. 전체 기록은 백업에 포함됩니다. 결과는 사용자가 입력한 정규시간 점수입니다.</p>` +
      ['margin','total'].map(k=>calibrationText(k,F.calibrate(history,modelSignature(),k))).join('');
    $('#historyTable').innerHTML = history.length ? `<table class="grid history-grid"><thead><tr><th>경기 / 기록 시각</th><th>당시 예측·기준점</th><th>당시 적용 확률</th><th>정규시간 결과</th></tr></thead><tbody>${history.slice().sort((a,b)=>Date.parse(b.start)-Date.parse(a.start)).slice(0,100).map(r=>{
      const final = r.result;
      const probs = (kind) => r.applied?.[kind] && Number.isFinite(r.applied[kind].above) ? `${pct(r.applied[kind].above)}% / ${pct(r.applied[kind].below)}% / ${pct(r.applied[kind].equal)}%` : '–';
      return `<tr><td>${esc(r.away)} @ ${esc(r.home)}<br>${esc(kst(r.start))}<br><small>저장 ${esc(kst(r.savedAt))}</small></td>
        <td>홈 점수차 ${signed(r.raw.margin)} / 총점 ${r.raw.total.toFixed(1)}<br>홈 핸디 ${Number.isFinite(r.lines?.margin)?signed(-r.lines.margin):'–'} / O/U ${Number.isFinite(r.lines?.total)?r.lines.total:'–'}</td>
        <td>핸디 승/패/동점 ${probs('margin')}<br>오버/언더/동점 ${probs('total')}</td>
        <td><form data-result-id="${esc(r.id)}"><label>원정 <input name="awayScore" type="number" min="0" max="300" step="1" required value="${final?.away ?? ''}"></label>
          <label>홈 <input name="homeScore" type="number" min="0" max="300" step="1" required value="${final?.home ?? ''}"></label>
          <label class="chk"><input name="regulation" type="checkbox" required> 4쿼터 종료 점수 확인</label><button>${final?'결과 수정':'결과 저장'}</button></form>
          ${final?`<small>원예측 오차: 점수차 ${signed(final.home-final.away-r.raw.margin)} / 총점 ${signed(final.home+final.away-r.raw.total)}점</small>`:''}</td></tr>`;
    }).join('')}</tbody></table>` : '<p>아직 기록이 없습니다. 경기 예측 탭에서 시작 전 예측을 먼저 저장하세요.</p>';
  }
  $('#historyTable').addEventListener('submit', e => {
    e.preventDefault();
    const form=e.target.closest('[data-result-id]'); if(!form || !form.reportValidity()) return;
    const r=history.find(x=>x.id===form.dataset.resultId), now=new Date();
    if(!r || Date.parse(r.start)>=now.getTime()) { $('#historyMessage').textContent='경기 시작 전에는 결과를 입력할 수 없습니다.'; return; }
    const home=Number(form.elements.homeScore.value), away=Number(form.elements.awayScore.value);
    if(![home,away].every(x=>Number.isInteger(x)&&x>=0&&x<=300)) return;
    const next={...r,result:{home,away,basis:'regulation',recordedAt:now.toISOString(),source:'manual'}};
    if (persistHistory(history.map(x=>x.gameId===r.gameId?next:x))) {
      $('#historyMessage').textContent='정규시간 결과를 저장했습니다. 당시 예측은 그대로 보존했습니다.';
      renderHistory(); renderPredict();
    }
  });
  $('#exportHistory').addEventListener('click', () => {
    const blob=new Blob([JSON.stringify({schema:2,records:history},null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob), a=document.createElement('a');
    a.href=url;a.download='nba-predictions-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
  $('#importHistory').addEventListener('change', async e => {
    const file=e.target.files[0];if(!file) return;
    try {
      if(file.size>20*1024*1024) throw new Error('백업 파일은 20MB 이하여야 합니다.');
      const data=JSON.parse(await file.text());
      if(data.schema!==2 || !Array.isArray(data.records) || data.records.length>2000 || !data.records.every(F.validRecord)) throw new Error('지원하지 않거나 유효하지 않은 예측 백업입니다.');
      const merged=[...history], gamesSeen=new Set(history.map(r=>r.gameId)), idsSeen=new Set(history.map(r=>r.id));
      for(const r of data.records){if(!gamesSeen.has(r.gameId)){
        if(idsSeen.has(r.id)) throw new Error('서로 다른 경기에 같은 기록 ID가 있습니다.');
        merged.push(r);gamesSeen.add(r.gameId);idsSeen.add(r.id);
      }}
      if(merged.length>2000) throw new Error('합친 기록이 2,000경기를 초과합니다.');
      if(persistHistory(merged)){ $('#historyMessage').textContent='백업을 합쳤습니다. 중복 경기의 기존 기록은 유지했습니다.';renderHistory();renderPredict(); }
    } catch(err){$('#historyMessage').textContent=err.message;}
    e.target.value='';
  });

  // ---------- 시작 ----------
  function renderAll() {
    renderGames(); renderPredict();
    if (state.tab === 'players') renderPlayers();
    if (state.tab === 'teams') renderTeams();
    if (state.tab === 'history') renderHistory();
  }
  recenter();
  renderQuality();
  renderSettings();
  const now = Date.now();
  const firstGame = games.find(g => g.state !== 'post' && new Date(g.date).getTime() > now - 4 * 3600 * 1000) || games[games.length - 1];
  if (firstGame) selectGame(firstGame);
  else { state.home = TEAMS[0]; state.away = TEAMS[1]; syncPickers(); renderGames(); renderPredict(); }
  showTab(state.tab);
})();
