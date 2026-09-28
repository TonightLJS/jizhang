/* 类别管理回归测试：数据层（增删改排序 + 墓碑）+ 云端合并 + UI 全链路
 *
 * 覆盖的线上 bug：
 *   1) 只能新增一个 / 删除其他类别后新增的也消失
 *      —— 根因：sync.mergeData 里 categories 是 `cloud.categories || local.categories`，
 *         云端整份覆盖本地，任何本地增删都会被云端旧副本冲掉。已改为逐条 merge + 墓碑。
 *   2) 无法自定义顺序 —— 新增 order 字段 + moveCategory/reorderCategories + UI ↑↓。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('C:/Users/lujia/.workbuddy/binaries/node/workspace/node_modules/jsdom');

const ROOT = 'C:/Users/lujia/WorkBuddy/2026-09-23-15-46-47';
let pass = 0, fail = 0;
const fails = [];
function a(name, cond, extra) {
  console.log((cond ? 'PASS' : 'FAIL') + ' · ' + name + (extra != null ? '  [' + extra + ']' : ''));
  cond ? pass++ : fail++;
  if (!cond) fails.push(name);
}
const KEY = 'ledger_data_v1';
const rawData = () => JSON.parse(window.localStorage.getItem(KEY) || '{}');

/* ==================== 第一部分：数据层 + 云端合并（无 DOM） ==================== */
console.log('--- 数据层 & 云端合并 ---');
{
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://x.test/', pretendToBeVisual: true });
  const { window } = dom;
  global.window = window; global.document = window.document; global.localStorage = window.localStorage;
  window.localStorage.clear();
  window.eval(fs.readFileSync(path.join(ROOT, 'assets/sync.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(ROOT, 'assets/store.js'), 'utf8'));
  const S = window.Store, H = window.SyncHub;
  S.ensureSeed();

  // --- 1) 新增：可以连续新增多个，且都持久化 ---
  const k1 = S.addCategory('expense', { name: '咖啡', emoji: '☕' });
  const k2 = S.addCategory('expense', { name: '健身', emoji: '🍺' });
  const k3 = S.addCategory('expense', { name: '宠物粮', emoji: '⛽' });
  a('连续新增 3 个后总数 = 15', S.getCategories('expense').length === 15, S.getCategories('expense').length);
  a('3 个自定义类别都在', ['咖啡', '健身', '宠物粮'].every((n) => S.getCategories('expense').some((c) => c.name === n)));
  a('新增返回的 key 不重复', new Set([k1, k2, k3]).size === 3);
  a('新增项排在末尾', S.getCategories('expense').slice(12).map((c) => c.name).join(',') === '咖啡,健身,宠物粮', S.getCategories('expense').slice(12).map((c) => c.name).join(','));
  a('新增项都带 order/updatedAt', S.getCategories('expense').slice(12).every((c) => typeof c.order === 'number' && c.updatedAt != null));
  a('新增已落盘', rawData().categories.expense.length === 15, rawData().categories.expense.length);

  // --- 2) 修改 ---
  S.updateCategory('expense', k1, { name: '手冲咖啡' });
  a('改名生效', S.catMeta('expense', k1).name === '手冲咖啡', S.catMeta('expense', k1).name);
  // 把 updatedAt 压到一个明确的旧值，再改一次，验证确实被刷新（避免同毫秒比较的偶然性）
  {
    const d0 = rawData();
    d0.categories.expense.find((c) => c.key === k1).updatedAt = 1;
    window.localStorage.setItem(KEY, JSON.stringify(d0));
  }
  S.updateCategory('expense', k1, { emoji: '🍵' });
  a('改图标生效', S.catMeta('expense', k1).emoji === '🍵', S.catMeta('expense', k1).emoji);
  a('修改会刷新 updatedAt', S.catMeta('expense', k1).updatedAt > 1000, S.catMeta('expense', k1).updatedAt);

  // --- 3) 排序 ---
  const names = () => S.getCategories('expense').map((c) => c.name).join(',');
  a('初始顺序：餐饮在前', S.getCategories('expense')[0].name === '餐饮', names());
  S.moveCategory('expense', 'food', 1);
  a('下移「餐饮」一位', S.getCategories('expense')[1].name === '餐饮', names());
  S.moveCategory('expense', 'food', -1);
  a('再上移回来', S.getCategories('expense')[0].name === '餐饮', names());
  a('已在首位时上移返回 false', S.moveCategory('expense', 'food', -1) === false);
  const lastKey = S.getCategories('expense')[14].key;
  a('已在末位时下移返回 false', S.moveCategory('expense', lastKey, 1) === false);
  a('不存在的 key 返回 false', S.moveCategory('expense', 'nope', -1) === false);

  S.reorderCategories('expense', ['other_exp', 'food', 'transport']);
  a('reorderCategories 把「其他」放首位', S.getCategories('expense')[0].key === 'other_exp', names());
  a('reorder 后未列出的项保留在后', S.getCategories('expense').slice(3).every((c) => ['other_exp', 'food', 'transport'].indexOf(c.key) < 0));
  a('顺序已落盘（order 连续）', rawData().categories.expense.filter((c) => !c.deleted).map((c) => c.order).sort((x, y) => x - y).join(',') === Array.from({ length: 15 }, (_, i) => i).join(','));

  // --- 4) 删除 = 墓碑 ---
  S.deleteCategory('expense', 'fun');
  a('删除后 getCategories 不含它', !S.getCategories('expense').some((c) => c.key === 'fun'));
  a('删除后总数 14', S.getCategories('expense').length === 14, S.getCategories('expense').length);
  a('raw 里仍保留（墓碑）', rawData().categories.expense.some((c) => c.key === 'fun' && c.deleted === true));
  a('墓碑带 deletedAt', !!rawData().categories.expense.find((c) => c.key === 'fun').deletedAt);
  a('catMeta 仍能取到已删类别的原名', S.catMeta('expense', 'fun').name === '娱乐', S.catMeta('expense', 'fun').name);
  a('未知 key 回退为「其他」', S.catMeta('expense', 'zzz').name === '其他');
  S.deleteCategory('expense', 'medical');
  a('删第二个也不影响自定义类别', S.getCategories('expense').filter((c) => c.key.startsWith('c_')).length === 3);
  a('删不存在的 key 返回 false', S.deleteCategory('expense', 'nope') === false);

  // --- 5) 云端合并：这是 bug 的核心 ---
  // 此刻：15 条原始类别，其中 2 条已打墓碑（fun/medical）→ 有效 13 条
  const ALIVE = S.getCategories('expense').length;
  a('删除两条后有效类别 = 13', ALIVE === 13, ALIVE);
  const local = S.load();
  const cloudStale = JSON.parse(JSON.stringify(local));
  // 云端旧副本：没有 3 个自定义类别，且「娱乐/医疗」还活着
  cloudStale.categories.expense = cloudStale.categories.expense.filter(
    (c) => !c.key.startsWith('c_') && ['fun', 'medical'].indexOf(c.key) < 0
  ).concat([
    { key: 'fun', name: '娱乐', emoji: '🎮', order: 4, updatedAt: 0 },
    { key: 'medical', name: '医疗', emoji: '💊', order: 5, updatedAt: 0 }
  ]);

  const merged = H.mergeData(local, cloudStale);
  const mA = merged.categories.expense.filter((c) => !c.deleted);
  a('合并后 3 个自定义类别都还在', ['手冲咖啡', '健身', '宠物粮'].every((n) => mA.some((c) => c.name === n)), mA.map((c) => c.name).join(','));
  a('合并后不会丢成云端旧副本', mA.length === ALIVE, mA.length + ' vs ' + ALIVE);
  a('合并后已删的「娱乐」没有复活', !mA.some((c) => c.key === 'fun'));
  a('合并后已删的「医疗」没有复活', !mA.some((c) => c.key === 'medical'));
  a('合并后顺序与本地一致', mA.map((c) => c.key).join(',') === S.getCategories('expense').map((c) => c.key).join(','));
  a('mergeData(null 云端) 返回本地', H.mergeData(local, null) === local);
  {
    // 云端缺 categories 字段时应原样沿用本地
    const r = H.mergeData(local, { transactions: [] });
    a('云端缺 categories 时沿用本地', r.categories.expense.filter((c) => !c.deleted).length === ALIVE, r.categories.expense.filter((c) => !c.deleted).length);
  }

  // --- 6) 墓碑只留在本地，不随推送外泄（与其它实体一致） ---
  a('本地仍保留墓碑（用于压过云端旧副本）', rawData().categories.expense.filter((c) => c.deleted).length === 2, rawData().categories.expense.filter((c) => c.deleted).length);
  a('本地有效项 = 13', rawData().categories.expense.filter((c) => !c.deleted).length === ALIVE, rawData().categories.expense.filter((c) => !c.deleted).length);

  // --- 7) normalize 给老数据补 order/updatedAt ---
  {
    const d = rawData();
    d.categories.expense.forEach((c) => { delete c.order; delete c.updatedAt; });
    window.localStorage.setItem(KEY, JSON.stringify(d));
    S.normalize();
    const after = rawData().categories.expense;
    a('normalize 补上 order', after.every((c) => typeof c.order === 'number'));
    a('normalize 补上 updatedAt', after.every((c) => c.updatedAt != null));
    a('补的 order 保序（0..n-1）', after.map((c) => c.order).sort((x, y) => x - y).join(',') === after.map((_, i) => i).join(','));
    a('老数据升级后 getCategories 仍正常', S.getCategories('expense').length === ALIVE, S.getCategories('expense').length);
  }

  // --- 8) 收入类别同样可排序 ---
  S.addCategory('income', { name: '稿费', emoji: '✍️' });
  a('收入类别可新增', S.getCategories('income').length === 7, S.getCategories('income').length);
  a('收入新增项在末尾', S.getCategories('income')[6].name === '稿费', S.getCategories('income').map((c) => c.name).join(','));
  const incFirst = S.getCategories('income')[0].key;
  S.moveCategory('income', incFirst, 1);
  a('收入类别可下移', S.getCategories('income')[1].key === incFirst, S.getCategories('income').map((c) => c.name).join(','));
  a('income 操作不影响 expense', S.getCategories('expense').length === ALIVE, S.getCategories('expense').length);
  a('expense 的墓碑不泄漏到 income', !rawData().categories.income.some((c) => c.deleted));
}

/* ==================== 第二部分：UI 全链路（真实 index.html + app.js） ==================== */
console.log('\n--- UI 全链路 ---');
{
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://example.test/' });
  const { window } = dom;
  global.window = window; global.document = window.document; global.localStorage = window.localStorage;
  window.localStorage.clear();
  for (const f of ['assets/config.js', 'assets/sync.js', 'assets/store.js', 'assets/charts.js', 'assets/app.js']) {
    window.eval(fs.readFileSync(path.join(ROOT, f), 'utf8'));
  }
  const S = window.Store;
  const $ = (s) => window.document.querySelector(s);
  const $$ = (s) => Array.from(window.document.querySelectorAll(s));
  const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  const input = (el, v) => { el.value = v; el.dispatchEvent(new window.Event('input', { bubbles: true })); };

  window.document.dispatchEvent(new window.Event('DOMContentLoaded', { bubbles: true }));
  S.ensureSeed();
  click($('.tab-item[data-view="me"]'));

  const rows = () => $$('#catExp .cat-row').map((r) => r.querySelector('.cat-row-name').textContent);
  const addCat = (name, emojiIdx) => {
    click($('#catExp [data-add]'));
    input($('#cName'), name);
    const cells = $$('#cEmojis .cat-cell');
    if (emojiIdx != null && cells[emojiIdx]) click(cells[emojiIdx]);
    click($('#cSave'));
  };

  a('UI：渲染成列表', $$('#catExp .cat-row').length === 12, $$('#catExp .cat-row').length);
  a('UI：每行 4 个操作按钮', $$('#catExp .cat-row')[0].querySelectorAll('.icon-btn').length === 4);
  a('UI：首行 ↑ 禁用', $$('#catExp .cat-row')[0].querySelector('[data-up]').disabled === true);
  a('UI：末行 ↓ 禁用', $$('#catExp .cat-row')[11].querySelector('[data-down]').disabled === true);
  a('UI：有「添加类别」按钮', !!$('#catExp [data-add]'));

  addCat('咖啡', 18); addCat('健身', 19); addCat('宠物粮', 20);
  a('UI：连加 3 个 → 15 行', rows().length === 15, rows().length);
  a('UI：3 个自定义都在', ['咖啡', '健身', '宠物粮'].every((n) => rows().includes(n)), rows().join(','));

  const k = S.getCategories('expense').find((c) => c.name === '宠物粮').key;
  a('UI：宠物粮起始在第 15 位', rows().indexOf('宠物粮') === 14, rows().indexOf('宠物粮') + 1);
  click($(`#catExp [data-up="${k}"]`));
  a('UI：一次上移只走一格（无重复触发）', rows().indexOf('宠物粮') === 13, rows().indexOf('宠物粮') + 1);
  click($(`#catExp [data-up="${k}"]`));
  a('UI：两次上移到第 13 位', rows().indexOf('宠物粮') === 12, rows().indexOf('宠物粮') + 1);
  click($(`#catExp [data-down="${k}"]`));
  a('UI：下移回第 14 位', rows().indexOf('宠物粮') === 13, rows().indexOf('宠物粮') + 1);

  const ok = S.getCategories('expense').find((c) => c.name === '其他').key;
  for (let i = 0; i < 14; i++) { const b = $(`#catExp [data-up="${ok}"]`); if (b && !b.disabled) click(b); }
  a('UI：「其他」可一路移到首位', rows()[0] === '其他', rows().slice(0, 3).join(','));
  a('UI：落盘顺序与界面一致', rawData().categories.expense.filter((c) => !c.deleted).sort((x, y) => x.order - y.order).map((c) => c.name).join(',') === rows().join(','));

  // 删除走二次确认
  click($('#catExp [data-del="fun"]'));
  a('UI：删除弹二次确认', !!$('#cfYes'));
  click($('#cfYes'));
  a('UI：确认后「娱乐」移除', !rows().includes('娱乐'), rows().join(','));
  a('UI：删完自定义类别仍在', ['咖啡', '健身', '宠物粮'].every((n) => rows().includes(n)));
  click($('#catExp [data-del="medical"]'));
  click($('#cfYes'));
  a('UI：连续删除后自定义类别仍都在', rows().filter((n) => ['咖啡', '健身', '宠物粮'].includes(n)).length === 3, rows().join(','));
  a('UI：删除是墓碑', rawData().categories.expense.some((c) => c.key === 'fun' && c.deleted));

  // 编辑
  const ck = S.getCategories('expense').find((c) => c.name === '咖啡').key;
  click($(`#catExp [data-edit="${ck}"]`));
  a('UI：编辑抽屉回显原名', $('#cName').value === '咖啡', $('#cName').value);
  input($('#cName'), '手冲咖啡');
  click($('#cSave'));
  a('UI：编辑后改名生效', rows().includes('手冲咖啡'), rows().join(','));

  // 网格跟随
  const mgrOrder = rows().slice();
  click($('.tab-item[data-view="record"]'));
  click($('.tab-item.tab-add'));
  const grid = $$('#catGrid .cat-cell').map((c) => c.querySelector('.name').textContent);
  a('UI：记账页分类网格顺序 == 管理页', grid.join(',') === mgrOrder.join(','), grid.join(','));
  a('UI：网格含新增类别', ['手冲咖啡', '健身', '宠物粮'].every((n) => grid.includes(n)), grid.join(','));
  a('UI：网格不含已删类别', !grid.includes('娱乐') && !grid.includes('医疗'), grid.join(','));

  // 已删类别的历史账单仍显示原名
  const led = S.defaultLedger();
  const cash = S.listAccounts().find((x) => x.name === '现金');
  const tx = S.addTransaction({ ledgerId: led.id, type: 'expense', amount: 60, currency: 'CNY', rate: 1, category: 'fun', accountId: cash.id, date: '2026-09-25', note: '电影' });
  click($('.tab-item[data-view="record"]'));
  a('UI：已删类别的历史账单仍显示「娱乐」', /娱乐/.test($('#txList').textContent) && !/其他/.test($('#txList').textContent), $('#txList').textContent.slice(0, 60));
  // 编辑该笔时不会崩（类别已删）
  click($(`.tx-item[data-id="${tx.id}"]`));
  click($('#axEdit'));
  a('UI：编辑已删类别的账单不报错', !!$('#fAmount'), $('#fAmount') && $('#fAmount').value);
}

console.log('\n========== 类别管理: ' + pass + ' 通过, ' + fail + ' 失败 ==========');
if (fail) console.log('失败项:\n  - ' + fails.join('\n  - '));
process.exit(fail ? 1 : 0);
