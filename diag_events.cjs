// 診斷：劇本二前半，事件「照預設處理」和「挑最好的選項」差多少。
// 用法：node diag_events.cjs [局數]
// 1. 三種玩家的結局：autoPlay（試算挑最好）、全部照預設（沒有預設的選第一個）、全部選最後一個
// 2. 照預設時，哪些事件的預設選項讓存款掉最多（和最好選項的差距）
require("./sim.js");
require("./career.js");
const C = globalThis.TeaCareer;

const N = Number(process.argv[2] || 100);
const clone = (x) => JSON.parse(JSON.stringify(x));
const loss = {};
for (const mode of ["best", "fallback", "last"]) {
  const ends = {};
  const weeks = [];
  for (let i = 0; i < N; i++) {
    const c = C.newCareer("測試", 3000 + i * 7919);
    while (!c.over && !c.promoted && c.week < 160) {
      if (mode !== "best") {
        for (const inst of c.inbox.slice()) {
          const ev = C.eventView(c, inst);
          // 沒有預設的事件（升遷等）照預設玩家會接受，選第一個
          const k = mode === "fallback" ? (ev.fallback >= 0 ? ev.fallback : 0) : ev.options.length - 1;
          if (mode === "fallback") {
            // 跟每個選項比存款（同一個亂數），記下預設選項比最好的少多少
            const money = ev.options.map((_, j) => { const t = clone(c); C.resolveEvent(t, inst.uid, j); return t.savings; });
            const gap = Math.max(...money) - money[k];
            const r = (loss[inst.id] = loss[inst.id] || { n: 0, gap: 0, label: ev.options[k].label });
            r.n++; r.gap += gap;
          }
          C.resolveEvent(c, inst.uid, k);
          if (c.promoted) break;
        }
      }
      if (c.promoted) break;
      C.autoPlay(c);
      C.endWeek(c);
    }
    const key = c.promoted ? "升店長" : c.over ? c.over.title : "卡住";
    ends[key] = (ends[key] || 0) + 1;
    if (!c.promoted) weeks.push(c.week);
  }
  const avg = weeks.length ? Math.round(weeks.reduce((a, b) => a + b, 0) / weeks.length) : "-";
  console.log(mode, JSON.stringify(ends), "沒升上去的平均結束週", avg);
}
console.log("\n照預設時，存款比最好選項少最多的事件（總差距、次數、預設選項）：");
Object.entries(loss).sort((a, b) => b[1].gap - a[1].gap).slice(0, 20)
  .forEach(([id, r]) => console.log(`  ${id.padEnd(20)} ${String(Math.round(r.gap)).padStart(9)}  ${String(r.n).padStart(4)} 次  ${r.label}`));
