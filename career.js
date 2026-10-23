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
        { label: "自己出錢重做（NT$420）", note: "老闆會記得", apply: (c) => { c.savings -= 420; c.trust += 3; } },
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
      options: [{ label: "謝謝阿姨", note: "名聲 +2", apply: (c) => { c.fame += 2; } }],
    },
    scooter: {
      cat: "urgent", weight: 1.5, fallback: 0, cd: 14, max: 2, cond: (c) => c.stage === "runner" && (c.flags.scooterOk || 0) <= c.week,
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
        { label: "道歉並重做一杯", note: "服務 +、名聲 +1", apply: (c) => { gain(c, "service", 2); c.fame += 1; } },
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
      options: [{ label: "聽他說完", note: "名聲 +1、服務 +1", apply: (c) => { c.fame += 1; gain(c, "service", 1); } }],
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
    promote_clerk: {
      cat: "people", weight: 0, fallback: -1,
      title: () => "德哥：「要不要轉正職店員？」",
      body: (c) => `德哥說這幾週看你做事很實在，想讓你轉成正職店員，時薪調到 ${STAGES.clerk.wage + (c.wageBonus || 0)}。不用再每天在外面跑了。`,
      options: [
        { label: "好！", note: "升任店員", apply: (c) => { c.stage = "clerk"; c.stageWeeks = 0; c.trust += 5; log(c, "你換上店員的圍裙，正式站進吧台。"); } },
        { label: "再跑一陣子外送", note: "小費比較多；之後再問", apply: (c) => { c.flags.clerkLater = c.week + 6; } },
      ],
    },
    promote_manager: {
      cat: "people", weight: 0, fallback: -1,
      title: () => "德哥要開第二家店",
      body: (c) => `德哥在${c.shop.district2}找到第二間店面，想讓你當店長：月薪 42,000，店有賺錢再分一成。「店交給你，我只看帳。」`,
      options: [
        { label: "接下店長", note: "進入店長階段：排班、叫貨、帶人都是你的事", apply: (c) => { c.promoted = 1; } },
        { label: "我還沒準備好", note: "兩個月後德哥會再問", apply: (c) => { c.flags.managerLater = c.week + 8; } },
      ],
    },
  };
  const RANDOM_IDS = Object.keys(EVENTS).filter((k) => EVENTS[k].weight > 0);

  function ev(c, id, data) {
    return { uid: "c" + c.nextId++, id, data: data || {}, week: c.week };
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
      { label: "當店員滿 24 週", ok: c.stageWeeks >= 24 },
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
    for (const k of c.plan) {
      const a = ACTIONS[k];
      if (a.pay) paidHours += a.hours;
      out.push({ text: `${a.name}：${a.run(c, o)}` });
    }
    const used = hoursUsed(c) + (c.flags.extraHours || 0);
    const wage = STAGES[c.stage].wage + (c.wageBonus || 0);
    const pay = paidHours * wage;
    const living = LIVING + (c.livingPlus || 0);
    c.savings += pay - living;
    // 體力：每週自然恢復，超時多扣
    c.energy += 26 + (c.fit || 0) * 0.6 - (c.flags.farHome ? 3 : 0) - Math.max(0, used - BASE_HOURS) * 1.2 - paidHours * 0.35;
    if (paidHours < 16) { c.trust -= 3; out.push({ text: "這週班排得很少，德哥問你是不是不想做了。" }); }
    c.flags.extraHours = 0;
    c.flags.skipHours = 0;
    normalize(c);

    const report = { week: c.week, stage: c.stage, pay: round(pay), tips: round(o.tips || 0), living, savingsStart: round(savingsStart), savings: round(c.savings), energy: round(c.energy), lines: out };
    c.history.push({ week: c.week, savings: round(c.savings), energy: round(c.energy), trust: round(c.trust) });

    c.lastPlan = c.plan.slice();
    c.week++;
    if (c.stage === "clerk") c.stageWeeks++;
    if (c.savings < 0) c.debtWeeks++;
    else c.debtWeeks = 0;
    if (c.debtWeeks >= 4) c.over = { grade: "D", title: "回老家", text: `連續一個月入不敷出，${c.name}把機車賣了，搬回老家。` };
    if (c.week >= 156 && !c.over) c.over = { grade: "C", title: "資深店員", text: `三年過去，${c.name}還在「${c.shop.name}」站吧台，熟客都叫得出你的名字。` };
    if (!c.over) {
      if (c.energy <= 5) c.inbox.push(ev(c, "sick"));
      const g = goals(c);
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
      const total = pool.reduce((a, id) => a + EVENTS[id].weight, 0);
      let r = rand(c) * total;
      let chosen = pool[0];
      for (const id of pool) {
        r -= EVENTS[id].weight;
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
    for (const inst of c.inbox.slice()) {
      const e = EVENTS[inst.id];
      resolveEvent(c, inst.uid, inst.id === "friend_trip" || inst.id === "rival_recruit" ? 1 : 0);
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
