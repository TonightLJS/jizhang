/* 随手记账 —— 云端配置（Supabase）
 * 默认留空。两种方式填写：
 *   1) 部署前直接把下面 supabaseUrl / supabaseAnonKey 填上；
 *   2) 更方便：在 App「我的 → 云端同步 → 配置云端」里填入，会写入本机 localStorage（手机端不用改代码）。
 * Anon Key 是公开的，可安全放在前端；真正的安全靠 Supabase 的 RLS（行级权限，只能读自己的数据）。
 */
(function () {
  'use strict';
  var LS_KEY = 'ledger_cloud_cfg';
  var cfg = { supabaseUrl: '', supabaseAnonKey: '' };
  try {
    var saved = localStorage.getItem(LS_KEY);
    if (saved) cfg = Object.assign(cfg, JSON.parse(saved));
  } catch (e) {}

  window.APP_CONFIG = cfg;

  // 应用内保存配置（写入 localStorage，覆盖上面的默认值）
  window.saveCloudConfig = function (url, key) {
    var c = {
      supabaseUrl: (url || '').trim(),
      supabaseAnonKey: (key || '').trim()
    };
    try { localStorage.setItem(LS_KEY, JSON.stringify(c)); } catch (e) {}
    window.APP_CONFIG = c;
    return c;
  };
  window.loadCloudConfig = function () { return window.APP_CONFIG; };
})();
