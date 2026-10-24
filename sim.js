// 手搖飲連鎖原型：模擬引擎（純函式、可重現）。設計見 docs/18-bubble-tea-prototype.md。
// 瀏覽器載入後掛在 globalThis.TeaSim；Node 用 require() 取得同一個物件（平衡腳本用）。
(function (root) {
  "use strict";

  // ---------- 亂數（mulberry32，狀態存在 s.rng，存讀檔後可重現） ----------
  function rand(s) {
    s.rng = (s.rng + 0x6d2b79f5) >>> 0;
    let t = s.rng;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  const between = (s, a, b) => a + (b - a) * rand(s);
  const intBetween = (s, a, b) => Math.floor(between(s, a, b + 1));
  const pick = (s, arr) => arr[Math.floor(rand(s) * arr.length)];
  const chance = (s, p) => rand(s) < p;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const round = (v) => Math.round(v);

  // ---------- 靜態資料 ----------
  const WEEKS_PER_YEAR = 52;
  const TOTAL_WEEKS = 156;
  const BASE_HOURS = 40;
  const MAX_HOURS = 60;
  const WEEKS_PER_MONTH = 4.33;

  const LOCATIONS = {
    school: { name: "學區", rent: 60000, base: 330, weekday: 1.12, weekend: 0.68, rain: 0.85, vacation: true, note: "寒暑假來客少四成；學生兼職考試週會請假" },
    office: { name: "辦公區", rent: 120000, base: 440, weekday: 1.22, weekend: 0.48, rain: 0.9, groupOrders: true, note: "平日強、週末弱；常有團購大單" },
    mall: { name: "商圈", rent: 150000, base: 470, weekday: 0.88, weekend: 1.42, rain: 0.85, crowded: true, note: "週末旺，競爭最多" },
    night: { name: "夜市", rent: 80000, base: 370, weekday: 0.9, weekend: 1.32, rain: 0.55, tourist: true, note: "晚上生意，下雨大受影響；觀光客多" },
    residential: { name: "住宅區", rent: 50000, base: 240, weekday: 1, weekend: 1.06, rain: 0.92, loyal: true, note: "來客少但穩，回頭客多" },
  };
  const LOCATION_KEYS = Object.keys(LOCATIONS);
  const DISTRICTS = ["中正", "大安", "信義", "板橋", "新莊", "三重", "西屯", "北屯", "東區", "左營", "苓雅", "新竹東區", "竹北", "桃園", "中壢", "永和", "士林", "內湖"];

  const PRODUCTS = {
    greentea: { name: "四季春青茶", price: 35, cost: 7, pop: 1.0, season: { summer: 1.1, winter: 0.8 } },
    pearl: { name: "珍珠奶茶", price: 60, cost: 15, pop: 1.5, pearl: true },
    brownsugar: { name: "黑糖珍珠鮮奶", price: 75, cost: 24, pop: 1.1, pearl: true, milk: true },
    milktea: { name: "鮮奶茶", price: 65, cost: 20, pop: 0.9, milk: true },
    fruit: { name: "季節水果茶", price: 85, cost: 30, pop: 0.7, fruit: true, season: { summer: 1.8, winter: 0.5 } },
    cream: { name: "奶蓋綠茶", price: 70, cost: 18, pop: 0.8 },
    // 研發才會出現
    taro: { name: "芋泥波波鮮奶", price: 80, cost: 26, pop: 1.2, pearl: true, milk: true, idea: true },
    mango: { name: "楊枝甘露", price: 90, cost: 34, pop: 1.0, fruit: true, idea: true, season: { summer: 1.6, winter: 0.6 } },
    oolonglatte: { name: "烏龍拿鐵", price: 65, cost: 18, pop: 1.0, milk: true, idea: true },
    yakult: { name: "檸檬養樂多", price: 55, cost: 14, pop: 0.9, fruit: true, idea: true, season: { summer: 1.4, winter: 0.7 } },
    ginger: { name: "黑糖薑母茶", price: 60, cost: 12, pop: 0.6, idea: true, season: { summer: 0.3, winter: 2.4 } },
    wintermelon: { name: "冬瓜檸檬", price: 50, cost: 11, pop: 0.8, idea: true, season: { summer: 1.3, winter: 0.8 } },
    // 劇本二：店員時期研發的私房配方（名稱存在 s.career.signature）
    signature: { name: "招牌特調", price: 75, cost: 20, pop: 1.3, career: true },
  };
  const STARTER_MENU = ["greentea", "pearl", "brownsugar", "milktea", "fruit", "cream"];
  const IDEAS = Object.keys(PRODUCTS).filter((k) => PRODUCTS[k].idea);

  const SURNAMES = ["陳", "林", "黃", "張", "李", "王", "吳", "劉", "蔡", "楊", "許", "鄭", "謝", "郭", "洪", "曾", "邱", "廖", "賴", "周"];
  const GIVEN = ["怡君", "冠宇", "雅婷", "家豪", "佳穎", "柏翰", "思妤", "宇軒", "詩涵", "承恩", "品妍", "子翔", "欣妤", "俊傑", "語彤", "彥廷", "郁婷", "建宏", "宜蓁", "冠廷", "芷瑜", "宗翰", "筱涵", "志明"];
  const TRAITS = [
    { tag: "手很快但愛抱怨", speed: 5, quality: -5, morale: -0.5 },
    { tag: "細心、做得慢", speed: -4, quality: 10 },
    { tag: "笑容甜，熟客都認識她", quality: 4, rep: 0.02 },
    { tag: "很可靠，從不遲到", reliability: 15 },
    { tag: "新手，學得很快", speed: -3, growth: 1.5 },
    { tag: "想存錢出國，排班很拚", reliability: 8, morale: 0.3 },
    { tag: "有點散漫", reliability: -12, quality: -4 },
    { tag: "以前在大連鎖做過", speed: 4, quality: 6 },
    { tag: "會自己研究新口味", quality: 3, rnd: 1 },
    { tag: "脾氣直，跟同事常吵", morale: -0.8, speed: 2 },
  ];
  const ROLES = {
    manager: { name: "店長", wage: 45000, monthly: true, share: 1.0 },
    full: { name: "正職", wage: 33000, monthly: true, share: 1.0 },
    part: { name: "兼職", wage: 190 * 38, monthly: false, share: 0.5 },
  };

  const RIVALS = [
    { id: "chatang", name: "茶湯會社", style: "穩健的大型連鎖，愛打價格戰", stores: 40, rep: 62, aggression: 0.5 },
    { id: "sweetie", name: "甜蜜蜜 Sweetie", style: "網紅品牌，推爆款、搶人", stores: 12, rep: 58, aggression: 0.8 },
  ];

  const ACTIONS = {
    inspect: { name: "巡店", hours: 2, needs: "store", desc: "看到報表看不到的問題，員工士氣小升" },
    talk: { name: "員工談話", hours: 0.5, needs: "staff", desc: "士氣、忠誠上升，可能聽到情報" },
    research: { name: "研發新品", hours: 4, desc: "累積研發進度，滿了推出新品" },
    supplier: { name: "談供應商", hours: 3, desc: "原料成本降低（每季一次有效）" },
    marketing: { name: "行銷活動", hours: 2, needs: "campaign", desc: "短期來客增加" },
    scout: { name: "找新店址", hours: 6, desc: "看 3 個候選地點，可以展店" },
    hire: { name: "面試", hours: 1, needs: "store", desc: "從 3 位應徵者挑一位" },
    audit: { name: "查帳盤點", hours: 2, desc: "揪出盤點差異與耗損問題" },
    forecast: { name: "看天氣與活動預報", hours: 0.5, desc: "下週備料更準，耗損降低" },
    complaint: { name: "處理客訴與評論", hours: 1, desc: "負評有機會轉正，聲譽上升" },
    rest: { name: "休息", hours: 4, desc: "董事長壓力下降" },
    sitin: { name: "到門市坐鎮", hours: 6, needs: "store", desc: "跟員工一起顧店：品質與士氣上升，順便抓出問題" },
    office: { name: "處理公文與會議", hours: 4, desc: "可以重複排：審核帳單、簽約、和幹部開會，耗損與原料浪費稍降" },
    network: { name: "參加商會餐敘", hours: 3, desc: "聲譽小升，有機會帶來合作機會" },
    survey: { name: "市場調查", hours: 4, desc: "研發進度與下週備料都更準" },
    course: { name: "上經營管理課", hours: 6, desc: "店長能力上升（全部門市）；學費 NT$8,000" },
    // 劇本二店長階段才有
    meeting: { name: "跟老闆開會", hours: 2, mode: "manager", desc: "報告這週的店務，老闆信任 +" },
    learn: { name: "跟老闆學做生意", hours: 3, mode: "manager", desc: "看老闆怎麼談房租、算展店，營運與帶人 +" },
  };
  // 店長沒有權限的行動（要老闆決定）
  const OWNER_ACTIONS = ["supplier", "scout"];
  // 店長模式不會出現的事件（品牌層級、老闆的事）
  const OWNER_EVENTS = ["milk_price", "fruit_glut", "plastic_ban", "min_wage", "mall_counter", "delivery_offer", "delivery_fee_up", "franchise", "investor", "price_war", "copycat", "tea_price", "landlord", "chairman_health", "loan_offer", "expansion_chaos", "store_losing", "bank_review", "tea_expo", "corporate_deal", "pos_upgrade", "central_kitchen", "award", "landlord_sells", "supplier_batch", "syrup_scandal", "year_end_party"];
  const BUYOUT_PRICE = 2500000;
  const BUYOUT_DOWN = 100000; // 最低自備款：存越少，銀行貸越多、董事長階段越辛苦
  const BUYOUT_WEEKS = 14; // 劇本二每升一階多 2 週：小弟 10、店員 12、店長 14
  const MANAGER_SALARY = 42000;

  const CAMPAIGNS = {
    bogo: { name: "第二杯半價", cost: 0, weeks: 2, demand: 0.32, priceMul: 0.8, rep: 0 },
    influencer: { name: "網紅合作", cost: 60000, weeks: 3, demand: 0.2, priceMul: 1, rep: 3 },
    stamp: { name: "集點卡", cost: 18000, weeks: 8, demand: 0.08, priceMul: 0.97, rep: 1 },
    // 事件產生的暫時效果（不出現在行銷選單）
    __shortage: { name: "珍珠限量", hidden: true, demand: -0.1, priceMul: 1 },
    __short: { name: "縮短營業", hidden: true, demand: -0.15, priceMul: 1 },
    __viral: { name: "網紅爆紅", hidden: true, demand: 0.25, priceMul: 1 },
    __tourist: { name: "觀光客", hidden: true, demand: 0.06, priceMul: 1 },
    __hot: { name: "熱飲加價購", hidden: true, demand: 0.08, priceMul: 1 },
    __collab: { name: "聯名杯", hidden: true, demand: 0.18, priceMul: 1 },
  };

  // ---------- 時間 ----------
  function calendar(week) {
    const w = week % WEEKS_PER_YEAR;
    const year = Math.floor(week / WEEKS_PER_YEAR) + 1;
    let season = "spring";
    if (w >= 22 && w <= 36) season = "summer";
    else if (w >= 37 && w <= 46) season = "autumn";
    else if (w >= 47 || w <= 7) season = "winter";
    const seasonName = { spring: "春", summer: "夏", autumn: "秋", winter: "冬" }[season];
    const vacation = (w >= 26 && w <= 34) || (w >= 3 && w <= 6);
    const exams = w === 24 || w === 25 || w === 1 || w === 2;
    return { year, weekOfYear: w + 1, season, seasonName, vacation, exams };
  }

  // ---------- 建立 ----------
  function makeStaff(s, role) {
    const trait = pick(s, TRAITS);
    const name = pick(s, SURNAMES) + pick(s, GIVEN);
    const baseSpeed = role === "manager" ? 26 : role === "full" ? 28 : 22;
    return {
      id: "p" + s.nextId++,
      name,
      role,
      trait: trait.tag,
      speed: clamp(round(baseSpeed + between(s, -4, 6) + (trait.speed || 0)), 12, 40),
      quality: clamp(round(between(s, 45, 82) + (trait.quality || 0)), 20, 98),
      reliability: clamp(round(between(s, 45, 85) + (trait.reliability || 0)), 15, 99),
      skill: role === "manager" ? round(between(s, 40, 80)) : round(between(s, 20, 55)),
      morale: round(between(s, 62, 80)),
      moraleDrift: trait.morale || 0,
      repBonus: trait.rep || 0,
      rnd: trait.rnd || 0,
      student: role === "part" && chance(s, 0.6),
      weeks: 0,
    };
  }

  function makeLocationOffer(s, key) {
    const loc = LOCATIONS[key];
    return {
      key,
      district: pick(s, DISTRICTS),
      rent: round((loc.rent * between(s, 0.85, 1.2)) / 1000) * 1000,
      base: round(loc.base * between(s, 0.85, 1.15) * Math.pow(0.965, (s.stores ? s.stores.length : 0))),
      fitout: round(between(s, 1500000, 2400000) / 10000) * 10000,
    };
  }

  function makeStore(s, offer, opening) {
    const store = {
      id: "s" + s.nextId++,
      key: offer.key,
      district: offer.district,
      rent: offer.rent,
      base: offer.base,
      openWeek: opening ? s.week + 2 : s.week,
      staff: [],
      prep: "normal",
      hygiene: 80,
      theft: 0,
      rivalNearby: 0,
      lastWeek: null,
      reviewsBad: 0,
    };
    store.staff.push(makeStaff(s, "manager"));
    store.staff.push(makeStaff(s, "full"));
    store.staff.push(makeStaff(s, "part"));
    store.staff.push(makeStaff(s, "part"));
    return store;
  }

  function offersForStart(seed) {
    const s = { rng: seed >>> 0 };
    const keys = ["school", "office", "night", "residential", "mall"];
    const chosen = [];
    while (chosen.length < 3) {
      const k = pick(s, keys);
      if (!chosen.includes(k)) chosen.push(k);
    }
    const tmp = { rng: s.rng };
    return chosen.map((k) => makeLocationOffer(tmp, k));
  }

  // opts（劇本二用）：mode "manager"、startWeek、cash、rep、career（前面階段帶過來的能力與存款）
  function newGame(brand, seed, offer, opts) {
    opts = opts || {};
    const s = {
      version: 1,
      brand: (brand || "我的茶飲").slice(0, 16),
      seed: seed >>> 0,
      rng: (seed ^ 0x9e3779b9) >>> 0,
      nextId: 1,
      week: 0,
      cash: 3000000,
      rep: 50,
      stress: 10,
      costMod: 0,
      supplierWeek: -99,
      menu: STARTER_MENU.map((k) => ({ key: k, price: PRODUCTS[k].price, active: true })),
      research: { idea: IDEAS[0], progress: 0 },
      buzz: 0,
      campaigns: [],
      delivery: false,
      priceWar: 0,
      foodScare: 0,
      stores: [],
      rivals: RIVALS.map((r) => ({ ...r, cash: 1 })),
      inbox: [],
      plan: [],
      timers: [],
      flags: {},
      cooldown: {},
      history: [],
      news: [],
      loan: 0,
      debtWeeks: 0,
      profitTotal: 0,
      over: null,
      forecastWeek: -1,
      lastReport: null,
    };
    if (opts.mode === "manager") {
      s.mode = "manager";
      s.week = opts.startWeek || 0;
      s.totalWeeks = s.week + 156;
      s.cash = opts.cash || 600000;
      s.rep = opts.rep || 50;
      s.career = opts.career;
      s.forecastWeek = -1;
      s.supplierWeek = s.week - 99;
      if (s.career.signature) s.menu.push({ key: "signature", price: PRODUCTS.signature.price, active: true });
    }
    const st = makeStore(s, offer, false);
    s.stores.push(st);
    if (s.mode === "manager") {
      const sk = s.career.skills;
      st.openWeek = s.week;
      st.staff[0] = { id: "me", isPlayer: true, name: s.career.name + "（你）", role: "manager", trait: "就是你", speed: round(20 + sk.brew / 5), quality: round(45 + sk.brew / 2), reliability: 95, skill: round(25 + sk.ops * 0.8), morale: 80, moraleDrift: 0, repBonus: 0, rnd: 0, weeks: 0 };
      s.news.push({ week: s.week, text: `${s.career.name}成為「${s.brand}」${offer.district}店的店長。` });
    } else {
      s.news.push({ week: 0, text: `「${s.brand}」第一家店在${offer.district}${LOCATIONS[offer.key].name}開幕。` });
    }
    buildInbox(s);
    return s;
  }
  const productName = (s, key) => (key === "signature" && s.career && s.career.signature ? s.career.signature : PRODUCTS[key].name);
  const totalWeeks = (s) => s.totalWeeks || TOTAL_WEEKS;
  function actionVisible(s, key) {
    const a = ACTIONS[key];
    if (a.mode) return a.mode === s.mode;
    return !(s.mode === "manager" && OWNER_ACTIONS.includes(key));
  }

  // ---------- 小工具 ----------
  const storeById = (s, id) => s.stores.find((x) => x.id === id);
  function staffById(s, id) {
    for (const st of s.stores) {
      const p = st.staff.find((x) => x.id === id);
      if (p) return { store: st, person: p };
    }
    return null;
  }
  const openStores = (s) => s.stores.filter((x) => x.openWeek <= s.week);
  function addNews(s, text) {
    s.news.unshift({ week: s.week, text });
    if (s.news.length > 60) s.news.length = 60;
  }
  function hoursUsed(s) {
    return s.plan.reduce((a, p) => a + ACTIONS[p.action].hours, 0);
  }
  function fmtMoney(v) {
    const sign = v < 0 ? "−" : "";
    return sign + "NT$" + Math.abs(round(v)).toLocaleString("en-US");
  }

  // ---------- 行動 ----------
  function canPlan(s, action, target) {
    const a = ACTIONS[action];
    if (!a) return "沒有這個行動";
    if (!actionVisible(s, action)) return "這要老闆決定";
    if (hoursUsed(s) + a.hours > MAX_HOURS) return "這週時間不夠了";
    if (["meeting", "learn", "network", "survey", "course"].includes(action) && s.plan.some((p) => p.action === action)) return "這週已經排了";
    if (action === "sitin" && s.plan.some((p) => p.action === "sitin" && p.target === target)) return "這家店這週已經排了";
    if (action === "course" && s.cash < 8000) return "現金不夠";
    if (action === "scout" && s.plan.some((p) => p.action === "scout")) return "一週只能看一次店址";
    if (action === "scout" && (s.flags.noScoutUntil || 0) > s.week) return "你答應先暫停展店，等訓練完成";
    if (action === "supplier" && s.plan.some((p) => p.action === "supplier")) return "這週已經安排了";
    if (action === "forecast" && s.plan.some((p) => p.action === "forecast")) return "這週已經安排了";
    if (action === "inspect" && s.plan.some((p) => p.action === "inspect" && p.target === target)) return "這家店這週已經排了巡店";
    if (action === "talk" && s.plan.some((p) => p.action === "talk" && p.target === target)) return "這週已經約了";
    if (action === "marketing" && s.campaigns.some((c) => c.key === target)) return "這個活動還在進行中";
    if (action === "marketing" && CAMPAIGNS[target].cost > s.cash) return "現金不夠";
    if (action === "complaint" && !s.stores.some((x) => x.reviewsBad > 0)) return "目前沒有待處理的負評";
    return null;
  }
  function planAction(s, action, target) {
    const err = canPlan(s, action, target);
    if (err) return err;
    s.plan.push({ action, target: target || null });
    return null;
  }
  function unplan(s, index) {
    s.plan.splice(index, 1);
  }
  // 照上週的行程排（做不了的跳過，例如店已關、現金不夠）
  function repeatLast(s) {
    let skipped = 0;
    for (const p of s.lastPlan || []) {
      if (p.target && ACTIONS[p.action].needs === "store" && !storeById(s, p.target)) { skipped++; continue; }
      if (planAction(s, p.action, p.target)) skipped++;
    }
    return skipped;
  }

  function runActions(s, out) {
    for (const p of s.plan) {
      const st = p.target ? storeById(s, p.target) : null;
      switch (p.action) {
        case "inspect": {
          if (!st) break;
          st.inspected = s.week;
          st.staff.forEach((x) => (x.morale = clamp(x.morale + 4, 0, 100)));
          const issues = [];
          if (st.hygiene < 60) issues.push(`衛生只有 ${round(st.hygiene)} 分，冰箱與吧台要整理`);
          if (st.theft > 0.015) issues.push("盤點對不上，杯數與原料用量有落差");
          const low = st.staff.filter((x) => x.morale < 45);
          if (low.length) issues.push(`${low.map((x) => x.name).join("、")}看起來很累，士氣偏低`);
          if (st.lastWeek && st.lastWeek.lost > st.lastWeek.served * 0.12) issues.push("尖峰排隊太長，客人等不及就走了");
          st.hygiene = clamp(st.hygiene + 12, 0, 100);
          out.push({ kind: "inspect", text: `巡${st.district}${LOCATIONS[st.key].name}店：` + (issues.length ? issues.join("；") : "一切正常，大家做得不錯") + "。" });
          break;
        }
        case "talk": {
          const f = staffById(s, p.target);
          if (!f) break;
          f.person.morale = clamp(f.person.morale + 10, 0, 100);
          f.person.loyal = (f.person.loyal || 0) + 1;
          const tips = [
            `${f.person.name}說附近${pick(s, RIVALS).name}最近在徵人，時薪開比較高。`,
            `${f.person.name}建議夏天多備一些水果茶的料。`,
            `${f.person.name}覺得尖峰時段再多一個人會順很多。`,
            `${f.person.name}謝謝你特地來聊，說會繼續努力。`,
            `${f.person.name}提到常客問有沒有冬天的熱飲。`,
          ];
          out.push({ kind: "talk", text: pick(s, tips) });
          break;
        }
        case "research": {
          const bonus = s.stores.some((x) => x.staff.some((y) => y.rnd)) ? 6 : 0;
          s.research.progress += 22 + bonus + intBetween(s, 0, 8);
          if (s.research.progress >= 100) {
            const key = s.research.idea;
            const success = chance(s, 0.8);
            s.research.progress = 0;
            if (success) {
              if (!s.menu.some((m) => m.key === key)) s.menu.push({ key, price: PRODUCTS[key].price, active: true });
              s.buzz = 4;
              out.push({ kind: "research", text: `新品「${PRODUCTS[key].name}」上市！接下來幾週會帶來話題與來客。` });
              const next = IDEAS.find((k) => !s.menu.some((m) => m.key === k));
              if (next) s.research.idea = next;
            } else {
              out.push({ kind: "research", text: `「${PRODUCTS[key].name}」試喝反應普通，研發要重來。` });
            }
          } else {
            out.push({ kind: "research", text: `「${PRODUCTS[s.research.idea].name}」研發進度 ${s.research.progress}%。` });
          }
          break;
        }
        case "supplier": {
          if (s.week - s.supplierWeek < 13) {
            out.push({ kind: "supplier", text: "供應商說這季已經給過優惠了，這次談不下來。" });
          } else {
            const cut = between(s, 0.03, 0.08);
            s.costMod = clamp(s.costMod - cut, -0.18, 0.4);
            s.supplierWeek = s.week;
            out.push({ kind: "supplier", text: `談到原料價格降 ${round(cut * 100)}%（目前原料成本 ${s.costMod >= 0 ? "+" : ""}${round(s.costMod * 100)}%）。` });
          }
          break;
        }
        case "marketing": {
          const c = CAMPAIGNS[p.target];
          s.cash -= c.cost;
          s.campaigns.push({ key: p.target, weeksLeft: c.weeks });
          s.rep = clamp(s.rep + c.rep, 0, 100);
          out.push({ kind: "marketing", text: `「${c.name}」開跑${c.cost ? `，花了 ${fmtMoney(c.cost)}` : ""}。` });
          break;
        }
        case "scout": {
          const keys = [];
          while (keys.length < 3) {
            const k = pick(s, LOCATION_KEYS);
            if (!keys.includes(k)) keys.push(k);
          }
          const offers = keys.map((k) => makeLocationOffer(s, k));
          s.inbox.push(eventInstance(s, "site_offers", { offers }, true));
          out.push({ kind: "scout", text: "看了三個店址，結果放在「機會」，這週內決定。" });
          break;
        }
        case "hire": {
          if (!st) break;
          const role = st.staff.filter((x) => x.role !== "part").length < 3 && chance(s, 0.4) ? "full" : "part";
          const cands = [makeStaff(s, role), makeStaff(s, role), makeStaff(s, role)];
          s.inbox.push(eventInstance(s, "hire_pick", { storeId: st.id, cands }, true));
          out.push({ kind: "hire", text: `面試了三位應徵者（${ROLES[role].name}），在「機會」挑一位。` });
          break;
        }
        case "audit": {
          let found = 0;
          s.stores.forEach((x) => {
            found += x.theft;
            x.theft = 0;
          });
          s.flags.auditWeek = s.week;
          out.push({ kind: "audit", text: found > 0.02 ? "盤點發現原料用量與杯數有落差，已重新訂規則，之後耗損會降。" : "帳目大致正常，耗損在合理範圍。" });
          break;
        }
        case "forecast":
          s.forecastWeek = s.week;
          out.push({ kind: "forecast", text: "看了下週天氣與附近活動，各店備料量已調整。" });
          break;
        case "sitin": {
          if (!st) break;
          st.inspected = s.week;
          st._sitin = s.week;
          st.staff.forEach((x) => (x.morale = clamp(x.morale + 6, 0, 100)));
          st.hygiene = clamp(st.hygiene + 8, 0, 100);
          st.theft = Math.max(0, st.theft - 0.004);
          out.push({ kind: "sitin", text: `在${sname(st)}顧了一整天店：` + pick(s, ["尖峰時親自出杯，員工說老闆難得這麼接地氣。", "發現新人封膜常漏，當場教了一遍。", "跟熟客聊天，聽到他們希望多一款無糖選項。", "把冰箱整理了一遍，丟掉兩包快過期的粉圓。"]) });
          break;
        }
        case "office": {
          const cut = 0.004;
          s.flags.officeWeek = s.week;
          s.costMod = clamp(s.costMod - cut, -0.25, 0.6);
          s.timers.push({ week: s.week + 4, type: "costMod", value: cut });
          out.push({ kind: "office", text: pick(s, ["跟會計對了一下午的帳，抓出兩筆重複請款。", "和幹部開週會，排好下個月的班表。", "簽了新的杯材合約，每個杯子便宜一點點。", "審了一疊報銷單，退回三張沒附發票的。"]) });
          break;
        }
        case "network": {
          s.rep = clamp(s.rep + 1, 0, 100);
          if (chance(s, 0.3)) s.inbox.push(eventInstance(s, pick(s, ["group_order", "collab", "corporate_deal"].filter((k) => EVENTS[k] && !(s.mode === "manager" && OWNER_EVENTS.includes(k)))), {}, true));
          out.push({ kind: "network", text: pick(s, ["商會餐敘上認識了一位辦公大樓的總務主任。", "聽同業抱怨租金又漲了，大家都在找新地點。", "和烘焙坊老闆聊到可以一起推聯名組合。"]) });
          break;
        }
        case "survey": {
          s.research.progress = Math.min(99, s.research.progress + 10);
          s.forecastWeek = s.week;
          out.push({ kind: "survey", text: "走訪了三個商圈、試喝對手新品，研發進度 +10%，下週備料也更準。" });
          break;
        }
        case "course": {
          s.cash -= 8000;
          s.stores.forEach((x) => x.staff.forEach((p) => { if (p.role === "manager" && !p.isPlayer) p.skill = clamp(p.skill + 3, 0, 100); }));
          out.push({ kind: "course", text: "上完一整天的連鎖經營課，回來把排班和教育訓練的方法分享給店長們。" });
          break;
        }
        case "complaint": {
          const bad = s.stores.filter((x) => x.reviewsBad > 0);
          bad.forEach((x) => (x.reviewsBad = Math.max(0, x.reviewsBad - 2)));
          s.rep = clamp(s.rep + 2, 0, 100);
          out.push({ kind: "complaint", text: "逐一回覆了負評，有兩位客人改成好評。" });
          break;
        }
        case "rest":
          s.stress = clamp(s.stress - 18, 0, 100);
          out.push({ kind: "rest", text: "空出半天陪家人，精神好多了。" });
          break;
        case "meeting": {
          const st0 = s.stores[0];
          const good = st0 && st0.lastWeek && st0.lastWeek.profit > 0;
          s.career.trust = clamp(s.career.trust + (good ? 4 : 2), 0, 100);
          out.push({ kind: "meeting", text: good ? "德哥看完帳說：「不錯，照這樣做。」" : "德哥看著虧損的數字沒說話，要你下週把對策寫給他。" });
          break;
        }
        case "learn": {
          const sk = s.career.skills;
          sk.ops = clamp(sk.ops + 3 * (1 - sk.ops / 130), 0, 100);
          sk.lead = clamp(sk.lead + 2 * (1 - sk.lead / 130), 0, 100);
          out.push({ kind: "learn", text: pick(s, ["跟德哥去看了一間店面，他算給你聽押金、裝潢多久回本。", "德哥帶你跟茶葉行老闆吃飯，聽他們談明年的價格。", "德哥說他開第一家店時虧了半年，靠的是把熟客顧好。"]) });
          break;
        }
      }
    }
  }

  // ---------- 一週營運 ----------
  function storeCapacity(st, cal, s) {
    let cap = 0;
    for (const p of st.staff) {
      let share = ROLES[p.role].share;
      if (p.student && cal.exams) share *= 0.4;
      const moraleMul = 0.7 + (p.morale / 100) * 0.4;
      cap += p.speed * share * moraleMul;
    }
    if (s.stress > 85) cap *= 0.95;
    return cap * 6.2 * (s.flags.capMul || 1);
  }
  function storeQuality(st) {
    const q = st.staff.reduce((a, p) => a + p.quality * (0.7 + p.morale / 330), 0) / Math.max(1, st.staff.length);
    return q * (0.75 + st.hygiene / 400) + (st._qualityBonus || 0);
  }
  function weatherFor(s, season) {
    const r = rand(s);
    if (season === "summer") {
      if (r < 0.04) return "typhoon";
      if (r < 0.45) return "hot";
      if (r < 0.7) return "rain";
      return "sunny";
    }
    if (season === "winter") {
      if (r < 0.3) return "cold";
      if (r < 0.55) return "rain";
      return "cloudy";
    }
    if (r < 0.35) return "rain";
    if (r < 0.6) return "cloudy";
    return "sunny";
  }

  function simulateStore(s, st, cal, weatherDays) {
    const loc = LOCATIONS[st.key];
    const repMul = 0.6 + (s.rep / 100) * 0.8;
    const active = s.menu.filter((m) => m.active);
    const defaultAvg = active.reduce((a, m) => a + PRODUCTS[m.key].price, 0) / Math.max(1, active.length);
    const avgPrice = active.reduce((a, m) => a + m.price, 0) / Math.max(1, active.length);
    let campaignMul = 1;
    let priceMul = 1;
    for (const c of s.campaigns) {
      campaignMul += CAMPAIGNS[c.key].demand;
      priceMul *= CAMPAIGNS[c.key].priceMul;
    }
    const priceFactor = Math.pow(defaultAvg / Math.max(1, avgPrice * priceMul), 1.3);
    const menuFactor = 0.85 + Math.min(active.length, 9) * 0.03;
    const buzzMul = 1 + (s.buzz > 0 ? 0.1 : 0);
    const compMul = Math.pow(0.86, st.rivalNearby) * (loc.crowded ? 0.94 : 1) * (s.priceWar > 0 ? 0.9 : 1) * (s.foodScare > 0 ? 0.8 : 1);
    const vacMul = loc.vacation && cal.vacation ? 0.6 : 1;
    const ramp = Math.min(1, 0.6 + 0.4 * ((s.week - st.openWeek) / 12)); // 新店要時間累積客人
    const cannibal = Math.pow(0.985, Math.max(0, openStores(s).length - 1)); // 自家門市互搶
    const capacity = storeCapacity(st, cal, s);
    const quality = storeQuality(st);
    const forecastErr = clamp(0.24 - (st.staff.find((x) => x.role === "manager")?.skill || 30) / 600 - (s.forecastWeek === s.week ? 0.09 : 0) - (s.flags.forecastBonus || 0), 0.04, 0.3);
    const prepMul = { conservative: 0.96, normal: 1.06, aggressive: 1.2 }[st.prep];

    // 品項比例
    let mixW = 0;
    const mix = active.map((m) => {
      const p = PRODUCTS[m.key];
      const w = p.pop * ((p.season && p.season[cal.season]) || 1) * Math.pow(p.price / Math.max(1, m.price), 1.5);
      mixW += w;
      return { m, p, w };
    });
    let unitRev = 0;
    let unitCost = 0;
    for (const x of mix) {
      const share = x.w / Math.max(0.001, mixW);
      unitRev += share * x.m.price * priceMul;
      unitCost += share * x.p.cost;
    }
    unitCost = unitCost * (1 + s.costMod) + 4; // 杯材、封膜、吸管

    let demand = 0, served = 0, lost = 0, prepared = 0, waste = 0, revenue = 0, closedDays = 0, stockout = 0;
    for (let d = 0; d < 7; d++) {
      const weekend = d >= 5;
      const w = weatherDays[d];
      if (w === "typhoon") {
        closedDays++;
        continue;
      }
      let wMul = 1;
      if (w === "hot") wMul = 1.18;
      else if (w === "rain") wMul = loc.rain;
      else if (w === "cold") wMul = 0.86;
      else if (w === "cloudy") wMul = 0.97;
      const seasonMul = { spring: 1, summer: 1.2, autumn: 1, winter: 0.85 }[cal.season];
      const dayDemand = st.base * (weekend ? loc.weekend : loc.weekday) * seasonMul * wMul * repMul * priceFactor * menuFactor * campaignMul * buzzMul * compMul * vacMul * ramp * cannibal * between(s, 0.9, 1.1);
      const expected = st.base * (weekend ? loc.weekend : loc.weekday) * seasonMul * repMul * priceFactor * menuFactor * campaignMul * buzzMul * compMul * vacMul * ramp * cannibal;
      const prep = Math.max(0, expected * prepMul * (1 + (rand(s) * 2 - 1) * forecastErr));
      const sell = Math.min(dayDemand, capacity, prep);
      demand += dayDemand;
      served += sell;
      prepared += prep;
      if (prep < Math.min(dayDemand, capacity)) stockout += Math.min(dayDemand, capacity) - prep;
      lost += dayDemand - sell;
      waste += Math.max(0, prep - sell);
    }
    if (s.delivery) {
      const extra = served * 0.16;
      served += extra;
      revenue -= extra * unitRev * 0.3;
    }
    revenue += served * unitRev;
    const theftLoss = served * unitCost * st.theft;
    const cogs = served * unitCost + theftLoss;
    const wasteCost = waste * (unitCost * 0.45);
    let wages = 0;
    for (const p of st.staff) wages += p.role === "part" ? ROLES.part.wage : ROLES[p.role].wage / WEEKS_PER_MONTH;
    wages *= 1.12; // 勞健保、勞退
    const rent = st.rent / WEEKS_PER_MONTH;
    const utilities = 11000;
    const overhead = revenue * 0.06; // 營業稅、刷卡與行動支付手續費
    const profit = revenue - cogs - wasteCost - wages - rent - utilities - overhead;

    // 聲譽、士氣、衛生
    const lostShare = demand > 0 ? lost / demand : 0;
    let repDelta = (quality - 60) / 90 - Math.max(0, lostShare - 0.08) * 6 - (stockout / Math.max(1, demand)) * 3;
    repDelta += st.staff.reduce((a, p) => a + p.repBonus, 0) * 10;
    const overload = demand / Math.max(1, capacity * (7 - closedDays));
    for (const p of st.staff) {
      if (p.isPlayer) { p.weeks++; continue; }
      let dm = p.moraleDrift + between(s, -1.5, 1.5) + (s.flags.moraleBonus || 0);
      if (overload > 1.12) dm -= 3.5;
      else if (overload < 0.75) dm += 0.5;
      if (s.stress > 75) dm -= 1;
      if (st.inspected === s.week) dm += 1;
      dm -= 0.35 + 0.06 * Math.max(0, s.stores.length - 4); // 日常疲勞；店越多，董事長越顧不到
      p.morale = clamp(p.morale + dm, 0, 100);
      p.weeks++;
    }
    st.hygiene = clamp(st.hygiene - between(s, 1.5, 3.5) * (1 + 0.1 * Math.max(0, s.stores.length - 4)) + (st.staff.find((x) => x.role === "manager")?.skill || 40) / 60, 0, 100);
    if (s.flags.auditWeek === undefined || s.week - s.flags.auditWeek > 8) st.theft = clamp(st.theft + between(s, 0, 0.004), 0, 0.08);
    if (lostShare > 0.15 || quality < 52) st.reviewsBad += 1;

    st.lastWeek = { demand: round(demand), served: round(served), lost: round(lost), revenue: round(revenue), profit: round(profit), wasteRate: prepared > 0 ? waste / prepared : 0, wasteCost: round(wasteCost), wages: round(wages), rent: round(rent), cogs: round(cogs), capacityDay: round(capacity), quality: round(quality), closedDays };
    return { profit, revenue, repDelta };
  }

  // ---------- 事件 ----------
  // 每個事件：cat（urgent／opportunity／people）、cond、weight、cooldown、make（產生資料）、title、body、options、fallback（沒處理時用第幾個選項）
  const pickStore = (s) => pick(s, openStores(s));
  const pickStaff = (s, filter) => {
    const all = [];
    openStores(s).forEach((st) => st.staff.forEach((p) => !p.isPlayer && (!filter || filter(p, st)) && all.push({ st, p })));
    return all.length ? pick(s, all) : null;
  };
  // 事件可能指向已經關掉的店（舊存檔也有），找不到店時不能讓整個畫面壞掉
  const sname = (st) => (st ? `${st.district}${LOCATIONS[st.key].name}店` : "那家店");
  const dropStaleEvents = (s) => { s.inbox = s.inbox.filter((x) => !x.data || x.data.storeId == null || storeById(s, x.data.storeId)); };

  const EVENTS = {
    heatwave: {
      cat: "urgent", weight: 3, cooldown: 6,
      cond: (s, c) => c.season === "summer",
      title: () => "熱浪來襲，下週全台高溫",
      body: () => "氣象局發布高溫警報。水果茶和冰飲會大賣，但各店人手和備料可能跟不上。",
      options: [
        { label: "各店加開臨時班、多備料", note: "本週每店多一位臨時人手（−NT$6,000／店），積極備料", apply: (s) => { openStores(s).forEach((st) => { st.prep = "aggressive"; st.tempBoost = s.week + 1; }); s.cash -= 6000 * openStores(s).length; } },
        { label: "照常營運", note: "不花錢，但可能大排長龍、流失客人", apply: () => {} },
      ], fallback: 1,
    },
    typhoon: {
      cat: "urgent", weight: 1.5, cooldown: 8,
      cond: (s, c) => c.season === "summer",
      title: () => "颱風要來了",
      body: () => "颱風預計週三登陸，可能要停業一到兩天。原料可能泡水。",
      options: [
        { label: "提早停業、原料移到高處", note: "損失一天營業，但不會有原料損失", apply: (s) => { s.flags.typhoonSafe = s.week + 1; } },
        { label: "能開就開", note: "多賺半天，但有三成機會原料泡水（−NT$40,000）", apply: (s) => { if (chance(s, 0.3)) { s.cash -= 40000; addNews(s, "颱風夜倉庫進水，報廢一批原料。"); } } },
      ], fallback: 1,
    },
    pearl_shortage: {
      cat: "urgent", weight: 2, cooldown: 10,
      title: () => "珍珠供應商斷貨",
      body: () => "原本的粉圓廠機器故障，兩週內只能供應一半的量。珍珠類飲品占營收很大一塊。",
      options: [
        { label: "找替代供應商（貴 20%）", note: "兩週原料成本 +8%，品質略差", apply: (s) => { s.costMod += 0.08; s.timers.push({ week: s.week + 2, type: "costMod", value: -0.08 }); } },
        { label: "珍珠類限量供應", note: "兩週來客 −10%、可能有負評", apply: (s) => { s.campaigns.push({ key: "__shortage", weeksLeft: 2 }); openStores(s).forEach((st) => (st.reviewsBad += 1)); } },
      ], fallback: 1,
    },
    milk_price: {
      cat: "urgent", weight: 2, cooldown: 16,
      title: () => "鮮奶要漲價 12%",
      body: () => "乳品廠通知下個月起鮮奶漲價。鮮奶類飲品的毛利會被壓縮。",
      options: [
        { label: "鮮奶類漲 5 元", note: "毛利維持，但少數客人會嫌貴", apply: (s) => { s.menu.forEach((m) => { if (PRODUCTS[m.key].milk) m.price += 5; }); s.rep -= 1; } },
        { label: "吸收成本", note: "原料成本 +4%", apply: (s) => { s.costMod += 0.04; } },
        { label: "換另一家乳品（口感差一點）", note: "成本不變，聲譽 −2", apply: (s) => { s.rep -= 2; } },
      ], fallback: 1,
    },
    fruit_glut: {
      cat: "opportunity", weight: 1.5, cooldown: 10,
      cond: (s, c) => c.season !== "winter" && s.menu.some((m) => m.active && PRODUCTS[m.key].fruit),
      title: () => "水果盛產，果農直接找上門",
      body: () => "今年芒果和柳橙大豐收，果農願意用市價七折長期供貨，但要先付訂金。",
      options: [
        { label: "簽約（付訂金 NT$80,000）", note: "8 週內原料成本 −6%", apply: (s) => { s.cash -= 80000; s.costMod -= 0.06; s.timers.push({ week: s.week + 8, type: "costMod", value: 0.06 }); } },
        { label: "謝謝，不用", note: "", apply: () => {} },
      ], fallback: 1,
    },
    staff_poach: {
      cat: "people", weight: 2, cooldown: 8,
      cond: (s) => openStores(s).length > 0,
      make: (s) => { const x = pickStaff(s, (p) => p.role === "manager"); return x ? { storeId: x.st.id, staffId: x.p.id } : null; },
      title: (s, d) => { const f = staffById(s, d.staffId); return `${f ? f.person.name : "店長"}收到甜蜜蜜的挖角`; },
      body: (s, d) => { const f = staffById(s, d.staffId); return f ? `${sname(f.store)}的${f.person.name}私下跟你說，甜蜜蜜開了月薪 52,000 找她當區經理。` : ""; },
      options: [
        { label: "加薪留人（月薪 +5,000）", note: "士氣大升；成本每月 +5,000", apply: (s, d) => { const f = staffById(s, d.staffId); if (f) { f.person.morale = clamp(f.person.morale + 25, 0, 100); f.person.raise = (f.person.raise || 0) + 5000; } } },
        { label: "給她升遷的承諾", note: "士氣 +10；半年內沒兌現會離職", apply: (s, d) => { const f = staffById(s, d.staffId); if (f) { f.person.morale = clamp(f.person.morale + 10, 0, 100); s.timers.push({ week: s.week + 26, type: "promiseCheck", staffId: d.staffId }); } } },
        { label: "祝福她", note: "店長離職，店會亂一陣子", apply: (s, d) => quitStaff(s, d.staffId, "跳槽到甜蜜蜜") },
      ], fallback: 2,
    },
    exam_week: {
      cat: "urgent", weight: 4, cooldown: 20,
      cond: (s, c) => c.exams && openStores(s).some((st) => st.staff.some((p) => p.student)),
      title: () => "學生兼職考試週集體請假",
      body: () => "期末考到了，好幾位學生兼職說這兩週沒辦法排班。尖峰時段會很吃緊。",
      options: [
        { label: "正職加班補位（加班費 NT$8,000／店）", note: "產能維持，正職士氣 −5", apply: (s) => { openStores(s).forEach((st) => { st.tempBoost = s.week + 1; st.staff.filter((p) => p.role !== "part").forEach((p) => (p.morale -= 5)); }); s.cash -= 8000 * openStores(s).length; } },
        { label: "縮短營業時間", note: "這週來客 −15%", apply: (s) => { s.campaigns.push({ key: "__short", weeksLeft: 1 }); } },
      ], fallback: 1,
    },
    viral: {
      cat: "opportunity", weight: 1.5, cooldown: 12,
      cond: (s) => s.rep >= 55,
      make: (s) => ({ storeId: pickStore(s).id }),
      title: () => "網紅開箱影片爆紅",
      body: (s, d) => `一位美食網紅拍了${sname(storeById(s, d.storeId))}的黑糖珍奶，影片 48 小時破百萬觀看。接下來兩週會湧入大量客人。`,
      options: [
        { label: "加派人手、趁勢推廣（NT$20,000）", note: "聲譽 +6，兩週來客 +25%", apply: (s, d) => { s.cash -= 20000; s.rep += 6; s.campaigns.push({ key: "__viral", weeksLeft: 2 }); const st = storeById(s, d.storeId); if (st) st.tempBoost = s.week + 2; } },
        { label: "順其自然", note: "來客增加，但可能排隊太久被罵", apply: (s, d) => { s.campaigns.push({ key: "__viral", weeksLeft: 2 }); const st = storeById(s, d.storeId); if (st) st.reviewsBad += 1; } },
      ], fallback: 1,
    },
    bad_reviews: {
      cat: "urgent", weight: 3, cooldown: 4,
      cond: (s) => s.stores.some((st) => st.reviewsBad >= 2),
      make: (s) => ({ storeId: s.stores.filter((st) => st.reviewsBad >= 2)[0].id }),
      title: (s, d) => `${sname(storeById(s, d.storeId))} Google 評論連續出現一星`,
      body: () => "客人抱怨等太久、飲料太甜、店員態度差。評分正在往下掉。",
      options: [
        { label: "老闆親自逐則回覆並招待", note: "NT$5,000，聲譽 −1（止血）", apply: (s, d) => { s.cash -= 5000; s.rep -= 1; const st = storeById(s, d.storeId); if (st) st.reviewsBad = 0; } },
        { label: "不理它", note: "聲譽 −4", apply: (s) => { s.rep -= 4; } },
      ], fallback: 1,
    },
    health_inspection: {
      cat: "urgent", weight: 2, cooldown: 12,
      make: (s) => ({ storeId: pickStore(s).id }),
      title: (s, d) => `衛生局要稽查${sname(storeById(s, d.storeId))}`,
      body: () => "衛生局通知這週會來抽查冰箱溫度、製冰機和作業流程。",
      options: [
        { label: "相信店長，照常營業", note: "衛生分數低於 60 會被罰款並上新聞", apply: (s, d) => inspectionResult(s, d.storeId, 0) },
        { label: "停業半天大掃除（NT$12,000）", note: "衛生 +25 後再接受稽查", apply: (s, d) => { s.cash -= 12000; inspectionResult(s, d.storeId, 25); } },
      ], fallback: 0,
    },
    food_scare: {
      cat: "urgent", weight: 0.8, cooldown: 40,
      cond: (s) => s.week > 20,
      title: () => "食安新聞：知名品牌茶葉驗出農藥",
      body: () => "雖然不是你家，但整個手搖飲業來客都會受影響兩週。",
      options: [
        { label: "公開檢驗報告（NT$30,000）", note: "影響減半，聲譽 +3", apply: (s) => { s.cash -= 30000; s.rep += 3; s.foodScare = 1; } },
        { label: "低調度過", note: "兩週來客 −20%", apply: (s) => { s.foodScare = 2; } },
      ], fallback: 1,
    },
    plastic_ban: {
      cat: "urgent", weight: 1, cooldown: 999,
      cond: (s) => s.week > 30 && !s.flags.plasticDone,
      title: () => "限塑新制：內用與外帶杯要改材質",
      body: () => "環保署公告三個月後起，一次性塑膠杯要改成可回收材質。杯材成本會上升。",
      options: [
        { label: "提前換、推環保杯折 5 元", note: "杯材成本 +3%，聲譽 +4", apply: (s) => { s.flags.plasticDone = 1; s.costMod += 0.03; s.rep += 4; } },
        { label: "等期限到再換", note: "杯材成本 +4%", apply: (s) => { s.flags.plasticDone = 1; s.timers.push({ week: s.week + 12, type: "costMod", value: 0.04 }); } },
      ], fallback: 1,
    },
    min_wage: {
      cat: "urgent", weight: 1, cooldown: 52,
      cond: (s, c) => c.weekOfYear === 40,
      title: () => "明年基本工資調漲 4%",
      body: () => "勞動部公告明年起時薪與月薪調漲。兼職時薪也要跟著調。",
      options: [
        { label: "全部員工一起調薪", note: "人事成本 +4%，士氣 +8", apply: (s) => { s.flags.wageMul = (s.flags.wageMul || 1) * 1.04; s.stores.forEach((st) => st.staff.forEach((p) => (p.morale += 8))); } },
        { label: "只調法定最低的人", note: "人事成本 +2%，士氣 −3", apply: (s) => { s.flags.wageMul = (s.flags.wageMul || 1) * 1.02; s.stores.forEach((st) => st.staff.forEach((p) => (p.morale -= 3))); } },
      ], fallback: 1,
    },
    raise_request: {
      cat: "people", weight: 2.5, cooldown: 4,
      make: (s) => { const x = pickStaff(s, (p) => p.weeks > 20 && p.morale > 40); return x ? { staffId: x.p.id } : null; },
      title: (s, d) => { const f = staffById(s, d.staffId); return `${f ? f.person.name : ""}想談加薪`; },
      body: (s, d) => { const f = staffById(s, d.staffId); return f ? `${sname(f.store)}的${ROLES[f.person.role].name}${f.person.name}（${f.person.trait}）做了快半年，希望加薪。` : ""; },
      options: [
        { label: "加薪", note: "士氣 +20，人事成本小增", apply: (s, d) => { const f = staffById(s, d.staffId); if (f) { f.person.morale += 20; f.person.raise = (f.person.raise || 0) + (f.person.role === "part" ? 600 : 2000); } } },
        { label: "下次再說", note: "士氣 −15", apply: (s, d) => { const f = staffById(s, d.staffId); if (f) f.person.morale -= 15; } },
      ], fallback: 1,
    },
    quit_lowmorale: {
      cat: "people", weight: 4, cooldown: 2,
      make: (s) => { const x = pickStaff(s, (p) => p.morale < 30); return x ? { staffId: x.p.id } : null; },
      title: (s, d) => { const f = staffById(s, d.staffId); return `${f ? f.person.name : ""}遞了辭呈`; },
      body: (s, d) => { const f = staffById(s, d.staffId); return f ? `${sname(f.store)}的${f.person.name}說太累了，想做到月底。` : ""; },
      options: [
        { label: "親自慰留（下週休假三天）", note: "五成機會留下，士氣回到 60", apply: (s, d) => { const f = staffById(s, d.staffId); if (f) { if (chance(s, 0.5)) f.person.morale = 60; else quitStaff(s, d.staffId, "還是決定離開"); } } },
        { label: "同意", note: "人手少一位，記得面試補人", apply: (s, d) => quitStaff(s, d.staffId, "離職") },
      ], fallback: 1,
    },
    staff_fight: {
      cat: "people", weight: 1.5, cooldown: 8,
      make: (s) => { const st = openStores(s).find((x) => x.staff.length >= 3); return st ? { storeId: st.id } : null; },
      title: (s, d) => `${sname(storeById(s, d.storeId))}員工尖峰吵架`,
      body: () => "兩位員工在尖峰時段為了做飲料順序吵起來，客人在 IG 限動上發了影片。",
      options: [
        { label: "找兩人分別談、調整排班", note: "這週要花你 1 小時（已扣），士氣 +5", apply: (s, d) => { const st = storeById(s, d.storeId); if (st) st.staff.forEach((p) => (p.morale += 5)); s.flags.extraHours = (s.flags.extraHours || 0) + 1; } },
        { label: "交給店長處理", note: "店長能力不夠的話士氣 −8", apply: (s, d) => { const st = storeById(s, d.storeId); if (!st) return; const m = st.staff.find((p) => p.role === "manager"); if (!m || m.skill < 60) st.staff.forEach((p) => (p.morale -= 8)); } },
      ], fallback: 1,
    },
    group_order: {
      cat: "opportunity", weight: 2.5, cooldown: 3,
      cond: (s) => openStores(s).some((st) => LOCATIONS[st.key].groupOrders || chance(s, 0.3)),
      make: (s) => ({ storeId: pickStore(s).id, cups: intBetween(s, 80, 260) }),
      title: (s, d) => `${d.cups} 杯團購大單`,
      body: (s, d) => `附近公司辦活動，要在週五下午兩點前送 ${d.cups} 杯到${sname(storeById(s, d.storeId))}附近。`,
      options: [
        { label: "接單", note: "營收 + 約 NT$" + "{cash}" + "，那天尖峰會很擠", apply: (s, d) => { const v = d.cups * 52; s.cash += v * 0.55; const st = storeById(s, d.storeId); if (st) st.staff.forEach((p) => (p.morale -= 2)); } },
        { label: "婉拒", note: "", apply: () => {} },
      ], fallback: 1,
    },
    mall_counter: {
      cat: "opportunity", weight: 1, cooldown: 26,
      cond: (s) => s.rep >= 60 && s.cash > 1200000,
      title: () => "百貨公司邀請週年慶設櫃",
      body: () => "百貨公司邀你在美食街設三週快閃櫃，抽成 25%。可以打品牌知名度。",
      options: [
        { label: "參加（籌備 NT$150,000）", note: "三週額外淨利約 NT$120,000～260,000，聲譽 +4", apply: (s) => { s.cash -= 150000; s.timers.push({ week: s.week + 3, type: "cash", value: round(between(s, 270000, 410000)), text: "百貨快閃櫃結算入帳。" }); s.rep += 4; } },
        { label: "人手不夠，婉拒", note: "", apply: () => {} },
      ], fallback: 1,
    },
    delivery_offer: {
      cat: "opportunity", weight: 2, cooldown: 30,
      cond: (s) => !s.delivery,
      title: () => "外送平台找你合作",
      body: () => "外送平台業務說上架後訂單會多一成五以上，但每筆抽成 30%。",
      options: [
        { label: "上架", note: "外送訂單 +16%、該部分營收被抽 30%", apply: (s) => { s.delivery = true; } },
        { label: "先不要", note: "", apply: () => {} },
      ], fallback: 1,
    },
    delivery_fee_up: {
      cat: "urgent", weight: 1, cooldown: 40,
      cond: (s) => s.delivery,
      title: () => "外送平台抽成調高到 35%",
      body: () => "平台通知下月起抽成提高。不少店家考慮下架。",
      options: [
        { label: "繼續合作", note: "外送部分毛利再降", apply: (s) => { s.flags.deliveryCut = 0.35; } },
        { label: "下架外送", note: "少了外送訂單", apply: (s) => { s.delivery = false; } },
      ], fallback: 0,
    },
    franchise: {
      cat: "opportunity", weight: 1.2, cooldown: 16,
      cond: (s) => s.stores.length >= 3 && s.rep >= 62,
      title: () => "有人想加盟",
      body: () => "一位在台南開早餐店的老闆想加盟你的品牌，願意付加盟金 NT$500,000，之後每月抽營業額 4%。",
      options: [
        { label: "同意加盟", note: "立即 +NT$500,000，每週權利金；加盟店出包會傷聲譽", apply: (s) => { s.cash += 500000; s.flags.franchises = (s.flags.franchises || 0) + 1; } },
        { label: "目前只做直營", note: "", apply: () => {} },
      ], fallback: 1,
    },
    investor: {
      cat: "opportunity", weight: 0.8, cooldown: 30,
      cond: (s) => s.stores.length >= 4 && s.rep >= 65,
      title: () => "創投想投資",
      body: () => "一家創投願意投資 NT$8,000,000 換 25% 股份，條件是兩年內開到 15 家店。",
      options: [
        { label: "接受", note: "現金 +NT$8,000,000，評級改看門市數與成長", apply: (s) => { s.cash += 8000000; s.flags.investor = s.week; } },
        { label: "婉拒，自己慢慢來", note: "", apply: () => {} },
      ], fallback: 1,
    },
    rival_open: {
      cat: "urgent", weight: 0, cooldown: 0,
      title: (s, d) => `${d.rival}在${sname(storeById(s, d.storeId))}斜對面開店`,
      body: () => "對手新店開幕第一週買一送一，你的來客會被分走一部分。",
      options: [
        { label: "推出會員集點反擊（NT$18,000）", note: "集點卡活動 8 週", apply: (s) => { if (!s.campaigns.some((c) => c.key === "stamp")) { s.cash -= 18000; s.campaigns.push({ key: "stamp", weeksLeft: 8 }); } } },
        { label: "專心做好自己的品質", note: "", apply: () => {} },
      ], fallback: 1,
    },
    price_war: {
      cat: "urgent", weight: 0, cooldown: 0,
      title: () => "茶湯會社全面降價 10 元",
      body: () => "茶湯會社宣布全品項降價 10 元，為期一個月。",
      options: [
        { label: "跟著降價 5 元", note: "四週來客回穩、毛利下降", apply: (s) => { s.menu.forEach((m) => (m.price -= 5)); s.timers.push({ week: s.week + 4, type: "priceBack", value: 5 }); } },
        { label: "不跟，強調品質", note: "四週來客 −10%", apply: (s) => { s.priceWar = 4; } },
      ], fallback: 1,
    },
    copycat: {
      cat: "people", weight: 0, cooldown: 0,
      title: () => "甜蜜蜜推出跟你幾乎一樣的新品",
      body: () => "甜蜜蜜上週推出的新品，配方和外觀都跟你家的招牌很像，網友在比較。",
      options: [
        { label: "發文強調原創、推限定口味", note: "NT$15,000，聲譽 +3", apply: (s) => { s.cash -= 15000; s.rep += 3; } },
        { label: "不回應", note: "聲譽 −1", apply: (s) => { s.rep -= 1; } },
      ], fallback: 1,
    },
    tourist_wave: {
      cat: "opportunity", weight: 1.5, cooldown: 10,
      cond: (s) => openStores(s).some((st) => LOCATIONS[st.key].tourist),
      title: () => "觀光客變多了",
      body: () => "航空公司加開班機，夜市觀光客明顯增加。可以做英日文菜單吸引他們。",
      options: [
        { label: "做多語菜單與行動支付（NT$15,000）", note: "夜市店 6 週來客 +12%", apply: (s) => { s.cash -= 15000; s.campaigns.push({ key: "__tourist", weeksLeft: 6 }); } },
        { label: "不用", note: "", apply: () => {} },
      ], fallback: 1,
    },
    ac_broken: {
      cat: "urgent", weight: 1.5, cooldown: 12,
      cond: (s, c) => c.season === "summer",
      make: (s) => ({ storeId: pickStore(s).id }),
      title: (s, d) => `${sname(storeById(s, d.storeId))}冷氣和製冰機壞了`,
      body: () => "夏天製冰機故障，冰塊不夠，員工也熱到受不了。",
      options: [
        { label: "立刻換新（NT$65,000）", note: "", apply: (s) => { s.cash -= 65000; } },
        { label: "先叫冰塊、請師傅修（NT$15,000）", note: "這週該店士氣 −10", apply: (s, d) => { s.cash -= 15000; const st = storeById(s, d.storeId); if (st) st.staff.forEach((p) => (p.morale -= 10)); } },
      ], fallback: 1,
    },
    theft_found: {
      cat: "people", weight: 1.5, cooldown: 10,
      cond: (s) => s.stores.some((st) => st.theft > 0.03),
      make: (s) => { const st = s.stores.find((x) => x.theft > 0.03); const p = st.staff.find((x) => x.role !== "manager") || st.staff[0]; return { storeId: st.id, staffId: p.id }; },
      title: () => "有員工私下反映盤點的事",
      body: (s, d) => { const f = staffById(s, d.staffId); return `${sname(storeById(s, d.storeId))}有同事說，${f ? f.person.name : "某位員工"}常常自己做飲料喝、也給朋友免費。`; },
      options: [
        { label: "調監視器確認後約談", note: "盤點差異歸零；該員工士氣 −20", apply: (s, d) => { const st = storeById(s, d.storeId); if (st) st.theft = 0; const f = staffById(s, d.staffId); if (f) f.person.morale -= 20; } },
        { label: "訂員工飲料規則，不追究", note: "盤點差異減半", apply: (s, d) => { const st = storeById(s, d.storeId); if (st) st.theft /= 2; } },
      ], fallback: 1,
    },
    cold_snap: {
      cat: "opportunity", weight: 2, cooldown: 8,
      cond: (s, c) => c.season === "winter",
      title: () => "寒流來了",
      body: () => "接下來一週氣溫十度以下，冰飲會掉，熱飲會變搶手。",
      options: [
        { label: "推熱飲加價購（NT$5,000）", note: "本週來客 +8%", apply: (s) => { s.cash -= 5000; s.campaigns.push({ key: "__hot", weeksLeft: 1 }); } },
        { label: "照常", note: "", apply: () => {} },
      ], fallback: 1,
    },
    collab: {
      cat: "opportunity", weight: 0.8, cooldown: 26,
      cond: (s) => s.rep >= 58,
      title: () => "動漫 IP 想跟你聯名",
      body: () => "一部熱門動畫的代理商提議推出聯名杯，授權金 NT$200,000。",
      options: [
        { label: "合作", note: "4 週來客 +18%，聲譽 +3", apply: (s) => { s.cash -= 200000; s.campaigns.push({ key: "__collab", weeksLeft: 4 }); s.rep += 3; } },
        { label: "婉拒", note: "", apply: () => {} },
      ], fallback: 1,
    },
    tea_price: {
      cat: "urgent", weight: 1.2, cooldown: 26,
      title: () => "茶葉產區乾旱，茶葉漲價",
      body: () => "高山茶區今年雨量少，茶葉批發價上漲兩成。",
      options: [
        { label: "全品項漲 5 元", note: "聲譽 −2", apply: (s) => { s.menu.forEach((m) => (m.price += 5)); s.rep -= 2; } },
        { label: "吸收", note: "原料成本 +5%", apply: (s) => { s.costMod += 0.05; } },
      ], fallback: 1,
    },
    landlord: {
      cat: "urgent", weight: 1, cooldown: 26,
      cond: (s) => openStores(s).some((st) => s.week - st.openWeek > 40),
      make: (s) => ({ storeId: openStores(s).find((st) => s.week - st.openWeek > 40).id }),
      title: (s, d) => `${sname(storeById(s, d.storeId))}房東要漲租`,
      body: () => "租約快到期，房東說附近行情漲了，要調漲 15%。",
      options: [
        { label: "接受", note: "月租 +15%", apply: (s, d) => { const st = storeById(s, d.storeId); if (st) st.rent = round(st.rent * 1.15); } },
        { label: "談判（花你 2 小時）", note: "五成機會只漲 5%，五成照漲", apply: (s, d) => { s.flags.extraHours = (s.flags.extraHours || 0) + 2; const st = storeById(s, d.storeId); if (st) st.rent = round(st.rent * (chance(s, 0.5) ? 1.05 : 1.15)); } },
      ], fallback: 0,
    },
    chairman_health: {
      cat: "urgent", weight: 6, cooldown: 6,
      cond: (s) => s.stress >= 85,
      title: () => "你在辦公室頭暈",
      body: () => "連續加班好幾週，你今天差點昏倒。醫生要你休息。",
      options: [
        { label: "休假一週", note: "下週只有 20 小時，壓力大降", apply: (s) => { s.stress = 30; s.flags.extraHours = (s.flags.extraHours || 0) + 20; } },
        { label: "撐下去", note: "壓力不降，下次可能更嚴重", apply: (s) => { s.rep -= 1; } },
      ], fallback: 0,
    },
    loan_offer: {
      cat: "urgent", weight: 10, cooldown: 6,
      cond: (s) => s.cash < 150000 && s.loan === 0,
      title: () => "現金快見底了",
      body: () => "會計提醒帳上現金不夠付下個月的薪水與房租。銀行願意給週轉金。",
      options: [
        { label: "借 NT$1,500,000（月息 1.5%）", note: "每週還本息約 NT$16,000，共兩年", apply: (s) => { s.cash += 1500000; s.loan = 1500000; } },
        { label: "先不借", note: "現金變負數連續 4 週就破產", apply: () => {} },
      ], fallback: 1,
    },
    // ---------- 10/23 擴充：展店風險 ----------
    expansion_chaos: {
      cat: "urgent", weight: 8, cooldown: 10,
      cond: (s) => s.stores.length >= 4 && (s.flags.recentOpens || []).filter((w) => s.week - w <= 13).length >= 2,
      title: () => "新店開太快，訓練跟不上",
      body: () => "三個月內開了好幾家店，新店員工多半只受過三天訓練。區經理回報：飲料甜度不一、出錯率變高，老店的好手也被調去支援新店。",
      options: [
        { label: "暫停展店 8 週，辦集中訓練（NT$90,000）", note: "所有員工品質 +4（長期），8 週內不能找新店址", apply: (s) => { s.cash -= 90000; s.flags.qualityBonus = (s.flags.qualityBonus || 0) + 4; s.flags.noScoutUntil = s.week + 8; s.stores.forEach((st) => st.staff.forEach((p) => (p.morale += 5))); } },
        { label: "繼續衝，邊做邊學", note: "各店衛生 −15、聲譽 −4；兩週後可能出包", apply: (s) => { s.stores.forEach((st) => (st.hygiene -= 15)); s.rep -= 4; s.timers.push({ week: s.week + 2, type: "event", id: "wrong_order_viral", data: {} }); } },
      ], fallback: 1,
    },
    wrong_order_viral: {
      cat: "urgent", weight: 0, cooldown: 0,
      title: () => "新人做錯飲料，客人發文被轉傳",
      body: () => "一位對乳製品過敏的客人點了無奶的茶，新人卻加了奶精。客人在臉書發文，已經被分享上千次。",
      options: [
        { label: "公開道歉、負擔醫藥費、全店重新訓練（NT$40,000）", note: "聲譽 −2（止血）", apply: (s) => { s.cash -= 40000; s.rep -= 2; } },
        { label: "私下處理", note: "聲譽 −7，之後可能被媒體追問", apply: (s) => { s.rep -= 7; } },
      ], fallback: 1,
    },
    store_losing: {
      cat: "urgent", weight: 10, cooldown: 4,
      cond: (s) => s.stores.some((st) => (st.lossWeeks || 0) >= 6),
      make: (s) => ({ storeId: s.stores.find((st) => (st.lossWeeks || 0) >= 6).id }),
      title: (s, d) => `${sname(storeById(s, d.storeId))}連續虧損`,
      body: (s, d) => { const st = storeById(s, d.storeId); return `這家店已經連續 ${st ? st.lossWeeks : 6} 週虧錢（上週 ${st && st.lastWeek ? fmtMoney(st.lastWeek.profit) : ""}）。會計問你要怎麼辦。`; },
      options: [
        { label: "關店止血", note: "賠兩個月租金、員工資遣；之後不再虧", apply: (s, d) => closeStore(s, d.storeId) },
        { label: "改裝換菜單（NT$300,000）", note: "基本來客 +12%，再給它一季", apply: (s, d) => { s.cash -= 300000; const st = storeById(s, d.storeId); if (st) { st.base = Math.round(st.base * 1.12); st.lossWeeks = 0; } } },
        { label: "再撐撐看", note: "", apply: (s, d) => { const st = storeById(s, d.storeId); if (st) st.lossWeeks = 2; } },
      ], fallback: 2,
    },
    bank_review: {
      cat: "urgent", weight: 3, cooldown: 26,
      cond: (s) => s.loan > 0 && s.cash < 400000,
      title: () => "銀行要重新審查貸款",
      body: () => "銀行看到你的現金一直很低，要求提前償還部分貸款，或提供個人擔保。",
      options: [
        { label: "提前還 NT$300,000", note: "", apply: (s) => { s.cash -= 300000; s.loan = Math.max(0, s.loan - 300000); } },
        { label: "董事長個人擔保", note: "壓力 +20", apply: (s) => { s.stress += 20; } },
      ], fallback: 1,
    },
    // ---------- 機會 ----------
    tea_expo: {
      cat: "opportunity", weight: 1.2, cooldown: 26,
      title: () => "台北國際茶飲展邀請參展",
      body: () => "茶飲展有很多原料商和加盟主。攤位費和布置要 NT$120,000。",
      options: [
        { label: "參展", note: "聲譽 +4；認識新原料商，原料成本 −3%", apply: (s) => { s.cash -= 120000; s.rep += 4; s.costMod -= 0.03; } },
        { label: "這次先不要", note: "", apply: () => {} },
      ], fallback: 1,
    },
    festival: {
      cat: "opportunity", weight: 2, cooldown: 6,
      make: (s) => ({ storeId: pickStore(s).id }),
      title: (s, d) => `${sname(storeById(s, d.storeId))}附近要辦市集`,
      body: () => "這週末附近有大型市集，主辦單位問要不要擺攤，攤位費 NT$10,000。",
      options: [
        { label: "擺攤", note: "這週營收約 +NT$35,000～60,000，該店員工士氣 −3", apply: (s, d) => { s.cash -= 10000; s.cash += Math.round(between(s, 35000, 60000)); const st = storeById(s, d.storeId); if (st) st.staff.forEach((p) => (p.morale -= 3)); } },
        { label: "不去", note: "", apply: () => {} },
      ], fallback: 1,
    },
    corporate_deal: {
      cat: "opportunity", weight: 1.5, cooldown: 20,
      cond: (s) => openStores(s).some((st) => LOCATIONS[st.key].groupOrders),
      title: () => "科技公司想簽年度下午茶合約",
      body: () => "附近一家科技公司想每週五固定訂 120 杯，價格打九折，簽一年。",
      options: [
        { label: "簽約", note: "一年內每週穩定 +NT$4,000 左右淨利", apply: (s) => { s.flags.corporate = (s.flags.corporate || 0) + 1; s.timers.push({ week: s.week + 52, type: "corporateEnd" }); } },
        { label: "量太大，婉拒", note: "", apply: () => {} },
      ], fallback: 1,
    },
    training_course: {
      cat: "opportunity", weight: 1.2, cooldown: 30,
      title: () => "飲料調製職訓課程",
      body: () => "勞動部補助的飲料調製課程招生，每人自付 NT$3,000，上完品質會比較穩定。",
      options: [
        { label: "全體員工報名", note: "費用依人數；所有員工品質 +3、士氣 +5", apply: (s) => { let n = 0; s.stores.forEach((st) => st.staff.forEach((p) => { n++; p.quality += 3; p.morale += 5; })); s.cash -= n * 3000; } },
        { label: "不用", note: "", apply: () => {} },
      ], fallback: 1,
    },
    pos_upgrade: {
      cat: "opportunity", weight: 1, cooldown: 52,
      cond: (s) => s.stores.length >= 2 && !s.flags.pos,
      title: () => "雲端點餐系統業務來推銷",
      body: () => "新的點餐與叫號系統可以讓尖峰更順，所有門市一次導入 NT$200,000。",
      options: [
        { label: "導入", note: "所有門市產能 +6%（長期）", apply: (s) => { s.cash -= 200000; s.flags.pos = 1; s.flags.capMul = (s.flags.capMul || 1) * 1.06; } },
        { label: "再看看", note: "", apply: () => {} },
      ], fallback: 1,
    },
    central_kitchen: {
      cat: "opportunity", weight: 1.5, cooldown: 52,
      cond: (s) => s.stores.length >= 5 && !s.flags.kitchen,
      title: () => "要不要蓋中央廚房？",
      body: () => "門市多了，珍珠、糖漿、水果處理可以集中在中央廚房做，品質一致、成本也降，但要一次投入 NT$2,000,000。",
      options: [
        { label: "蓋", note: "原料成本 −8%、耗損減少；三個月後才完工", apply: (s) => { s.cash -= 2000000; s.flags.kitchen = 1; s.timers.push({ week: s.week + 13, type: "costMod", value: -0.08 }); addNews(s, "中央廚房動工，預計三個月後完工。"); } },
        { label: "還太早", note: "", apply: () => {} },
      ], fallback: 1,
    },
    award: {
      cat: "opportunity", weight: 1.5, cooldown: 52,
      cond: (s) => s.rep >= 75,
      title: () => "入圍「年度人氣手搖飲」票選",
      body: () => "美食媒體的年度票選把你們列入決選。要不要投廣告衝票？",
      options: [
        { label: "投 NT$80,000 宣傳衝票", note: "七成機會得獎：聲譽 +6、六週來客 +10%", apply: (s) => { s.cash -= 80000; if (chance(s, 0.7)) { s.rep += 6; s.campaigns.push({ key: "__collab", weeksLeft: 3 }); addNews(s, "獲選年度人氣手搖飲！"); } else addNews(s, "年度票選差一點，拿到第二名。"); } },
        { label: "順其自然", note: "三成機會得獎", apply: (s) => { if (chance(s, 0.3)) { s.rep += 6; addNews(s, "沒有宣傳也拿下年度人氣手搖飲！"); } } },
      ], fallback: 1,
    },
    holiday_rush: {
      cat: "opportunity", weight: 6, cooldown: 20,
      cond: (s, c) => c.weekOfYear === 38 || c.weekOfYear === 52,
      title: (s) => (calendar(s.week).weekOfYear === 38 ? "中秋烤肉季" : "跨年夜"),
      body: () => "節日前後外帶大單多，可以推節慶限定組合。",
      options: [
        { label: "推節慶組合、加開人手（NT$25,000）", note: "這週來客 +20%", apply: (s) => { s.cash -= 25000; s.campaigns.push({ key: "__viral", weeksLeft: 1 }); } },
        { label: "照常", note: "", apply: () => {} },
      ], fallback: 1,
    },
    rival_closes: {
      cat: "opportunity", weight: 1, cooldown: 20,
      cond: (s) => s.stores.some((st) => st.rivalNearby > 0),
      make: (s) => ({ storeId: s.stores.find((st) => st.rivalNearby > 0).id }),
      title: (s, d) => `${sname(storeById(s, d.storeId))}附近的對手店收了`,
      body: () => "對面那家撐不下去，宣布結束營業。原本被分走的客人會回來一部分。",
      options: [
        { label: "趁機發傳單（NT$8,000）", note: "對手影響消失、兩週來客 +8%", apply: (s, d) => { s.cash -= 8000; const st = storeById(s, d.storeId); if (st) st.rivalNearby = Math.max(0, st.rivalNearby - 1); s.campaigns.push({ key: "__hot", weeksLeft: 2 }); } },
        { label: "不用特別做什麼", note: "對手影響消失", apply: (s, d) => { const st = storeById(s, d.storeId); if (st) st.rivalNearby = Math.max(0, st.rivalNearby - 1); } },
      ], fallback: 1,
    },
    // ---------- 意外與危機 ----------
    power_outage: {
      cat: "urgent", weight: 1.5, cooldown: 10,
      make: (s) => ({ storeId: pickStore(s).id }),
      title: (s, d) => `${sname(storeById(s, d.storeId))}所在大樓停電`,
      body: () => "台電搶修中，預計停電半天。冰箱裡的鮮奶和水果可能撐不住。",
      options: [
        { label: "租發電機（NT$12,000）", note: "原料保住、照常營業", apply: (s) => { s.cash -= 12000; } },
        { label: "等它來電", note: "報廢原料約 NT$20,000、少半天營業", apply: (s) => { s.cash -= 20000; } },
      ], fallback: 1,
    },
    spill_injury: {
      cat: "urgent", weight: 1, cooldown: 20,
      title: () => "熱飲打翻燙傷客人",
      body: () => "寒流期間熱飲杯蓋沒蓋緊，一位客人被燙傷，家屬要求賠償。",
      options: [
        { label: "全額賠醫藥費並慰問（NT$30,000）", note: "聲譽不受影響", apply: (s) => { s.cash -= 30000; } },
        { label: "依保險流程處理", note: "NT$5,000，家屬上網抱怨，聲譽 −3", apply: (s) => { s.cash -= 5000; s.rep -= 3; } },
      ], fallback: 1,
    },
    rude_video: {
      cat: "urgent", weight: 1.2, cooldown: 16,
      make: (s) => { const x = pickStaff(s, (p) => p.morale < 45); return x ? { storeId: x.st.id, staffId: x.p.id } : null; },
      title: () => "員工態度差的影片在網路瘋傳",
      body: (s, d) => { const f = staffById(s, d.staffId); return `客人拍到${f ? f.person.name : "員工"}對客人大小聲，影片被轉到 Dcard 和 Threads。這位員工最近士氣很低。`; },
      options: [
        { label: "公開道歉、找員工談、調整排班", note: "聲譽 −2；員工士氣 +15，你這週要多花 1 小時", apply: (s, d) => { s.rep -= 2; const f = staffById(s, d.staffId); if (f) f.person.morale += 15; s.flags.extraHours = (s.flags.extraHours || 0) + 1; } },
        { label: "開除了事", note: "聲譽 −1；其他員工士氣 −6", apply: (s, d) => { s.rep -= 1; const f = staffById(s, d.staffId); if (f) { const st = f.store; quitStaff(s, d.staffId, "被開除"); st.staff.forEach((p) => (p.morale -= 6)); s.timers.push({ week: s.week + 6, type: "event", id: "ex_employee_post", data: {} }); } } },
      ], fallback: 1,
    },
    ex_employee_post: {
      cat: "urgent", weight: 0, cooldown: 0,
      title: () => "前員工在網路爆料",
      body: () => "被開除的員工在網路上發文，說公司常常要大家無償加班、珍珠放隔夜。雖然有些是誇大，但留言很多。",
      options: [
        { label: "公開說明並請記者參觀廚房（NT$20,000）", note: "聲譽 −1", apply: (s) => { s.cash -= 20000; s.rep -= 1; } },
        { label: "不回應", note: "聲譽 −5", apply: (s) => { s.rep -= 5; } },
      ], fallback: 1,
    },
    supplier_batch: {
      cat: "urgent", weight: 1.2, cooldown: 26,
      title: () => "原料商通知：一批糖漿可能有問題",
      body: () => "原料商說上週送的黑糖漿有一批檢驗數值異常，建議下架。數量不少。",
      options: [
        { label: "全部下架、主動公告（NT$45,000）", note: "聲譽 +2（負責任的形象）", apply: (s) => { s.cash -= 45000; s.rep += 2; } },
        { label: "只下架還沒開封的", note: "省錢；兩成機會之後被衛生局查到", apply: (s) => { s.cash -= 15000; if (chance(s, 0.2)) s.timers.push({ week: s.week + 3, type: "event", id: "syrup_scandal", data: {} }); } },
      ], fallback: 1,
    },
    syrup_scandal: {
      cat: "urgent", weight: 0, cooldown: 0,
      title: () => "衛生局查到問題糖漿",
      body: () => "衛生局抽驗發現店裡還在用那批糖漿，地方新聞報導了。",
      options: [
        { label: "道歉、退款、停售黑糖系列兩週", note: "NT$80,000、聲譽 −6", apply: (s) => { s.cash -= 80000; s.rep -= 6; } },
        { label: "說是原料商的錯", note: "聲譽 −9", apply: (s) => { s.rep -= 9; } },
      ], fallback: 1,
    },
    register_theft: {
      cat: "people", weight: 1, cooldown: 20,
      make: (s) => ({ storeId: pickStore(s).id }),
      title: (s, d) => `${sname(storeById(s, d.storeId))}收銀機短少現金`,
      body: () => "連續三天打烊結帳都少了一兩千元。監視器剛好拍不到收銀台。",
      options: [
        { label: "裝監視器、改成兩人結帳（NT$15,000）", note: "盤點差異歸零，員工士氣 −3", apply: (s, d) => { s.cash -= 15000; const st = storeById(s, d.storeId); if (st) { st.theft = 0; st.staff.forEach((p) => (p.morale -= 3)); } } },
        { label: "先觀察", note: "每週繼續少一點錢", apply: (s, d) => { const st = storeById(s, d.storeId); if (st) st.theft += 0.01; } },
      ], fallback: 1,
    },
    landlord_sells: {
      cat: "urgent", weight: 0.6, cooldown: 52,
      cond: (s) => s.stores.length >= 2,
      make: (s) => ({ storeId: pickStore(s).id }),
      title: (s, d) => `${sname(storeById(s, d.storeId))}的房東要賣房子`,
      body: () => "房東要賣掉店面，新屋主可能不續租。你可以出價買下來，或是準備搬家。",
      options: [
        { label: "買下店面（NT$3,000,000）", note: "之後不用付這家店的房租", apply: (s, d) => { s.cash -= 3000000; const st = storeById(s, d.storeId); if (st) st.rent = 0; } },
        { label: "跟新屋主談續約", note: "月租 +25%", apply: (s, d) => { const st = storeById(s, d.storeId); if (st) st.rent = Math.round(st.rent * 1.25); } },
      ], fallback: 1,
    },
    // ---------- 員工 ----------
    year_end_party: {
      cat: "people", weight: 8, cooldown: 40,
      cond: (s, c) => c.weekOfYear === 3,
      title: () => "尾牙要怎麼辦？",
      body: () => "員工在問今年尾牙和年終。大家這一年都很辛苦。",
      options: [
        { label: "辦尾牙＋發年終（每人 NT$8,000）", note: "所有員工士氣 +20", apply: (s) => { let n = 0; s.stores.forEach((st) => st.staff.forEach((p) => { n++; p.morale += 20; })); s.cash -= n * 8000 + 30000; } },
        { label: "只聚餐（每人 NT$1,500）", note: "士氣 +6", apply: (s) => { let n = 0; s.stores.forEach((st) => st.staff.forEach((p) => { n++; p.morale += 6; })); s.cash -= n * 1500; } },
        { label: "今年先不辦", note: "士氣 −10", apply: (s) => { s.stores.forEach((st) => st.staff.forEach((p) => (p.morale -= 10))); } },
      ], fallback: 2,
    },
    star_employee: {
      cat: "people", weight: 1.5, cooldown: 12,
      make: (s) => { const x = pickStaff(s, (p) => p.role !== "manager" && p.quality >= 72 && p.morale >= 60 && p.weeks >= 16); return x ? { staffId: x.p.id, storeId: x.st.id } : null; },
      title: (s, d) => { const f = staffById(s, d.staffId); return `${f ? f.person.name : ""}想挑戰當店長`; },
      body: (s, d) => { const f = staffById(s, d.staffId); return f ? `${f.person.name}（${f.person.trait}）表現一直很好，問你之後新店有沒有機會讓她當店長。` : ""; },
      options: [
        { label: "答應，先讓她當副店長", note: "士氣 +15，下一家新店由她當店長（能力較好）", apply: (s, d) => { const f = staffById(s, d.staffId); if (f) { f.person.morale += 15; f.person.skill = Math.max(f.person.skill, 60); f.person.promoted = true; s.flags.nextManager = d.staffId; } } },
        { label: "再磨練一陣子", note: "士氣 −5", apply: (s, d) => { const f = staffById(s, d.staffId); if (f) f.person.morale -= 5; } },
      ], fallback: 1,
    },
    burnout_manager: {
      cat: "people", weight: 2, cooldown: 10,
      make: (s) => { const x = pickStaff(s, (p) => p.role === "manager" && p.morale < 40); return x ? { staffId: x.p.id } : null; },
      title: (s, d) => { const f = staffById(s, d.staffId); return `${f ? f.person.name : "店長"}快撐不住了`; },
      body: (s, d) => { const f = staffById(s, d.staffId); return f ? `${sname(f.store)}的店長${f.person.name}最近常常加班到打烊後兩小時，排班表一直缺人。` : ""; },
      options: [
        { label: "給她放一週假，由區經理代班", note: "士氣回到 70；你這週要多花 2 小時", apply: (s, d) => { const f = staffById(s, d.staffId); if (f) f.person.morale = 70; s.flags.extraHours = (s.flags.extraHours || 0) + 2; } },
        { label: "請她再撐一下，旺季過了再說", note: "四成機會離職", apply: (s, d) => { if (chance(s, 0.4)) quitStaff(s, d.staffId, "說太累了，離職"); } },
      ], fallback: 1,
    },
    site_offers: {
      cat: "opportunity", weight: 0, cooldown: 0,
      title: () => "三個候選店址",
      body: (s, d) => "看了這三個地點，選一個開新店（開幕前要準備兩週）。裝潢設備費一次付清。",
      dynamicOptions: (s, d) => d.offers.map((o) => ({
        label: `${o.district}${LOCATIONS[o.key].name}：月租 ${fmtMoney(o.rent)}，裝潢 ${fmtMoney(o.fitout)}`,
        note: LOCATIONS[o.key].note + `；預估每日來客約 ${round(o.base * 0.9)}～${round(o.base * 1.15)} 杯`,
        apply: (s2) => openNewStore(s2, o),
      })).concat([{ label: "都不要", note: "", apply: () => {} }]),
      fallback: -1,
    },
    hire_pick: {
      cat: "opportunity", weight: 0, cooldown: 0,
      title: () => "面試結果",
      body: (s, d) => `${sname(storeById(s, d.storeId) || s.stores[0])}的應徵者：`,
      dynamicOptions: (s, d) => d.cands.map((p) => ({
        label: `${p.name}（${ROLES[p.role].name}）`,
        note: `速度 ${p.speed}、品質 ${p.quality}、可靠 ${p.reliability}；${p.trait}${p.student ? "；學生" : ""}`,
        apply: (s2) => { const st = storeById(s2, d.storeId); if (st) { st.staff.push(p); addNews(s2, `${p.name}加入${sname(st)}。`); } },
      })).concat([{ label: "都不錄取", note: "", apply: () => {} }]),
      fallback: -1,
    },
  };
  // 劇本二：老闆要退休，問你要不要買下品牌
  EVENTS.owner_retire = {
    cat: "opportunity", weight: 0, cooldown: 0,
    title: (s) => `德哥想把「${s.brand}」交給你`,
    body: (s) => `德哥說他想退休了：「兩家店加品牌，算你 ${fmtMoney(BUYOUT_PRICE)}。你的存款不夠，差額銀行可以貸，我幫你作保。」你現在有 ${fmtMoney(s.career.savings)}。`,
    dynamicOptions: (s) => {
      const loan = Math.max(0, BUYOUT_PRICE - s.career.savings);
      return [
        { label: "買下品牌，當董事長", note: s.career.savings >= BUYOUT_DOWN ? `存款全部投入${loan ? `，向銀行貸 ${fmtMoney(loan)}（每週還本 NT$13,000 加利息）` : ""}；接下來兩年看你的了` : `自備款要 ${fmtMoney(BUYOUT_DOWN)} 以上，銀行才肯貸`, apply: (s) => { if (s.career.savings >= BUYOUT_DOWN) toChairman(s); else s.flags.retireAgain = s.week + 8; } },
        { label: "再當一陣子店長，多存點錢", note: "貸款少一點比較穩；德哥說一個月後再談", apply: (s) => { s.flags.retireAgain = s.week + 4; } },
      ];
    },
    options: [],
    fallback: -1,
  };
  const RANDOM_EVENT_IDS = Object.keys(EVENTS).filter((k) => EVENTS[k].weight > 0);

  // 店長模式的一週：薪水、分紅、生活費進你的存款；老闆看帳調整信任；時機到了老闆要退休
  function managerWeek(s, profit, out) {
    const c = s.career;
    const salary = MANAGER_SALARY / WEEKS_PER_MONTH;
    const bonus = profit > 0 ? profit * 0.12 : 0;
    c.savings += salary + bonus - 6000;
    c.trust = clamp(c.trust + (profit > 0 ? 1.2 : -2.2) + (s.rep >= 60 ? 0.3 : 0), 0, 100);
    if (s.cash < 0) {
      s.cash += 300000;
      c.trust = clamp(c.trust - 8, 0, 100);
      out.push({ kind: "owner", text: "店裡現金不夠付帳，德哥補了 NT$300,000 週轉金，臉色不太好看。" });
    }
    const weeks = s.week - c.managerWeek;
    if (weeks === 8 && s.stores.length === 1) {
      // 德哥開第二家店（老闆出錢），你負責兩家
      const offer = makeLocationOffer(s, pick(s, ["office", "school", "night"]));
      const st = makeStore(s, offer, true);
      s.stores.push(st);
      addNews(s, `德哥在${sname(st)}開了第二家店，也交給你管。`);
    }
    if (weeks >= BUYOUT_WEEKS && c.trust >= 65 && c.savings >= BUYOUT_DOWN && (s.flags.retireAgain || 0) <= s.week && !s.inbox.some((x) => x.id === "owner_retire")) s.inbox.push(eventInstance(s, "owner_retire", {}, true));
  }

  function toChairman(s) {
    const c = s.career;
    const loan = Math.max(0, BUYOUT_PRICE - c.savings);
    const left = Math.max(0, c.savings - BUYOUT_PRICE);
    s.mode = "chairman";
    s.loan += loan;
    s.cash = 1500000 + left; // 德哥把兩家店的週轉金留給你
    c.savings = 0;
    c.chairmanWeek = s.week;
    s.profitTotal = 0;
    s.history = [];
    s.totalWeeks = s.week + 104;
    s.stress = 20;
    // 一路練起來的能力，變成董事長的優勢
    const sk = c.skills;
    s.flags.qualityBonus = (s.flags.qualityBonus || 0) + Math.max(0, (sk.brew - 50) / 6);
    s.flags.moraleBonus = Math.max(0, (sk.lead - 20) / 120);
    s.flags.forecastBonus = Math.max(0, (sk.ops - 35) / 600);
    s.rep = clamp(s.rep + c.fame / 15, 0, 100);
    // 你不再是店長：從店員裡升一位
    for (const st of s.stores) {
      const me = st.staff.find((p) => p.isPlayer);
      if (!me) continue;
      st.staff = st.staff.filter((p) => !p.isPlayer);
      const up = st.staff.find((p) => p.role === "full") || st.staff[0];
      if (up) { up.role = "manager"; up.skill = Math.max(up.skill, 45); addNews(s, `${up.name}接下${sname(st)}店長。`); }
      else st.staff.push(makeStaff(s, "manager"));
    }
    s.inbox = s.inbox.filter((x) => x.id !== "owner_retire");
    addNews(s, `${c.name}買下「${s.brand}」，成為董事長。${loan ? `銀行貸款 ${fmtMoney(loan)}。` : ""}`);
  }

  function eventInstance(s, id, data, fresh) {
    return { uid: "e" + s.nextId++, id, data: data || {}, week: s.week, fresh: !!fresh };
  }
  function eventView(s, inst) {
    const ev = EVENTS[inst.id];
    const options = ev.dynamicOptions ? ev.dynamicOptions(s, inst.data) : ev.options;
    return {
      uid: inst.uid,
      id: inst.id,
      cat: ev.cat,
      title: ev.title(s, inst.data),
      body: ev.body(s, inst.data),
      options: options.map((o) => ({ label: o.label, note: (o.note || "").replace("{cash}", inst.data.cups ? round(inst.data.cups * 52 * 0.55).toLocaleString("en-US") : "") })),
      fallback: ev.fallback,
    };
  }
  function resolveEvent(s, uid, optionIndex) {
    const i = s.inbox.findIndex((x) => x.uid === uid);
    if (i < 0) return;
    const inst = s.inbox[i];
    const ev = EVENTS[inst.id];
    const options = ev.dynamicOptions ? ev.dynamicOptions(s, inst.data) : ev.options;
    const opt = options[optionIndex];
    s.inbox.splice(i, 1);
    if (opt) opt.apply(s, inst.data);
    normalize(s);
  }

  function quitStaff(s, staffId, why) {
    const f = staffById(s, staffId);
    if (!f || f.person.isPlayer) return;
    f.store.staff = f.store.staff.filter((p) => p.id !== staffId);
    addNews(s, `${f.person.name}（${sname(f.store)}${ROLES[f.person.role].name}）${why}。`);
    if (f.person.role === "manager") {
      const promote = f.store.staff.find((p) => p.role === "full");
      if (promote) {
        promote.role = "manager";
        promote.skill = Math.max(promote.skill, 35);
        addNews(s, `${promote.name}暫代${sname(f.store)}店長。`);
      }
    }
  }
  function inspectionResult(s, storeId, bonus) {
    const st = storeById(s, storeId);
    if (!st) return;
    st.hygiene = clamp(st.hygiene + bonus, 0, 100);
    if (st.hygiene < 60) {
      s.cash -= 60000;
      s.rep -= 6;
      addNews(s, `${sname(st)}衛生稽查不合格，罰款 NT$60,000，上了地方新聞。`);
    } else {
      s.rep += 1;
      addNews(s, `${sname(st)}衛生稽查合格。`);
    }
  }
  function openNewStore(s, offer) {
    if (s.cash < offer.fitout) {
      addNews(s, "現金不夠付裝潢費，展店暫緩。");
      return;
    }
    // 裝潢＋兩個月押金＋開店前的招募與訓練
    const deposit = offer.rent * 2;
    const training = 120000;
    s.cash -= offer.fitout + deposit + training;
    const st = makeStore(s, offer, true);
    st.deposit = deposit;
    // 答應過要升店長的員工，調到新店當店長
    const promised = s.flags.nextManager && staffById(s, s.flags.nextManager);
    if (promised) {
      promised.store.staff = promised.store.staff.filter((p) => p.id !== promised.person.id);
      promised.person.role = "manager";
      st.staff = st.staff.filter((p) => p.role !== "manager");
      st.staff.unshift(promised.person);
      s.flags.nextManager = null;
      addNews(s, `${promised.person.name}升任新店店長。`);
    }
    s.stores.push(st);
    s.flags.recentOpens = (s.flags.recentOpens || []).concat([s.week]);
    addNews(s, `新店${sname(st)}開始裝潢（含押金與招募訓練共 ${fmtMoney(offer.fitout + deposit + training)}），兩週後開幕。`);
  }

  function closeStore(s, storeId) {
    const st = storeById(s, storeId);
    if (!st) return;
    const penalty = st.rent * 2;
    s.cash -= penalty;
    s.stores = s.stores.filter((x) => x.id !== storeId);
    dropStaleEvents(s);
    addNews(s, `${sname(st)}結束營業，提前解約賠了 ${fmtMoney(penalty)}，員工資遣。`);
  }

  function normalize(s) {
    s.rep = clamp(s.rep, 0, 100);
    s.stress = clamp(s.stress, 0, 100);
    s.costMod = clamp(s.costMod, -0.25, 0.6);
    s.menu.forEach((m) => (m.price = clamp(m.price, 20, 160)));
    s.stores.forEach((st) => st.staff.forEach((p) => (p.morale = clamp(p.morale, 0, 100))));
  }

  function rollEvents(s, cal) {
    const count = intBetween(s, 1, 3);
    for (let n = 0; n < count; n++) {
      const pool = RANDOM_EVENT_IDS.filter((id) => {
        const ev = EVENTS[id];
        if ((s.cooldown[id] || -999) + ev.cooldown > s.week) return false;
        if (s.inbox.some((x) => x.id === id)) return false;
        if (s.mode === "manager" && OWNER_EVENTS.includes(id)) return false;
        return !ev.cond || ev.cond(s, cal);
      });
      if (!pool.length) return;
      const total = pool.reduce((a, id) => a + EVENTS[id].weight, 0);
      let r = rand(s) * total;
      let chosen = pool[0];
      for (const id of pool) {
        r -= EVENTS[id].weight;
        if (r <= 0) { chosen = id; break; }
      }
      const ev = EVENTS[chosen];
      let data = {};
      try {
        data = ev.make ? ev.make(s) : {};
      } catch (e) {
        data = null; // 例如沒有營業中的門市可挑
      }
      if (ev.make && !data) continue;
      s.cooldown[chosen] = s.week;
      s.inbox.push(eventInstance(s, chosen, data, true));
    }
  }

  function rivalsAct(s) {
    if (s.week % 4 !== 3) return;
    for (const r of s.rivals) {
      r.stores += chance(s, 0.5) ? 1 : 0;
      r.rep = clamp(r.rep + between(s, -2, 2), 30, 90);
      if (chance(s, r.aggression * 0.35) && openStores(s).length) {
        const st = pickStore(s);
        if (st.rivalNearby < 2) {
          st.rivalNearby += 1;
          s.inbox.push(eventInstance(s, "rival_open", { storeId: st.id, rival: r.name }, true));
        }
      } else if (s.mode === "manager") {
        continue;
      } else if (r.id === "chatang" && chance(s, 0.12) && s.priceWar === 0) {
        s.inbox.push(eventInstance(s, "price_war", {}, true));
      } else if (r.id === "sweetie" && chance(s, 0.12) && s.menu.length > 6) {
        s.inbox.push(eventInstance(s, "copycat", {}, true));
      }
    }
  }

  function runTimers(s) {
    const due = s.timers.filter((t) => t.week <= s.week);
    s.timers = s.timers.filter((t) => t.week > s.week);
    for (const t of due) {
      if (t.type === "costMod") s.costMod += t.value;
      else if (t.type === "cash") { s.cash += t.value; if (t.text) addNews(s, t.text + `（${fmtMoney(t.value)}）`); }
      else if (t.type === "priceBack") s.menu.forEach((m) => (m.price += t.value));
      else if (t.type === "event") s.inbox.push(eventInstance(s, t.id, t.data || {}, true));
      else if (t.type === "corporateEnd") s.flags.corporate = Math.max(0, (s.flags.corporate || 0) - 1);
      else if (t.type === "capMul") s.flags.capMul = (s.flags.capMul || 1) * t.value;
      else if (t.type === "promiseCheck") { const f = staffById(s, t.staffId); if (f && f.person.role !== "manager" && !f.person.promoted) quitStaff(s, t.staffId, "說你沒兌現升遷承諾，離開了"); }
    }
  }

  // ---------- 結束一週 ----------
  function endWeek(s) {
    if (s.over) return null;
    const cal = calendar(s.week);
    const out = [];
    const startCash = s.cash;
    // 沒處理的急件與過期機會：急件套用預設選項
    const pending = s.inbox.slice();
    for (const inst of pending) {
      const ev = EVENTS[inst.id];
      if (ev.cat === "urgent" && ev.fallback >= 0) {
        const view = eventView(s, inst);
        out.push({ kind: "auto", text: `沒有處理「${view.title}」，照「${view.options[ev.fallback].label}」辦理。` });
        resolveEvent(s, inst.uid, ev.fallback);
      } else if (inst.week < s.week || ev.cat !== "people") {
        s.inbox = s.inbox.filter((x) => x.uid !== inst.uid);
      }
    }
    runActions(s, out);
    const used = hoursUsed(s) + (s.flags.extraHours || 0);
    s.flags.extraHours = 0;
    s.stress = clamp(s.stress + (used > BASE_HOURS ? (used - BASE_HOURS) * 1.2 : -6), 0, 100);

    const weather = Array.from({ length: 7 }, () => weatherFor(s, cal.season));
    let revenue = 0, profit = 0, repDelta = 0;
    for (const st of openStores(s)) {
      const boost = st.tempBoost && st.tempBoost >= s.week;
      if (boost) st.staff.push({ id: "tmp", name: "臨時", role: "full", speed: 24, quality: 55, reliability: 60, skill: 0, morale: 70, moraleDrift: 0, repBonus: 0, weeks: 0 });
      st._qualityBonus = s.flags.qualityBonus || 0;
      const r = simulateStore(s, st, cal, weather);
      if (boost) st.staff = st.staff.filter((p) => p.id !== "tmp");
      // 開幕 8 週後還連續虧損，週數累計（觸發「要不要關店」）
      st.lossWeeks = r.profit < 0 && s.week - st.openWeek > 8 ? (st.lossWeeks || 0) + 1 : 0;
      revenue += r.revenue;
      profit += r.profit;
      repDelta += r.repDelta;
    }
    const n = Math.max(1, openStores(s).length);
    s.rep = clamp(s.rep + repDelta / n, 0, 100);
    // 加薪、工資調整
    const wageMul = s.flags.wageMul || 1;
    let raises = 0;
    s.stores.forEach((st) => st.staff.forEach((p) => (raises += (p.raise || 0) / WEEKS_PER_MONTH)));
    const wageAdj = openStores(s).reduce((a, st) => a + (st.lastWeek ? st.lastWeek.wages : 0), 0) * (wageMul - 1);
    profit -= raises + wageAdj;
    // 加盟權利金、貸款、總部固定費
    const royalties = (s.flags.franchises || 0) * 9000 + (s.flags.corporate || 0) * 4000;
    const hq = s.mode === "manager" ? 0 : 12000 + 6000 * s.stores.length;
    let loanPay = 0;
    if (s.loan > 0) {
      loanPay = Math.min(s.loan, 13000) + s.loan * 0.015 / WEEKS_PER_MONTH;
      s.loan = Math.max(0, s.loan - 13000);
    }
    profit += royalties - hq - loanPay;
    // 裝潢中的店也要付房租
    s.stores.filter((st) => st.openWeek > s.week).forEach((st) => (profit -= st.rent / WEEKS_PER_MONTH));
    s.cash += profit;
    s.profitTotal += profit;
    if (s.mode === "manager") managerWeek(s, profit, out);

    // 活動倒數
    s.campaigns.forEach((c) => c.weeksLeft--);
    s.campaigns = s.campaigns.filter((c) => c.weeksLeft > 0);
    if (s.buzz > 0) s.buzz--;
    if (s.priceWar > 0) s.priceWar--;
    if (s.foodScare > 0) s.foodScare--;

    const report = {
      week: s.week,
      cal,
      weather,
      revenue: round(revenue),
      profit: round(profit),
      cashStart: round(startCash),
      cash: round(s.cash),
      rep: round(s.rep),
      stores: openStores(s).map((st) => ({ id: st.id, name: sname(st), ...st.lastWeek })),
      lines: out,
      quarterly: null,
    };
    s.history.push({ week: s.week, revenue: report.revenue, profit: report.profit, cash: report.cash, rep: report.rep, stores: openStores(s).length });

    // 季報
    if ((s.week + 1) % 13 === 0) {
      const last = s.history.slice(-13);
      const prev = s.history.slice(-26, -13);
      const sum = (a, k) => a.reduce((x, y) => x + y[k], 0);
      const growth = prev.length ? (sum(last, "revenue") - sum(prev, "revenue")) / Math.max(1, sum(prev, "revenue")) : null;
      report.quarterly = {
        revenue: sum(last, "revenue"),
        profit: sum(last, "profit"),
        growth,
        stores: s.stores.length,
        rivals: s.rivals.map((r) => ({ name: r.name, stores: r.stores, rep: round(r.rep) })),
        verdict: growth === null ? "第一季，站穩腳步最重要。" : growth > 0.15 ? "營收大幅成長，媒體開始注意你的品牌。" : growth > 0 ? "穩定成長。" : "營收下滑，股東和員工都在看你怎麼調整。",
      };
    }

    // 破產與結局
    if (s.cash < 0) s.debtWeeks++;
    else s.debtWeeks = 0;
    s.week++;
    if (s.mode === "manager" && s.career.trust < 10) s.over = { grade: "D", title: "被換掉的店長", text: `德哥找了新店長。${s.career.name}帶著 ${fmtMoney(s.career.savings)} 的存款離開「${s.brand}」。` };
    else if (s.mode === "manager" && s.week - s.career.managerWeek >= 104) s.over = { grade: "B", title: "一輩子的好店長", text: `德哥把品牌賣給了別人，新老闆留你繼續當店長。存款 ${fmtMoney(s.career.savings)}。` };
    else if (s.debtWeeks >= 4) s.over = ending(s, true);
    else if (s.stores.length === 0) s.over = { grade: "D", title: "全部收店", text: `「${s.brand}」的門市全部結束營業，累積淨利 ${fmtMoney(s.profitTotal)}。` };
    else if (s.week >= totalWeeks(s)) s.over = ending(s, false);

    if (!s.over) {
      runTimers(s);
      rivalsAct(s);
      rollEvents(s, calendar(s.week));
      buildInbox(s);
    }
    s.lastPlan = s.plan.slice();
    s.plan = [];
    normalize(s);
    s.lastReport = report;
    return report;
  }

  function buildInbox(s) {
    // 員工主動找你（士氣低、想加薪）由事件產生；這裡補上固定提醒
    s.inbox.forEach((x) => (x.fresh = x.week === s.week));
  }

  function ending(s, bankrupt) {
    if (bankrupt) return { grade: "D", title: "週轉不靈", text: `現金連續四週是負數，「${s.brand}」在第 ${calendar(s.week).year} 年結束營業。` };
    const stores = s.stores.length;
    const score = stores * 5 + s.profitTotal / 1000000 * 2.5 + s.rep / 2 + (s.flags.franchises || 0) * 3;
    let grade = "C", title = "地方小店", text = "";
    if (score >= 130) { grade = "S"; title = "全台人氣品牌"; }
    else if (score >= 90) { grade = "A"; title = "區域連鎖"; }
    else if (score >= 60) { grade = "B"; title = "穩健成長的小連鎖"; }
    else if (score < 35) { grade = "D"; title = "勉強撐過三年"; }
    if (s.career) {
      text = `從外送小弟做起的${s.career.name}，當了兩年董事長：「${s.brand}」有 ${stores} 家直營店${s.flags.franchises ? `、${s.flags.franchises} 家加盟店` : ""}，累積淨利 ${fmtMoney(s.profitTotal)}，聲譽 ${round(s.rep)}。`;
      return { grade, title, text, score: round(score) };
    }
    text = `三年過去，「${s.brand}」有 ${stores} 家直營店${s.flags.franchises ? `、${s.flags.franchises} 家加盟店` : ""}，累積淨利 ${fmtMoney(s.profitTotal)}，聲譽 ${round(s.rep)}。`;
    if (s.flags.investor && stores < 15) text += "創投的 15 家目標沒有達成，董事會要求重新規劃。";
    return { grade, title, text, score: round(score) };
  }

  // ---------- 給畫面用 ----------
  function view(s) {
    const cal = calendar(s.week);
    dropStaleEvents(s);
    const inbox = s.inbox.map((inst) => eventView(s, inst));
    return {
      cal,
      hoursUsed: hoursUsed(s),
      hoursBase: BASE_HOURS,
      hoursMax: MAX_HOURS,
      urgent: inbox.filter((x) => x.cat === "urgent"),
      opportunity: inbox.filter((x) => x.cat === "opportunity"),
      people: inbox.filter((x) => x.cat === "people"),
    };
  }

  // ---------- 自動玩家（平衡用） ----------
  function autoPlay(s, style) {
    // 先處理收件匣
    for (const inst of s.inbox.slice()) {
      const ev = EVENTS[inst.id];
      if (style === "idle") continue;
      if (inst.id === "site_offers") {
        const opts = inst.data.offers;
        const best = opts.map((o, i) => ({ i, v: o.base * 60 * 0.4 * 30 - o.rent })).sort((a, b) => b.v - a.v)[0];
        const reserve = style === "aggressive" ? 250000 : 1500000;
        resolveEvent(s, inst.uid, s.cash - opts[best.i].fitout > reserve ? best.i : opts.length);
      } else if (inst.id === "hire_pick") {
        const c = inst.data.cands.map((p, i) => ({ i, v: p.speed + p.quality / 3 + p.reliability / 4 })).sort((a, b) => b.v - a.v)[0];
        resolveEvent(s, inst.uid, c.i);
      } else {
        const opts = ev.dynamicOptions ? ev.dynamicOptions(s, inst.data) : ev.options;
        let choice = 0;
        if (inst.id === "loan_offer") choice = 0;
        else if (style === "aggressive" && inst.id === "expansion_chaos") choice = 1;
        else if (style === "aggressive" && inst.id === "store_losing") choice = 2;
        else if (["central_kitchen", "landlord_sells", "award"].includes(inst.id) && s.cash < 3500000) choice = opts.length - 1;
        else if (style === "reasonable" && ["fruit_glut", "mall_counter", "investor", "collab"].includes(inst.id) && s.cash < 1500000) choice = opts.length - 1;
        resolveEvent(s, inst.uid, choice);
      }
    }
    if (style === "idle") return;
    const stores = openStores(s);
    const tryPlan = (a, t) => planAction(s, a, t);
    tryPlan("forecast");
    stores.forEach((st) => { if (st.lastWeek && st.lastWeek.lost > st.lastWeek.served * 0.1 && st.staff.length < 7) tryPlan("hire", st.id); });
    stores.forEach((st) => { if (st.staff.length < 4) tryPlan("hire", st.id); });
    const lows = [];
    stores.forEach((st) => st.staff.forEach((p) => p.morale < 55 && lows.push(p)));
    lows.sort((a, b) => a.morale - b.morale).slice(0, 4).forEach((p) => tryPlan("talk", p.id));
    stores.forEach((st, i) => { if ((s.week + i) % 3 === 0) tryPlan("inspect", st.id); });
    if (s.week % 13 === 1) tryPlan("supplier");
    if (s.week % 9 === 4) tryPlan("audit");
    if (s.stores.some((x) => x.reviewsBad > 0)) tryPlan("complaint");
    if (s.menu.length < 10) tryPlan("research");
    const cashGate = style === "aggressive" ? 1900000 : 3800000;
    if (s.cash > cashGate && s.stores.length < (style === "aggressive" ? 30 : 12) && s.stores.every((x) => x.openWeek <= s.week)) tryPlan("scout");
    if (style === "aggressive" && s.campaigns.length === 0 && s.cash > 300000) tryPlan("marketing", "influencer");
    if (style === "reasonable" && s.campaigns.length === 0 && calendar(s.week).season === "winter") tryPlan("marketing", "stamp");
    if (s.mode === "manager") { tryPlan("meeting"); tryPlan("learn"); }
    if (s.stress > 60) tryPlan("rest");
    if (hoursUsed(s) > 52) s.plan.pop();
  }

  const api = {
    LOCATIONS, PRODUCTS, ACTIONS, CAMPAIGNS, ROLES, TOTAL_WEEKS, BASE_HOURS, MAX_HOURS,
    calendar, offersForStart, newGame, view, planAction, unplan, canPlan, resolveEvent, endWeek,
    hoursUsed, storeById, staffById, sname, fmtMoney, autoPlay, normalize, actionVisible, productName, totalWeeks, BUYOUT_PRICE, BUYOUT_DOWN, BUYOUT_WEEKS, repeatLast,
  };
  root.TeaSim = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
