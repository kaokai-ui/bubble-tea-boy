// 平衡測試：三種自動玩家各跑 N 局，看破產率、門市數、現金、評級分布。
// 用法：node balance.cjs [局數]
require("./sim.js");
const T = globalThis.TeaSim;

const N = Number(process.argv[2] || 200);
const styles = ["idle", "reasonable", "aggressive"];
for (const style of styles) {
  let bankrupt = 0, stores = 0, cash = 0, profit = 0, weeksSum = 0;
  const grades = {};
  for (let i = 0; i < N; i++) {
    const seed = 1000 + i * 7919;
    const offers = T.offersForStart(seed);
    const s = T.newGame("測試", seed, offers[i % offers.length]);
    while (!s.over) {
      T.autoPlay(s, style);
      T.endWeek(s);
    }
    if (s.over.title === "週轉不靈") bankrupt++;
    stores += s.stores.length;
    cash += s.cash;
    profit += s.profitTotal;
    weeksSum += s.week;
    grades[s.over.grade] = (grades[s.over.grade] || 0) + 1;
  }
  console.log(`${style.padEnd(10)} 破產 ${(bankrupt / N * 100).toFixed(0)}%  平均門市 ${(stores / N).toFixed(1)}  平均現金 ${Math.round(cash / N / 1e4)} 萬  平均累積淨利 ${Math.round(profit / N / 1e4)} 萬  平均週數 ${Math.round(weeksSum / N)}  評級 ${JSON.stringify(grades)}`);
}
