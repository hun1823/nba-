const fs=require('node:fs'), vm=require('node:vm'), assert=require('node:assert/strict');
const path=require('node:path'); process.chdir(path.join(__dirname,'..'));
const context={window:{},document:{getElementById:()=>({})},localStorage:{getItem:()=>null},assert,console};
vm.runInNewContext(fs.readFileSync('data/nba_data.js','utf8'),context);
const src=fs.readFileSync('app.js','utf8');
const model=src.slice(src.indexOf('  const D ='),src.indexOf('  // ---------- 경기 일정'));
const market=src.slice(src.indexOf('  function marketProb'),src.indexOf('  function scenarioPrediction'));
vm.runInNewContext('(function(){'+model+market+`
recenter();
for(const t of TEAMS) {
 const h=healthy(t), r=rotation(t,noneOut);
 assert(r.valid); assert(Math.abs(r.totalMinutes-240)<.01);
 for(const x of r.list) assert(Math.abs(x.final-x.base)<.01);
 const p=r.list.find(x=>x.final>20).p;
 const changed=rotation(t,noneOut,{[p.eid]:20});
 assert.equal(changed.list.find(x=>x.p.eid===p.eid).final,20);
 assert(changed.valid);
 const out=rotation(t,x=>x.eid===p.eid,{[p.eid]:20});
 assert.equal(out.list.find(x=>x.p.eid===p.eid).final,0);
 assert(out.valid);
}
const symmetric=marketProb(0,12.5,0);
assert(Math.abs(symmetric.above-symmetric.below)<1e-7); assert(symmetric.equal>0);
for(const line of [-3.5,0,3,225,225.5]){
 const p=marketProb(0,12.5,line);
 assert(Math.abs(p.above+p.below+p.equal-1)<1e-10);
 if(!Number.isInteger(line)) assert(p.equal<1e-12);
}
assert(marketProb(5,12.5,3.5).above>.5); // home -3.5
assert(marketProb(230,18,225.5).above>.5);
console.log('PASS: 30-team rotations, fixed minutes, absence precedence, probability sums and handicap signs');
})()`,context);
