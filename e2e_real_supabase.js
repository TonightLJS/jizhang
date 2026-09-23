/* 端到端跑通「真实 Supabase 项目」——无需安装任何依赖（直接用 fetch 调 GoTrue + PostgREST）。
 *
 * 前置：
 *   1) 已按 SETUP.md 建好 Supabase 项目，并在 SQL Editor 执行过 supabase_schema.sql（建表 + 开 RLS）
 *   2) Authentication → Providers → Email 里关闭 “Confirm email”（否则注册后拿不到会话）
 *
 * 用法（把两段换成你自己的）：
 *   SUPABASE_URL=https://xxxx.supabase.co \
 *   SUPABASE_ANON_KEY=eyJhbGciOi... \
 *   node e2e_real_supabase.js
 *
 * 可选：用已有账号而非新建：
 *   E2E_EMAIL=you@example.com E2E_PASSWORD=yourpass node e2e_real_supabase.js
 *
 * 说明：不填邮箱时会自动注册一个临时账号（e2e-<时间戳>@example.com），
 *       会在你的项目里写入 1 个测试用户 + 1 行数据，可随时在后台删除。
 */
'use strict';
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const ANON = process.env.SUPABASE_ANON_KEY || '';
const EMAIL = process.env.E2E_EMAIL || ('e2e-' + Date.now() + '@example.com');
const PW = process.env.E2E_PASSWORD || 'e2e-Passw0rd!';

if (!SUPABASE_URL || !ANON) {
  console.log('\n缺少凭据。请这样运行（把 URL / anon key 换成你自己的）：\n');
  console.log('  SUPABASE_URL=https://xxxx.supabase.co SUPABASE_ANON_KEY=eyJ... node e2e_real_supabase.js\n');
  console.log('获取方式：Supabase 后台 → Project Settings → API → Project URL / anon public key');
  process.exit(0);
}

/* ---------------- 真实 supabase-js 兼容客户端（fetch 直连，无依赖） ---------------- */
function errMsg(j) { return (j && (j.error_description || j.msg || j.error || j.message)) || JSON.stringify(j || {}); }
function createClient(url, anonKey) {
  const base = url.replace(/\/$/, '');
  const listeners = [];
  const sess = () => { try { return JSON.parse(global.localStorage.getItem('sb-real-auth') || 'null'); } catch (e) { return null; } };
  const fire = (ev, s) => listeners.forEach((fn) => { try { fn(ev, s); } catch (e) {} });
  const mk = (raw) => ({ access_token: raw.access_token, refresh_token: raw.refresh_token, user: raw.user });
  const auth = {
    onAuthStateChange(cb) { listeners.push(cb); return { data: { subscription: { unsubscribe() {} } } }; },
    async getSession() { return { data: { session: sess() } }; },
    async signUp({ email, password }) {
      const r = await fetch(base + '/auth/v1/signup', { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: anonKey, Authorization: 'Bearer ' + anonKey }, body: JSON.stringify({ email, password }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return { error: errMsg(j) };
      if (!j.access_token) return { error: '注册成功但需邮箱验证：请到 Supabase → Authentication → Providers → Email 关闭 “Confirm email” 后重试' };
      const s = mk(j); global.localStorage.setItem('sb-real-auth', JSON.stringify(s)); fire('SIGNED_IN', s);
      return { data: { session: s, user: s.user } };
    },
    async signInWithPassword({ email, password }) {
      const r = await fetch(base + '/auth/v1/token?grant_type=password', { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: anonKey, Authorization: 'Bearer ' + anonKey }, body: JSON.stringify({ email, password }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.access_token) return { error: errMsg(j) };
      const s = mk(j); global.localStorage.setItem('sb-real-auth', JSON.stringify(s)); fire('SIGNED_IN', s);
      return { data: { session: s, user: s.user } };
    },
    async signOut() { global.localStorage.removeItem('sb-real-auth'); fire('SIGNED_OUT', null); return { error: null }; }
  };
  function from() {
    let filters = [], single = false, bodyObj = null;
    const b = {
      select() { return b; }, eq(c, v) { filters.push([c, v]); return b; },
      maybeSingle() { single = true; return exec('GET'); }, single() { single = true; return b; },
      upsert(o) { bodyObj = o; return exec('POST'); }
    };
    async function exec(method) {
      const qs = new global.URLSearchParams(); filters.forEach(([c, v]) => qs.set(c, 'eq.' + v));
      const u2 = base + '/rest/v1/ledger_sync' + (qs.toString() ? '?' + qs.toString() : '');
      const headers = { apikey: anonKey, Authorization: 'Bearer ' + (sess() ? sess().access_token : anonKey), 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' };
      if (single) headers['Accept'] = 'application/vnd.pgrst.object+json';
      const r = await fetch(u2, { method, headers, body: bodyObj ? JSON.stringify(bodyObj) : undefined });
      if (r.status === 406) return { error: null, data: null };  // object+json 且 0 行
      if (!r.ok) { let t = ''; try { t = await r.text(); } catch (e) {} return { error: { message: t || ('HTTP ' + r.status) } }; }
      if (method === 'POST') return { error: null, data: [] };
      const txt = await r.text(); if (!txt) return { error: null, data: null };
      try { return { error: null, data: JSON.parse(txt) }; } catch (e) { return { error: null, data: null }; }
    }
    return b;
  }
  return { auth, from };
}

/* ---------------- 测试环境（复用真实 store.js / sync.js） ---------------- */
global.window = global;
function freshLS() { const m = {}; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; } }; }
const devices = {};
function configure(ls) { global.localStorage = ls; global.window.saveCloudConfig(SUPABASE_URL, ANON); }
async function use(name) { const ls = devices[name] || (devices[name] = freshLS()); configure(ls); await global.SyncHub.getSession(); }
let pass = 0, fail = 0;
function assert(name, cond, extra) { console.log((cond ? 'PASS' : 'FAIL') + ' · ' + name + (extra != null ? '  [' + extra + ']' : '')); cond ? pass++ : fail++; }

(async () => {
  console.log('目标项目: ' + SUPABASE_URL + '\n');

  /* ---- 0) 后端健康检查：先确认「表 + 邮箱确认设置」是否就绪，避免白跑 ---- */
  const HH = { 'Content-Type': 'application/json', apikey: ANON, Authorization: 'Bearer ' + ANON };
  try {
    const tr = await fetch(SUPABASE_URL + '/rest/v1/ledger_sync?select=user_id&limit=1', { headers: HH });
    if (tr.status === 404) console.log('⚠️  health: 表 ledger_sync 不存在 → 请先在 SQL Editor 执行 supabase_schema.sql');
    else if (tr.ok || tr.status === 206) console.log('✅ health: 表 ledger_sync 可访问（RLS 生效，未登录读到 0 行）');
    else console.log('⚠️  health: 探测表返回 HTTP ' + tr.status + ' → ' + (await tr.text()).slice(0, 200));
  } catch (e) { console.log('⚠️  health: 无法访问项目（检查 URL/网络）：' + e.message); }

  require('C:/Users/lujia/WorkBuddy/2026-09-23-15-46-47/assets/config.js');
  global.window.supabase = { createClient };
  require('C:/Users/lujia/WorkBuddy/2026-09-23-15-46-47/assets/sync.js');
  require('C:/Users/lujia/WorkBuddy/2026-09-23-15-46-47/assets/store.js');
  const S = global.Store;

  try {
    /* 设备 A：登录（或注册） + 记账 + 同步上传 */
    await use('A'); S.ensureSeed();
    let auth = await global.SyncHub.signUp(EMAIL, PW);
    if (auth.error && /already|registered/i.test(auth.error)) auth = await global.SyncHub.signIn(EMAIL, PW);
    if (auth.error) { assert('A 登录/注册', false, auth.error); console.log('\n—— 中断：请先确认已建表(ledger_sync + RLS)且已关闭邮箱确认 ——'); process.exit(1); }
    if (!auth.session) {
      assert('A 登录/注册（拿到会话）', false, '注册成功但未拿到会话 → 邮箱确认仍开启，请到 Authentication → Sign In / Providers → Email 关闭 “Confirm email” 后重试');
      process.exit(1);
    }
    assert('A 登录/注册成功', global.SyncHub.isSignedIn());

    const accA = S.addAccount({ name: 'E2E测试卡', currency: 'CNY', initialBalance: 100 });
    const txA = S.addTransaction({ ledgerId: S.defaultLedger().id, type: 'expense', amount: 30, currency: 'CNY', rate: 1, category: 'food', accountId: accA.id, date: '2026-09-23', note: 'e2e' });
    const r1 = await S.syncNow();
    assert('A 上传云端成功（真实 REST 写入）', !r1.error, JSON.stringify(r1.error || {}));

    /* 设备 B：同账号登录 + 拉取合并 */
    await use('B'); S.ensureSeed();
    const r2 = await global.SyncHub.signIn(EMAIL, PW);
    assert('B 登录成功', !r2.error && !!(r2.user || global.SyncHub.isSignedIn()), JSON.stringify(r2.error || (r2.user ? {} : '无会话')));
    const r3 = await S.pullAndMerge();
    assert('B 拉取合并成功', !r3.error, JSON.stringify(r3.error || {}));
    const bData = S.load();
    assert('B 拿到 A 的账户（真实云端往返）', bData.accounts.some((a) => a.id === accA.id));
    assert('B 拿到 A 的交易（真实云端往返）', bData.transactions.some((t) => t.id === txA.id));
    assert('默认账户去重正确（4默认+A卡=5）', bData.accounts.length === 5, bData.accounts.length);

    /* 反向：B 新增 → A 拉取 */
    const txB = S.addTransaction({ ledgerId: S.defaultLedger().id, type: 'income', amount: 66, currency: 'CNY', rate: 1, category: 'salary', accountId: accA.id, date: '2026-09-23', note: 'e2e-b' });
    await S.syncNow();
    await use('A'); await S.pullAndMerge();
    assert('A 拉到 B 的记录（多设备双向）', S.load().transactions.some((t) => t.id === txB.id));

    await global.SyncHub.signOut();
    console.log('\n========== 真实 Supabase 端到端: ' + pass + ' 通过, ' + fail + ' 失败 ==========');
    console.log('（测试账号 ' + EMAIL + ' 及其 1 行数据可在 Supabase 后台删除）');
    process.exit(fail ? 1 : 0);
  } catch (e) {
    console.error('\n发生异常（网络/权限/建表问题均可能）：', (e && e.message) || e);
    process.exit(2);
  }
})();
