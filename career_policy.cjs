// 劇本二前半（小弟、店員）的難度：比較「認真玩」（autoPlay）和「隨便玩」（隨機選項、隨機排班）。
// 用法：node career_policy.cjs [局數]
require("./sim.js");
require("./career.js");
const C = globalThis.TeaCareer;
const N = Number(process.argv[2] || 200);

function careless(c, rnd) {
  for (const inst of c.inbox.slice()) {
    const v = C.eventView(c, inst);
    C.resolveEvent(c, inst.uid, Math.floor(rnd() * v.options.length));
    if (c.promoted) return;
  }
  const keys = Object.keys(C.ACTIONS).filter((k) => C.available(c, k));
  for (let n = 0; n < 12; n++) C.planAction(c, keys[Math.floor(rnd() * keys.length)]);
}

for (const mode of ["認真玩", "隨便玩"]) {
  const r = { clerk: [], manager: [], fail: {}, demoted: 0, testFail: 0, events: new Set() };
  for (let i = 0; i < N; i++) {
    const c = C.newCareer("測試", 5000 + i * 104729);
    let s = (i * 2654435761) >>> 0;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    let wasClerk = false;
    while (!c.over && !c.promoted && c.week < 156) {
      c.inbox.forEach((x) => r.events.add(x.id));
      if (mode === "認真玩") C.autoPlay(c); else careless(c, rnd);
      if (c.promoted) break;
      C.endWeek(c);
      if (c.stage === "clerk" && !wasClerk) { wasClerk = true; r.clerk.push(c.week); }
      if (wasClerk && c.stage === "runner") { r.demoted++; wasClerk = false; }
    }
    r.testFail += c.log.filter((l) => /再練兩週|再看看|還不急|再等等/.test(l.text)).length;
    if (c.promoted) r.manager.push(c.week);
    else { const k = c.over ? c.over.title : "三年還沒升店長"; r.fail[k] = (r.fail[k] || 0) + 1; }
  }
  const avg = (a) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : "-");
  console.log(`【${mode}】升店員 ${r.clerk.length}/${N}（平均第 ${avg(r.clerk)} 週）· 升店長 ${r.manager.length}/${N}（平均第 ${avg(r.manager)} 週）· 被降回外送 ${r.demoted} 次 · 升職考驗沒過 ${r.testFail} 次 · 失敗 ${JSON.stringify(r.fail)} · 出現過的事件 ${r.events.size} 種`);
}
