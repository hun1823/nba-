const assert = require('node:assert/strict');
const F = require('../forecast.js');
const season = (g, mpg, bpm = 5) => ({g, mpg, mp:g*mpg, obpm:bpm});
const last = season(70,30,2);
assert.equal(F.currentWeight(season(10,30), last), .15);
assert.equal(F.currentWeight(season(19,15), last), .15);
assert.equal(F.currentWeight(season(20,15), last), .15);
assert(F.currentWeight(season(21,15), last) > .15);
assert(F.currentWeight(season(70,12), last) > .15); // bench cumulative minutes
assert(F.currentWeight(season(2,10), last) < .15);
assert(F.currentWeight(season(21,15), last)-F.currentWeight(season(20,15),last)<.04);
assert.equal(F.currentWeight(null,last),0);
assert.equal(F.currentWeight(season(1,10),null),1);
assert(F.ability(season(1,10,20),null,'obpm',0)<1); // noisy rookie shrinks
assert(F.ability(null,season(1,10,20),'obpm',0)<1); // noisy last season also shrinks
assert.equal(F.ability(null,null,'obpm',-1),-1);
assert(F.roleMinutes(season(10,15),last)<18); // current role, not 85% of old minutes
const makeRecord = i => {
 const start=Date.UTC(2025,0,i+1,12), error=[-9,-6,-3,0,3,6,9][i%7];
 return {id:String(i),version:F.VERSION,signature:'model',gameId:String(i),home:'BOS',away:'MIA',
  start:new Date(start).toISOString(),savedAt:new Date(start-3600000).toISOString(),
  raw:{margin:0,total:190,sdMargin:12.5,sdTotal:18},lines:{margin:3.5,total:200.5},
  result:{home:110+error,away:100,basis:'regulation',recordedAt:new Date(start+4*3600000).toISOString()}};
};
const rows=Array.from({length:130},(_,i)=>makeRecord(i));
assert.equal(F.calibrate(rows.slice(0,129),'model','margin').applied,false);
for (const kind of ['margin','total']) {
 const c=F.calibrate(rows,'model',kind);
 assert(c.applied,JSON.stringify(c));assert.equal(c.trainN,100);assert.equal(c.holdN,30);
 assert(c.bias>0);assert(c.after.nll<c.before.nll);assert(c.after.brier<c.before.brier);
}
assert.equal(F.calibrate(rows,'other-model','margin').n,0);
assert.equal(F.calibrate(rows,'model','margin',Date.parse(rows[50].savedAt)).n,50);
assert.equal(F.calibrate([...rows,...rows],'model','margin').n,130);
const postdated={...rows[0],savedAt:rows[0].start};
assert.equal(F.validRecord(postdated),false);
assert.equal(F.validRecord({...rows[0],result:{...rows[0].result,basis:'including-overtime'}}),false);
assert.equal(F.validRecord({...rows[0],result:{...rows[0].result,home:NaN}}),false);
const withoutTotals=rows.map(r=>({...r,lines:{margin:3.5}}));
assert(F.calibrate(withoutTotals,'model','margin').applied);
assert(!F.calibrate(withoutTotals,'model','total').applied);
const lateResults=rows.map(r=>({...r,result:{...r.result,recordedAt:rows[129].result.recordedAt}}));
assert.equal(F.calibrate(lateResults,'model','margin').reason,'chronology');
const shiftedHoldout=rows.map((r,i)=>i<100?r:({...r,raw:{...r.raw,margin:r.result.home-r.result.away}}));
assert(!F.calibrate(shiftedHoldout,'model','margin').applied); // biased training does not help this holdout
const p=F.probabilities(0,12.5,0);
assert.equal(F.expectedValue(p,1.85,'unknown'),null);
assert(Math.abs(F.expectedValue(p,1.85,'refund')-F.expectedValue(p,1.85,'loss')-p.equal)<1e-10);
assert.equal(F.expectedValue(p,1,'refund'),null);
assert(Math.abs(F.probabilities(0,12.5,.5).equal)<1e-10);
console.log('PASS: season thresholds, bench/rookie priors, role minutes, chronological holdout, model isolation, duplicates, independent markets, EV refund');
