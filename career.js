// 劇本二「從外送小弟做起」：外送小弟 → 店員兩個階段的引擎（純函式、可重現）。
// 升店長後交給 TeaSim（sim.js）的店長模式，買下品牌後變回一般的董事長模式。
// 瀏覽器掛在 globalThis.TeaCareer；需要先載入 sim.js。
(function (root) {
  "use strict";
  const T = root.TeaSim;

  function rand(c) {
    c.rng = (c.rng + 0x6d2b79f5) >>> 0;
    let t = c.rng;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  const between = (c, a, b) => a + (b - a) * rand(c);
  const intBetween = (c, a, b) => Math.floor(between(c, a, b + 1));
  const pick = (c, arr) => arr[Math.floor(rand(c) * arr.length)];
  const chance = (c, p) => rand(c) < p;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const round = (v) => Math.round(v);

  const BASE_HOURS = 44;
  const MAX_HOURS = 64;
  const LIVING = 4500; // 每週房租分攤、吃飯、機車油錢

  const MISHAPS = {
    runner: ["送錯兩棟大樓，客人打電話到店裡罵。", "整袋飲料忘了插吸管，被留了負評。", "騎過頭三個路口，飲料送到都退冰了。", "把甜度貼紙貼反，客人喝到全糖。"],
    clerk: ["連續做錯三杯甜度，熟客臉色很難看。", "封膜機沒對好，一整排飲料漏出來。", "收銀找錯錢，少了一張千元鈔。", "把鮮奶當成豆漿加進去，只好整杯重做。"],
  };
  const STAGES = {
    runner: { name: "外送小弟", wage: 190 },
    clerk: { name: "店員", wage: 205 },
  };

  // 每個行動：stage（哪個階段能做）、hours、pay（是否照時薪算）、desc、run（效果，回傳一句話）
  const ACTIONS = {
    lunch: { stage: "runner", name: "跑午餐外送", hours: 10, pay: true, desc: "時薪＋小費；體力消耗大", run: (c, o) => delivery(c, o, 1) },
    teatime: { stage: "runner", name: "跑下午茶團購", hours: 8, pay: true, desc: "辦公室大單，小費看運氣", run: (c, o) => delivery(c, o, 0.75) },
    prep: { stage: "runner", name: "洗杯、煮珍珠、備料", hours: 6, pay: true, desc: "調飲 +、老闆信任 +", run: (c) => { gain(c, "brew", 4); c.trust += 3; c.energy -= 6; return "在後場煮了三鍋珍珠，終於知道什麼叫「Q 但不硬」。"; } },
    watch: { stage: "runner", name: "在吧台旁偷學", hours: 3, desc: "不支薪；老闆信任夠才學得到東西", run: (c) => { if (c.trust >= 30) { gain(c, "brew", 4); return "吧台的小美教你茶湯和冰塊的比例，順手讓你搖了兩杯。"; } gain(c, "brew", 1); c.trust -= 1; return "尖峰時段站在吧台旁邊，被念「不要擋路」。"; } },
    routes: { stage: "runner", name: "研究外送路線", hours: 2, desc: "熟了以後送得快、小費多", run: (c) => { c.routes = clamp(c.routes + 15, 0, 100); return `把巷弄和大樓的後門記熟了一些（路線熟悉度 ${c.routes}）。`; } },
    recipe: { stage: "any", name: "背菜單和配方", hours: 3, desc: "調飲 +、營運 +", run: (c) => { gain(c, "brew", 2); gain(c, "ops", 1); return "把每款飲料的糖量、冰量和茶種背了一遍。"; } },
    bar: { stage: "clerk", name: "站吧台搖飲", hours: 10, pay: true, desc: "調飲 ++；尖峰很累", run: (c) => { gain(c, "brew", 4); c.energy -= 11; c.trust += 1; return pick(c, ["一個晚上搖了兩百多杯，手臂快舉不起來。", "第一次一個人撐完下班尖峰，沒有做錯任何一杯。", "熟客說你搖的四季春「跟小美的一樣好喝」。"]); } },
    counter: { stage: "clerk", name: "站櫃台點餐", hours: 10, pay: true, desc: "服務 ++、名聲 +", run: (c) => { gain(c, "service", 4); c.fame += 1; c.energy -= 10; return pick(c, ["記住了十幾位熟客的甜度冰塊。", "幫一位不會用手機點餐的阿伯點好飲料，他說下次還來。", "排隊排到門口，你一邊點餐一邊安撫大家。"]); } },
    openclose: { stage: "clerk", name: "開店／關店班", hours: 8, pay: true, desc: "營運 +、老闆信任 +", run: (c) => { gain(c, "ops", 3); c.trust += 3; c.energy -= 10; return "早上七點開店、晚上十一點關帳，開始懂得一家店怎麼運轉。"; } },
    stock: { stage: "clerk", name: "學叫貨和盤點", hours: 4, pay: true, desc: "營運 ++（老闆信任 50 以上）", need: (c) => (c.trust >= 50 ? null : "老闆還沒放心讓你碰帳"), run: (c) => { gain(c, "ops", 4); return "跟老闆一起盤點，才知道每個月有一成的原料不知道去哪了。"; } },
    mentor: { stage: "clerk", name: "帶新人", hours: 4, pay: true, desc: "帶人 ++（當店員 6 週後）", need: (c) => (c.stageWeeks >= 6 ? null : "你自己也還算新人"), run: (c) => { gain(c, "lead", 5); return pick(c, ["教新來的工讀生封膜，教了三次她終於封得平。", "新人做錯單被客人罵哭，你陪她把那一單重做。", "排了一張新人上手表，老闆說要拿去用。"]); } },
    rnd: { stage: "clerk", name: "試做私房配方", hours: 4, desc: "做出自己的招牌飲料", need: (c) => (c.signature.done ? "招牌已經上市了" : null), run: (c) => signatureStep(c) },
    social: { stage: "clerk", name: "經營店的 IG", hours: 3, desc: "名聲 +、服務 +", run: (c) => { c.fame += 3; gain(c, "service", 1); return pick(c, ["拍了一支搖飲的短片，按讚比平常多三倍。", "回了一整晚的私訊，有人問能不能訂婚禮的飲料。"]); } },
    night: { stage: "any", name: "夜間商業課", hours: 6, desc: "營運 ++、帶人 +；學費 NT$1,500", need: (c) => (c.savings >= 1500 ? null : "存款不夠付學費"), run: (c) => { c.savings -= 1500; gain(c, "ops", 4); gain(c, "lead", 1); return pick(c, ["老師講損益表，你第一次知道毛利和淨利差在哪。", "這週上排班與人事成本，想起老闆每次排班都在嘆氣。"]); } },
    rest: { stage: "any", name: "好好休息", hours: 6, desc: "體力 ++", run: (c) => { c.energy += 22; return "睡到自然醒，晚上去河堤騎車。"; } },
    family: { stage: "any", name: "回家吃飯", hours: 4, desc: "體力 +，家裡會關心你", run: (c) => { c.energy += 10; return pick(c, ["媽媽煮了一桌菜，問你什麼時候要找「正式的工作」。", "爸爸默默塞了兩千塊給你。", "跟哥哥聊到他公司在找業務，你說再看看。"]); } },
    // 小弟階段的其他選擇
    evening: { stage: "runner", name: "跑晚上宵夜單", hours: 6, pay: true, desc: "時薪＋小費；夜路要小心", run: (c, o) => { const r = delivery(c, o, 0.6); if (chance(c, 0.08)) { c.energy -= 6; return r + "回程差點被闖紅燈的車撞到，嚇出一身冷汗。"; } return r; } },
    market: { stage: "runner", name: "去批發市場叫料", hours: 4, pay: true, desc: "營運 +；學會看茶葉和水果的好壞", run: (c) => { gain(c, "ops", 2); gain(c, "brew", 1); c.trust += 1; return pick(c, ["凌晨四點的果菜市場，老闆教你怎麼挑不會太酸的檸檬。", "跟茶行老闆殺價，省了兩百塊，德哥說「不錯喔」。", "第一次自己扛十箱鮮奶上車，腰快斷了。"]); } },
    clean: { stage: "any", name: "大掃除和整理冰箱", hours: 4, pay: true, desc: "老闆信任 +；店裡衛生分數會記得你", run: (c) => { c.trust += 2; gain(c, "ops", 1); c.energy -= 4; return pick(c, ["把製冰機拆開洗了一遍，裡面的東西不敢說。", "冰箱的原料全部貼上日期，過期的倒掉了一袋珍珠。"]); } },
    video: { stage: "runner", name: "拍外送日常短片", hours: 2, desc: "名聲 +，有機會被更多客人認識", run: (c) => { c.fame += chance(c, 0.2) ? 6 : 2; return pick(c, ["拍了一支雨天外送的短片，留言都在叫你注意安全。", "跟熟客的狗合照，那支影片意外很多人看。"]); } },
    scooter: { stage: "runner", name: "保養機車", hours: 2, desc: "NT$600；之後比較不會拋錨", need: (c) => (c.savings >= 600 ? null : "存款不夠"), run: (c) => { c.savings -= 600; c.flags.scooterOk = c.week + 12; return "換了機油和煞車皮，騎起來順多了。"; } },
    gym: { stage: "any", name: "運動、跑步", hours: 3, desc: "體力 +；連續做會讓你比較不累", run: (c) => { c.energy += 6; c.fit = clamp((c.fit || 0) + 1, 0, 10); return pick(c, ["在河堤跑了五公里，晚上睡得很好。", "跟同學去打籃球，才發現自己體力變好了。"]); } },
    side: { stage: "any", name: "超商夜班打工", hours: 8, desc: "多一份收入 NT$1,600；很傷體力", run: (c) => { c.savings += 1600; c.energy -= 14; c.trust -= 1; return "凌晨三點的超商，客人只有一位買泡麵的計程車司機。"; } },
    online: { stage: "any", name: "上網自學", hours: 3, desc: "免費；營運或服務 +", run: (c) => { const k = pick(c, ["ops", "service"]); gain(c, k, 2); return k === "ops" ? "看了一系列講餐飲成本的影片，做了筆記。" : "看了服務業的待客課程，學到怎麼應付奧客。"; } },
    // 店員階段的其他選擇
    rival: { stage: "clerk", name: "去對手店試喝", hours: 2, desc: "NT$300；調飲 +，可能學到新點子", run: (c) => { c.savings -= 300; gain(c, "brew", 2); if (!c.signature.done && chance(c, 0.4)) { c.signature.progress = clamp(c.signature.progress + 10, 0, 100); return "甜蜜蜜的新品給了你靈感，私房配方進度 +10%。"; } return pick(c, ["茶湯會社的四季春比我們淡，但冰塊比較少。", "網紅店的奶蓋很漂亮，喝起來卻太甜。"]); } },
    bulk: { stage: "clerk", name: "包團購大單", hours: 6, pay: true, desc: "營運 +、老闆信任 +；手速練起來", run: (c) => { gain(c, "ops", 2); gain(c, "brew", 1); c.trust += 2; c.energy -= 7; return pick(c, ["兩百杯的公司團購，三個人一小時包完。", "幫學校運動會備了三百杯紅茶，杯蓋差點不夠。"]); } },
    complaint: { stage: "clerk", name: "處理客訴和評論", hours: 2, desc: "服務 +、名聲 +", run: (c) => { gain(c, "service", 3); c.fame += 1; return pick(c, ["回了一則一星評論，客人後來改成四星。", "打電話向送錯飲料的客人道歉，送了一張招待券。"]); } },
    training: { stage: "clerk", name: "寫新人教學手冊", hours: 4, desc: "帶人 +、營運 +（當店員 10 週後）", need: (c) => (c.stageWeeks >= 10 ? null : "還不夠熟悉店裡的流程"), run: (c) => { gain(c, "lead", 3); gain(c, "ops", 2); return "把封膜、搖飲、收銀的步驟拍照寫成一本小手冊。"; } },
    contest: { stage: "clerk", name: "練習調飲比賽作品", hours: 5, desc: "調飲 ++；之後可能有比賽", run: (c) => { gain(c, "brew", 5); c.flags.contestReady = (c.flags.contestReady || 0) + 1; return "下班後留下來練拉花奶蓋，倒掉了十幾杯失敗品。"; } },
  };

  // 每週限定的機會（每週隨機出現 2～3 個，只有這週能做）
  const SPECIALS = {
    s_festival: { name: "【本週限定】廟會擺攤", hours: 8, pay: true, desc: "時薪加倍、名聲 ++", run: (c) => { c.savings += 8 * 190; c.fame += 4; c.energy -= 8; return "廟會人山人海，攤位前排了一整晚，賣到原料用完。"; } },
    s_school: { name: "【本週限定】校慶團購", hours: 6, pay: true, desc: "小費多；老闆信任 +", run: (c) => { c.savings += intBetween(c, 400, 1200); c.trust += 3; c.energy -= 6; return "國小校慶訂了三百杯，家長會長塞了紅包給大家。"; } },
    s_tea: { name: "【本週限定】參觀茶園", hours: 6, desc: "NT$800；調飲 ++，私房配方靈感", run: (c) => { c.savings -= 800; gain(c, "brew", 5); if (!c.signature.done) c.signature.progress = clamp(c.signature.progress + 8, 0, 100); return "在坪林喝到剛炒好的包種茶，才知道茶湯可以這麼香。"; } },
    s_typhoon: { name: "【本週限定】颱風天加班", hours: 6, pay: true, desc: "時薪三倍、很危險", run: (c) => { c.savings += 6 * 190 * 2; c.energy -= 12; c.trust += 4; if (chance(c, 0.15)) { c.savings -= 2500; return "颱風天外送加給很多，但機車被吹倒，修理花了 NT$2,500。"; } return "風雨裡送了二十單，老闆說這個月加你一點獎金。"; } },
    s_workshop: { name: "【本週限定】連鎖品牌講座", hours: 3, desc: "免費；營運 +、帶人 +", run: (c) => { gain(c, "ops", 3); gain(c, "lead", 2); return "聽了一位連鎖品牌創辦人講展店失敗的故事，抄了滿滿三頁。"; } },
    s_market: { name: "【本週限定】週末市集", hours: 8, desc: "自己擺攤賣飲料：收入看運氣", run: (c) => { const v = intBetween(c, -800, 3500); c.savings += v; c.fame += 2; c.energy -= 9; return v >= 0 ? `跟朋友在週末市集擺攤，扣掉成本賺了 NT$${v}。` : "市集那天下大雨，賠了一點材料錢，但學到不少。"; } },
    s_help: { name: "【本週限定】支援分店", hours: 8, pay: true, desc: "到別家分店幫忙；認識其他店長", run: (c) => { c.trust += 2; gain(c, "service", 2); gain(c, "lead", 1); c.energy -= 8; return "支援隔壁鎮的加盟店，店長教你一套更快的出杯流程。"; } },
    s_photo: { name: "【本週限定】幫雜誌拍照", hours: 2, desc: "名聲 ++", run: (c) => { c.fame += 5; return "美食雜誌來採訪，你被拍到正在搖飲的樣子。"; } },
  };
  Object.assign(ACTIONS, Object.fromEntries(Object.entries(SPECIALS).map(([k, a]) => [k, { ...a, stage: "special" }])));

  function gain(c, key, v) {
    c.lastTrain = c.lastTrain || {};
    if (v > 0) c.lastTrain[key] = c.week;
    if ((c.flags.burnout || 0) > c.week) v *= 0.5;
    c.skills[key] = clamp(c.skills[key] + v * (1 - c.skills[key] / 130), 0, 100);
  }

  function delivery(c, o, size) {
    const orders = round(between(c, 32, 48) * size);
    const tipRate = 0.2 + c.routes / 250 + c.fame / 400;
    const tips = round(orders * tipRate * between(c, 8, 16) / 10) * 10;
    c.savings += tips;
    c.energy -= 12 * size;
    c.trust += 1.5 * size;
    c.fame += 0.6 * size;
    if (!c.flags.firstTip && tips > 0) { c.flags.firstTip = 1; }
    if (chance(c, 0.18 - c.routes / 900)) c.inbox.push(ev(c, pick(c, ["wrong_address", "spill", "rain_order"])));
    o.tips = (o.tips || 0) + tips;
    return `送了 ${orders} 單，小費 ${T.fmtMoney(tips)}。`;
  }

  function signatureStep(c) {
    const step = 16 + c.skills.brew / 8 + intBetween(c, 0, 6);
    c.signature.progress = clamp(c.signature.progress + step, 0, 100);
    if (c.signature.progress >= 100 && !c.signature.done) {
      c.inbox.push(ev(c, "taste_test"));
      return "配方差不多了，下週請老闆試喝。";
    }
    return `試了第 ${c.signature.tries = (c.signature.tries || 0) + 1} 版，進度 ${round(c.signature.progress)}%。`;
  }

  // ---------- 事件 ----------
  // cat：urgent（這週要決定，沒處理照 fallback）／people（有人找你）
  const EVENTS = {
    wrong_address: {
      cat: "urgent", fallback: 1,
      title: () => "地址寫錯，飲料快退冰了",
      body: () => "客人留的是舊地址，打電話也不接。後面還有三單在等。",
      options: [
        { label: "繞過去新地址送到", note: "多花半小時，後面兩單遲到被扣分；客人可能給好評", apply: (c) => { c.trust -= 1; if (chance(c, 0.5)) { c.fame += 2; log(c, "客人在評論寫「外送小哥很有責任感」。"); } } },
        { label: "先送後面的單", note: "這單退回店裡，老闆會問", apply: (c) => { c.trust -= 3; } },
      ],
    },
    spill: {
      cat: "urgent", fallback: 0,
      title: () => "急煞，整袋飲料翻了",
      body: () => "前面的車突然停下，你閃過了，但掛在車上的六杯飲料倒了一半。",
      options: [
        { label: "自己出錢重做（NT$300～700）", note: "老闆可能記得", apply: (c) => { c.savings -= intBetween(c, 3, 7) * 100; c.trust += intBetween(c, 1, 4); } },
        { label: "回店裡老實說", note: "老闆嘆氣，店裡吸收", apply: (c) => { c.trust -= 1; } },
      ],
    },
    rain_order: {
      cat: "urgent", fallback: 1,
      title: () => "暴雨特急單",
      body: () => "傾盆大雨，一家公司要二十杯，說會給 NT$500 小費。路上很多積水。",
      options: [
        { label: "穿雨衣出發", note: "小費 NT$500；體力 −8，有一成機會摔車", apply: (c) => { c.savings += 500; c.energy -= 8; if (chance(c, 0.1)) { c.energy -= 15; c.savings -= 1800; log(c, "在積水處滑倒，膝蓋擦傷、機車修了 NT$1,800。"); } } },
        { label: "請老闆婉拒", note: "安全第一", apply: () => {} },
      ],
    },
    regular_gift: {
      cat: "people", weight: 1.2, fallback: 0, cd: 16, max: 2, cond: (c) => c.fame >= 6,
      title: () => "常客阿姨送你一盒水果",
      body: () => "每週都點三杯鮮奶茶的阿姨說，你是她遇過最有禮貌的外送員。",
      options: [{ label: "謝謝阿姨", note: "名聲 +1～3", apply: (c) => { c.fame += intBetween(c, 1, 3); } }],
    },
    scooter: {
      // 越久沒保養越容易拋錨
      cat: "urgent", weight: (c) => Math.min(4, 1 + Math.max(0, c.week - (c.flags.scooterOk || 0)) / 6), fallback: 0, cd: 10, max: 3, cond: (c) => c.stage === "runner" && (c.flags.scooterOk || 0) <= c.week,
      title: () => "機車發不動",
      body: () => "老機車電瓶壞了、皮帶也該換了，機車行說要 NT$3,200。",
      options: [
        { label: "修好它", note: "−NT$3,200", apply: (c) => { c.savings -= 3200; } },
        { label: "先借老闆的電動車", note: "老闆信任 −2，下週體力 −5", apply: (c) => { c.trust -= 2; c.energy -= 5; } },
      ],
    },
    friend_trip: {
      cat: "people", weight: 1, fallback: 1, max: 1,
      title: () => "朋友約你去墾丁三天",
      body: () => "高職同學要去墾丁，問你要不要一起。要請兩天假、花 NT$6,000。",
      options: [
        { label: "去！", note: "−NT$6,000；體力回滿；老闆信任 −3", apply: (c) => { c.savings -= 6000; c.energy = 100; c.trust -= 3; c.flags.skipHours = 16; } },
        { label: "下次吧", note: "存錢要緊", apply: (c) => { c.energy -= 3; } },
      ],
    },
    coworker_swap: {
      cat: "people", weight: 1, fallback: 1, cd: 14, max: 3,
      title: () => "同事小美想跟你換班",
      body: () => "小美週六要去面試，問你能不能幫她上週六的晚班。",
      options: [
        { label: "幫她", note: "這週多 6 小時班（照時薪）；她會記得", apply: (c) => { c.flags.extraHours = (c.flags.extraHours || 0) + 6; c.friend = (c.friend || 0) + 1; } },
        { label: "這週真的不行", note: "", apply: () => {} },
      ],
    },
    boss_test: {
      cat: "people", weight: 1.2, fallback: 0, cd: 12, max: 3, cond: (c) => c.skills.brew >= 15,
      title: () => "老闆突然叫你搖一杯",
      body: () => "德哥把雪克杯丟給你：「搖一杯半糖少冰的四季春我看看。」",
      options: [{ label: "搖！", note: "看你調飲有多少", apply: (c) => { if (c.skills.brew >= 30 + rand(c) * 20) { c.trust += 6; log(c, "德哥喝了一口，點點頭：「明天開始可以幫忙站吧台。」"); } else { c.trust += 1; log(c, "德哥說茶太澀：「冰塊下太早。再練。」"); } } }],
    },
    rival_recruit: {
      cat: "people", weight: 0.8, fallback: 1, max: 1, cond: (c) => c.skills.brew >= 35 || c.skills.service >= 35,
      title: () => "甜蜜蜜的店長來挖角",
      body: () => "對街網紅店的店長說，時薪多 30 塊、班也比較好排。",
      options: [
        { label: "跳槽", note: "時薪 +30，但老闆信任從 30 重新開始", apply: (c) => { c.wageBonus = (c.wageBonus || 0) + 30; c.trust = 30; c.shopChanged = 1; log(c, "你換到甜蜜蜜上班。德哥說：「有空回來喝一杯。」"); } },
        { label: "留下來", note: "德哥知道後，信任 +5", apply: (c) => { c.trust += 5; } },
      ],
    },
    sick: {
      cat: "urgent", weight: 0, fallback: 0,
      title: () => "你發燒倒下了",
      body: () => "連續幾週太拚，體力透支。醫生說至少休息三天。",
      options: [{ label: "乖乖休息", note: "這週少 20 小時、看病 NT$800", apply: (c) => { c.savings -= 800; c.energy = 55; c.flags.skipHours = 20; } }],
    },
    family_call: {
      cat: "people", weight: 1, fallback: 0, max: 1, cond: (c) => c.week > 8,
      title: () => "媽媽打電話來",
      body: () => "「做飲料能做一輩子嗎？你表哥考上公務員了。」",
      options: [
        { label: "跟她說你的計畫", note: "需要一點勇氣；之後她會支持你", apply: (c) => { c.flags.familyOk = 1; log(c, "你說想有一天開自己的店。媽媽沉默了一下：「那就做到最好。」"); } },
        { label: "敷衍過去", note: "", apply: () => {} },
      ],
    },
    taste_test: {
      cat: "people", weight: 0, fallback: 0,
      title: () => "老闆試喝你的私房配方",
      body: (c) => `你把「${c.signature.name}」端給德哥，店裡其他人也圍過來。`,
      options: [{ label: "請喝", note: "", apply: (c) => { if (c.skills.brew >= 40 || chance(c, 0.4)) { c.signature.done = 1; c.trust += 10; c.fame += 5; log(c, `「${c.signature.name}」變成店內限定，第一天賣了八十杯。`); } else { c.signature.progress = 55; c.trust += 2; log(c, "德哥說香氣不錯但太甜，要你再調。"); } } }],
    },
    // 10/23 晚上加：讓每週發生的事更多樣（cd＝至少隔幾週、max＝一局最多幾次）
    rude_customer: {
      cat: "urgent", weight: 1.2, fallback: 1, cd: 8, max: 3,
      title: () => "客人在櫃台大聲罵人",
      body: () => "一位客人說飲料太甜，要求全部退錢，還拿手機開始錄影。",
      options: [
        { label: "道歉並重做一杯", note: "看客人買不買單", apply: (c) => { gain(c, "service", 2); if (chance(c, 0.7)) c.fame += 1; else { c.fame -= 1; log(c, "重做了，客人還是把影片上傳，留言兩極。"); } } },
        { label: "照規定只換不退", note: "客人可能留負評", apply: (c) => { if (chance(c, 0.5)) { c.fame -= 2; log(c, "那位客人在網路上留了一星評論。"); } else c.trust += 1; } },
      ],
    },
    lost_wallet: {
      cat: "people", weight: 0.8, fallback: 0, max: 1,
      title: () => "外送途中撿到一個錢包",
      body: () => "錢包裡有一萬多塊和身分證，地址就在你常送的那棟大樓。",
      options: [
        { label: "送回去給失主", note: "名聲 +3；可能有謝禮", apply: (c) => { c.fame += 3; if (chance(c, 0.5)) { c.savings += 1000; log(c, "失主塞了 NT$1,000 給你，說一定要收。"); } } },
        { label: "交給派出所", note: "名聲 +1", apply: (c) => { c.fame += 1; } },
      ],
    },
    new_coworker: {
      cat: "people", weight: 1, fallback: 0, max: 2, cond: (c) => c.week > 4,
      title: () => "店裡來了新同事",
      body: () => "新來的工讀生阿凱什麼都不會，德哥叫你多照顧他。",
      options: [
        { label: "下班留下來教他", note: "帶人 +2；體力 −5", apply: (c) => { gain(c, "lead", 2); c.energy -= 5; } },
        { label: "讓他自己看別人怎麼做", note: "", apply: () => {} },
      ],
    },
    price_hike: {
      cat: "urgent", weight: 0.8, fallback: 0, cd: 20, max: 2,
      title: () => "房東要漲你的房租",
      body: () => "你租的雅房下個月起每月多 NT$1,500，房東說附近都漲了。",
      options: [
        { label: "接受", note: "每週生活費 +NT$350", apply: (c) => { c.livingPlus = (c.livingPlus || 0) + 350; } },
        { label: "搬去更遠但便宜的地方", note: "搬家 NT$2,000；之後每週通勤多累一點", apply: (c) => { c.savings -= 2000; c.flags.farHome = 1; } },
      ],
    },
    scam_call: {
      cat: "urgent", weight: 0.6, fallback: 1, max: 1,
      title: () => "接到「銀行」的電話",
      body: () => "對方說你的帳戶被盜用，要你到 ATM 依指示操作「解除分期」。",
      options: [
        { label: "照他說的去操作", note: "……", apply: (c) => { c.savings -= 8000; log(c, "被騙了 NT$8,000。德哥說下次先打 165。"); } },
        { label: "掛掉，打 165 查證", note: "", apply: (c) => { log(c, "165 說那是詐騙。你把號碼封鎖了。"); } },
      ],
    },
    boss_birthday: {
      cat: "people", weight: 0.6, fallback: 1, max: 1, cond: (c) => c.week > 6,
      title: () => "德哥生日",
      body: () => "大家想湊錢買禮物，每人 NT$500。",
      options: [
        { label: "一起出錢，還寫了卡片", note: "−NT$500；老闆信任 +4", apply: (c) => { c.savings -= 500; c.trust += 4; } },
        { label: "這個月手頭緊，跳過", note: "", apply: () => {} },
      ],
    },
    heat_wave: {
      cat: "urgent", weight: 1, fallback: 0, cd: 10, max: 3,
      title: () => "熱浪來了，訂單爆量",
      body: () => "連續一週 37 度，店裡訂單多一倍，德哥問你能不能多上班。",
      options: [
        { label: "多上 8 小時", note: "照時薪；體力 −10；老闆信任 +3", apply: (c) => { c.flags.extraHours = (c.flags.extraHours || 0) + 8; c.energy -= 10; c.trust += 3; } },
        { label: "照原本的班", note: "", apply: () => {} },
      ],
    },
    contest_invite: {
      cat: "people", weight: 0.7, fallback: 1, max: 1, cond: (c) => c.stage === "clerk" && (c.flags.contestReady || 0) >= 2,
      title: () => "全國調飲大賽報名",
      body: () => "茶飲公會辦調飲大賽，報名費 NT$1,000，冠軍有獎金和媒體報導。",
      options: [
        { label: "報名參賽", note: "看你的調飲能力", apply: (c) => { c.savings -= 1000; if (c.skills.brew >= 55 || chance(c, 0.25)) { c.savings += 20000; c.fame += 10; c.trust += 5; log(c, "你拿下調飲大賽冠軍！獎金 NT$20,000，上了新聞。"); } else { c.fame += 2; log(c, "比賽沒得名，但評審說你的奶蓋很有想法。"); } } },
        { label: "明年再說", note: "", apply: () => {} },
      ],
    },
    regular_story: {
      cat: "people", weight: 0.8, fallback: 0, cd: 12, max: 3, cond: (c) => c.fame >= 10,
      title: () => "常客跟你聊起他的故事",
      body: (c) => ["每天下午來的大學生說他考上研究所了，要請全店喝飲料。", "附近的計程車司機說他兒子也在飲料店打工，叫你們互相照顧。", "常來的阿嬤說她年輕時也在茶行工作，教你怎麼聞茶葉。"][c.week % 3],
      options: [{ label: "聽他說完", note: "名聲、服務 +", apply: (c) => { c.fame += intBetween(c, 0, 2); gain(c, "service", intBetween(c, 1, 2)); } }],
    },
    inspection_day: {
      cat: "urgent", weight: 0.8, fallback: 1, cd: 14, max: 2, cond: (c) => c.stage === "clerk",
      title: () => "衛生局明天要來稽查",
      body: () => "德哥問誰今天能留下來大掃除。",
      options: [
        { label: "我留下來", note: "多 4 小時班（照時薪）；老闆信任 +4", apply: (c) => { c.flags.extraHours = (c.flags.extraHours || 0) + 4; c.trust += 4; } },
        { label: "今天有事", note: "老闆信任 −1", apply: (c) => { c.trust -= 1; } },
      ],
    },
    meimei_leaves: {
      cat: "people", weight: 0.6, fallback: 0, max: 1, cond: (c) => (c.friend || 0) >= 1 && c.week > 10,
      title: () => "小美要離職了",
      body: () => "小美面試上一家設計公司，下個月就不做了。她說謝謝你上次幫她換班。",
      options: [{ label: "幫她辦歡送會", note: "−NT$400；帶人 +2", apply: (c) => { c.savings -= 400; gain(c, "lead", 2); log(c, "小美離職前把她的奶蓋祕訣都教給你了。"); gain(c, "brew", 3); } }],
    },
    power_cut: {
      cat: "urgent", weight: 0.6, fallback: 0, cd: 20, max: 2,
      title: () => "整條街停電",
      body: () => "冰箱沒電，鮮奶和水果撐不了多久。",
      options: [
        { label: "去超商買冰塊救急", note: "自己先墊 NT$600；老闆信任 +3", apply: (c) => { c.savings -= 600; c.trust += 3; } },
        { label: "等德哥處理", note: "", apply: () => {} },
      ],
    },
    // 10/24 加：事件量約三倍，結果依能力與運氣上下變動（使用者試玩回饋：太順、太單調）
    boss_warning: {
      cat: "people", weight: 0, fallback: 0,
      title: () => "德哥把你叫到後面",
      body: (c) => `「最近怎麼了？客人跟同事都在講。」德哥說再這樣下去，${c.stage === "clerk" ? "只好讓你回去跑外送" : "他只能請你走"}。`,
      options: [
        { label: "老實說最近太累，會調整", note: "老闆信任 +3～6", apply: (c) => { c.trust += intBetween(c, 3, 6); } },
        { label: "說是同事害的", note: "看德哥信不信", apply: (c) => { if (chance(c, 0.35)) c.trust += 4; else { c.trust -= 3; log(c, "德哥看了監視器，臉更臭了。"); } } },
      ],
    },
    flat_tire: {
      cat: "urgent", weight: 1, fallback: 1, cd: 10, max: 3, cond: (c) => c.stage === "runner",
      title: () => "外送途中爆胎",
      body: () => "後輪壓到釘子，車上還有四杯飲料要送。",
      options: [
        { label: "找路邊機車行補胎", note: "NT$300～700；飲料可能遲到", apply: (c) => { c.savings -= intBetween(c, 3, 7) * 100; if (chance(c, 0.5)) c.trust -= 2; } },
        { label: "牽著車走去送", note: "體力 −6～12；客人可能感動", apply: (c) => { c.energy -= intBetween(c, 6, 12); if (chance(c, 0.4)) { c.fame += 2; log(c, "客人看到你牽車送飲料，多給了 NT$200 小費。"); c.savings += 200; } else c.trust -= 1; } },
      ],
    },
    dog_chase: {
      cat: "urgent", weight: 0.8, fallback: 0, cd: 12, max: 2, cond: (c) => c.stage === "runner",
      title: () => "巷子裡衝出三隻狗",
      body: () => "這條是捷徑，但每次經過都有狗追。",
      options: [
        { label: "繞遠路", note: "這單遲到，老闆信任 −1～2", apply: (c) => { c.trust -= intBetween(c, 1, 2); } },
        { label: "加速衝過去", note: "有機會摔車", apply: (c) => { if (chance(c, 0.3)) { const v = intBetween(c, 5, 15) * 100; c.savings -= v; c.energy -= 10; log(c, `為了閃狗摔車，手肘擦傷，看醫生加修車 NT$${v}。`); } } },
      ],
    },
    elevator_ban: {
      cat: "people", weight: 0.9, fallback: 1, cd: 10, max: 3, cond: (c) => c.stage === "runner",
      title: () => "管理員不讓外送員上樓",
      body: () => "客人在 18 樓，管理員說外送一律放一樓，客人卻堅持要送上去。",
      options: [
        { label: "爬樓梯送上去", note: "體力 −8；客人可能大方", apply: (c) => { c.energy -= 8; if (chance(c, 0.5)) { const v = intBetween(c, 1, 5) * 100; c.savings += v; c.fame += 2; log(c, `18 樓的客人塞了 NT$${v} 給你。`); } } },
        { label: "請客人下樓拿", note: "客人可能給負評", apply: (c) => { if (chance(c, 0.45)) { c.fame -= intBetween(c, 1, 3); log(c, "客人給了一顆星：「外送員態度很差」。"); } } },
      ],
    },
    big_tip: {
      cat: "people", weight: 0.7, fallback: 0, cd: 10, max: 3, cond: (c) => c.stage === "runner" && c.fame >= 4,
      title: () => "豪爽的客人",
      body: () => "一位剛簽下大案子的業務一口氣點了三十杯，說要謝謝你上次準時送到。",
      options: [{ label: "謝謝老闆", note: "小費多少看他心情", apply: (c) => { const v = pick(c, [300, 500, 800, 1200, 2000]); c.savings += v; c.fame += 1; log(c, `收到 NT$${v} 小費。`); } }],
    },
    rating_drop: {
      cat: "urgent", weight: 0.8, fallback: 1, cd: 12, max: 2, cond: (c) => c.stage === "runner" && c.week > 3,
      title: () => "外送平台評分掉到 4.2",
      body: () => "平台說評分再掉，店家會被排到搜尋結果後面。德哥要你想辦法。",
      options: [
        { label: "每單附手寫感謝卡", note: "服務 +2；體力 −4；評分可能回來", apply: (c) => { gain(c, "service", 2); c.energy -= 4; if (chance(c, 0.6)) { c.fame += 3; c.trust += 2; } } },
        { label: "評分本來就看運氣", note: "老闆信任 −2～4", apply: (c) => { c.trust -= intBetween(c, 2, 4); c.fame -= 1; } },
      ],
    },
    police_check: {
      cat: "urgent", weight: 0.7, fallback: 0, cd: 16, max: 2, cond: (c) => c.stage === "runner",
      title: () => "路口臨檢",
      body: () => "警察攔下你，說要看行照和車燈。",
      options: [{ label: "配合檢查", note: "車況不好可能被罰", apply: (c) => { if ((c.flags.scooterOk || 0) > c.week || chance(c, 0.5)) log(c, "臨檢沒事，警察還叫你騎慢一點。"); else { const v = pick(c, [600, 900, 1200, 1800]); c.savings -= v; log(c, `方向燈壞了，被開罰 NT$${v}。`); } } }],
    },
    order_stolen: {
      cat: "urgent", weight: 0.7, fallback: 1, cd: 14, max: 2, cond: (c) => c.stage === "runner",
      title: () => "放在警衛室的飲料不見了",
      body: () => "客人說沒拿到，警衛說他沒看到。",
      options: [
        { label: "自己出錢補送", note: "NT$300～700；老闆信任 +2", apply: (c) => { c.savings -= intBetween(c, 3, 7) * 100; c.trust += 2; } },
        { label: "跟客人說不是我的問題", note: "可能吵起來", apply: (c) => { if (chance(c, 0.5)) { c.fame -= intBetween(c, 1, 3); c.trust -= 2; log(c, "客人打電話到店裡客訴，德哥幫你道歉。"); } } },
      ],
    },
    plum_rain: {
      cat: "people", weight: 0.8, fallback: 1, cd: 20, max: 2, cond: (c) => c.stage === "runner",
      title: () => "梅雨下了一整週",
      body: () => "外送單變多，但路很滑。德哥問你要不要多跑幾單。",
      options: [
        { label: "多跑 6 小時", note: "照時薪＋小費 NT$300～900；有機會滑倒", apply: (c) => { c.flags.extraHours = (c.flags.extraHours || 0) + 6; c.savings += intBetween(c, 3, 9) * 100; c.energy -= 8; if (chance(c, 0.2)) { c.savings -= 1500; c.energy -= 10; log(c, "雨天滑倒，機車修了 NT$1,500。"); } } },
        { label: "照原本的班", note: "", apply: () => {} },
      ],
    },
    phone_broke: {
      cat: "urgent", weight: 0.6, fallback: 1, cd: 30, max: 1,
      title: () => "手機摔壞了",
      body: () => "螢幕碎成蜘蛛網，接單軟體點不太到。",
      options: [
        { label: "買一支新的", note: "NT$6,000～12,000", apply: (c) => { c.savings -= intBetween(c, 6, 12) * 1000; } },
        { label: "送修就好", note: "NT$2,000；有可能修不好", apply: (c) => { c.savings -= 2000; if (chance(c, 0.4)) { c.savings -= 5000; c.trust -= 1; log(c, "修完三天又壞，最後還是買了一支 NT$5,000 的二手機。"); } } },
      ],
    },
    parking_ticket: {
      cat: "urgent", weight: 0.7, fallback: 0, cd: 12, max: 3, cond: (c) => c.stage === "runner",
      title: () => "收到違停罰單",
      body: () => "上週在大樓前停了兩分鐘，被檢舉了。",
      options: [
        { label: "乖乖繳", note: "NT$600", apply: (c) => { c.savings -= 600; } },
        { label: "上網申訴", note: "成功不用繳，失敗要繳 NT$900", apply: (c) => { if (chance(c, 0.45)) log(c, "申訴成功，罰單撤銷。"); else { c.savings -= 900; log(c, "申訴被駁回，還多了逾期的錢。"); } } },
      ],
    },
    traffic_accident: {
      cat: "urgent", weight: 0.5, fallback: 1, cd: 30, max: 1, cond: (c) => c.stage === "runner" && c.week > 3,
      title: () => "跟轎車擦撞",
      body: () => "轎車右轉沒打方向燈，你連人帶車倒在路邊。腳踝腫起來了。",
      options: [
        { label: "當場和解", note: "對方賠一點；你得休息幾天", apply: (c) => { c.savings += intBetween(c, 1, 5) * 1000; c.energy -= 20; c.flags.skipHours = (c.flags.skipHours || 0) + 10; } },
        { label: "報警走保險", note: "拖比較久；結果看運氣", apply: (c) => { c.energy -= 20; c.flags.skipHours = (c.flags.skipHours || 0) + 14; if (chance(c, 0.5)) { c.savings += 8000; log(c, "保險理賠下來了，NT$8,000。"); } else { c.savings -= 3000; log(c, "肇責認定你也有責任，自己付了 NT$3,000 醫藥費。"); } } },
      ],
    },
    wrong_sugar: {
      cat: "urgent", weight: 1, fallback: 0, cd: 10, max: 3, cond: (c) => c.stage === "clerk",
      title: () => "一整張團購單糖度做錯",
      body: () => "四十杯的公司訂單，你把「微糖」看成「半糖」，客人已經在電話裡發火。",
      options: [
        { label: "全部重做、親自送去道歉", note: "體力 −10；結果看你的調飲", apply: (c) => { c.energy -= 10; if (c.skills.brew + intBetween(c, 0, 30) >= 50) { c.trust += 3; c.fame += 2; log(c, "重做得比原本還好喝，那家公司下個月又訂了。"); } else { c.trust -= 3; log(c, "重做還是被嫌太甜，那家公司改訂別家。"); } } },
        { label: "打折給客人", note: "老闆信任 −2～4", apply: (c) => { c.trust -= intBetween(c, 2, 4); } },
      ],
    },
    sealer_broke: {
      cat: "urgent", weight: 0.9, fallback: 1, cd: 14, max: 2, cond: (c) => c.stage === "clerk",
      title: () => "封口機壞了",
      body: () => "下班尖峰前十分鐘，封口機發出焦味，膜一直封不平。",
      options: [
        { label: "自己拆開試著修", note: "看你的營運能力", apply: (c) => { if (c.skills.ops + intBetween(c, 0, 30) >= 40) { c.trust += 4; log(c, "你發現只是加熱片鬆了，鎖緊就好。德哥很驚訝。"); } else { c.trust -= 2; c.savings -= 500; log(c, "越修越糟，還燙傷手，自己去藥局買了燙傷藥。"); } } },
        { label: "改用杯蓋，打電話叫廠商", note: "尖峰出杯變慢；客人可能抱怨", apply: (c) => { if (chance(c, 0.5)) c.fame -= 2; c.trust -= 1; } },
      ],
    },
    till_short: {
      cat: "urgent", weight: 0.8, fallback: 0, cd: 16, max: 2, cond: (c) => c.stage === "clerk",
      title: (c, d) => `收銀短少 NT$${d.amt || 800}`,
      body: () => "關帳時錢對不起來，今天只有你和工讀生兩個人碰過收銀機。",
      make: (c) => ({ amt: intBetween(c, 3, 20) * 100 }),
      options: [
        { label: "自己先補上", note: "老闆信任 +1", apply: (c, d) => { c.savings -= d.amt || 800; c.trust += 1; } },
        { label: "請德哥調監視器", note: "可能還你清白，也可能更尷尬", apply: (c) => { if (chance(c, 0.55)) { c.trust += 3; log(c, "監視器拍到是找錢時多找了，德哥說不怪你。"); } else { c.trust -= 4; log(c, "監視器剛好死角，德哥沒說什麼，但你感覺得到他在懷疑。"); } } },
      ],
    },
    influencer_visit: {
      cat: "people", weight: 0.8, fallback: 1, cd: 14, max: 2, cond: (c) => c.stage === "clerk",
      title: () => "美食網紅走進店裡",
      body: () => "她有二十萬追蹤，點了三杯飲料，手機一直對著吧台拍。",
      options: [
        { label: "親自幫她做，順便介紹", note: "名聲可能大漲，也可能被嫌", apply: (c) => { if (c.skills.brew + c.skills.service + intBetween(c, 0, 40) >= 80) { const v = intBetween(c, 4, 9); c.fame += v; c.trust += 3; log(c, `影片爆了，名聲 +${v}，週末排隊排到騎樓。`); } else { c.fame -= 3; log(c, "影片說「普普通通，不會再來」。"); } } },
        { label: "照平常做", note: "", apply: (c) => { if (chance(c, 0.3)) c.fame += 2; } },
      ],
    },
    rush_crisis: {
      cat: "urgent", weight: 1, fallback: 1, cd: 8, max: 4, cond: (c) => c.stage === "clerk",
      title: () => "外送單一次湧進六十筆",
      body: () => "平台在做免運活動，店裡只有你和一個工讀生。",
      options: [
        { label: "咬牙撐住", note: "體力 −10；看你的服務能力", apply: (c) => { c.energy -= 10; if (c.skills.service + intBetween(c, 0, 30) >= 45) { c.trust += 4; gain(c, "service", 2); log(c, "六十單全部準時出完，德哥請大家吃鹹酥雞。"); } else { c.fame -= intBetween(c, 2, 4); c.trust -= 2; log(c, "出單大亂，平台上多了七則負評。"); } } },
        { label: "暫停接單半小時", note: "老闆信任 −2", apply: (c) => { c.trust -= 2; } },
      ],
    },
    allergy_claim: {
      cat: "urgent", weight: 0.6, fallback: 1, cd: 20, max: 1, cond: (c) => c.stage === "clerk",
      title: () => "客人說喝了過敏",
      body: () => "客人說明明交代不要加堅果，喝完全身起疹子，要求賠醫藥費。",
      options: [
        { label: "誠懇道歉，賠醫藥費", note: "NT$1,000～3,000；名聲 +1", apply: (c) => { c.savings -= intBetween(c, 1, 3) * 1000; c.fame += 1; c.trust += 1; } },
        { label: "堅持店裡沒做錯", note: "對的話沒事；錯的話上新聞", apply: (c) => { if (chance(c, 0.55)) log(c, "查了單子，是客人自己點錯。對方道了歉。"); else { c.fame -= 6; c.trust -= 4; log(c, "客人把事情貼上社團，店被罵了一整週。"); } } },
      ],
    },
    lazy_coworker: {
      cat: "people", weight: 0.9, fallback: 1, cd: 12, max: 2, cond: (c) => c.stage === "clerk",
      title: () => "同事一直躲在後面滑手機",
      body: () => "阿凱每次尖峰都說去拿冰塊，一去就是二十分鐘。",
      options: [
        { label: "跟德哥說", note: "老闆信任 +2；阿凱可能記仇", apply: (c) => { c.trust += 2; if (chance(c, 0.4)) { c.energy -= 6; log(c, "阿凱之後故意把最累的收店工作丟給你。"); } } },
        { label: "自己多做一點", note: "體力 −8；帶人 +1", apply: (c) => { c.energy -= 8; gain(c, "lead", 1); } },
      ],
    },
    mystery_shopper: {
      cat: "urgent", weight: 0.7, fallback: 0, cd: 16, max: 2, cond: (c) => c.stage === "clerk",
      title: () => "神祕客評分結果出來了",
      body: () => "德哥加入的連鎖協會派了神祕客，上週來店裡點了兩杯。",
      options: [{ label: "看結果", note: "看你的服務和調飲", apply: (c) => { const sc = c.skills.service + c.skills.brew + intBetween(c, -15, 25); if (sc >= 85) { c.trust += 6; c.fame += 2; log(c, "神祕客給了九十二分，德哥把評分表貼在牆上。"); } else if (sc >= 60) { c.trust += 1; log(c, "神祕客給了七十五分，「待客親切，出杯偏慢」。"); } else { c.trust -= 5; log(c, "神祕客給了五十八分，德哥一整天沒跟你說話。"); } } }],
    },
    supplier_late: {
      cat: "urgent", weight: 0.9, fallback: 1, cd: 12, max: 3, cond: (c) => c.stage === "clerk",
      title: () => "鮮奶沒送到",
      body: () => "廠商的車在路上拋錨，鮮奶系列中午就會賣完。",
      options: [
        { label: "騎車去量販店補貨", note: "體力 −6；老闆信任 +3", apply: (c) => { c.energy -= 6; c.trust += 3; } },
        { label: "賣完就掛「售完」", note: "名聲 −1～3", apply: (c) => { c.fame -= intBetween(c, 1, 3); } },
      ],
    },
    ice_machine: {
      cat: "urgent", weight: 0.8, fallback: 1, cd: 16, max: 2, cond: (c) => c.stage === "clerk",
      title: () => "製冰機罷工",
      body: () => "三十三度的下午，製冰機只吐出水。",
      options: [
        { label: "去超商買冰塊", note: "自己先墊 NT$400～900；老闆信任 +2", apply: (c) => { c.savings -= intBetween(c, 4, 9) * 100; c.trust += 2; } },
        { label: "只賣少冰、去冰", note: "名聲 −1～3", apply: (c) => { c.fame -= intBetween(c, 1, 3); } },
      ],
    },
    promo_idea: {
      cat: "people", weight: 0.8, fallback: 1, cd: 14, max: 2, cond: (c) => c.stage === "clerk" && c.skills.ops >= 20,
      title: () => "你想到一個促銷點子",
      body: () => "雨天第二杯半價，下雨的時候店裡常常沒人。",
      options: [
        { label: "跟德哥提案", note: "成功信任大增，失敗要負責", apply: (c) => { if (c.skills.ops + intBetween(c, 0, 40) >= 50) { c.trust += 6; c.fame += 3; log(c, "雨天半價大成功，德哥說要寫進加盟手冊。"); } else { c.trust -= 3; log(c, "那週剛好都沒下雨，印好的海報只能收起來。"); } } },
        { label: "先不要好了", note: "", apply: () => {} },
      ],
    },
    parttimer_noshow: {
      cat: "urgent", weight: 1, fallback: 1, cd: 10, max: 3, cond: (c) => c.stage === "clerk",
      title: () => "工讀生沒來上班",
      body: () => "晚班的工讀生傳訊息說「不做了」，然後封鎖了德哥。",
      options: [
        { label: "連上兩個班", note: "多 8 小時（照時薪）；體力 −12；老闆信任 +4", apply: (c) => { c.flags.extraHours = (c.flags.extraHours || 0) + 8; c.energy -= 12; c.trust += 4; } },
        { label: "真的撐不下去", note: "老闆信任 −3", apply: (c) => { c.trust -= 3; } },
      ],
    },
    health_check: {
      cat: "urgent", weight: 0.5, fallback: 0, cd: 40, max: 1, cond: (c) => c.stage === "clerk",
      title: () => "要補員工健康檢查",
      body: () => "衛生局規定餐飲從業人員每年要體檢，店裡不幫出。",
      options: [{ label: "去醫院做", note: "NT$500～1,200", apply: (c) => { c.savings -= intBetween(c, 5, 12) * 100; } }],
    },
    boss_mood: {
      cat: "people", weight: 0.9, fallback: 1, cd: 10, max: 3, cond: (c) => c.week > 6,
      title: () => "德哥今天心情很差",
      body: () => "聽說房東又來談漲租，德哥一早就在後面摔東西。",
      options: [
        { label: "泡一杯他最愛的凍頂給他", note: "可能被罵，也可能被記住", apply: (c) => { if (chance(c, 0.6)) { c.trust += intBetween(c, 2, 4); log(c, "德哥喝了一口，嘆氣說謝謝。"); } else { c.trust -= 1; log(c, "德哥說：「誰叫你泡的？去做事。」"); } } },
        { label: "離他遠一點", note: "", apply: (c) => { if (chance(c, 0.3)) c.trust -= 1; } },
      ],
    },
    overslept: {
      cat: "urgent", weight: 0.8, fallback: 0, cd: 12, max: 3, cond: (c) => c.energy < 45,
      title: () => "睡過頭了",
      body: () => "鬧鐘沒響（或是你按掉了），醒來已經遲到一個小時。",
      options: [
        { label: "道歉，下班補時數", note: "多上 4 小時（照時薪）；老闆信任 −1", apply: (c) => { c.flags.extraHours = (c.flags.extraHours || 0) + 4; c.trust -= 1; c.energy -= 4; } },
        { label: "說機車拋錨", note: "被拆穿就慘了", apply: (c) => { if (chance(c, 0.6)) log(c, "德哥沒多問。"); else { c.trust -= 6; log(c, "同事看到你從家裡慢慢走出來。德哥很生氣。"); } } },
      ],
    },
    toothache: {
      cat: "urgent", weight: 0.6, fallback: 1, cd: 30, max: 1,
      title: () => "智齒痛到睡不著",
      body: () => "牙醫說要拔，但健保不給付的部分要自費。",
      options: [
        { label: "去拔", note: "NT$1,500～5,000；休息半天", apply: (c) => { c.savings -= intBetween(c, 15, 50) * 100; c.flags.skipHours = (c.flags.skipHours || 0) + 4; } },
        { label: "先吃止痛藥撐著", note: "體力 −8；可能更嚴重", apply: (c) => { c.energy -= 8; if (chance(c, 0.35)) { c.savings -= 6000; c.flags.skipHours = (c.flags.skipHours || 0) + 8; log(c, "拖到發炎，最後花了 NT$6,000 還請了一天假。"); } } },
      ],
    },
    family_money: {
      cat: "people", weight: 0.6, fallback: 1, cd: 26, max: 2, cond: (c) => c.week > 5,
      title: () => "家裡需要錢",
      body: () => "爸爸工廠減班，媽媽小心地問你這個月能不能幫忙一點。",
      options: [
        { label: "寄錢回家", note: "NT$3,000～8,000；家裡會記得", apply: (c) => { c.savings -= intBetween(c, 3, 8) * 1000; c.flags.familyOk = 1; c.energy += 4; } },
        { label: "說這個月真的不行", note: "心裡過意不去，體力 −5", apply: (c) => { c.energy -= 5; } },
      ],
    },
    friend_borrow: {
      cat: "people", weight: 0.6, fallback: 1, cd: 30, max: 1,
      title: () => "高職同學想跟你借 NT$5,000",
      body: () => "他說下個月薪水進來就還，語氣聽起來很急。",
      options: [
        { label: "借他", note: "可能還，也可能不還", apply: (c) => { c.savings -= 5000; c.flags.loanBack = c.week + intBetween(c, 4, 8); } },
        { label: "婉拒", note: "他可能不太高興", apply: (c) => { if (chance(c, 0.5)) log(c, "同學說沒關係，之後就很少聯絡了。"); } },
      ],
    },
    receipt_lottery: {
      cat: "people", weight: 0.5, fallback: 0, cd: 8, max: 3,
      title: () => "統一發票對獎",
      body: () => "你把整個月的發票攤在床上一張一張對。",
      options: [{ label: "對！", note: "看運氣", apply: (c) => { const v = pick(c, [0, 0, 200, 200, 1000, 4000]); c.savings += v; log(c, v ? `中了 NT$${v}！` : "一張都沒中。"); } }],
    },
    caught_cold: {
      cat: "urgent", weight: 0.8, fallback: 1, cd: 12, max: 3,
      title: () => "感冒了",
      body: () => "喉嚨痛、鼻塞，量了一下 37.8 度。",
      options: [
        { label: "請假休息兩天", note: "少 8 小時；老闆信任 −1", apply: (c) => { c.flags.skipHours = (c.flags.skipHours || 0) + 8; c.trust -= 1; c.energy += 6; } },
        { label: "戴口罩硬撐", note: "體力 −10～18；可能變嚴重", apply: (c) => { c.energy -= intBetween(c, 10, 18); if (chance(c, 0.3)) c.inbox.push(ev(c, "sick")); } },
      ],
    },
    scooter_stolen: {
      cat: "urgent", weight: 0.35, fallback: 0, cd: 40, max: 1, cond: (c) => c.week > 8,
      title: () => "機車被偷了",
      body: () => "早上下樓，停車格空空的。警察說找回來的機會不大。",
      options: [
        { label: "買一台二手機車", note: "NT$12,000～18,000", apply: (c) => { c.savings -= intBetween(c, 12, 18) * 1000; } },
        { label: "先坐公車上班", note: "通勤累，好幾週體力都會比較差", apply: (c) => { c.energy -= 10; c.flags.farHome = 1; c.trust -= 2; } },
      ],
    },
    ac_broke: {
      cat: "urgent", weight: 0.6, fallback: 1, cd: 30, max: 1, cond: (c) => c.week > 4,
      title: () => "租屋的冷氣壞了",
      body: () => "房東說「舊冷氣本來就這樣」，要你自己找人修。",
      options: [
        { label: "自己出錢修", note: "NT$1,000～3,000", apply: (c) => { c.savings -= intBetween(c, 10, 30) * 100; } },
        { label: "開電風扇撐過去", note: "睡不好，體力 −6；之後幾週也比較累", apply: (c) => { c.energy -= 6; c.flags.hotRoom = c.week + 6; } },
      ],
    },
    course_sale: {
      cat: "people", weight: 0.6, fallback: 1, cd: 20, max: 2,
      title: () => "線上課程限時優惠",
      body: () => "「餐飲創業實戰班」原價一萬二，今天特價 NT$2,000。",
      options: [
        { label: "買了", note: "營運 +3～6；有可能是灌水課程", apply: (c) => { c.savings -= 2000; if (chance(c, 0.7)) gain(c, "ops", intBetween(c, 3, 6)); else log(c, "課程內容都是網路上抄來的，有點後悔。"); } },
        { label: "不買", note: "", apply: () => {} },
      ],
    },
    cousin_wedding: {
      cat: "people", weight: 0.5, fallback: 1, cd: 30, max: 1, cond: (c) => c.week > 6,
      title: () => "表姊要結婚了",
      body: () => "婚禮在週六中午，家族的人都會到，媽媽希望你一定要來。",
      options: [
        { label: "請假去，包紅包", note: "NT$1,600～3,600；少 8 小時；家裡很開心", apply: (c) => { c.savings -= pick(c, [1600, 2200, 2600, 3600]); c.flags.skipHours = (c.flags.skipHours || 0) + 8; c.flags.familyOk = 1; c.energy += 5; } },
        { label: "說要上班，紅包託媽媽帶", note: "NT$1,600；媽媽有點失望", apply: (c) => { c.savings -= 1600; c.energy -= 3; } },
      ],
    },
    side_hustle: {
      cat: "people", weight: 0.5, fallback: 1, cd: 30, max: 1,
      title: () => "朋友找你一起做代購",
      body: () => "他說日本零食轉賣很好賺，要你出 NT$5,000 一起進貨。",
      options: [
        { label: "一起做", note: "可能賺，也可能賠", apply: (c) => { const v = intBetween(c, -5, 7) * 1000; c.savings += v; log(c, v >= 0 ? `代購賺了 NT$${v}。` : `代購的零食過期賣不掉，賠了 NT$${-v}。`); } },
        { label: "不要", note: "", apply: () => {} },
      ],
    },
    stock_tip: {
      cat: "people", weight: 0.5, fallback: 1, cd: 26, max: 2, cond: (c) => c.savings > 15000,
      title: () => "同事報明牌",
      body: () => "阿凱說他表哥在證券公司，這支股票下週一定漲。",
      options: [
        { label: "投 NT$10,000", note: "看運氣", apply: (c) => { const v = intBetween(c, -8, 9) * 1000; c.savings += v; log(c, v >= 0 ? `那支股票真的漲了，賺 NT$${v}。` : `買在最高點，賠了 NT$${-v}。`); } },
        { label: "不碰股票", note: "", apply: () => {} },
      ],
    },
    typhoon_day: {
      cat: "urgent", weight: 0.7, fallback: 0, cd: 20, max: 2,
      title: () => "颱風假",
      body: () => "市政府宣布停班停課。德哥說店要不要開讓大家自己決定。",
      options: [
        { label: "待在家", note: "少 8 小時薪水，體力 +8", apply: (c) => { c.flags.skipHours = (c.flags.skipHours || 0) + 8; c.energy += 8; } },
        { label: "去店裡顧", note: "多 6 小時、加給；路上危險", apply: (c) => { c.flags.extraHours = (c.flags.extraHours || 0) + 6; c.savings += 1200; c.trust += 3; if (chance(c, 0.15)) { c.energy -= 15; c.savings -= 2000; log(c, "颱風天騎車被招牌砸到，人沒事，車修了 NT$2,000。"); } } },
      ],
    },
    blood_drive: {
      cat: "people", weight: 0.4, fallback: 1, cd: 20, max: 2,
      title: () => "捐血車停在店門口",
      body: () => "護理師說今天 O 型血很缺。",
      options: [
        { label: "捐一袋", note: "體力 −5；名聲 +1", apply: (c) => { c.energy -= 5; c.fame += 1; } },
        { label: "下次", note: "", apply: () => {} },
      ],
    },
    insomnia: {
      cat: "people", weight: 0.6, fallback: 0, cd: 12, max: 3, cond: (c) => c.week > 4,
      title: () => "連續好幾天睡不著",
      body: () => "一閉上眼睛就在想存款和下個月的房租。",
      options: [
        { label: "下班去跑步", note: "體力 −4 換之後比較好睡", apply: (c) => { c.energy -= 4; c.fit = clamp((c.fit || 0) + 1, 0, 10); } },
        { label: "滑手機到天亮", note: "體力 −6～12", apply: (c) => { c.energy -= intBetween(c, 6, 12); } },
      ],
    },
    online_scam: {
      cat: "urgent", weight: 0.5, fallback: 0, cd: 30, max: 1,
      title: () => "網購的球鞋一直沒寄來",
      body: () => "賣家的帳號不見了，你付了 NT$2,400。",
      options: [
        { label: "報警", note: "錢多半拿不回來", apply: (c) => { c.savings -= 2400; if (chance(c, 0.2)) { c.savings += 2400; log(c, "警察真的抓到人，錢退回來了。"); } } },
        { label: "算了，當學費", note: "", apply: (c) => { c.savings -= 2400; } },
      ],
    },
    employee_month: {
      cat: "people", weight: 0.6, fallback: 0, cd: 12, max: 3, cond: (c) => c.trust >= 55,
      title: () => "你是這個月的最佳員工",
      body: () => "德哥在晨會上宣布，還包了紅包。",
      options: [{ label: "收下", note: "紅包多少看這個月店裡生意", apply: (c) => { const v = intBetween(c, 5, 30) * 100; c.savings += v; c.trust += 2; log(c, `紅包裡有 NT$${v}。`); } }],
    },
    rival_bogo: {
      cat: "people", weight: 0.8, fallback: 1, cd: 16, max: 2, cond: (c) => c.stage === "clerk",
      title: () => "對面的店開始買一送一",
      body: () => "這週店裡的客人少了三成，德哥問大家有沒有辦法。",
      options: [
        { label: "建議推會員集點", note: "看你的營運", apply: (c) => { if (c.skills.ops + intBetween(c, 0, 30) >= 40) { c.trust += 4; log(c, "集點卡推出兩週，熟客都回來了。"); } else { c.trust -= 2; log(c, "集點卡沒人在用，印了五百張。"); } } },
        { label: "多做一點服務，留住熟客", note: "看你的服務", apply: (c) => { if (c.skills.service + intBetween(c, 0, 30) >= 45) { c.fame += 3; gain(c, "service", 1); } else c.fame -= 2; } },
      ],
    },
    dirty_video: {
      cat: "urgent", weight: 0.6, fallback: 1, cd: 26, max: 1, cond: (c) => c.stage === "clerk",
      title: () => "有人拍到店裡的冰桶沒蓋",
      body: () => "影片在地方社團被分享了兩百次，留言都在問「還敢喝嗎」。",
      options: [
        { label: "帶頭大掃除、拍改善影片", note: "體力 −8；老闆信任 +3；名聲看反應", apply: (c) => { c.energy -= 8; c.trust += 3; c.fame += chance(c, 0.5) ? 2 : -2; } },
        { label: "等風頭過去", note: "名聲 −4～8；老闆信任 −2", apply: (c) => { c.fame -= intBetween(c, 4, 8); c.trust -= 2; } },
      ],
    },
    boss_son: {
      cat: "people", weight: 0.6, fallback: 1, max: 1, cond: (c) => c.stage === "clerk" && c.week > 14,
      title: () => "德哥的兒子來店裡實習",
      body: () => "大學剛畢業，什麼都覺得「效率很差」，第一天就改了你排好的備料表。",
      options: [
        { label: "耐心教他", note: "帶人 +2；他可能聽，也可能去告狀", apply: (c) => { gain(c, "lead", 2); if (chance(c, 0.6)) { c.trust += 3; log(c, "德哥的兒子後來跟德哥說你很會教。"); } else { c.trust -= 3; log(c, "他跟德哥說你「很難溝通」。"); } } },
        { label: "照規矩來，不讓他亂改", note: "老闆信任 ±", apply: (c) => { c.trust += chance(c, 0.5) ? 2 : -3; } },
      ],
    },
    late_delivery_fine: {
      cat: "urgent", weight: 0.7, fallback: 0, cd: 12, max: 3, cond: (c) => c.stage === "runner" && c.routes < 50,
      title: () => "迷路送晚了二十分鐘",
      body: () => "新開的社區門牌很亂，你繞了三圈才找到。",
      options: [
        { label: "跟客人道歉", note: "客人可能取消訂單", apply: (c) => { if (chance(c, 0.4)) { c.savings -= 300; c.trust -= 2; log(c, "客人拒收，飲料錢從你薪水扣。"); } else c.trust -= 1; } },
      ],
    },
    regular_moves: {
      cat: "people", weight: 0.5, fallback: 0, max: 1, cond: (c) => c.fame >= 8 && c.week > 10,
      title: () => "最常點的熟客要搬家了",
      body: () => "每週三固定點十杯的設計公司要搬到台北。",
      options: [{ label: "最後一次送去", note: "", apply: (c) => { c.fame -= 2; log(c, "設計公司的人說會想念你們的珍奶，還寫了一張卡片。"); } }],
    },
    heat_stroke: {
      cat: "urgent", weight: 0.6, fallback: 0, cd: 20, max: 2, cond: (c) => c.energy < 50,
      title: () => "中午差點中暑",
      body: () => "36 度的大太陽下排隊等紅燈，眼前一黑。",
      options: [
        { label: "去超商吹冷氣休息", note: "這單遲到；體力 +4", apply: (c) => { c.trust -= 1; c.energy += 4; } },
        { label: "灌一瓶運動飲料繼續", note: "體力 −8；有機會真的倒下", apply: (c) => { c.energy -= 8; if (chance(c, 0.25)) c.inbox.push(ev(c, "sick")); } },
      ],
    },
    customer_praise: {
      cat: "people", weight: 0.6, fallback: 0, cd: 10, max: 3, cond: (c) => c.skills.service >= 20,
      title: () => "客人在 Google 評論點名誇你",
      body: (c) => `「${c.name}很細心，記得我不要珍珠要椰果。」`,
      options: [{ label: "截圖傳給媽媽", note: "名聲 +1～3", apply: (c) => { c.fame += intBetween(c, 1, 3); c.energy += 3; } }],
    },
    tax_refund: {
      cat: "people", weight: 0.4, fallback: 0, max: 1, cond: (c) => c.week > 20,
      title: () => "報稅季",
      body: () => "第一次自己報所得稅，手機 App 跳出試算結果。",
      options: [{ label: "送出", note: "看結果", apply: (c) => { const v = intBetween(c, -3, 6) * 500; c.savings += v; log(c, v >= 0 ? `可以退稅 NT$${v}。` : `還要補繳 NT$${-v}。`); } }],
    },
    gym_injury: {
      cat: "urgent", weight: 0.4, fallback: 0, cd: 30, max: 1, cond: (c) => (c.fit || 0) >= 3,
      title: () => "打球扭到腳",
      body: () => "下班去打籃球，落地時踩到別人的腳。",
      options: [{ label: "去看骨科", note: "NT$800～2,000；這週少 6 小時", apply: (c) => { c.savings -= intBetween(c, 8, 20) * 100; c.flags.skipHours = (c.flags.skipHours || 0) + 6; c.energy -= 6; } }],
    },
    power_bill: {
      cat: "urgent", weight: 0.5, fallback: 0, cd: 26, max: 2, cond: (c) => c.week > 8,
      title: () => "夏天的電費單來了",
      body: () => "雅房的電錶是房東自己裝的，一度算六塊。",
      options: [
        { label: "照付", note: "NT$1,200～2,800", apply: (c) => { c.savings -= intBetween(c, 12, 28) * 100; } },
        { label: "跟房東理論", note: "可能少付，也可能被趕", apply: (c) => { if (chance(c, 0.5)) { c.savings -= 1000; log(c, "房東讓步，改成一度五塊。"); } else { c.savings -= 2800; c.energy -= 4; log(c, "房東說不爽可以搬走，最後還是全付。"); } } },
      ],
    },
    // 10/24 第二批：再加 70 種（外送 20、店員 25、生活 25），降低重複
    wrong_change: {
      cat: "urgent", weight: 0.7, fallback: 0, cd: 14, max: 2, cond: (c) => c.stage === "runner",
      title: () => "貨到付款找錯錢",
      body: () => "回店裡對帳才發現，剛剛那位客人你多找了一張。",
      options: [
        { label: "自己吸收", note: "NT$100～500", apply: (c) => { c.savings -= pick(c, [100, 100, 500]); } },
        { label: "打電話問客人", note: "客人可能還，也可能不理你", apply: (c) => { if (chance(c, 0.5)) { c.fame += 1; log(c, "客人笑說「我還以為你送我的」，把錢轉回來了。"); } else { c.savings -= 500; c.trust -= 1; log(c, "客人說他沒拿到，還客訴你態度不好。"); } } },
      ],
    },
    factory_gate: {
      cat: "urgent", weight: 0.7, fallback: 1, cd: 14, max: 2, cond: (c) => c.stage === "runner",
      title: () => "科技廠門口要換證",
      body: () => "警衛說外送員要等員工下來領，客人卻在會議裡沒接電話。",
      options: [
        { label: "在門口等", note: "後面兩單會遲到", apply: (c) => { c.trust -= intBetween(c, 1, 3); if (chance(c, 0.4)) { c.savings += 300; log(c, "客人開完會下來，覺得不好意思，給了 NT$300。"); } } },
        { label: "交給警衛先走", note: "客人可能找不到", apply: (c) => { if (chance(c, 0.35)) { c.fame -= 2; log(c, "飲料在警衛室放到退冰，客人給了負評。"); } } },
      ],
    },
    drunk_customer: {
      cat: "urgent", weight: 0.6, fallback: 1, cd: 16, max: 2, cond: (c) => c.stage === "runner" && c.week > 2,
      title: () => "宵夜單的客人喝醉了",
      body: () => "他一直要你進屋陪他喝一杯，錢也拿不出來。",
      options: [
        { label: "耐心等他找錢", note: "多花半小時", apply: (c) => { c.energy -= 4; if (chance(c, 0.5)) { c.savings += 500; log(c, "他最後塞了一張五百說不用找。"); } else c.trust -= 1; } },
        { label: "把飲料帶回店裡", note: "這單算店裡的損失", apply: (c) => { c.trust -= 1; } },
      ],
    },
    helmet_stolen: {
      cat: "urgent", weight: 0.5, fallback: 0, cd: 30, max: 1, cond: (c) => c.stage === "runner",
      title: () => "安全帽被偷了",
      body: () => "掛在機車上不到五分鐘就不見了。",
      options: [
        { label: "買一頂新的", note: "NT$400～1,200", apply: (c) => { c.savings -= intBetween(c, 4, 12) * 100; } },
        { label: "先借店裡的舊安全帽", note: "很臭，但能撐", apply: (c) => { c.energy -= 2; } },
      ],
    },
    road_works: {
      cat: "people", weight: 0.7, fallback: 0, cd: 14, max: 2, cond: (c) => c.stage === "runner",
      title: () => "主要道路在挖馬路",
      body: () => "這兩週要繞一大圈，每單多五分鐘。",
      options: [
        { label: "研究替代路線", note: "路線熟悉度 +5～10；這週體力 −4", apply: (c) => { c.routes = clamp(c.routes + intBetween(c, 5, 10), 0, 100); c.energy -= 4; } },
        { label: "照舊騎，遲到就遲到", note: "老闆信任 −1～3", apply: (c) => { c.trust -= intBetween(c, 1, 3); } },
      ],
    },
    kitten_rescue: {
      cat: "people", weight: 0.5, fallback: 1, max: 1, cond: (c) => c.stage === "runner",
      title: () => "路邊的紙箱裡有一隻小貓",
      body: () => "下著小雨，小貓一直叫，你手上還有兩單。",
      options: [
        { label: "先抱去附近的獸醫", note: "NT$800；兩單遲到；你拍的照片可能被轉傳", apply: (c) => { c.savings -= 800; c.trust -= 2; if (chance(c, 0.5)) { c.fame += 5; log(c, "你抱小貓的照片在地方社團被轉了上千次。"); } } },
        { label: "打給動保處就走", note: "", apply: (c) => { c.energy -= 2; } },
      ],
    },
    hospital_order: {
      cat: "people", weight: 0.6, fallback: 0, cd: 16, max: 2, cond: (c) => c.stage === "runner",
      title: () => "醫院護理站的大單",
      body: () => "夜班護理師訂了二十五杯，要送到十二樓護理站。",
      options: [{ label: "送過去", note: "小費看大家心情", apply: (c) => { const v = intBetween(c, 1, 8) * 100; c.savings += v; c.fame += 1; log(c, `護理師們湊了 NT$${v} 小費，還說「辛苦了」。`); } }],
    },
    parking_fight: {
      cat: "urgent", weight: 0.6, fallback: 1, cd: 16, max: 2, cond: (c) => c.stage === "runner",
      title: () => "別家的外送員說你搶他的位子",
      body: () => "大樓前只有一個臨停位，對方開始大聲罵人。",
      options: [
        { label: "跟他理論", note: "可能吵贏，也可能被拍上網", apply: (c) => { if (chance(c, 0.5)) log(c, "對方罵一罵騎走了。"); else { c.fame -= 3; c.trust -= 2; log(c, "吵架的影片被上傳，大家都看得到你制服上的店名。"); } } },
        { label: "讓給他，停遠一點", note: "體力 −3", apply: (c) => { c.energy -= 3; } },
      ],
    },
    gps_down: {
      cat: "urgent", weight: 0.6, fallback: 0, cd: 14, max: 2, cond: (c) => c.stage === "runner",
      title: () => "導航 App 當機",
      body: () => "手上五單，地址都在不熟的重劃區。",
      options: [{ label: "靠記憶和路標硬送", note: "看你的路線熟悉度", apply: (c) => { if (c.routes + intBetween(c, 0, 40) >= 50) { c.routes = clamp(c.routes + 3, 0, 100); log(c, "五單都送到了，你比導航還熟。"); } else { c.trust -= 3; c.energy -= 5; log(c, "繞了四十分鐘，兩位客人取消訂單。"); } } }],
    },
    raincoat_torn: {
      cat: "urgent", weight: 0.5, fallback: 1, cd: 20, max: 2, cond: (c) => c.stage === "runner",
      title: () => "雨衣破了一個大洞",
      body: () => "下午的雷陣雨把你淋得全身濕。",
      options: [
        { label: "買一件好一點的雨衣", note: "NT$600～1,200", apply: (c) => { c.savings -= intBetween(c, 6, 12) * 100; } },
        { label: "貼膠帶撐著", note: "可能感冒", apply: (c) => { c.energy -= 4; if (chance(c, 0.35)) c.inbox.push(ev(c, "caught_cold")); } },
      ],
    },
    not_cold_enough: {
      cat: "urgent", weight: 0.6, fallback: 0, cd: 12, max: 2, cond: (c) => c.stage === "runner",
      title: () => "客人說飲料不冰",
      body: () => "大熱天送了二十分鐘，冰塊都化了。客人要求重送。",
      options: [
        { label: "回店裡重送", note: "體力 −5；客人滿意度看運氣", apply: (c) => { c.energy -= 5; if (chance(c, 0.6)) { c.fame += 1; c.trust += 1; } else c.trust -= 1; } },
        { label: "道歉，給下次折價券", note: "客人可能不買單", apply: (c) => { if (chance(c, 0.4)) c.fame -= 2; } },
      ],
    },
    baby_cake: {
      cat: "people", weight: 0.4, fallback: 0, max: 1, cond: (c) => c.stage === "runner" && c.fame >= 6,
      title: () => "熟客送你彌月蛋糕",
      body: () => "常點珍奶的工程師當爸爸了，特地留了一盒給你。",
      options: [{ label: "恭喜他", note: "體力 +3；名聲 +1", apply: (c) => { c.energy += 3; c.fame += 1; } }],
    },
    lonely_grandpa: {
      cat: "people", weight: 0.5, fallback: 1, max: 1, cond: (c) => c.stage === "runner" && c.week > 4,
      title: () => "獨居阿公每天都點一杯",
      body: () => "他其實不太喝甜的，只是想有人跟他說說話。",
      options: [
        { label: "每次多聊五分鐘", note: "服務 +2；名聲 +1；後面的單會晚一點", apply: (c) => { gain(c, "service", 2); c.fame += 1; c.trust -= 1; } },
        { label: "送到就走", note: "", apply: () => {} },
      ],
    },
    prank_order: {
      cat: "urgent", weight: 0.5, fallback: 0, cd: 20, max: 2, cond: (c) => c.stage === "runner",
      title: () => "惡作劇訂單",
      body: () => "地址是一間空屋，電話是空號。十杯飲料白做了。",
      options: [{ label: "回店裡報告", note: "德哥說要不要扣你看心情", apply: (c) => { if (chance(c, 0.5)) { c.savings -= intBetween(c, 2, 6) * 100; log(c, "德哥說下次貨到付款的大單要先打電話確認，這次扣你一點。"); } else log(c, "德哥嘆氣：「不是你的錯。」"); } }],
    },
    platform_bonus: {
      cat: "people", weight: 0.6, fallback: 1, cd: 14, max: 3, cond: (c) => c.stage === "runner",
      title: () => "平台衝單獎勵",
      body: () => "這週送滿一百二十單，平台加發獎金。",
      options: [
        { label: "拚拚看", note: "多 8 小時；達標獎金 NT$1,000～2,000，沒達標就白累", apply: (c) => { c.flags.extraHours = (c.flags.extraHours || 0) + 8; c.energy -= 10; if (c.routes + intBetween(c, 0, 60) >= 55) { const v = intBetween(c, 10, 20) * 100; c.savings += v; log(c, `衝單成功，平台獎金 NT$${v}。`); } else log(c, "差六單沒達標，獎金一毛都沒有。"); } },
        { label: "照平常跑", note: "", apply: () => {} },
      ],
    },
    emission_check: {
      cat: "urgent", weight: 0.4, fallback: 0, cd: 40, max: 1, cond: (c) => c.stage === "runner",
      title: () => "機車排氣定檢通知",
      body: () => "老機車排氣不合格的話要罰錢。",
      options: [
        { label: "先去保養再檢驗", note: "NT$800；一定過", apply: (c) => { c.savings -= 800; c.flags.scooterOk = c.week + 8; } },
        { label: "直接去驗", note: "沒過要罰 NT$1,500", apply: (c) => { if ((c.flags.scooterOk || 0) > c.week || chance(c, 0.5)) log(c, "排氣檢驗過了。"); else { c.savings -= 1500; log(c, "排氣不合格，罰了 NT$1,500。"); } } },
      ],
    },
    night_robbery: {
      cat: "urgent", weight: 0.25, fallback: 0, max: 1, cond: (c) => c.stage === "runner" && c.week > 6,
      title: () => "深夜送餐遇到搶劫",
      body: () => "兩個人攔下你，要你把錢包和手機交出來。",
      options: [
        { label: "東西給他們，保命要緊", note: "損失 NT$3,000～8,000", apply: (c) => { c.savings -= intBetween(c, 3, 8) * 1000; c.energy -= 15; log(c, "報了警，但東西沒找回來。好幾天晚上都睡不好。"); } },
        { label: "騎車衝出去", note: "很危險", apply: (c) => { if (chance(c, 0.5)) { c.energy -= 8; log(c, "你衝出巷子，一路騎到派出所。"); } else { c.energy -= 30; c.savings -= 5000; c.flags.skipHours = (c.flags.skipHours || 0) + 16; log(c, "被拉下車受了傷，錢也被搶走，請了兩天假。"); } } },
      ],
    },
    runner_quits: {
      cat: "people", weight: 0.6, fallback: 1, max: 2, cond: (c) => c.stage === "runner" && c.week > 3,
      title: () => "另一位外送員不做了",
      body: () => "阿弘說他要去跑貨運，店裡的外送只剩你一個。",
      options: [
        { label: "多扛一點", note: "多 8 小時（照時薪＋小費）；體力 −12", apply: (c) => { c.flags.extraHours = (c.flags.extraHours || 0) + 8; c.energy -= 12; c.savings += intBetween(c, 3, 8) * 100; c.trust += 3; } },
        { label: "跟德哥說要找人", note: "老闆信任 −1", apply: (c) => { c.trust -= 1; } },
      ],
    },
    same_name_shop: {
      cat: "urgent", weight: 0.5, fallback: 0, cd: 20, max: 1, cond: (c) => c.stage === "runner",
      title: () => "送到同名的另一家公司",
      body: () => "兩家都叫「大成」，你送錯了，正確的那家在另一個區。",
      options: [{ label: "趕快拿回來重送", note: "看對方肯不肯還", apply: (c) => { if (chance(c, 0.6)) { c.energy -= 6; c.trust -= 1; } else { c.savings -= 600; c.trust -= 3; log(c, "對方已經喝掉一半，只好重做一份，錢從你薪水扣。"); } } }],
    },
    coffee_coupon: {
      cat: "people", weight: 0.5, fallback: 0, cd: 12, max: 2, cond: (c) => c.stage === "runner",
      title: () => "客人在袋子上留了紙條",
      body: () => "「謝謝你每天風雨無阻」，裡面夾了一張咖啡券。",
      options: [{ label: "收好", note: "體力 +3", apply: (c) => { c.energy += 3; c.fame += intBetween(c, 0, 1); } }],
    },
    pearls_burnt: {
      cat: "urgent", weight: 0.8, fallback: 0, cd: 12, max: 2, cond: (c) => c.stage === "clerk",
      title: () => "珍珠煮焦了",
      body: () => "你在忙櫃台，忘了關火，一整鍋珍珠黏在鍋底。",
      options: [
        { label: "跟德哥坦白，重煮", note: "賣斷一小時；老闆信任 −1～3", apply: (c) => { c.trust -= intBetween(c, 1, 3); } },
        { label: "挑沒焦的部分先用", note: "被客人喝出來就慘了", apply: (c) => { if (chance(c, 0.5)) log(c, "沒人發現。"); else { c.fame -= 4; c.trust -= 4; log(c, "客人喝到焦味，拍照貼上評論。"); } } },
      ],
    },
    new_pos: {
      cat: "people", weight: 0.6, fallback: 0, max: 1, cond: (c) => c.stage === "clerk",
      title: () => "店裡換了新的點餐系統",
      body: () => "德哥要你先學會，再教其他人。",
      options: [{ label: "下班留下來研究", note: "看你的營運能力", apply: (c) => { c.energy -= 4; if (c.skills.ops + intBetween(c, 0, 30) >= 35) { gain(c, "ops", 3); c.trust += 3; log(c, "你把新系統摸熟了，還做了一張操作小抄。"); } else { c.trust -= 2; log(c, "第一天上線就當機兩次，排隊排到門外。"); } } }],
    },
    child_slip: {
      cat: "urgent", weight: 0.5, fallback: 0, cd: 30, max: 1, cond: (c) => c.stage === "clerk",
      title: () => "小孩踩到飲料滑倒",
      body: () => "地上的冰沙還沒擦，小朋友跌倒哭了，家長很生氣。",
      options: [
        { label: "道歉，陪他們去診所", note: "NT$500～2,000；名聲看家長", apply: (c) => { c.savings -= intBetween(c, 5, 20) * 100; c.fame += chance(c, 0.6) ? 1 : -2; } },
        { label: "請德哥處理", note: "老闆信任 −3", apply: (c) => { c.trust -= 3; } },
      ],
    },
    celebrity_order: {
      cat: "people", weight: 0.4, fallback: 0, max: 1, cond: (c) => c.stage === "clerk" && c.fame >= 12,
      title: () => "藝人的經紀公司來訂飲料",
      body: () => "附近在拍戲，劇組要六十杯，指定要你們的招牌。",
      options: [{ label: "全力做好", note: "看你的調飲", apply: (c) => { c.energy -= 8; if (c.skills.brew + intBetween(c, 0, 30) >= 55) { c.fame += intBetween(c, 5, 10); c.trust += 3; log(c, "主角在限動拍了你們的飲料，隔天門口排了三十個人。"); } else { c.fame += 1; log(c, "劇組喝完沒什麼反應。"); } } }],
    },
    expired_milk: {
      cat: "urgent", weight: 0.6, fallback: 0, cd: 20, max: 2, cond: (c) => c.stage === "clerk",
      title: () => "冰箱裡有兩瓶過期鮮奶",
      body: () => "過期一天，看起來還好。德哥不在店裡。",
      options: [
        { label: "倒掉，記在報廢表", note: "老闆信任 +2", apply: (c) => { c.trust += 2; } },
        { label: "先用掉，不要浪費", note: "可能沒事，也可能出大事", apply: (c) => { if (chance(c, 0.7)) log(c, "沒有人喝出問題。"); else { c.fame -= 8; c.trust -= 8; log(c, "兩位客人喝完肚子痛，衛生局來店裡查。"); } } },
      ],
    },
    fridge_alarm: {
      cat: "urgent", weight: 0.5, fallback: 1, cd: 20, max: 2, cond: (c) => c.stage === "clerk",
      title: () => "半夜冰箱溫度警報",
      body: () => "手機收到店裡冰箱的警報，現在是凌晨一點。",
      options: [
        { label: "騎車回店裡處理", note: "體力 −8；老闆信任 +4", apply: (c) => { c.energy -= 8; c.trust += 4; } },
        { label: "傳訊息給德哥就睡", note: "原料可能壞掉", apply: (c) => { if (chance(c, 0.5)) { c.trust -= 3; log(c, "早上來一整冰箱鮮奶都壞了，德哥問你為什麼沒去看。"); } } },
      ],
    },
    coworker_fight: {
      cat: "urgent", weight: 0.6, fallback: 1, cd: 16, max: 2, cond: (c) => c.stage === "clerk",
      title: () => "兩個同事在吧台吵起來",
      body: () => "為了誰要洗杯子，聲音大到客人都在看。",
      options: [
        { label: "出面調解", note: "看你的帶人能力", apply: (c) => { if (c.skills.lead + intBetween(c, 0, 30) >= 30) { gain(c, "lead", 3); c.trust += 2; log(c, "你重新排了清潔表，兩個人都接受了。"); } else { c.trust -= 2; log(c, "兩個人都覺得你偏袒對方。"); } } },
        { label: "裝作沒看到", note: "客人可能留負評", apply: (c) => { if (chance(c, 0.4)) c.fame -= 2; } },
      ],
    },
    order_cancelled: {
      cat: "urgent", weight: 0.6, fallback: 0, cd: 16, max: 2, cond: (c) => c.stage === "clerk",
      title: () => "八十杯的團購臨時取消",
      body: () => "飲料都做好了，對方說活動延期，不想付錢。",
      options: [
        { label: "打電話協調", note: "看你的服務能力", apply: (c) => { if (c.skills.service + intBetween(c, 0, 30) >= 40) { c.trust += 3; log(c, "對方同意付一半，下次活動再訂。"); } else { c.trust -= 3; log(c, "對方掛電話，店裡損失三千多。"); } } },
        { label: "做成買一送一賣掉", note: "名聲 +1；虧一點", apply: (c) => { c.fame += 1; c.trust -= 1; } },
      ],
    },
    label_misprint: {
      cat: "urgent", weight: 0.5, fallback: 0, cd: 20, max: 1, cond: (c) => c.stage === "clerk",
      title: () => "杯貼印錯了",
      body: () => "新一批杯貼把「無糖」印成「微糖」，已經用掉兩百張。",
      options: [
        { label: "全部撕掉重貼", note: "體力 −6；老闆信任 +2", apply: (c) => { c.energy -= 6; c.trust += 2; } },
        { label: "用簽字筆改", note: "客人可能看錯", apply: (c) => { if (chance(c, 0.4)) c.fame -= 2; } },
      ],
    },
    hq_audit: {
      cat: "urgent", weight: 0.6, fallback: 0, cd: 20, max: 2, cond: (c) => c.stage === "clerk",
      title: () => "協會督導來店裡",
      body: () => "督導拿著評分表，從洗手台看到收銀機。",
      options: [{ label: "陪她看完", note: "看你的營運和服務", apply: (c) => { const sc = c.skills.ops + c.skills.service + intBetween(c, -10, 25); if (sc >= 70) { c.trust += 5; log(c, "督導說這是她看過最乾淨的吧台。"); } else if (sc >= 45) log(c, "督導列了三個要改善的地方。"); else { c.trust -= 5; log(c, "督導給了不及格，德哥被叫去開會。"); } } }],
    },
    ig_troll: {
      cat: "people", weight: 0.5, fallback: 1, cd: 20, max: 2, cond: (c) => c.stage === "clerk",
      title: () => "店的 IG 被酸了",
      body: () => "有人在最新貼文留言「漲價又變難喝」，按讚的人越來越多。",
      options: [
        { label: "認真回覆，附上改善", note: "服務 +2；可能扭轉風向", apply: (c) => { gain(c, "service", 2); c.fame += chance(c, 0.6) ? 2 : -1; } },
        { label: "刪掉留言", note: "可能被截圖", apply: (c) => { if (chance(c, 0.5)) { c.fame -= 4; log(c, "有人截圖說店家刪留言，吵得更大。"); } } },
      ],
    },
    new_drink_trial: {
      cat: "people", weight: 0.6, fallback: 0, cd: 16, max: 2, cond: (c) => c.stage === "clerk",
      title: () => "德哥要你負責試做新品",
      body: () => "夏季新品「芒果綠茶冰沙」，下週要上架。",
      options: [{ label: "接下來", note: "看你的調飲", apply: (c) => { gain(c, "brew", 2); if (c.skills.brew + intBetween(c, 0, 30) >= 50) { c.trust += 5; c.fame += 3; log(c, "新品第一週賣了五百杯。"); } else { c.trust -= 2; log(c, "新品太酸，上架三天就下架。"); } } }],
    },
    straw_shortage: {
      cat: "urgent", weight: 0.5, fallback: 1, cd: 20, max: 2, cond: (c) => c.stage === "clerk",
      title: () => "粗吸管缺貨",
      body: () => "廠商說下週才補，珍奶沒有粗吸管很難喝。",
      options: [
        { label: "跑三家材料行湊", note: "體力 −6；自己墊 NT$300～600", apply: (c) => { c.energy -= 6; c.savings -= intBetween(c, 3, 6) * 100; c.trust += 3; } },
        { label: "改附湯匙", note: "客人會抱怨", apply: (c) => { c.fame -= intBetween(c, 1, 3); } },
      ],
    },
    fake_bill: {
      cat: "urgent", weight: 0.4, fallback: 0, cd: 30, max: 1, cond: (c) => c.stage === "clerk",
      title: () => "收到一張假鈔",
      body: () => "關帳時發現一張千元鈔摸起來怪怪的。",
      options: [
        { label: "自己賠", note: "−NT$1,000", apply: (c) => { c.savings -= 1000; } },
        { label: "報警，調監視器", note: "看運氣", apply: (c) => { if (chance(c, 0.3)) log(c, "警察抓到用假鈔的人，你沒被扣錢。"); else { c.savings -= 1000; c.trust -= 1; } } },
      ],
    },
    regular_unhappy: {
      cat: "people", weight: 0.6, fallback: 1, cd: 14, max: 2, cond: (c) => c.stage === "clerk",
      title: () => "熟客說最近變難喝",
      body: () => "每天來的大哥說四季春「沒以前香」。",
      options: [
        { label: "當場重泡一壺給他試", note: "看你的調飲", apply: (c) => { if (c.skills.brew + intBetween(c, 0, 30) >= 45) { c.fame += 2; gain(c, "brew", 1); log(c, "你發現是茶葉放太久，換一批就好了。"); } else { c.fame -= 2; log(c, "大哥喝了說還是一樣，之後很少來了。"); } } },
        { label: "說配方沒變", note: "可能流失熟客", apply: (c) => { if (chance(c, 0.5)) c.fame -= 2; } },
      ],
    },
    new_year_shift: {
      cat: "people", weight: 0.5, fallback: 1, max: 1, cond: (c) => c.stage === "clerk" && c.week > 10,
      title: () => "過年要不要上班？",
      body: () => "除夕到初三，時薪兩倍。媽媽問你今年回不回家。",
      options: [
        { label: "上班賺加倍", note: "多 12 小時、雙倍時薪；家裡有點失望", apply: (c) => { c.flags.extraHours = (c.flags.extraHours || 0) + 12; c.savings += 12 * STAGES.clerk.wage; c.energy -= 10; c.trust += 3; } },
        { label: "回家過年", note: "體力 +15；少 8 小時", apply: (c) => { c.energy += 15; c.flags.skipHours = (c.flags.skipHours || 0) + 8; c.flags.familyOk = 1; } },
      ],
    },
    boss_abroad: {
      cat: "people", weight: 0.5, fallback: 0, max: 1, cond: (c) => c.stage === "clerk" && c.stageWeeks >= 6,
      title: () => "德哥出國一週，店交給你",
      body: () => "他去日本看展，說有事打 LINE，但最好不要有事。",
      options: [{ label: "撐起來", note: "看你的營運和帶人", apply: (c) => { c.energy -= 10; const sc = c.skills.ops + c.skills.lead + intBetween(c, -10, 30); if (sc >= 55) { c.trust += 8; log(c, "德哥回來看了帳，營業額還多了一點。他說：「可以喔。」"); } else { c.trust -= 5; log(c, "那週叫貨叫錯、工讀生請假，德哥一回來就開始收爛攤子。"); } } }],
    },
    cockroach: {
      cat: "urgent", weight: 0.5, fallback: 0, cd: 20, max: 2, cond: (c) => c.stage === "clerk",
      title: () => "客人看到蟑螂",
      body: () => "一隻蟑螂從吧台下面爬出來，正好被排隊的客人看到。",
      options: [
        { label: "當場處理，晚上請人除蟲", note: "店裡出錢；你加班 4 小時", apply: (c) => { c.flags.extraHours = (c.flags.extraHours || 0) + 4; c.trust += 2; c.fame -= 1; } },
        { label: "道歉帶過", note: "名聲可能大跌", apply: (c) => { if (chance(c, 0.5)) { c.fame -= 6; log(c, "那位客人把照片貼上評論，標題是「蟑螂奶茶」。"); } } },
      ],
    },
    tablet_crash: {
      cat: "urgent", weight: 0.6, fallback: 0, cd: 14, max: 2, cond: (c) => c.stage === "clerk",
      title: () => "外送平板當機，漏了十張單",
      body: () => "外送員一個個進來說單子沒做。",
      options: [{ label: "一邊道歉一邊趕單", note: "看你的服務", apply: (c) => { c.energy -= 6; if (c.skills.service + intBetween(c, 0, 30) >= 45) { c.trust += 2; log(c, "你一張張道歉，還送了每位外送員一杯紅茶。"); } else { c.fame -= 3; log(c, "平台上一口氣多了五則一星評論。"); } } }],
    },
    new_hire_mom: {
      cat: "people", weight: 0.5, fallback: 1, max: 1, cond: (c) => c.stage === "clerk",
      title: () => "二度就業的姊姊來上班",
      body: () => "小孩上小學後回來工作，手很巧，但對點餐系統很緊張。",
      options: [
        { label: "排時間教她", note: "帶人 +3；體力 −4", apply: (c) => { gain(c, "lead", 3); c.energy -= 4; if (chance(c, 0.5)) { c.trust += 2; log(c, "她學得很快，後來還幫你分擔開店班。"); } } },
        { label: "讓她自己摸索", note: "", apply: (c) => { if (chance(c, 0.4)) log(c, "她做了兩週就離職了。"); } },
      ],
    },
    fire_inspection: {
      cat: "urgent", weight: 0.4, fallback: 1, cd: 40, max: 1, cond: (c) => c.stage === "clerk",
      title: () => "消防安檢",
      body: () => "滅火器過期，後門被紙箱擋住了。",
      options: [
        { label: "馬上整理", note: "加班 4 小時；老闆信任 +3", apply: (c) => { c.flags.extraHours = (c.flags.extraHours || 0) + 4; c.trust += 3; } },
        { label: "等德哥來處理", note: "可能被罰", apply: (c) => { if (chance(c, 0.5)) { c.trust -= 3; log(c, "店被罰了 NT$6,000，德哥問你那天為什麼不先處理。"); } } },
      ],
    },
    recipe_leak: {
      cat: "people", weight: 0.4, fallback: 0, max: 1, cond: (c) => c.stage === "clerk" && c.week > 12,
      title: () => "前同事把配方帶去對手店",
      body: () => "對面新開的店，賣的鳳梨冰茶跟你們一模一樣。",
      options: [{ label: "跟德哥一起想對策", note: "看你的調飲和營運", apply: (c) => { if (c.skills.brew + c.skills.ops + intBetween(c, 0, 30) >= 80) { c.trust += 4; c.fame += 2; log(c, "你們改了配方，還推出新口味，客人沒有流失。"); } else { c.fame -= 3; c.trust -= 1; log(c, "那個月營業額掉了一成。"); } } }],
    },
    tip_box: {
      cat: "people", weight: 0.4, fallback: 1, max: 1, cond: (c) => c.stage === "clerk",
      title: () => "要不要在櫃台放小費箱？",
      body: () => "同事說隔壁咖啡店放了，一個月多兩千塊。",
      options: [
        { label: "跟德哥提議", note: "可能多賺，也可能被客人嫌", apply: (c) => { if (chance(c, 0.5)) { c.savings += intBetween(c, 5, 15) * 100; log(c, "小費箱放了一個月，大家分到一點零用錢。"); } else { c.fame -= 2; log(c, "有客人留言說「買個飲料還要給小費？」。"); } } },
        { label: "算了", note: "", apply: () => {} },
      ],
    },
    unpaid_overtime: {
      cat: "people", weight: 0.5, fallback: 1, cd: 26, max: 2, cond: (c) => c.stage === "clerk" && c.week > 8,
      title: () => "薪水單少算了加班",
      body: () => "上個月多上的十二個小時，薪水單上沒有。",
      options: [
        { label: "去跟德哥說", note: "多半會補，但他可能不高興", apply: (c) => { c.savings += 12 * STAGES.clerk.wage; if (chance(c, 0.3)) { c.trust -= 3; log(c, "德哥補了錢，但說「計較這麼多」。"); } } },
        { label: "算了，不想吵", note: "", apply: (c) => { c.energy -= 3; } },
      ],
    },
    rainy_weeks: {
      cat: "urgent", weight: 0.6, fallback: 0, cd: 20, max: 2, cond: (c) => c.stage === "clerk",
      title: () => "連續下雨，店裡沒客人",
      body: () => "德哥說這週要減班，每個人少排 8 小時。",
      options: [
        { label: "接受", note: "這週少 8 小時", apply: (c) => { c.flags.skipHours = (c.flags.skipHours || 0) + 8; c.energy += 5; } },
        { label: "主動提出做外送", note: "照時薪；體力 −6", apply: (c) => { c.energy -= 6; c.trust += 2; } },
      ],
    },
    landlord_visit: {
      cat: "urgent", weight: 0.4, fallback: 0, cd: 30, max: 1, cond: (c) => c.week > 6,
      title: () => "房東突然要來看房",
      body: () => "他說要確認有沒有「違規使用電器」，你房裡有一台電磁爐。",
      options: [
        { label: "老實說", note: "可能被罰，也可能沒事", apply: (c) => { if (chance(c, 0.5)) log(c, "房東說下次注意就好。"); else { c.savings -= 1000; log(c, "房東扣了 NT$1,000 押金。"); } } },
        { label: "藏起來", note: "", apply: (c) => { if (chance(c, 0.3)) { c.savings -= 2000; log(c, "房東在床底下翻到了，扣了 NT$2,000。"); } } },
      ],
    },
    credit_card: {
      cat: "people", weight: 0.4, fallback: 1, max: 1, cond: (c) => c.week > 6,
      title: () => "銀行打來邀你辦信用卡",
      body: () => "首刷禮是一台藍牙耳機，額度五萬。",
      options: [
        { label: "辦了，順便買想要的東西", note: "之後幾週帳單會來", apply: (c) => { c.livingPlus = (c.livingPlus || 0) + 400; c.energy += 5; log(c, "刷了一台新手機，每週多了 NT$400 的分期。"); } },
        { label: "不用", note: "", apply: () => {} },
      ],
    },
    classmate_flex: {
      cat: "people", weight: 0.5, fallback: 1, cd: 26, max: 2, cond: (c) => c.week > 5,
      title: () => "同學會",
      body: () => "有人在科技廠月薪五萬，有人在讀研究所。大家問你在做什麼。",
      options: [
        { label: "說你在學開店", note: "體力 +4；也可能被酸", apply: (c) => { if (chance(c, 0.6)) { c.energy += 4; log(c, "有同學說他很羨慕你知道自己要什麼。"); } else { c.energy -= 6; log(c, "有人笑說「做飲料喔？」，你笑不太出來。"); } } },
        { label: "藉口有班沒去", note: "", apply: () => {} },
      ],
    },
    hometown_job: {
      cat: "people", weight: 0.4, fallback: 1, max: 1, cond: (c) => c.week > 12,
      title: () => "家鄉的工廠在找人",
      body: () => "舅舅說可以介紹你去，月薪三萬五，住家裡不用房租。",
      options: [
        { label: "留下來繼續拚", note: "體力 +3（你更確定自己要什麼）", apply: (c) => { c.energy += 3; } },
        { label: "認真考慮了一週", note: "這週工作分心，老闆信任 −2", apply: (c) => { c.trust -= 2; log(c, "你最後還是決定留下來。"); } },
      ],
    },
    scratch_card: {
      cat: "people", weight: 0.4, fallback: 1, cd: 16, max: 2,
      title: () => "彩券行的刮刮樂",
      body: () => "下班經過彩券行，櫥窗貼著「本店開出百萬大獎」。",
      options: [
        { label: "買一張 NT$500", note: "看運氣", apply: (c) => { const v = pick(c, [0, 0, 0, 0, 500, 1000, 2000, 10000]); c.savings += v - 500; log(c, v ? `刮中 NT$${v}！` : "什麼都沒中。"); } },
        { label: "不買", note: "", apply: () => {} },
      ],
    },
    insurance_due: {
      cat: "urgent", weight: 0.4, fallback: 0, cd: 50, max: 1, cond: (c) => c.week > 8,
      title: () => "機車強制險到期",
      body: () => "沒保險被攔到要罰錢，出事更麻煩。",
      options: [
        { label: "續保", note: "NT$600", apply: (c) => { c.savings -= 600; } },
        { label: "下個月再說", note: "", apply: (c) => { if (chance(c, 0.3)) { c.savings -= 3000; log(c, "隔週臨檢就被抓到，罰了 NT$3,000。"); } } },
      ],
    },
    phone_bill: {
      cat: "urgent", weight: 0.4, fallback: 0, cd: 30, max: 1,
      title: () => "電信帳單爆表",
      body: () => "上個月吃到飽到期沒發現，帳單三千多。",
      options: [
        { label: "照繳，改方案", note: "NT$3,200", apply: (c) => { c.savings -= 3200; } },
        { label: "打客服爭取", note: "看你的口才", apply: (c) => { if (c.skills.service + intBetween(c, 0, 40) >= 40) { c.savings -= 800; log(c, "客服幫你降成 NT$800。"); } else { c.savings -= 3200; c.energy -= 3; log(c, "講了四十分鐘，還是要全繳。"); } } },
      ],
    },
    grandma_hospital: {
      cat: "urgent", weight: 0.4, fallback: 0, max: 1, cond: (c) => c.week > 10,
      title: () => "阿嬤住院了",
      body: () => "家裡說不嚴重，但阿嬤一直問你什麼時候回來。",
      options: [
        { label: "請兩天假回去", note: "少 16 小時；車錢 NT$1,200；家裡很感動", apply: (c) => { c.flags.skipHours = (c.flags.skipHours || 0) + 16; c.savings -= 1200; c.flags.familyOk = 1; c.trust -= 1; } },
        { label: "視訊就好", note: "心裡很掛念，體力 −6", apply: (c) => { c.energy -= 6; } },
      ],
    },
    my_birthday: {
      cat: "people", weight: 0.4, fallback: 1, max: 1, cond: (c) => c.week > 4,
      title: () => "你的生日",
      body: () => "同事偷偷買了蛋糕，晚上大家問要不要去唱歌。",
      options: [
        { label: "去唱！", note: "−NT$800；體力 +8", apply: (c) => { c.savings -= 800; c.energy += 8; c.friend = (c.friend || 0) + 1; } },
        { label: "吃完蛋糕就回家睡", note: "體力 +4", apply: (c) => { c.energy += 4; } },
      ],
    },
    concert_ticket: {
      cat: "people", weight: 0.4, fallback: 1, max: 1,
      title: () => "喜歡的樂團來開演唱會",
      body: () => "搶到兩張票，但那天是週六晚班。",
      options: [
        { label: "請假去", note: "−NT$2,800；少 6 小時；體力 +12", apply: (c) => { c.savings -= 2800; c.flags.skipHours = (c.flags.skipHours || 0) + 6; c.energy += 12; c.trust -= 1; } },
        { label: "把票轉賣", note: "賺一點，但有點難過", apply: (c) => { c.savings += intBetween(c, 2, 8) * 100; c.energy -= 3; } },
      ],
    },
    first_date: {
      cat: "people", weight: 0.4, fallback: 1, max: 2, cond: (c) => c.week > 6,
      title: () => "交友軟體配對成功",
      body: () => "對方約你週日去吃早午餐。",
      options: [
        { label: "去", note: "−NT$600～1,500；結果看緣分", apply: (c) => { c.savings -= intBetween(c, 6, 15) * 100; if (chance(c, 0.5)) { c.energy += 8; log(c, "聊得很開心，約好下次去看電影。"); } else { c.energy -= 4; log(c, "對方一直看手機，吃完就說有事先走。"); } } },
        { label: "說最近太忙", note: "", apply: () => {} },
      ],
    },
    health_scare: {
      cat: "urgent", weight: 0.4, fallback: 0, max: 1, cond: (c) => c.week > 8,
      title: () => "健檢報告出現紅字",
      body: () => "醫生說你的肝指數偏高，叫你少熬夜、多休息。",
      options: [
        { label: "這幾週少排一點班", note: "少 8 小時；體力 +10", apply: (c) => { c.flags.skipHours = (c.flags.skipHours || 0) + 8; c.energy += 10; } },
        { label: "沒事，年輕撐得住", note: "可能真的倒下", apply: (c) => { if (chance(c, 0.35)) c.inbox.push(ev(c, "sick")); } },
      ],
    },
    sneaker_drop: {
      cat: "people", weight: 0.4, fallback: 1, max: 1,
      title: () => "想要很久的球鞋開賣",
      body: () => "限量款，原價 NT$4,800，轉手可能更貴。",
      options: [
        { label: "排隊買", note: "−NT$4,800；體力 +6", apply: (c) => { c.savings -= 4800; c.energy += 6; } },
        { label: "存錢要緊", note: "", apply: () => {} },
      ],
    },
    best_man: {
      cat: "people", weight: 0.3, fallback: 1, max: 1, cond: (c) => c.week > 8,
      title: () => "好朋友要你當伴郎",
      body: () => "要租西裝、包紅包，婚禮前一晚還要幫忙佈置。",
      options: [
        { label: "當然好", note: "−NT$4,000～6,000；少 8 小時；體力 +6", apply: (c) => { c.savings -= intBetween(c, 4, 6) * 1000; c.flags.skipHours = (c.flags.skipHours || 0) + 8; c.energy += 6; c.friend = (c.friend || 0) + 1; } },
        { label: "說要上班", note: "朋友有點失望", apply: (c) => { c.energy -= 4; } },
      ],
    },
    volunteer: {
      cat: "people", weight: 0.4, fallback: 1, cd: 26, max: 1,
      title: () => "社區食物銀行找志工",
      body: () => "週日上午幫忙整理物資。",
      options: [
        { label: "去幫忙", note: "體力 −4；名聲 +2；帶人 +1", apply: (c) => { c.energy -= 4; c.fame += 2; gain(c, "lead", 1); } },
        { label: "這週太累", note: "", apply: () => {} },
      ],
    },
    stray_dog: {
      cat: "people", weight: 0.3, fallback: 1, max: 1, cond: (c) => c.week > 6,
      title: () => "流浪狗一直跟你回家",
      body: () => "牠很瘦，在你家樓下等了三天。",
      options: [
        { label: "收養牠", note: "結紮打疫苗 NT$3,000；之後每週 +NT$200；體力 +5", apply: (c) => { c.savings -= 3000; c.livingPlus = (c.livingPlus || 0) + 200; c.energy += 5; log(c, "你幫牠取名叫「珍珠」。"); } },
        { label: "聯絡中途之家", note: "", apply: () => {} },
      ],
    },
    phone_left_bus: {
      cat: "urgent", weight: 0.4, fallback: 0, cd: 40, max: 1,
      title: () => "手機忘在公車上",
      body: () => "下車三分鐘才發現。",
      options: [{ label: "打給客運失物招領", note: "看運氣", apply: (c) => { if (chance(c, 0.5)) log(c, "司機撿到了，隔天去總站領回來。"); else { c.savings -= intBetween(c, 4, 9) * 1000; log(c, "手機沒找回來，只好買一支新的。"); } } }],
    },
    earthquake: {
      cat: "urgent", weight: 0.3, fallback: 1, max: 1,
      title: () => "半夜的地震",
      body: () => "搖得很大，店裡的玻璃杯和糖漿罐可能都摔了。",
      options: [
        { label: "一早去店裡收拾", note: "加班 6 小時；老闆信任 +4", apply: (c) => { c.flags.extraHours = (c.flags.extraHours || 0) + 6; c.trust += 4; c.energy -= 6; } },
        { label: "照平常時間上班", note: "", apply: () => {} },
      ],
    },
    food_poison: {
      cat: "urgent", weight: 0.4, fallback: 0, cd: 30, max: 1,
      title: () => "吃壞肚子",
      body: () => "夜市的蚵仔煎好像不太新鮮，你跑了一整晚廁所。",
      options: [
        { label: "請假看醫生", note: "NT$500；少 8 小時", apply: (c) => { c.savings -= 500; c.flags.skipHours = (c.flags.skipHours || 0) + 8; c.energy -= 6; } },
        { label: "吃藥硬撐", note: "體力 −15", apply: (c) => { c.energy -= 15; } },
      ],
    },
    invest_seminar: {
      cat: "people", weight: 0.3, fallback: 1, max: 1, cond: (c) => c.savings > 20000,
      title: () => "朋友帶你去投資說明會",
      body: () => "講師說每月穩賺 5%，入門方案 NT$20,000。",
      options: [
        { label: "投了", note: "……", apply: (c) => { c.savings -= 20000; if (chance(c, 0.15)) { c.savings += 26000; log(c, "三個月後真的領回 NT$26,000，你自己也嚇到。"); } else log(c, "兩個月後公司人去樓空，錢拿不回來了。"); } },
        { label: "這聽起來像詐騙", note: "", apply: () => {} },
      ],
    },
    parents_visit: {
      cat: "people", weight: 0.4, fallback: 0, max: 1, cond: (c) => c.week > 8,
      title: () => "爸媽北上來看你",
      body: () => "他們想看看你上班的地方，還說要點一杯你做的飲料。",
      options: [{ label: "帶他們去店裡", note: "看德哥給不給面子", apply: (c) => { c.flags.familyOk = 1; c.energy += 6; if (chance(c, 0.7)) { c.trust += 2; log(c, "德哥跟爸媽說你是店裡最認真的。媽媽眼眶有點紅。"); } else log(c, "那天店裡太忙，爸媽喝完就自己去逛街了。"); } }],
    },
    renovation_noise: {
      cat: "people", weight: 0.4, fallback: 0, cd: 30, max: 1,
      title: () => "隔壁在裝潢",
      body: () => "每天早上八點開始敲牆，你夜班回來根本睡不著。",
      options: [
        { label: "買耳塞和眼罩", note: "NT$300；體力 −4", apply: (c) => { c.savings -= 300; c.energy -= 4; } },
        { label: "去網咖補眠", note: "NT$600；體力 −2", apply: (c) => { c.savings -= 600; c.energy -= 2; } },
      ],
    },
    license_tax: {
      cat: "urgent", weight: 0.3, fallback: 0, max: 1, cond: (c) => c.week > 15,
      title: () => "牌照稅和燃料費帳單",
      body: () => "繳費期限是這週五。",
      options: [{ label: "繳", note: "NT$450～900", apply: (c) => { c.savings -= intBetween(c, 45, 90) * 10; } }],
    },
    back_pain: {
      cat: "urgent", weight: 0.5, fallback: 0, cd: 20, max: 2, cond: (c) => c.week > 6,
      title: () => "腰痛到彎不下去",
      body: () => "長時間站吧台、騎車，腰終於抗議了。",
      options: [
        { label: "去做復健", note: "NT$600～1,500；體力 +6", apply: (c) => { c.savings -= intBetween(c, 6, 15) * 100; c.energy += 6; } },
        { label: "貼藥布撐著", note: "體力 −8", apply: (c) => { c.energy -= 8; } },
      ],
    },
    cafe_partner: {
      cat: "people", weight: 0.3, fallback: 1, max: 1, cond: (c) => c.week > 14 && c.savings > 30000,
      title: () => "朋友找你合夥開咖啡店",
      body: () => "他說只差 NT$30,000 的股份，你負責飲料，他負責店面。",
      options: [
        { label: "投資", note: "可能大賺，也可能血本無歸", apply: (c) => { c.savings -= 30000; const r = rand(c); if (r < 0.25) { c.savings += 60000; log(c, "咖啡店撐過第一年，朋友把你的股份用 NT$60,000 買回去。"); } else if (r < 0.55) { c.savings += 25000; log(c, "咖啡店撐了半年收掉，拿回 NT$25,000。"); } else log(c, "咖啡店三個月就收了，錢都賠進去。"); } },
        { label: "專心在現在的工作", note: "", apply: () => {} },
      ],
    },
    promote_clerk: {
      cat: "people", weight: 0, fallback: -1,
      title: () => "德哥：「要不要轉正職店員？」",
      body: (c) => `德哥說這幾週看你做事很實在，想讓你轉成正職店員，時薪調到 ${STAGES.clerk.wage + (c.wageBonus || 0)}。不用再每天在外面跑了。`,
      options: [
        { label: "好！", note: "要先通過德哥的吧台考試（看調飲和信任）；沒過要再練兩週", apply: (c) => {
          const p = clamp(0.35 + (c.skills.brew - 25) / 30 + (c.trust - 45) / 80, 0.25, 0.9);
          if (chance(c, p)) { c.stage = "clerk"; c.stageWeeks = 0; c.trust += 5; c.flags.probationDone = 0; log(c, "吧台考試過了。你換上店員的圍裙，正式站進吧台。"); }
          else { c.flags.clerkLater = c.week + 2; c.trust -= 2; log(c, pick(c, ["考試那天手一直抖，三杯裡兩杯糖度做錯。德哥說：「再練兩週。」", "尖峰時段讓你試站吧台，單子一多就亂了，客人等了二十分鐘。德哥把你換下來。"])); }
        } },
        { label: "再跑一陣子外送", note: "小費比較多；之後再問", apply: (c) => { c.flags.clerkLater = c.week + 6; } },
      ],
    },
    promote_manager: {
      cat: "people", weight: 0, fallback: -1,
      title: () => "德哥要開第二家店",
      body: (c) => `德哥在${c.shop.district2}找到第二間店面，想讓你當店長：月薪 42,000，店有賺錢再分一成。「店交給你，我只看帳。」`,
      options: [
        { label: "接下店長", note: "先代理店長一週（看營運、帶人、信任）；沒過德哥會再觀察三週", apply: (c) => {
          const p = clamp(0.3 + (c.skills.ops - 35) / 40 + (c.skills.lead - 20) / 40 + (c.trust - 70) / 80, 0.2, 0.9);
          if (chance(c, p)) { c.promoted = 1; return; }
          c.flags.managerLater = c.week + 3; c.trust -= 3;
          log(c, pick(c, ["代理店長那週，叫貨算錯，週末珍珠斷貨兩天。德哥說：「再看看。」", "代理店長時排班沒排好，兩個工讀生同一天請假，你自己顧店到半夜。德哥說還不急。", "代理店長那週營業額掉了一成，德哥看完帳沒說話，只說再等等。"]));
        } },
        { label: "我還沒準備好", note: "兩個月後德哥會再問", apply: (c) => { c.flags.managerLater = c.week + 8; } },
      ],
    },
  };
  const RANDOM_IDS = Object.keys(EVENTS).filter((k) => typeof EVENTS[k].weight === "function" || EVENTS[k].weight > 0);
  const weightOf = (c, id) => (typeof EVENTS[id].weight === "function" ? EVENTS[id].weight(c) : EVENTS[id].weight);

  function ev(c, id, data) {
    const make = EVENTS[id] && EVENTS[id].make;
    return { uid: "c" + c.nextId++, id, data: data || (make ? make(c) : {}), week: c.week };
  }
  function log(c, text) {
    c.log.unshift({ week: c.week, text });
    if (c.log.length > 80) c.log.length = 80;
  }

  // ---------- 建立 ----------
  function newCareer(name, seed) {
    const c = {
      version: 1,
      scenario: "career",
      name: (name || "阿哲").slice(0, 8),
      seed: seed >>> 0,
      rng: (seed ^ 0x2545f491) >>> 0,
      nextId: 1,
      week: 0,
      stage: "runner",
      stageWeeks: 0,
      energy: 85,
      skills: { brew: 3, service: 8, ops: 2, lead: 0 },
      trust: 20,
      fame: 0,
      routes: 0,
      savings: 20000,
      shop: { name: "阿德茶舖", district: "", district2: "" },
      signature: { name: "", progress: 0, done: 0 },
      plan: [],
      inbox: [],
      log: [],
      history: [],
      flags: {},
      cooldown: {},
      debtWeeks: 0,
      over: null,
      promoted: 0,
      lastReport: null,
    };
    const districts = ["板橋", "新莊", "三重", "永和", "中壢", "西屯", "北屯", "左營", "苓雅", "竹北"];
    c.shop.district = pick(c, districts);
    c.shop.district2 = pick(c, districts.filter((d) => d !== c.shop.district));
    c.signature.name = pick(c, ["焙香烏龍奶霜", "柚香四季春", "黑糖桂圓鮮奶", "荔枝紅玉冰茶", "鳳梨青茶冰沙"]);
    log(c, `十九歲的${c.name}在${c.shop.district}的「${c.shop.name}」找到第一份工作：外送小弟。`);
    rollSpecials(c);
    return c;
  }

  // ---------- 行動 ----------
  const available = (c, key) => {
    const a = ACTIONS[key];
    if (a.stage === "special") return (c.specials || []).includes(key);
    return a.stage === "any" || a.stage === c.stage;
  };
  function hoursUsed(c) {
    return c.plan.reduce((x, k) => x + ACTIONS[k].hours, 0) + (c.flags.skipHours || 0);
  }
  function canPlan(c, key) {
    const a = ACTIONS[key];
    if (!a || !available(c, key)) return "現在做不了";
    if (hoursUsed(c) + a.hours > MAX_HOURS) return "這週時間不夠了";
    if (a.need) { const e = a.need(c); if (e) return e; }
    if ((!a.pay || a.stage === "special") && key !== "rest" && c.plan.includes(key)) return "這週已經排了";
    if (key === "routes" && c.routes >= 100) return "路線已經熟透了";
    return null;
  }
  function planAction(c, key) {
    const e = canPlan(c, key);
    if (e) return e;
    c.plan.push(key);
    return null;
  }
  function unplan(c, i) {
    c.plan.splice(i, 1);
  }
  // 照上週的班表排（做不了的跳過），回傳跳過幾項
  function repeatLast(c) {
    let skipped = 0;
    for (const k of c.lastPlan || []) if (planAction(c, k)) skipped++;
    return skipped;
  }
  function pendingUrgent(c) {
    return c.inbox.filter((x) => EVENTS[x.id].cat === "urgent" && EVENTS[x.id].fallback >= 0).map((x) => eventView(c, x));
  }
  function rollSpecials(c) {
    const keys = Object.keys(SPECIALS).filter((k) => !(c.specialSeen || {})[k] || c.week - c.specialSeen[k] > 6);
    const n = chance(c, 0.5) ? 3 : 2;
    c.specials = [];
    while (c.specials.length < n && keys.length) c.specials.push(keys.splice(Math.floor(rand(c) * keys.length), 1)[0]);
    c.specialSeen = c.specialSeen || {};
    c.specials.forEach((k) => (c.specialSeen[k] = c.week));
  }
  function resolveEvent(c, uid, i) {
    const k = c.inbox.findIndex((x) => x.uid === uid);
    if (k < 0) return;
    const inst = c.inbox[k];
    c.inbox.splice(k, 1);
    const opt = EVENTS[inst.id].options[i];
    if (opt) opt.apply(c, inst.data);
    normalize(c);
  }
  function eventView(c, inst) {
    const e = EVENTS[inst.id];
    return { uid: inst.uid, cat: e.cat, title: e.title(c, inst.data), body: e.body(c, inst.data), options: e.options.map((o) => ({ label: o.label, note: o.note || "" })), fallback: e.fallback };
  }
  function normalize(c) {
    c.energy = clamp(c.energy, 0, 100);
    c.trust = clamp(c.trust, 0, 100);
    c.fame = clamp(c.fame, 0, 100);
  }

  // 升職條件（畫面上的檢查表也用這個）
  function goals(c) {
    if (c.stage === "runner") return [
      { label: "工作滿 10 週", ok: c.week >= 10 },
      { label: "調飲 25", ok: c.skills.brew >= 25, v: c.skills.brew, need: 25 },
      { label: "老闆信任 45", ok: c.trust >= 45, v: c.trust, need: 45 },
    ];
    return [
      { label: "當店員滿 12 週", ok: c.stageWeeks >= 12 },
      { label: "調飲 50", ok: c.skills.brew >= 50, v: c.skills.brew, need: 50 },
      { label: "服務 40", ok: c.skills.service >= 40, v: c.skills.service, need: 40 },
      { label: "營運 35", ok: c.skills.ops >= 35, v: c.skills.ops, need: 35 },
      { label: "帶人 20", ok: c.skills.lead >= 20, v: c.skills.lead, need: 20 },
      { label: "老闆信任 70", ok: c.trust >= 70, v: c.trust, need: 70 },
    ];
  }

  // ---------- 結束一週 ----------
  function endWeek(c) {
    if (c.over || c.promoted) return null;
    const out = [];
    const o = {};
    for (const inst of c.inbox.slice()) {
      const e = EVENTS[inst.id];
      if (e.cat === "urgent" && e.fallback >= 0) {
        out.push({ text: `你這週沒有決定「${e.title(c, inst.data)}」，所以照預設選了「${e.options[e.fallback].label}」${e.options[e.fallback].note ? `（${e.options[e.fallback].note}）` : ""}。` });
        resolveEvent(c, inst.uid, e.fallback);
      } else if (inst.week < c.week - 1 && e.fallback >= 0) {
        resolveEvent(c, inst.uid, e.fallback);
      }
    }
    const savingsStart = c.savings;
    let paidHours = c.flags.extraHours || 0;
    const tired = c.energy < 35;
    for (const k of c.plan) {
      const a = ACTIONS[k];
      if (a.pay) paidHours += a.hours;
      out.push({ text: `${a.name}：${a.run(c, o)}` });
      // 太累上工容易出包
      if (a.pay && tired && chance(c, 0.25)) {
        const loss = intBetween(c, 2, 5);
        c.trust -= loss;
        out.push({ text: `　累到恍神：${pick(c, MISHAPS[c.stage])}（老闆信任 −${loss}）` });
      }
    }
    if (c.flags.loanBack && c.flags.loanBack <= c.week) {
      if (chance(c, 0.55)) { c.savings += 5000; out.push({ text: "借錢的朋友把 NT$5,000 還你了，還請你吃了一頓飯。" }); }
      else out.push({ text: "借你錢的朋友已讀不回。那 NT$5,000 大概要不回來了。" });
      c.flags.loanBack = 0;
    }
    const used = hoursUsed(c) + (c.flags.extraHours || 0);
    const wage = STAGES[c.stage].wage + (c.wageBonus || 0);
    const pay = paidHours * wage;
    const living = LIVING + (c.livingPlus || 0);
    c.savings += pay - living;
    // 體力：每週自然恢復，超時多扣
    c.energy += 26 + (c.fit || 0) * 0.6 - (c.flags.farHome ? 3 : 0) - ((c.flags.hotRoom || 0) > c.week ? 3 : 0) -Math.max(0, used - BASE_HOURS) * 1.2 - paidHours * 0.35;
    if (paidHours < 16) { c.trust -= 3; out.push({ text: "這週班排得很少，德哥問你是不是不想做了。" }); }
    // 連續三週超過 54 小時：過勞，之後兩週學得慢、恢復也慢
    if (used > 54) c.overWeeks = (c.overWeeks || 0) + 1;
    else c.overWeeks = 0;
    if (c.overWeeks >= 3) {
      c.overWeeks = 0; c.flags.burnout = c.week + 3; c.energy -= 10;
      out.push({ text: "連續好幾週超時，你過勞了：接下來兩週學東西比較慢，體力也恢復得慢。" });
    }
    if ((c.flags.burnout || 0) > c.week) c.energy -= 5;
    // 太久沒練的能力會生疏（20 以上才會退）
    c.lastTrain = c.lastTrain || {};
    const rusty = [];
    for (const [k, l] of [["brew", "調飲"], ["service", "服務"], ["ops", "營運"], ["lead", "帶人"]]) {
      if (c.skills[k] > 20 && c.week - (c.lastTrain[k] ?? c.week) >= 4) { c.skills[k] -= 1; rusty.push(l); }
    }
    if (rusty.length) out.push({ text: `太久沒練，${rusty.join("、")}有點生疏了（−1）。` });
    // 存款變負數：刷卡、借錢周轉，要付利息
    if (c.savings < 0) {
      const interest = round(-c.savings * 0.03);
      c.savings -= interest;
      out.push({ text: `存款是負的，靠刷卡周轉，這週利息 ${T.fmtMoney(interest)}。` });
    }
    c.flags.extraHours = 0;
    c.flags.skipHours = 0;
    normalize(c);

    const report ={ week: c.week, stage: c.stage, pay: round(pay), tips: round(o.tips || 0), living, savingsStart: round(savingsStart), savings: round(c.savings), energy: round(c.energy), lines: out };
    c.history.push({ week: c.week, savings: round(c.savings), energy: round(c.energy), trust: round(c.trust) });

    c.lastPlan = c.plan.slice();
    c.week++;
    if (c.stage === "clerk") c.stageWeeks++;
    if (c.savings < 0) c.debtWeeks++;
    else c.debtWeeks = 0;
    if (c.debtWeeks >= 4) c.over = { grade: "D", title: "回老家", text: `連續一個月入不敷出，${c.name}把機車賣了，搬回老家。` };
    if (c.week >= 156 && !c.over) c.over = { grade: "C", title: "資深店員", text: `三年過去，${c.name}還在「${c.shop.name}」站吧台，熟客都叫得出你的名字。` };
    // 老闆信任太低：先被警告，再不改善，店員降回外送、小弟被開除
    if (!c.over) {
      if (c.trust < 20) c.lowTrust = (c.lowTrust || 0) + 1;
      else c.lowTrust = 0;
      if (c.lowTrust === 2) c.inbox.push(ev(c, "boss_warning"));
      if (c.lowTrust >= 4) {
        if (c.stage === "clerk") {
          c.stage = "runner"; c.stageWeeks = 0; c.trust = 28; c.lowTrust = 0; c.flags.clerkLater = c.week + 4;
          log(c, "德哥把你調回去跑外送：「先把責任感找回來。」");
          report.lines.push({ text: "老闆信任一直沒回來，你被調回外送小弟。" });
        } else {
          c.over = { grade: "D", title: "被開除", text: `德哥說店裡不需要不穩定的人。${c.name}收拾了安全帽和雨衣，離開「${c.shop.name}」。` };
        }
      }
    }
    // 店員試用期：升上來第 4 週，老闆信任不到 45 就調回外送
    if (!c.over && c.stage === "clerk" && c.stageWeeks === 4 && !c.flags.probationDone) {
      c.flags.probationDone = 1;
      if (c.trust < 45) {
        c.stage = "runner"; c.stageWeeks = 0; c.flags.clerkLater = c.week + 3; c.flags.probationDone = 0;
        log(c, "試用期結束，德哥說你還不夠穩，先回去跑外送。");
        report.lines.push({ text: "店員試用期沒過（老闆信任不到 45），你被調回外送。" });
      } else report.lines.push({ text: "店員試用期過了，德哥把你的名字寫上正式班表。" });
    }
    if (!c.over) {
      if (c.energy <= 5) c.inbox.push(ev(c, "sick"));
      const g = goals(c);
      // 店長的位子不一定是你的：第一次符合條件時，德哥可能先讓阿凱試（信任 90 以上機會減半）
      if (c.stage === "clerk" && g.every((x) => x.ok) && !c.flags.rivalChecked) {
        c.flags.rivalChecked = 1;
        if (chance(c, c.trust >= 90 ? 0.2 : 0.4)) {
          c.flags.managerLater = Math.max(c.flags.managerLater || 0, c.week + 4);
          log(c, "德哥先讓阿凱代理第二家店的店長。你心裡很不是滋味。");
          report.lines.push({ text: "德哥先讓同事阿凱試當店長，你要再等四週看他做得怎樣。" });
        }
      }
      if (c.stage === "runner" && g.every((x) => x.ok) && (c.flags.clerkLater || 0) <= c.week && !c.inbox.some((x) => x.id === "promote_clerk")) c.inbox.push(ev(c, "promote_clerk"));
      if (c.stage === "clerk" && g.every((x) => x.ok) && (c.flags.managerLater || 0) <= c.week && !c.inbox.some((x) => x.id === "promote_manager")) c.inbox.push(ev(c, "promote_manager"));
      rollEvents(c);
      rollSpecials(c);
    }
    c.plan = [];
    normalize(c);
    c.lastReport = report;
    return report;
  }

  function rollEvents(c) {
    // 每週 1～3 件；同一件事至少隔 cd 週（預設 8），一局最多 max 次
    const count = 1 + (chance(c, 0.55) ? 1 : 0) + (chance(c, 0.2) ? 1 : 0);
    c.eventCount = c.eventCount || {};
    for (let n = 0; n < count; n++) {
      const pool = RANDOM_IDS.filter((id) => {
        const e = EVENTS[id];
        if ((c.cooldown[id] ?? -99) + (e.cd || 8) > c.week) return false;
        if (e.max && (c.eventCount[id] || 0) >= e.max) return false;
        if (c.inbox.some((x) => x.id === id)) return false;
        return !e.cond || e.cond(c);
      });
      if (!pool.length) return;
      const total = pool.reduce((a, id) => a + weightOf(c, id), 0);
      let r = rand(c) * total;
      let chosen = pool[0];
      for (const id of pool) {
        r -= weightOf(c, id);
        if (r <= 0) { chosen = id; break; }
      }
      c.cooldown[chosen] = c.week;
      c.eventCount[chosen] = (c.eventCount[chosen] || 0) + 1;
      c.inbox.push(ev(c, chosen));
    }
  }

  // ---------- 升店長：交給 TeaSim 的店長模式 ----------
  function toManager(c) {
    const offer = { key: "residential", district: c.shop.district2, rent: 56000, base: 260, fitout: 0 };
    const s = T.newGame(c.shop.name, c.seed ^ 0x51ed27, offer, {
      mode: "manager",
      startWeek: c.week,
      cash: 600000,
      rep: clamp(50 + c.fame / 8, 0, 70),
      career: { name: c.name, skills: { ...c.skills }, savings: c.savings, trust: 60, fame: c.fame, signature: c.signature.done ? c.signature.name : "", startWeek: c.week, managerWeek: c.week, log: c.log.slice(0, 30) },
    });
    return s;
  }

  // ---------- 自動玩家（測試用） ----------
  function autoPlay(c) {
    // 每個選項在複本上試一次，挑分數最高的（存款、信任、體力、能力都算）
    const score = (x) => x.savings + x.trust * 150 + x.energy * 60 + x.fame * 80 + (x.skills.brew + x.skills.service + x.skills.ops + x.skills.lead) * 120 + (x.stage === "clerk" ? 4000 : 0) + (x.promoted ? 1e6 : 0);
    for (const inst of c.inbox.slice()) {
      const e = EVENTS[inst.id];
      let best = 0;
      if (inst.id === "friend_trip" || inst.id === "rival_recruit") best = 1;
      else if (e.options.length > 1) {
        let top = -Infinity;
        // 用不同的亂數試 6 次取平均，不能偷看這一次真正的結果
        e.options.forEach((_, i) => {
          let v = 0;
          for (let k = 0; k < 6; k++) { const t = JSON.parse(JSON.stringify(c)); t.rng = (c.rng ^ (0x9e3779b9 * (k + 1))) >>> 0; resolveEvent(t, inst.uid, i); v += score(t); }
          if (v > top) { top = v; best = i; }
        });
      }
      resolveEvent(c, inst.uid, best);
      if (e && c.promoted) return;
    }
    const want = c.stage === "runner"
      ? (c.energy < 35 ? ["lunch", "prep", "watch", "rest", "rest"] : ["lunch", "teatime", "prep", "watch", "routes", "recipe"])
      : (c.energy < 35 ? ["bar", "counter", "rest", "rest"] : ["bar", "counter", "openclose", "stock", "mentor", "rnd", "night"]);
    want.forEach((k) => planAction(c, k));
  }

  root.TeaCareer = { ACTIONS, STAGES, BASE_HOURS, MAX_HOURS, LIVING, newCareer, canPlan, planAction, unplan, resolveEvent, eventView, endWeek, goals, hoursUsed, available, toManager, autoPlay, repeatLast, pendingUrgent, SPECIALS };
  if (typeof module !== "undefined" && module.exports) module.exports = root.TeaCareer;
})(typeof globalThis !== "undefined" ? globalThis : this);
