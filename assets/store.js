/* 随手记账 —— 数据层（localStorage 持久化，支持账本/货币/汇率/优惠/预算/分账） */
(function (global) {
  'use strict';

  const KEY = 'ledger_data_v1';

  const CATS_EXPENSE = [
    { key: 'food', name: '餐饮', emoji: '🍜' },
    { key: 'transport', name: '交通', emoji: '🚌' },
    { key: 'shopping', name: '购物', emoji: '🛍️' },
    { key: 'home', name: '居住', emoji: '🏠' },
    { key: 'fun', name: '娱乐', emoji: '🎮' },
    { key: 'medical', name: '医疗', emoji: '💊' },
    { key: 'study', name: '学习', emoji: '📚' },
    { key: 'phone', name: '通讯', emoji: '📱' },
    { key: 'travel', name: '旅行', emoji: '✈️' },
    { key: 'pet', name: '宠物', emoji: '🐾' },
    { key: 'gift', name: '人情', emoji: '🎁' },
    { key: 'other_exp', name: '其他', emoji: '📦' }
  ];
  const CATS_INCOME = [
    { key: 'salary', name: '工资', emoji: '💰' },
    { key: 'bonus', name: '奖金', emoji: '🎉' },
    { key: 'invest', name: '理财', emoji: '📈' },
    { key: 'parttime', name: '兼职', emoji: '💼' },
    { key: 'redbag', name: '红包', emoji: '🧧' },
    { key: 'other_inc', name: '其他', emoji: '➕' }
  ];

  const ACCOUNTS = ['现金', '微信', '支付宝', '银行卡', '其他'];

  const CURRENCIES = [
    { code: 'CNY', sym: '¥', name: '人民币' },
    { code: 'USD', sym: '$', name: '美元' },
    { code: 'EUR', sym: '€', name: '欧元' },
    { code: 'HKD', sym: 'HK$', name: '港币' },
    { code: 'MOP', sym: 'MOP$', name: '澳门元' },
    { code: 'TWD', sym: 'NT$', name: '新台币' },
    { code: 'JPY', sym: '¥', name: '日元' },
    { code: 'KRW', sym: '₩', name: '韩元' },
    { code: 'GBP', sym: '£', name: '英镑' },
    { code: 'THB', sym: '฿', name: '泰铢' },
    { code: 'SGD', sym: 'S$', name: '新加坡元' },
    { code: 'AUD', sym: 'A$', name: '澳元' },
    { code: 'CAD', sym: 'C$', name: '加元' }
  ];

  const LEDGER_ICONS = ['🏠', '✈️', '🍽️', '🛒', '💡', '🎉', '🚗', '👨‍👩‍👧', '🏢', '💰', '📚', '⭐'];
  const LEDGER_COLORS = ['#34c759', '#007aff', '#ff9500', '#ff3b30', '#af52de', '#00c7be', '#ff2d55', '#5856d6'];

  // 自定义类别可选图标
  const CAT_EMOJIS = ['🍜', '🚌', '🛍️', '🏠', '🎮', '💊', '📚', '📱', '✈️', '🐾', '🎁', '📦',
    '💰', '🎉', '📈', '💼', '🧧', '➕', '☕', '🍺', '⛽', '🎫', '🏥', '💡', '👕', '🍎', '💄', '🚕'];
  // 付款方式可选图标
  const ACCOUNT_ICONS = ['💳', '💰', '🏦', '📱', '🤑', '🪙', '💵', '🟢', '🔵', '🟡', '⚪', '🟣'];

  function currencyMeta(code) {
    return CURRENCIES.find((c) => c.code === code) || { code: code || 'CNY', sym: '¥', name: code || 'CNY' };
  }

  // 类别（可自定义增删）读取自 data.categories
  function getCategories(type) {
    const data = load();
    const k = type === 'income' ? 'income' : 'expense';
    return (data.categories && data.categories[k] ? data.categories[k] : []).slice();
  }
  function catMeta(type, key) {
    const list = getCategories(type);
    return list.find((c) => c.key === key) || { name: '其他', emoji: '❓', key };
  }
  function addCategory(type, cat) {
    const data = load();
    const k = type === 'income' ? 'income' : 'expense';
    if (!data.categories) data.categories = { expense: [], income: [] };
    const key = 'c_' + uid();
    data.categories[k].push({ key, name: cat.name || '自定义', emoji: cat.emoji || '⭐' });
    save(data);
    return key;
  }
  function updateCategory(type, key, patch) {
    const data = load();
    const k = type === 'income' ? 'income' : 'expense';
    const i = data.categories[k].findIndex((c) => c.key === key);
    if (i >= 0) { data.categories[k][i] = Object.assign({}, data.categories[k][i], patch); save(data); }
  }
  function deleteCategory(type, key) {
    const data = load();
    const k = type === 'income' ? 'income' : 'expense';
    data.categories[k] = data.categories[k].filter((c) => c.key !== key);
    save(data);
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function nowDate() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  // 当前时间 HH:MM（精确到分钟）。date 仍只存到日，时间单独放 time 字段，
  // 这样所有按「日 / 月 / 日期区间」的比较与 slice(0,7) 逻辑都不用改。
  function nowTime() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  /** 把各种写法的时间规整成 HH:MM；无效则返回 '' */
  function normTime(v) {
    if (v == null || v === '') return '';
    const m = String(v).trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return '';
    const h = Number(m[1]), mi = Number(m[2]);
    if (h < 0 || h > 23 || mi < 0 || mi > 59) return '';
    return String(h).padStart(2, '0') + ':' + String(mi).padStart(2, '0');
  }

  /** 从毫秒时间戳还原 HH:MM（用于给历史数据补 time） */
  function timeFromTs(ts) {
    const d = new Date(Number(ts));
    if (isNaN(d.getTime())) return '';
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  /** 记录的时间；历史数据没有 time 时返回 '' */
  function txTime(x) {
    if (!x || typeof x.time !== 'string') return '';
    return normTime(x.time);
  }

  /** 明细排序键：日期 + 时间（未填时间的排在当天最早，即 00:00） */
  function txSortKey(x) {
    return (x.date || '') + ' ' + (txTime(x) || '00:00');
  }

  /** 展示用：date + time（无时间则只返回日期） */
  function txDateTime(x) {
    const t = txTime(x);
    return t ? `${x.date || ''} ${t}` : (x.date || '');
  }

  function round2(n) { return Math.round(Number(n) * 100) / 100; }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return {
        transactions: [], splits: [], ledgers: [], clears: [], accounts: [],
        categories: { expense: CATS_EXPENSE.map((c) => ({ key: c.key, name: c.name, emoji: c.emoji })), income: CATS_INCOME.map((c) => ({ key: c.key, name: c.name, emoji: c.emoji })) },
        settings: {}
      };
      const data = JSON.parse(raw);
      data.transactions = data.transactions || [];
      data.splits = data.splits || [];
      data.ledgers = data.ledgers || [];
      data.clears = data.clears || [];
      data.accounts = data.accounts || [];
      data.categories = data.categories || { expense: CATS_EXPENSE.map((c) => ({ key: c.key, name: c.name, emoji: c.emoji })), income: CATS_INCOME.map((c) => ({ key: c.key, name: c.name, emoji: c.emoji })) };
      data.settings = data.settings || {};
      return data;
    } catch (e) {
      return {
        transactions: [], splits: [], ledgers: [], clears: [], accounts: [],
        categories: { expense: CATS_EXPENSE.map((c) => ({ key: c.key, name: c.name, emoji: c.emoji })), income: CATS_INCOME.map((c) => ({ key: c.key, name: c.name, emoji: c.emoji })) },
        settings: {}
      };
    }
  }

  // 同步状态（供 UI 展示）：status ∈ local|syncing|synced|error
  let _syncState = { status: 'local', message: '仅本地存储', lastSync: null };
  const _syncListeners = [];
  function _notifySync(status, message) {
    _syncState = Object.assign({}, _syncState, { status: status });
    if (message) _syncState.message = message;
    if (status === 'synced') _syncState.lastSync = Date.now();
    _syncListeners.forEach(function (fn) { try { fn(_syncState); } catch (e) {} });
  }

  let _syncTimer = null;
  let _syncing = false;
  function _hub() {
    return (typeof window !== 'undefined' && window.SyncHub) ? window.SyncHub : null;
  }
  // 墓碑（已删除）记录：跨设备同步靠它传播删除，但不参与任何统计/余额计算
  function isDeleted(x) { return !!(x && x.deleted); }
  // 账本/账户/交易/分账的「有效」集合（过滤墓碑），统一入口
  function alive(arr) { return (arr || []).filter((x) => !isDeleted(x)); }
  // 只落盘、不触发同步（供内部同步流程使用，避免递归）
  function _persist(data) { localStorage.setItem(KEY, JSON.stringify(data)); }
  // 上传云端时剔除墓碑记录：本地已删的项无需再同步到其他设备
  // （墓碑在本地保留用于覆盖云端旧副本；每次上传的体积也因此不膨胀）
  function _stripDeleted(data) {
    return Object.assign({}, data, {
      transactions: alive(data.transactions),
      splits: alive(data.splits),
      ledgers: alive(data.ledgers),
      accounts: alive(data.accounts),
      clears: alive(data.clears)
    });
  }
  function save(data) {
    _persist(data);
    if (!_syncing) _scheduleSync();
  }
  // 完整同步：先拉云端并与本地合并，再把合并结果上传。
  // 关键：不是「盲推本地副本」，否则一台陈旧设备会把另一台设备新增的记录冲掉。
  async function _fullSync() {
    const h = _hub();
    if (!h || !h.isSignedIn || !h.isSignedIn()) return { error: '未登录云端' };
    if (_syncing) return { ok: true, skipped: true };
    _syncing = true;
    _notifySync('syncing', '同步中…');
    try {
      const res = await h.pull();
      if (res.error) { _notifySync('error', res.error); return res; }
      let toPush;
      if (res.data) {
        const merged = h.mergeData(load(), res.data);
        _persist(merged);                 // 合并结果先落本地
        toPush = merged;
      } else {
        toPush = load();                  // 云端为空 → 以本地作为初始数据
      }
      const r = await h.push(_stripDeleted(toPush));
      if (r.error) { _notifySync('error', r.error); return r; }
      h.markSynced(r.updated_at);
      _notifySync('synced');
      return { ok: true, updated_at: r.updated_at };
    } finally { _syncing = false; }
  }
  // 改动后防抖触发「拉取合并 + 上传」（未配置/未登录则跳过，纯本地不受影响）
  function _scheduleSync() {
    const h = _hub();
    if (!h || !h.isSignedIn || !h.isSignedIn()) return;
    if (_syncTimer) clearTimeout(_syncTimer);
    _syncTimer = setTimeout(function () {
      _syncTimer = null;
      const h2 = _hub();
      if (!h2 || !h2.isSignedIn || !h2.isSignedIn()) return;
      _fullSync();
    }, 700);
  }

  function onSync(cb) { if (cb) _syncListeners.push(cb); }
  function getSyncState() { return Object.assign({}, _syncState); }
  // 手动「立即同步」= 拉取合并 + 上传
  async function syncNow() { return _fullSync(); }
  // 仅「拉取合并」到本地（启动时用；不主动上传，避免把本机默认数据推上去）
  async function pullAndMerge() {
    const h = _hub();
    if (!h || !h.isSignedIn || !h.isSignedIn()) return { error: '未登录云端' };
    if (_syncing) return { ok: true, skipped: true };
    _syncing = true;
    _notifySync('syncing', '同步中…');
    try {
      const res = await h.pull();
      if (res.error) { _notifySync('error', res.error); return res; }
      if (!res.data) {
        // 云端尚无数据 → 上传本地作为初始数据
        const r = await h.push(_stripDeleted(load()));
        if (r.error) { _notifySync('error', r.error); return r; }
        h.markSynced(r.updated_at); _notifySync('synced');
        return { ok: true, updated_at: r.updated_at };
      }
      const merged = h.mergeData(load(), res.data);
      _persist(merged);
      h.markSynced(res.updated_at);
      _notifySync('synced');
      return { ok: true, updated_at: res.updated_at };
    } finally { _syncing = false; }
  }

  // 首次运行播种一个默认「日常」账本
  function ensureSeed() {
    const data = load();
    if (!data.ledgers.length) {
      const led = {
        id: 'ledger_default', name: '日常', icon: '🏠', color: '#34c759',
        isDefault: true, startDate: null, endDate: null,
        currency: 'CNY', baseCurrency: 'CNY', budget: null, companions: []
      };
      data.ledgers.push(led);
      seedDefaultAccounts(data);
      data.settings = data.settings || {};
      data.settings.accountsSeeded = true;
      save(data);
    }
    return data;
  }

  // 一次性迁移：旧分账补 ledgerId、旧账本补 companions、保证有 clears 字段、类别/付款方式播种
  function normalize() {
    const data = load();
    const def = defaultLedger();
    if (!def) return;
    let changed = false;
    if (!Array.isArray(data.clears)) { data.clears = []; changed = true; }
    if (!data.categories || !data.categories.expense || !data.categories.income) {
      data.categories = {
        expense: CATS_EXPENSE.map((c) => ({ key: c.key, name: c.name, emoji: c.emoji })),
        income: CATS_INCOME.map((c) => ({ key: c.key, name: c.name, emoji: c.emoji }))
      };
      changed = true;
    }
    data.settings = data.settings || {};
    if (!data.settings.accountsSeeded) {
      if (!data.accounts.length) seedDefaultAccounts(data, def.id);
      data.settings.accountsSeeded = true;
      changed = true;
    }
    // 旧交易按名称匹配账户（全局），补 accountId
    data.transactions.forEach((t) => {
      if (t.accountId == null && t.account) {
        const acc = data.accounts.find((a) => a.name === t.account);
        if (acc) { t.accountId = acc.id; changed = true; }
      }
    });
    // 历史数据补 time：优先用 createdAt 反推当时的时分（createdAt 是写入时的毫秒时间戳，
    // 与 date 基本同一天，能还原出可信的录入时刻）；实在没有就留空，UI 会显示为「未记时间」。
    data.transactions.forEach((t) => {
      if (t.time == null) {
        t.time = t.createdAt ? timeFromTs(t.createdAt) : '';
        changed = true;
      }
    });
    data.splits.forEach((s) => {
      if (s.time == null) { s.time = s.createdAt ? timeFromTs(s.createdAt) : ''; changed = true; }
    });
    data.clears.forEach((c) => {
      if (c.time == null) { c.time = c.createdAt ? timeFromTs(c.createdAt) : ''; changed = true; }
    });
    data.splits.forEach((s) => {
      if (!s.ledgerId) { s.ledgerId = def.id; changed = true; }
    });
    data.ledgers.forEach((l) => {
      if (!Array.isArray(l.companions)) { l.companions = []; changed = true; }
    });
    if (changed) save(data);
  }

  /* ---------------- 账本 ---------------- */
  function listLedgers() {
    const data = load();
    if (!alive(data.ledgers).length) ensureSeed();
    return alive(load().ledgers);
  }
  function ledgerById(id) {
    return listLedgers().find((l) => l.id === id) || null;
  }
  function defaultLedger() {
    const ls = listLedgers();
    return ls.find((l) => l.isDefault) || ls[0] || null;
  }
  // 按日期自动命中：优先落在日期范围内的非默认账本（如旅游），否则默认账本
  function ledgerForDate(date) {
    const ls = listLedgers();
    const hit = ls.find(
      (l) => !l.isDefault && l.startDate && l.endDate && date >= l.startDate && date <= l.endDate
    );
    return hit || defaultLedger();
  }
  function addLedger(l) {
    const data = load();
    const led = {
      id: uid(), name: l.name || '新账本', icon: l.icon || '⭐', color: l.color || '#007aff',
      isDefault: false, startDate: l.startDate || null, endDate: l.endDate || null,
      currency: l.currency || 'CNY', baseCurrency: l.baseCurrency || 'CNY',
      budget: l.budget != null && l.budget !== '' ? round2(l.budget) : null,
      companions: Array.isArray(l.companions) ? l.companions.slice() : [],
      updatedAt: Date.now()
    };
    data.ledgers.push(led);
    save(data);
    return led;
  }

  // 账本同行人（用于快捷分账）
  function setCompanions(ledgerId, names) {
    const data = load();
    const i = data.ledgers.findIndex((l) => l.id === ledgerId);
    if (i >= 0) {
      data.ledgers[i].companions = (names || []).map((n) => String(n).trim()).filter(Boolean);
      save(data);
    }
    return data.ledgers[i];
  }
  function updateLedger(id, patch) {
    const data = load();
    const i = data.ledgers.findIndex((l) => l.id === id);
    if (i >= 0) {
      if ('budget' in patch) patch.budget = patch.budget != null && patch.budget !== '' ? round2(patch.budget) : null;
      patch.updatedAt = Date.now();
      data.ledgers[i] = Object.assign({}, data.ledgers[i], patch);
      save(data);
    }
    return data.ledgers[i];
  }
  function deleteLedger(id) {
    const data = load();
    const led = data.ledgers.find((l) => l.id === id);
    if (led && led.isDefault) return false; // 不允许删默认
    const def = defaultLedger();
    data.transactions.forEach((t) => { if (t.ledgerId === id && def) t.ledgerId = def.id; });
    // 打墓碑（而非硬删），使删除也能同步到其它设备
    data.ledgers = data.ledgers.map((l) => l.id === id
      ? Object.assign({}, l, { deleted: true, deletedAt: Date.now(), updatedAt: Date.now() }) : l);
    save(data);
    return true;
  }
  function setDefaultLedger(id) {
    const data = load();
    data.ledgers.forEach((l) => (l.isDefault = l.id === id));
    save(data);
  }

  // 交易是否属于某账本（无 ledgerId 的旧数据归入默认账本）
  function belongsToLedger(tx, ledgerId) {
    if (tx.ledgerId === ledgerId) return true;
    if (tx.ledgerId == null) {
      const d = defaultLedger();
      return !!(d && d.id === ledgerId);
    }
    return false;
  }

  /* ---------------- 付款方式 / 账户（全局通用，不绑定账本） ---------------- */
  function seedDefaultAccounts(data) {
    // 固定 id：让多设备各自播种时产生相同 id，云端合并时自动去重（不会出现两份默认账户）
    [
      { id: 'acc_cash', name: '现金', icon: '💰', color: '#34c759', initialBalance: 0 },
      { id: 'acc_wechat', name: '微信', icon: '📱', color: '#07c160', initialBalance: 0 },
      { id: 'acc_alipay', name: '支付宝', icon: '💙', color: '#1677ff', initialBalance: 0 },
      { id: 'acc_bank', name: '银行卡', icon: '💳', color: '#ff9500', initialBalance: 0 }
    ].forEach((d) =>       data.accounts.push({
      id: d.id, name: d.name, icon: d.icon, color: d.color,
      initialBalance: round2(d.initialBalance || 0), currency: 'CNY'
    }));
  }
  // 付款方式全局通用：返回全部账户（不再按账本过滤）
  function listAccounts() {
    return alive(load().accounts);
  }
  function accountById(id) {
    return alive(load().accounts).find((a) => a.id === id) || null;
  }
  function addAccount(a) {
    const data = load();
    const acc = {
      id: uid(), name: a.name || '账户',
      icon: a.icon || '💳', color: a.color || '#007aff',
      initialBalance: round2(a.initialBalance || 0),
      currency: a.currency || 'CNY',
      updatedAt: Date.now()
    };
    data.accounts.push(acc);
    save(data);
    return acc;
  }
  function updateAccount(id, patch) {
    const data = load();
    const i = data.accounts.findIndex((x) => x.id === id);
    if (i >= 0) {
      if ('initialBalance' in patch) patch.initialBalance = round2(patch.initialBalance || 0);
      patch.updatedAt = Date.now();
      data.accounts[i] = Object.assign({}, data.accounts[i], patch);
      save(data);
    }
    return data.accounts[i];
  }
  function deleteAccount(id) {
    const data = load();
    // 有流水（含作为转账的转出/转入方）不可删
    if (alive(data.transactions).some((t) =>
      t.accountId === id || (t.type === 'transfer' && (t.fromId === id || t.toId === id)))) return false;
    data.accounts = data.accounts.filter((x) => x.id !== id);
    save(data);
    return true;
  }
  // 单笔交易对某个账户余额的影响额（按该账户自身货币计）：
  // 交易货币与账户货币一致时直接用面值；否则回退到基准货币价值，避免单位错配。
  function legAmount(t, accCur) {
    const mag = t.currency === accCur ? (Number(t.amount) || 0) : baseAmount(t);
    if (t.type === 'refund') return (t.parentType === 'expense' ? 1 : -1) * mag;
    if (t.type === 'income') return mag;
    return -mag; // expense
  }
  // 当前余额 = 初始余额 + 收入 − 支出 ± 转账/退款（按各账户自身货币计）
  function accountBalance(id) {
    const data = load();
    const acc = data.accounts.find((a) => a.id === id);
    if (!acc) return { initialBalance: 0, balance: 0, currency: 'CNY' };
    let bal = acc.initialBalance || 0;
    alive(data.transactions).forEach((t) => {
      if (t.type === 'transfer') {
        // 跨货币转账：转出方按源货币面值扣减，转入方按目标货币面值增加
        if (t.fromId === id) bal -= (Number(t.amount) || 0);
        else if (t.toId === id) bal += (t.toAmount != null ? Number(t.toAmount) : (Number(t.amount) || 0));
        return;
      }
      if (t.accountId !== id) return;
      bal += legAmount(t, acc.currency);
    });
    return { initialBalance: round2(acc.initialBalance || 0), balance: round2(bal), currency: acc.currency };
  }
  // 该账户的流水 + 每笔后余额（最新在前），含作为转账转出/转入方的记录
  function accountTransactions(id) {
    const data = load();
    const acc = data.accounts.find((a) => a.id === id);
    const txs = alive(data.transactions).filter((t) =>
      t.accountId === id || (t.type === 'transfer' && (t.fromId === id || t.toId === id))).slice()
      .sort((a, b) => txSortKey(a).localeCompare(txSortKey(b)) || ((a.createdAt || 0) - (b.createdAt || 0)));
    let cur = acc ? (acc.initialBalance || 0) : 0;
    const items = txs.map((t) => {
      if (t.type === 'transfer') {
        const isOut = (t.fromId === id);
        // 跨货币：转出显示源货币面值，转入显示目标货币面值
        const amt = isOut ? (Number(t.amount) || 0)
                           : (t.toAmount != null ? Number(t.toAmount) : (Number(t.amount) || 0));
        const curCode = isOut ? (t.currency || 'CNY') : (t.toCurrency || t.currency || 'CNY');
        cur += isOut ? -amt : amt;
        return {
          tx: t, after: round2(cur),
          transfer: true,
          direction: isOut ? 'out' : 'in',
          otherId: isOut ? t.toId : t.fromId,
          displayAmount: amt, displayCurrency: curCode
        };
      }
      cur += legAmount(t, acc.currency);
      return { tx: t, after: round2(cur), displayAmount: Math.abs(Number(t.amount) || 0), displayCurrency: t.currency };
    });
    items.reverse();
    return { account: acc, initialBalance: acc ? round2(acc.initialBalance || 0) : 0, items };
  }

  /* ---------------- 交易 ---------------- */
  function addTransaction(t) {
    const data = load();
    const ledger = ledgerById(t.ledgerId) || defaultLedger();
    const rate = t.currency === ledger.baseCurrency ? 1 : (t.rate != null ? Number(t.rate) : 1);
    const acc = t.accountId ? accountById(t.accountId) : null;
    const tx = {
      id: uid(),
      ledgerId: ledger.id,
      type: t.type, // 'expense' | 'income'
      amount: round2(t.amount),
      currency: t.currency || ledger.currency || 'CNY',
      rate: round2(rate),
      discount: t.discount ? round2(t.discount) : 0,
      category: t.category,
      account: t.account || (acc ? acc.name : '现金'),
      accountId: t.accountId || null,
      date: t.date || nowDate(),
      // HH:MM，精确到分钟；date 仍只到日，保证按月/按日统计不受影响。
      // 未显式传 time（undefined）→ 取当前时刻；显式传空串 → 尊重「不记时间」。
      time: t.time === undefined ? nowTime() : normTime(t.time),
      note: t.note || '',
      splitId: t.splitId || null,
      source: t.source || null, // 'quick' = 快捷指令/快速记账写入
      updatedAt: Date.now(),
      createdAt: Date.now()
    };
    data.transactions.unshift(tx);
    save(data);
    return tx;
  }

  function updateTransaction(id, patch) {
    const data = load();
    const i = data.transactions.findIndex((x) => x.id === id);
    if (i >= 0) {
      if ('rate' in patch || 'currency' in patch) {
        const cur = patch.currency || data.transactions[i].currency;
        const led = ledgerById(data.transactions[i].ledgerId) || defaultLedger();
        const base = led.baseCurrency;
        let rate = patch.rate != null ? Number(patch.rate) : data.transactions[i].rate;
        if (cur === base) rate = 1;
        patch.rate = round2(rate);
      }
      if ('discount' in patch) patch.discount = patch.discount ? round2(patch.discount) : 0;
      if ('time' in patch) patch.time = normTime(patch.time);
      if ('accountId' in patch) {
        const acc = patch.accountId ? accountById(patch.accountId) : null;
        patch.account = acc ? acc.name : '现金';
      }
      patch.updatedAt = Date.now();
      data.transactions[i] = Object.assign({}, data.transactions[i], patch);
      save(data);
    }
    return data.transactions[i];
  }

  // 删除 = 打墓碑（deleted:true）。本地立即从统计/余额/列表中消失；
  // 同时保留墓碑用于在同步时覆盖云端旧副本，从而让「删除」也能传播到其它设备。
  function deleteTransaction(id, opts) {
    const data = load();
    const i = data.transactions.findIndex((x) => x.id === id);
    if (i < 0) return false;
    const keepRefunds = !!(opts && opts.keepRefunds);
    // 原单删除时，连同它的退款一起去掉（否则退款会变成悬空记录）。
    // keepRefunds=true 用于「退全款后清理原单」：此时要保留已生成的退款。
    if (!keepRefunds) {
      data.transactions = data.transactions.filter((x) => !(x.parentId === id && !isDeleted(x)));
    }
    // 重新定位（过滤后下标可能已变）
    const j = data.transactions.findIndex((x) => x.id === id);
    data.transactions[j] = Object.assign({}, data.transactions[j], {
      deleted: true, deletedAt: Date.now(), updatedAt: Date.now()
    });
    save(data);
    return true;
  }

  // ---------------- 退款（全退 / 部分退款） ----------------
  // 退款以「派生交易」建模：type='refund'，parentId 指向被退的原单。
  // 净额(基准货币) = -退款额 × 汇率；等同于把该笔收支按退款金额冲销。
  // 退款方向与原单相反：原支出退回 → 账户余额增加；原收入退回 → 账户余额减少。
  function refundedAmount(parentId) {
    return round2(load().transactions
      .filter((t) => !isDeleted(t) && t.type === 'refund' && t.parentId === parentId)
      .reduce((a, t) => a + (Number(t.amount) || 0), 0));
  }
  function refundChildren(parentId) {
    return alive(load().transactions.filter((t) => t.type === 'refund' && t.parentId === parentId));
  }
  function canRefund(parentTx) {
    return !!parentTx && !isDeleted(parentTx) && (parentTx.type === 'expense' || parentTx.type === 'income');
  }
  // 撤销某笔退款（直接移除；退款不可「删除」，只能撤销）
  function removeRefund(id) {
    const data = load();
    const tx = data.transactions.find((x) => x.id === id);
    if (!tx || tx.type !== 'refund') return false;
    data.transactions = data.transactions.filter((x) => x.id !== id);
    save(data);
    return true;
  }
  // r = { parentId, amount, date, note, toAccountId?, deleteParent? }
  //   amount：退款金额（与原单同币种）
  //   deleteParent：退全款时可选「同时删除原单」（保留退款以维持收支平衡）
  function addRefund(r) {
    const data = load();
    const parent = data.transactions.find((x) => x.id === r.parentId);
    if (!parent) return { error: '原交易不存在' };
    if (isDeleted(parent)) return { error: '原交易已删除' };
    if (!(parent.type === 'expense' || parent.type === 'income')) return { error: '该记录不支持退款' };
    const amount = round2(Number(r.amount));
    if (!(amount > 0)) return { error: '退款金额无效' };
    const already = round2(data.transactions
      .filter((t) => !isDeleted(t) && t.type === 'refund' && t.parentId === parent.id)
      .reduce((a, t) => a + (Number(t.amount) || 0), 0));
    const remain = round2(Number(parent.amount) - already);
    if (amount > remain + 0.005) return { error: `超出可退金额（剩余 ${remain} ${parent.currency}）` };

    // 退款退回哪个账户：默认原路退回（原单账户）；也可指定其它账户
    const toAcc = r.toAccountId ? accountById(r.toAccountId) : (parent.accountId ? accountById(parent.accountId) : null);
    const acc = toAcc || null;
    const tx = {
      id: uid(),
      ledgerId: parent.ledgerId,
      type: 'refund',
      parentId: parent.id,
      parentType: parent.type,       // 'expense' | 'income'：决定统计与余额方向
      amount,
      currency: parent.currency,
      rate: parent.rate || 1,
      discount: 0,
      category: parent.category,
      account: acc ? acc.name : (parent.account || '现金'),
      accountId: acc ? acc.id : (parent.accountId || null),
      date: r.date || nowDate(),
      time: r.time === undefined ? nowTime() : normTime(r.time),
      note: r.note || '',
      splitId: null,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    data.transactions.unshift(tx);
    save(data);

    let parentDeleted = false;
    if (r.deleteParent) {
      // 退全款 + 删除原单：原单打墓碑的同时保留退款（合起来净额为 0，与原单存在时等价）
      const full = round2(already + amount);
      if (full >= round2(Number(parent.amount)) - 0.005) {
        deleteTransaction(parent.id, { keepRefunds: true });
        parentDeleted = true;
      }
    }
    return { tx, parentDeleted };
  }

  function getTransaction(id) {
    return load().transactions.find((x) => x.id === id) || null;
  }

  // 账户间转账：金额从 fromId 划到 toId，不计入账本收支，仅影响两卡余额。
  // 支持跨货币：currency=源账户货币，toCurrency=目标账户货币，rate=1 currency=? toCurrency，
  // amount=源货币面值，toAmount=目标货币面值（= amount * rate）。
  function addTransfer(t) {
    const data = load();
    const ledger = ledgerById(t.ledgerId) || defaultLedger();
    const fromAcc = accountById(t.fromId);
    const toAcc = accountById(t.toId);
    const currency = fromAcc ? fromAcc.currency : (t.currency || 'CNY');
    const toCurrency = toAcc ? toAcc.currency : (t.toCurrency || currency);
    const amount = round2(t.amount);
    let rate = Number(t.rate) || 1;
    let toAmount = t.toAmount != null ? round2(t.toAmount) : round2(amount * rate);
    if (toCurrency === currency) { rate = 1; toAmount = amount; }
    const tx = {
      id: uid(),
      ledgerId: ledger.id,
      type: 'transfer',
      amount, currency, rate: round2(rate), toAmount, toCurrency,
      discount: 0,
      category: 'transfer',
      account: '转账',
      accountId: null,
      fromId: t.fromId, toId: t.toId,
      date: t.date || nowDate(),
      time: t.time === undefined ? nowTime() : normTime(t.time),
      note: t.note || '',
      splitId: null,
      createdAt: Date.now()
    };
    data.transactions.unshift(tx);
    save(data);
    return tx;
  }
  function updateTransfer(id, patch) {
    const data = load();
    const i = data.transactions.findIndex((x) => x.id === id);
    if (i >= 0) {
      const cur = data.transactions[i];
      const fromAcc = accountById(patch.fromId || cur.fromId);
      const toAcc = accountById(patch.toId || cur.toId);
      const currency = fromAcc ? fromAcc.currency : (patch.currency || cur.currency);
      const toCurrency = toAcc ? toAcc.currency : (patch.toCurrency || cur.toCurrency || currency);
      const amount = patch.amount != null ? round2(patch.amount) : cur.amount;
      let rate = patch.rate != null ? Number(patch.rate) : cur.rate;
      let toAmount = patch.toAmount != null ? round2(patch.toAmount)
        : (cur.toAmount != null ? cur.toAmount : amount);
      if (toCurrency === currency) { rate = 1; toAmount = amount; }
      if ('time' in patch) patch.time = normTime(patch.time);
      data.transactions[i] = Object.assign({}, cur, patch, {
        type: 'transfer', category: 'transfer', account: '转账', accountId: null,
        currency, toCurrency, rate: round2(rate), amount, toAmount
      });
      save(data);
    }
    return data.transactions[i];
  }

  // 基准货币金额
  function baseAmount(tx) { return round2(tx.amount * (tx.rate || 1)); }
  function baseDiscount(tx) { return round2((tx.discount || 0) * (tx.rate || 1)); }

  /* ---------------- 分账 ---------------- */
  // split: { id, ledgerId, title, date, total(基准货币), paidBy, method, members:[{name,share,amount}],
  //          note, settled:[], currency, rate, linkedTx }
  function addSplit(s) {
    const data = load();
    const ledgerId = s.ledgerId || defaultLedger() ? (s.ledgerId || (defaultLedger() || {}).id) : null;
    const split = {
      id: uid(),
      ledgerId: ledgerId,
      title: s.title || '未命名账单',
      date: s.date || nowDate(),
      time: s.time === undefined ? nowTime() : normTime(s.time),
      total: round2(s.total),
      paidBy: s.paidBy,
      method: s.method || 'equal',
      members: s.members || [],
      note: s.note || '',
      settled: [],
      currency: s.currency || null,
      rate: s.rate != null ? round2(s.rate) : null,
      baseCurrency: s.baseCurrency || 'CNY',
      linkedTx: s.linkedTx || null,
      createdAt: Date.now()
    };
    data.splits.unshift(split);
    save(data);
    return split;
  }

  function updateSplit(id, patch) {
    const data = load();
    const i = data.splits.findIndex((x) => x.id === id);
    if (i >= 0) {
      patch.updatedAt = Date.now();
      data.splits[i] = Object.assign({}, data.splits[i], patch);
      save(data);
    }
    return data.splits[i];
  }

  function deleteSplit(id) {
    const data = load();
    const sp = data.splits.find((x) => x.id === id);
    if (sp && sp.linkedTx) {
      const tx = data.transactions.find((t) => t.id === sp.linkedTx);
      if (tx) tx.splitId = null;
    }
    data.splits = data.splits.filter((x) => x.id !== id);
    save(data);
  }

  // 余数归付款人承担（如 100/3 → 付款人多付 0.01），保证合计 = total
  function reconcileSplit(sp, owes) {
    const payer = sp.members.some((m) => m.name === sp.paidBy) ? sp.paidBy : (sp.members[0] || {}).name;
    if (!payer) return;
    const others = sp.members.reduce((a, m) => a + (m.name === payer ? 0 : owes[m.name]), 0);
    owes[payer] = round2(sp.total - others);
  }

  function splitOwes(sp) {
    const owes = {};
    sp.members.forEach((m) => (owes[m.name] = 0));
    if (sp.method === 'equal') {
      const each = sp.total / (sp.members.length || 1);
      sp.members.forEach((m) => (owes[m.name] = round2(each)));
      reconcileSplit(sp, owes);
    } else if (sp.method === 'share') {
      const sum = sp.members.reduce((a, m) => a + (Number(m.share) || 0), 0) || 1;
      sp.members.forEach((m) => (owes[m.name] = round2((sp.total * (Number(m.share) || 0)) / sum)));
      reconcileSplit(sp, owes);
    } else if (sp.method === 'exact') {
      sp.members.forEach((m) => (owes[m.name] = round2(Number(m.amount) || 0)));
    }
    Object.keys(owes).forEach((k) => (owes[k] = round2(owes[k])));
    return owes;
  }

  // 已确认结算的清账记录：debtor(from) 向 creditor(to) 实际支付了 amount
  function addClear(c) {
    const data = load();
    const rec = {
      id: uid(),
      ledgerId: c.ledgerId || (defaultLedger() || {}).id,
      from: c.from, to: c.to,
      amount: round2(c.amount),
      date: c.date || nowDate(),
      time: c.time === undefined ? nowTime() : normTime(c.time),
      note: c.note || '',
      createdAt: Date.now()
    };
    data.clears.unshift(rec);
    save(data);
    return rec;
  }
  function deleteClear(id) {
    const data = load();
    data.clears = data.clears.filter((x) => x.id !== id);
    save(data);
  }

  // 某账本内每个人的净额（已扣减已清账）：正=应收，负=应付
  function allBalances(ledgerId) {
    const data = load();
    const net = {};
    alive(data.splits).forEach((sp) => {
      if (ledgerId && sp.ledgerId !== ledgerId) return;
      const owes = splitOwes(sp);
      Object.keys(owes).forEach((n) => { net[n] = (net[n] || 0) - owes[n]; });
      if (sp.paidBy) net[sp.paidBy] = (net[sp.paidBy] || 0) + sp.total;
    });
    alive(data.clears).forEach((c) => {
      if (ledgerId && c.ledgerId !== ledgerId) return;
      net[c.from] = (net[c.from] || 0) + c.amount; // 付钱者债务减少
      net[c.to] = (net[c.to] || 0) - c.amount;       // 收钱者应收减少
    });
    Object.keys(net).forEach((k) => (net[k] = round2(net[k])));
    return net;
  }

  // 建议转账（已扣减已清账后剩余净额推导）
  function settlement(ledgerId) {
    const net = allBalances(ledgerId);
    const creditors = [], debtors = [];
    Object.keys(net).forEach((n) => {
      if (net[n] > 0.005) creditors.push({ name: n, amt: net[n] });
      else if (net[n] < -0.005) debtors.push({ name: n, amt: -net[n] });
    });
    creditors.sort((a, b) => b.amt - a.amt);
    debtors.sort((a, b) => b.amt - a.amt);
    const result = [];
    let ci = 0, di = 0;
    while (ci < creditors.length && di < debtors.length) {
      const c = creditors[ci], d = debtors[di];
      const pay = Math.min(c.amt, d.amt);
      result.push({ from: d.name, to: c.name, amount: round2(pay) });
      c.amt -= pay; d.amt -= pay;
      if (c.amt <= 0.005) ci++;
      if (d.amt <= 0.005) di++;
    }
    return result;
  }

  /* ---------------- 统计（按账本/基准货币） ---------------- */
  function monthRange(ledgerId, month) {
    const data = load();
    const txs = alive(data.transactions).filter(
      (t) => belongsToLedger(t, ledgerId) && (t.date || '').slice(0, 7) === month
    );
    let income = 0, expense = 0, discount = 0;
    const byCat = {};
    txs.forEach((t) => {
      if (t.type === 'transfer') return; // 转账不计入账本收支
      const b = baseAmount(t);
      if (t.type === 'refund') {
        // 退款冲销原单：原支出退回 → 减少支出；原收入退回 → 减少收入
        if (t.parentType === 'income') income -= b;
        else {
          expense -= b;
          const meta = catMeta('expense', t.category);
          byCat[t.category] = byCat[t.category] || { name: meta.name, emoji: meta.emoji, amount: 0 };
          byCat[t.category].amount -= b;
        }
        return;
      }
      if (t.type === 'income') income += b;
      else {
        expense += b;
        discount += baseDiscount(t);
        const meta = catMeta('expense', t.category);
        byCat[t.category] = byCat[t.category] || { name: meta.name, emoji: meta.emoji, amount: 0 };
        byCat[t.category].amount += b;
      }
    });
    const cats = Object.keys(byCat).map((k) => byCat[k]).sort((a, b) => b.amount - a.amount);
    return {
      income: round2(income), expense: round2(expense), net: round2(income - expense),
      discount: round2(discount), cats
    };
  }

  function monthlyTrend(ledgerId, months) {
    const data = load();
    const map = {};
    alive(data.transactions).forEach((t) => {
      if (!belongsToLedger(t, ledgerId)) return;
      if (t.type === 'transfer') return; // 转账不计入趋势
      const m = (t.date || '').slice(0, 7);
      if (!m) return;
      map[m] = map[m] || { income: 0, expense: 0 };
      const b = baseAmount(t);
      if (t.type === 'refund') {
        if (t.parentType === 'income') map[m].income -= b;
        else map[m].expense -= b;
      } else if (t.type === 'income') map[m].income += b;
      else map[m].expense += b;
    });
    const keys = Object.keys(map).sort();
    return keys.slice(-(months || 6)).map((m) => ({
      month: m,
      income: round2(map[m].income),
      expense: round2(map[m].expense)
    }));
  }

  // 账本预算使用：若有起止日期则按范围，否则按该账本全部交易（退款冲减支出）
  function ledgerSpend(ledgerId) {
    const data = load();
    const led = ledgerById(ledgerId);
    let txs = alive(data.transactions).filter((t) => belongsToLedger(t, ledgerId) &&
      (t.type === 'expense' || (t.type === 'refund' && t.parentType === 'expense')));
    if (led && led.startDate && led.endDate) {
      txs = txs.filter((t) => t.date >= led.startDate && t.date <= led.endDate);
    }
    const spent = round2(txs.reduce((a, t) => a + (t.type === 'refund' ? -baseAmount(t) : baseAmount(t)), 0));
    return { spent, budget: led ? led.budget : null, ledger: led };
  }

  function exportAll() {
    return JSON.stringify(load(), null, 2);
  }

  function importAll(text) {
    const data = JSON.parse(text);
    const d = {
      transactions: data.transactions || [],
      splits: data.splits || [],
      ledgers: data.ledgers || [],
      clears: data.clears || [],
      accounts: data.accounts || [],
      categories: data.categories || { expense: CATS_EXPENSE.map((c) => ({ key: c.key, name: c.name, emoji: c.emoji })), income: CATS_INCOME.map((c) => ({ key: c.key, name: c.name, emoji: c.emoji })) },
      settings: data.settings || {}
    };
    save(d);
  }

  global.Store = {
    CATS_EXPENSE, CATS_INCOME, ACCOUNTS, CURRENCIES, LEDGER_ICONS, LEDGER_COLORS,
    CAT_EMOJIS, ACCOUNT_ICONS,
    currencyMeta, catMeta, getCategories, addCategory, updateCategory, deleteCategory,
    uid, nowDate, nowTime, normTime, txTime, txSortKey, txDateTime, round2, load, save, ensureSeed, normalize,
    listLedgers, ledgerById, defaultLedger, ledgerForDate,
    addLedger, updateLedger, deleteLedger, setDefaultLedger, setCompanions, belongsToLedger,
    listAccounts, accountById, addAccount, updateAccount, deleteAccount, accountBalance, accountTransactions,
    addTransaction, updateTransaction, deleteTransaction, getTransaction,
    addRefund, removeRefund, refundedAmount, refundChildren, canRefund, isDeleted,
    addTransfer, updateTransfer,
    baseAmount, baseDiscount, legAmount,
    addSplit, updateSplit, deleteSplit,
    addClear, deleteClear,
    splitOwes, allBalances, settlement,
    monthRange, monthlyTrend, ledgerSpend,
    exportAll, importAll,
    onSync, getSyncState, syncNow, pullAndMerge
  };
})(window);
