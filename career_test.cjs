// 劇本二自動測試：外送小弟 → 店員 → 店長 → 董事長，跑 N 局看各階段花幾週與結局。
// 用法：node career_test.cjs [局數]
require("./sim.js");
require("./career.js");
const T = globalThis.TeaSim;
const C = globalThis.TeaCareer;

const N = Number(process.argv[2] || 100);
const stats = { clerk: [], manager: [], chairman: [], endings: {}, savingsAtManager: [], stuck: 0 };
for (let i = 0; i < N; i++) {
  const seed = 3000 + i * 7919;
  const c = C.newCareer("測試", seed);
  while (!c.over && !c.promoted && c.week < 160) {
    C.autoPlay(c);
    if (c.promoted) break;
    C.endWeek(c);
    if (c.stage === "clerk" && !c._seenClerk) { c._seenClerk = 1; stats.clerk.push(c.week); }
  }
  if (!c.promoted) {
    const k = c.over ? c.over.title : "卡住";
    stats.endings[k] = (stats.endings[k] || 0) + 1;
    if (!c.over) stats.stuck++;
    continue;
  }
  stats.manager.push(c.week);
  stats.savingsAtManager.push(c.savings);
  const s = C.toManager(c);
  while (!s.over) {
    T.autoPlay(s, "reasonable");
    T.endWeek(s);
    if (s.mode === "chairman" && s.career.chairmanWeek === s.week - 1) stats.chairman.push(s.week);
  }
  const k = `${s.over.grade} ${s.over.title}`;
  stats.endings[k] = (stats.endings[k] || 0) + 1;
}
const avg = (a) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : "-");
console.log(`升店員：${stats.clerk.length}/${N} 局，平均第 ${avg(stats.clerk)} 週`);
console.log(`升店長：${stats.manager.length}/${N} 局，平均第 ${avg(stats.manager)} 週，存款平均 ${avg(stats.savingsAtManager)}`);
console.log(`當董事長：${stats.chairman.length}/${N} 局，平均第 ${avg(stats.chairman)} 週`);
console.log("結局：", JSON.stringify(stats.endings));
