/* 随手记账 —— 云端同步层（Supabase 免费层即可）
 *
 * 设计：本地 localStorage 仍是唯一真源（保证离线、iPhone PWA 体验不变）；
 * 云端只做镜像 + 多设备同步。每张表以「整个 data JSON」存一行：
 *   ledger_sync(user_id PK, data jsonb, updated_at)
 * 同步策略：按 id 并集合并（冲突取 updatedAt 较新者），因此多设备各自离线编辑也不会互相覆盖。
 * 登录：Supabase Auth 邮箱 + 密码（同一邮箱在多设备登录即自动同步）。
 */
(function () {
  'use strict';

  var META_KEY = 'ledger_sync_meta';
  var client = null;
  var currentSession = null;
  var authListeners = [];

  function cfg() { return (typeof window !== 'undefined' && window.APP_CONFIG) || {}; }
  function isConfigured() { var c = cfg(); return !!(c.supabaseUrl && c.supabaseAnonKey); }

  function init() {
    if (client) return client;
    if (!isConfigured()) return null;
    if (typeof window === 'undefined' || !window.supabase || !window.supabase.createClient) {
      console.warn('[sync] Supabase SDK 未加载，云端同步不可用（不影响本地使用）');
      return null;
    }
    try {
      client = window.supabase.createClient(cfg().supabaseUrl, cfg().supabaseAnonKey, {
        auth: { persistSession: true, autoRefreshToken: true }
      });
      if (client.auth && client.auth.onAuthStateChange) {
        client.auth.onAuthStateChange(function (_event, sess) { setSession(sess); });
      }
    } catch (e) { console.warn('[sync] 创建客户端失败', e); client = null; }
    return client;
  }

  function setSession(sess) {
    currentSession = sess || null;
    authListeners.forEach(function (fn) { try { fn(currentSession); } catch (e) {} });
  }
  function onAuthChange(cb) { if (cb) authListeners.push(cb); }
  function isSignedIn() { return !!(currentSession && currentSession.user); }
  function currentUser() { return (currentSession && currentSession.user) || null; }

  async function getSession() {
    if (!client) init();
    if (!client) return null;
    try {
      var res = await client.auth.getSession();
      setSession((res.data && res.data.session) || null);
      return currentSession;
    } catch (e) { return null; }
  }

  async function signUp(email, password) {
    if (!init()) return { error: '未配置云端' };
    var res = await client.auth.signUp({ email: email, password: password });
    if (res.error) return { error: res.error.message };
    setSession(res.data.session || null);
    return { user: res.data.user, session: res.data.session };
  }
  async function signIn(email, password) {
    if (!init()) return { error: '未配置云端' };
    var res = await client.auth.signInWithPassword({ email: email, password: password });
    if (res.error) return { error: res.error.message };
    setSession(res.data.session || null);
    return { user: res.data.user, session: res.data.session };
  }
  async function signOut() {
    if (!client) return;
    try { await client.auth.signOut(); } catch (e) {}
    setSession(null);
  }

  async function push(dataObj) {
    if (!client || !isSignedIn()) return { error: '未登录' };
    var uid = currentSession.user.id;
    var now = new Date().toISOString();
    var res = await client
      .from('ledger_sync')
      .upsert({ user_id: uid, data: dataObj, updated_at: now }, { onConflict: 'user_id' });
    if (res.error) return { error: res.error.message };
    return { updated_at: now };
  }
  async function pull() {
    if (!client || !isSignedIn()) return { error: '未登录' };
    var uid = currentSession.user.id;
    var res = await client
      .from('ledger_sync')
      .select('data, updated_at')
      .eq('user_id', uid)
      .maybeSingle();
    if (res.error) return { error: res.error.message };
    if (!res.data) return { data: null, updated_at: null };
    return { data: res.data.data, updated_at: res.data.updated_at };
  }

  function markSynced(ts) {
    try {
      var prev = JSON.parse(localStorage.getItem(META_KEY) || '{}');
      localStorage.setItem(META_KEY, JSON.stringify(Object.assign({}, prev, { at: ts || new Date().toISOString() })));
    } catch (e) {}
    try { return JSON.parse(localStorage.getItem(META_KEY) || '{}'); } catch (e) { return {}; }
  }

  // ---- 合并：按 id 并集，冲突取 updatedAt 较新者 ----
  // 墓碑（deleted:true）与普通记录同等参与「取较新」比较：
  //   · 一台设备删除了某条 → 它带走更新的 updatedAt，合并后仍为「已删除」，删除得以传播，旧副本不会复活
  //   · 若另一台设备在删除后又编辑过同一条（updatedAt 更新且未标删除），则编辑胜出（复活）
  function updatedAtOf(x) { return x.updatedAt || x.deletedAt || x.createdAt || 0; }
  function touch(arr) {
    return (arr || []).map(function (x) {
      return Object.assign({}, x, { updatedAt: updatedAtOf(x) });
    });
  }
  function mergeArray(localArr, cloudArr) {
    var map = {};
    touch(localArr).forEach(function (x) { map[x.id] = x; });
    touch(cloudArr).forEach(function (x) {
      var ex = map[x.id];
      if (!ex) map[x.id] = x;
      else if ((x.updatedAt || 0) > (ex.updatedAt || 0)) map[x.id] = x;
      // 相等 → 保留本地（ex），更安全
    });
    return Object.keys(map).map(function (k) { return map[k]; });
  }
  function mergeData(local, cloud) {
    if (!cloud) return local;
    return {
      transactions: mergeArray(local.transactions, cloud.transactions),
      splits: mergeArray(local.splits, cloud.splits),
      ledgers: mergeArray(local.ledgers, cloud.ledgers),
      clears: mergeArray(local.clears, cloud.clears),
      accounts: mergeArray(local.accounts, cloud.accounts),
      categories: cloud.categories || local.categories,
      settings: Object.assign({}, cloud.settings || {}, local.settings || {})
    };
  }

  window.SyncHub = {
    init: init,
    isConfigured: isConfigured,
    isSignedIn: isSignedIn,
    currentUser: currentUser,
    getSession: getSession,
    onAuthChange: onAuthChange,
    signUp: signUp,
    signIn: signIn,
    signOut: signOut,
    push: push,
    pull: pull,
    markSynced: markSynced,
    mergeData: mergeData
  };
})();
