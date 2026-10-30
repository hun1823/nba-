/* Pure forecasting and chronological validation helpers. No network or storage. */
(function (root) {
  'use strict';
  const VERSION = 'season-prior-v2';
  const finite = Number.isFinite;
  const minutes = s => s ? Math.max(0, finite(s.mp) ? s.mp : (s.g || 0) * (s.mpg || 0)) : 0;
  function currentWeight(c, p) {
    if (!minutes(c)) return 0;
    if (!minutes(p)) return 1;
    // A 600-minute alternative lets bench players eventually gain weight.
    const qualifiedProgress = c.g >= 20 && c.mpg >= 15 ? (c.g - 20) * c.mpg / 600 : 0;
    const progress = Math.max(qualifiedProgress, (minutes(c) - 600) / 600, 0);
    const early = .15 * Math.min(1, minutes(c) / 150);
    return Math.min(.85, early + .70 * (1 - Math.exp(-progress)));
  }
  function ability(c, p, key, prior) {
    const shrink = s => {
      if (!s || !finite(s[key])) return prior;
      const reliability = minutes(s) / (minutes(s) + 250);
      return reliability * s[key] + (1 - reliability) * prior;
    };
    const w = currentWeight(c, p);
    return w * shrink(c) + (1 - w) * shrink(p);
  }
  function roleMinutes(c, p) {
    if (!c || !(c.g > 0) || !finite(c.mpg)) return p && finite(p.mpg) ? p.mpg : 0;
    if (!p || !finite(p.mpg)) return c.mpg;
    const w = c.g / (c.g + 2);
    return c.mpg * w + p.mpg * (1 - w);
  }
  function cdf(z) {
    const t = 1 / (1 + .3275911 * Math.abs(z / Math.SQRT2));
    const x = Math.abs(z / Math.SQRT2);
    const erf = 1 - (((((1.061405429*t-1.453152027)*t)+1.421413741)*t-.284496736)*t+.254829592)*t*Math.exp(-x*x);
    return .5 * (1 + Math.sign(z) * erf);
  }
  function probabilities(mean, sd, threshold) {
    if (![mean, sd, threshold].every(finite) || sd <= 0) return null;
    const integer = Number.isInteger(threshold);
    const lo = integer ? threshold-.5 : Math.floor(threshold)+.5;
    const hi = integer ? threshold+.5 : lo;
    const below = cdf((lo-mean)/sd), above = 1-cdf((hi-mean)/sd);
    return {above, below, equal: Math.max(0, 1-above-below)};
  }
  function expectedValue(prob, odds, rule) {
    if (!prob || !finite(odds) || odds <= 1 || (prob.equal > 1e-10 && rule === 'unknown')) return null;
    return prob.above * odds + (rule === 'refund' ? prob.equal : 0) - 1;
  }
  function validRecord(r) {
    return r && r.version === VERSION && typeof r.id === 'string' && typeof r.signature === 'string'
      && typeof r.gameId === 'string' && typeof r.home === 'string' && typeof r.away === 'string' && r.home !== r.away
      && finite(Date.parse(r.savedAt)) && finite(Date.parse(r.start)) && Date.parse(r.savedAt) < Date.parse(r.start)
      && ['margin','total','sdMargin','sdTotal'].every(k => finite(r.raw?.[k])) && r.raw.sdMargin > 0 && r.raw.sdTotal > 0
      && (r.result == null || (r.result.basis === 'regulation' && ['home','away'].every(k => Number.isInteger(r.result[k]) && r.result[k] >= 0 && r.result[k] <= 300)
        && finite(Date.parse(r.result.recordedAt)) && Date.parse(r.result.recordedAt) > Date.parse(r.start)));
  }
  function eligible(records, signature, cutoff) {
    const seen = new Set();
    return records.filter(r => validRecord(r) && r.signature === signature && r.result
      && Date.parse(r.result.recordedAt) < cutoff && Date.parse(r.start) < cutoff)
      .sort((a,b) => Date.parse(a.start)-Date.parse(b.start) || Date.parse(a.savedAt)-Date.parse(b.savedAt))
      .filter(r => { if(seen.has(r.gameId)) return false; seen.add(r.gameId); return true; });
  }
  const actual = (r, kind) => kind === 'margin' ? r.result.home-r.result.away : r.result.home+r.result.away;
  const average = a => a.reduce((x,y)=>x+y,0)/a.length;
  function evaluate(rows, kind, bias, sd) {
    const errors = rows.map(r=> actual(r,kind)-r.raw[kind]-bias);
    const spreads = rows.map(r=>sd || r.raw[kind === 'margin' ? 'sdMargin':'sdTotal']);
    const nll = average(errors.map((e,i)=> Math.log(spreads[i]) + e*e/(2*spreads[i]*spreads[i])));
    const lines = rows.filter(r=>finite(r.lines?.[kind]));
    const brier = lines.length ? average(lines.map(r=>{
      const p=probabilities(r.raw[kind]+bias,sd || r.raw[kind==='margin'?'sdMargin':'sdTotal'],r.lines[kind]);
      const y=actual(r,kind), t=r.lines[kind];
      return (p.above-Number(y>t))**2+(p.below-Number(y<t))**2+(p.equal-Number(y===t))**2;
    })) : null;
    return {n: rows.length, mae: average(errors.map(Math.abs)), nll, brier, lineCount: lines.length};
  }
  function calibrate(records, signature, kind, cutoff = Date.now()) {
    const rows = eligible(records, signature, cutoff);
    const base = {applied:false, n:rows.length, bias:0, sd:null, reason:'waiting'};
    if (rows.length < 130) return base;
    const holdCount = Math.max(30, Math.floor(rows.length*.2));
    const hold = rows.slice(-holdCount);
    // Same-day/future results cannot be used to train a preceding validation prediction.
    const firstHoldSave = Math.min(...hold.map(r=>Date.parse(r.savedAt)));
    const train = rows.slice(0,-holdCount).filter(r=>Date.parse(r.result.recordedAt) < firstHoldSave);
    if (train.length < 100) return {...base, reason:'chronology', trainN:train.length, holdN:hold.length};
    const errors = train.map(r=>actual(r,kind)-r.raw[kind]);
    const mean = average(errors), weight = train.length/(train.length+100);
    const bias = mean*weight;
    const variance = average(errors.map(e=>(e-bias)**2));
    const defaultVariance = average(train.map(r=>r.raw[kind==='margin'?'sdMargin':'sdTotal']**2));
    const sd = Math.sqrt(Math.max(kind==='margin'?25:64, weight*variance+(1-weight)*defaultVariance));
    const before = evaluate(hold,kind,0,null), after = evaluate(hold,kind,bias,sd);
    // Separate holdout evidence for both scoring distribution and market probabilities.
    const applied = after.nll < before.nll && after.mae <= before.mae && after.lineCount >= 30 && after.brier < before.brier;
    return {...base, applied, bias:applied?bias:0, sd:applied?sd:null, reason:applied?'validated':'no-improvement',
      trainN:train.length, holdN:hold.length, before, after, candidate:{bias,sd}};
  }
  const api = {VERSION, minutes, currentWeight, ability, roleMinutes, probabilities, expectedValue, validRecord, eligible, calibrate};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.NBAForecast = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
