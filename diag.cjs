// 診斷：印出單一局前幾週第一家店的週帳目。用法：node diag.cjs [idle|reasonable]
require("./sim.js");
const T = globalThis.TeaSim;
const style = process.argv[2] || "reasonable";
const seed = 4242;
const s = T.newGame("診斷", seed, T.offersForStart(seed)[0]);
console.log("店型", s.stores[0].key, "月租", s.stores[0].rent, "基本來客", s.stores[0].base);
for (let w = 0; w < 30; w++) {
  T.autoPlay(s, style);
  const r = T.endWeek(s);
  const st = r.stores[0];
  if (w % 3 === 0) console.log(`週${w} 季${r.cal.season} 需求${st.demand} 售出${st.served} 流失${st.lost} 產能/日${st.capacityDay} 營收${st.revenue} 原料${st.cogs} 耗損${st.wasteCost} 薪資${st.wages} 租${st.rent} 店淨利${st.profit} | 總淨利${r.profit} 現金${r.cash} 聲譽${r.rep} 店數${s.stores.length}`);
}
