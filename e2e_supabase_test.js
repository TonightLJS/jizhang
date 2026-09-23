/* 端到端测试：用本地「Supabase 兼容后端」跑真实的 sync.js + store.js
 * 模拟多台设备（iPhone / iPad）用同一账号登录并互相同步。
 * 后端仅实现 sync.js 实际用到的 supabase-js 接口，与真实 Supabase 协议一致；
 * 把 URL/anonKey 换成你的真实项目，即可同样跑通。
 */
'use strict';
const http = require('http');
const SUPABASE_URL = 'http://127.0.0.1:8191';
const ANON = 'mock-anon-key';

/* ---------------- 本地 Supabase 兼容后端 ---------------- */
const users = new Map();              // email -> {id,email,password}
const rows = new Map();               // user_id -> {data, updated_at}
let _uid = 0;
const newId = () => 'usr_' + (++_uid);
function decodeTok(tok) { try { return JSON.parse(Buffer.from(tok, 'base64').toString()); } catch (e) { return null; } }
function mkSession(id, email) {
  return { access_token: Buffer.from(JSON.stringify({ uid: id, email })).toString('base64'), token_type: 'bearer', user: { id, email } };
}
const server = http.createServer(async (req, res) => {
  let body = ''; req.on('data', (c) => (body += c)); await new Promise((r) => req.on('end', r));
  const u = new global.URL(req.url, 'http://x');
  const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(obj == null ? '' : JSON.stringify(obj)); };
  const p = u.pathname;
  if (p === '/auth/v1/signup') {
    const { email, password } = body ? JSON.parse(body) : {};
    if (users.has(email)) return send(400, { error: { message: 'User already registered' } });
    const id = newId(); users.set(email, { id, email, password }); const s = mkSession(id, email);
    return send(200, { data: { session: s, user: { id, email } } });
  }
  if (p === '/auth/v1/token') {
    const { email, password } = body ? JSON.parse(body) : {};
    const usr = users.get(email);
    if (!usr || usr.password !== password) return send(400, { error: { message: 'Invalid login credentials' } });
    const s = mkSession(usr.id, email); return send(200, { data: { session: s, user: { id: usr.id, email } } });
  }
  if (p === '/auth/v1/logout') return send(204);
  if (p === '/rest/v1/ledger_sync') {
    const authH = req.headers['authorization'] || '';
    const tok = authH.startsWith('Bearer ') ? authH.slice(7) : '';
    const dec = decodeTok(tok); if (!dec) return send(401, { message: 'not authorized' });
    if (req.method === 'POST') {
      const obj = JSON.parse(body || '{}');
      if (dec.uid !== obj.user_id) return send(403, { message: 'row violates row-level security' });
      rows.set(obj.user_id, { data: obj.data, updated_at: obj.updated_at }); return send(201, { data: [obj] });
    }
    if (req.method === 'GET') {
      const f = u.searchParams.get('user_id'); const fuid = f && f.startsWith('eq.') ? f.slice(3) : null;
      if (fuid && fuid !== dec.uid) return send(403, { message: 'row violates row-level security' });
      const row = rows.get(dec.uid); if (!row) return send(204);
      return send(200, { data: row.data, updated_at: row.updated_at });
    }
  }
  return send(404, { message: 'not found' });
});

/* ---------------- 本地 supabase-js 兼容客户端 ---------------- */
function createClient(url, anonKey) {
  const base = url.replace(/\/$/, '');
  const listeners = [];
  const sess = () => { try { return JSON.parse(global.localStorage.getItem('sb-mock-auth') || 'null'); } catch (e) { return null; } };
  const fire = (ev, s) => listeners.forEach((fn) => { try { fn(ev, s); } catch (e) {} });
  const auth = {
    onAuthStateChange(cb) { listeners.push(cb); return { data: { subscription: { unsubscribe() {} } } }; },
    async getSession() { return { data: { session: sess() } }; },
    async signUp({ email, password }) {
      const r = await fetch(base + '/auth/v1/signup', { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: anonKey }, body: JSON.stringify({ email, password }) });
      const j = await r.json(); if (j.error) return { error: j.error };
      global.localStorage.setItem('sb-mock-auth', JSON.stringify(j.data.session)); fire('SIGNED_IN', j.data.session);
      return { data: { session: j.data.session, user: j.data.session.user } };
    },
    async signInWithPassword({ email, password }) {
      const r = await fetch(base + '/auth/v1/token?grant_type=password', { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: anonKey }, body: JSON.stringify({ email, password }) });
      const j = await r.json(); if (j.error) return { error: j.error };
      global.localStorage.setItem('sb-mock-auth', JSON.stringify(j.data.session)); fire('SIGNED_IN', j.data.session);
      return { data: { session: j.data.session, user: j.data.session.user } };
    },
    async signOut() { global.localStorage.removeItem('sb-mock-auth'); fire('SIGNED_OUT', null); return { error: null }; }
  };
  function from() {
    let filters = [], single = false, bodyObj = null;
    const b = {
      select() { return b; }, eq(col, val) { filters.push([col, val]); return b; },
      maybeSingle() { single = true; return exec('GET'); }, single() { single = true; return b; },
      upsert(obj) { bodyObj = obj; return exec('POST'); }
    };
    async function exec(method) {
      const qs = new global.URLSearchParams(); filters.forEach(([c, v]) => qs.set(c, 'eq.' + v));
      const u2 = base + '/rest/v1/ledger_sync' + (qs.toString() ? '?' + qs.toString() : '');
      const headers = { apikey: anonKey, Authorization: 'Bearer ' + (sess() ? sess().access_token : '') };
      if (single) headers['Accept'] = 'application/vnd.pgrst.object+json';
      const r = await fetch(u2, { method, headers, body: bodyObj ? JSON.stringify(bodyObj) : undefined });
      if (!r.ok) { let t = ''; try { t = await r.text(); } catch (e) {} return { error: { message: t || ('HTTP ' + r.status) } }; }
      if (method === 'POST') return { error: null, data: [] };
      const txt = await r.text(); if (!txt) return { error: null, data: null };
      try { return { error: null, data: JSON.parse(txt) }; } catch (e) { return { error: null, data: null }; }
    }
    return b;
  }
  return { auth, from };
}

/* ---------------- 测试环境 ---------------- */
global.window = global;
function freshLS() { const m = {}; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; } }; }
const devices = {};
function configure(ls) { global.localStorage = ls; global.window.saveCloudConfig(SUPABASE_URL, ANON); }
// 切换到某设备（保留其自己的 localStorage 与登录态）
async function use(name) { const ls = devices[name] || (devices[name] = freshLS()); configure(ls); await global.SyncHub.getSession(); }
let pass = 0, fail = 0;
function assert(name, cond, extra) { console.log((cond ? 'PASS' : 'FAIL') + ' · ' + name + (extra != null ? '  [' + extra + ']' : '')); cond ? pass++ : fail++; }

server.listen(8191, '127.0.0.1', async () => {
  try {
    require('C:/Users/lujia/WorkBuddy/2026-09-23-15-46-47/assets/config.js');
    global.window.supabase = { createClient };
    require('C:/Users/lujia/WorkBuddy/2026-09-23-15-46-47/assets/sync.js');
    require('C:/Users/lujia/WorkBuddy/2026-09-23-15-46-47/assets/store.js');
    const S = global.Store;
    const EMAIL = 'test@example.com', PW = 'secret123';

    /* === 设备 A（iPhone）：注册 + 记账 + 同步 === */
    await use('A'); S.ensureSeed();
    const r0 = await global.SyncHub.signUp(EMAIL, PW);
    assert('A 注册成功', !r0.error && !!r0.user, JSON.stringify(r0.error || {}));
    assert('A 已登录', global.SyncHub.isSignedIn());
    const accA = S.addAccount({ name: 'iPhone卡', currency: 'CNY', initialBalance: 50 });
    const txA = S.addTransaction({ ledgerId: S.defaultLedger().id, type: 'expense', amount: 30, currency: 'CNY', rate: 1, category: 'food', accountId: accA.id, date: '2026-09-23' });
    const r1 = await S.syncNow();
    assert('A 同步（拉合并+上传）成功', !r1.error, JSON.stringify(r1.error || {}));
    assert('A 同步状态=synced', S.getSyncState().status === 'synced', S.getSyncState().status);

    /* === 设备 B（iPad）：同账号登录 + 拉取合并 === */
    await use('B'); S.ensureSeed();
    const r2 = await global.SyncHub.signIn(EMAIL, PW);
    assert('B 登录成功（同账号）', !r2.error, JSON.stringify(r2.error || {}));
    const r3 = await S.pullAndMerge();
    assert('B 拉取合并成功', !r3.error, JSON.stringify(r3.error || {}));
    let bData = S.load();
    assert('B 拿到 A 的账户(id一致)', bData.accounts.some((a) => a.id === accA.id));
    assert('B 拿到 A 的交易(id一致)', bData.transactions.some((t) => t.id === txA.id));
    assert('默认账户已去重（4默认+A卡=5，非9）', bData.accounts.length === 5, bData.accounts.length);
    assert('默认账本已去重（仅1个）', bData.ledgers.length === 1, bData.ledgers.length);

    /* === 双向离线新增 → 各设备联网同步 → 应为并集（不互相覆盖） === */
    const txB = S.addTransaction({ ledgerId: S.defaultLedger().id, type: 'income', amount: 80, currency: 'CNY', rate: 1, category: 'salary', accountId: accA.id, date: '2026-09-23' });
    const br = await S.syncNow();                    // B 联网
    assert('B 同步成功', !br.error, JSON.stringify(br.error || {}));

    await use('A');
    const txA2 = S.addTransaction({ ledgerId: S.defaultLedger().id, type: 'expense', amount: 12, currency: 'CNY', rate: 1, category: 'coffee', accountId: accA.id, date: '2026-09-23' });
    const ar = await S.syncNow();                    // A 联网（应先拉 B 的 txB 再上传，不覆盖）
    assert('A 同步成功', !ar.error, JSON.stringify(ar.error || {}));
    let a2 = S.load();
    assert('A 拉到 B 的离线 txB（未被覆盖）', a2.transactions.some((t) => t.id === txB.id));
    assert('A 保留自己的 txA2', a2.transactions.some((t) => t.id === txA2.id));

    await use('B'); await S.pullAndMerge();
    let b2 = S.load();
    assert('B 并集含 txA', b2.transactions.some((t) => t.id === txA.id));
    assert('B 并集含 txA2', b2.transactions.some((t) => t.id === txA2.id));
    assert('B 并集含 txB', b2.transactions.some((t) => t.id === txB.id));
    assert('A/B 交易并集=3', b2.transactions.length === 3, b2.transactions.length);

    /* === 冲突解决（网络版）：A 改 txA=999（updatedAt 更新），B 拉取应取较新 === */
    await use('A'); S.updateTransaction(txA.id, { amount: 999 }); await S.syncNow();
    await use('B'); await S.pullAndMerge();
    const txAFound = S.load().transactions.find((t) => t.id === txA.id);
    assert('B 拉取后 txA=较新值999', txAFound && txAFound.amount === 999, txAFound && txAFound.amount);

    /* === RLS / 未登录：不能读写云端 === */
    await global.SyncHub.signOut();
    const r7 = await S.pullAndMerge();
    assert('未登录 pull 返回未登录', r7.error === '未登录云端', JSON.stringify(r7));
    const r8 = await S.syncNow();
    assert('未登录 push 返回未登录', r8.error === '未登录云端', JSON.stringify(r8));

    console.log('\n========== 端到端结果: ' + pass + ' 通过, ' + fail + ' 失败 ==========');
    process.exit(fail ? 1 : 0);
  } catch (e) { console.error('测试异常:', e); process.exit(2); }
});
