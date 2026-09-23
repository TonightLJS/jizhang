/* 随手记账 —— 主逻辑（账本 / 货币汇率 / 优惠 / 预算 / 关联分账） */
(function () {
  'use strict';

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));
  const S = window.Store;
  const C = window.Charts;
  const SELF = '老剑圣'; // 本人默认成员
  const unique = (arr) => arr.filter((v, i) => arr.indexOf(v) === i);

  let currentView = 'record';
  let currentLedgerId = null;
  let statMonth = S.nowDate().slice(0, 7);

  /* ---------------- 工具 ---------------- */
  function money(n) { return (Number(n) || 0).toFixed(2); }
  function fmtMoney(amount, code) {
    const m = S.currencyMeta(code || 'CNY');
    return m.sym + money(amount);
  }
  function toast(msg) {
    let t = $('#toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; document.body.appendChild(t); }
    t.textContent = msg; t.classList.add('show');
    clearTimeout(t._timer); t._timer = setTimeout(() => t.classList.remove('show'), 1600);
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }
  function on(root, sel, ev, fn) { $$(sel, root).forEach((e) => e.addEventListener(ev, fn)); }
  function fmtDate(d) {
    const t = new Date(d + 'T00:00:00');
    const wk = ['日', '一', '二', '三', '四', '五', '六'][t.getDay()];
    return `${t.getMonth() + 1}月${t.getDate()}日 周${wk}`;
  }
  // 日期 + 时间（时间缺失时只显示日期）
  function fmtDateTime(d, time) {
    return time ? `${fmtDate(d)} ${time}` : fmtDate(d);
  }
  // 明细行右侧的紧凑时间戳（今天显示「今天 14:30」，今年显示「9/23 14:30」）
  function fmtStamp(date, time) {
    if (!time) return '';
    const today = S.nowDate();
    if (date === today) return time;
    const parts = String(date || '').split('-');
    if (parts.length === 3) return `${+parts[1]}/${+parts[2]} ${time}`;
    return time;
  }
  // 明细行尾部的灰色时间戳（无时间则不渲染）
  function stampHTML(t) {
    const s = fmtStamp(t.date, S.txTime(t));
    return s ? ` <span class="tx-time">${esc(s)}</span>` : '';
  }
  function ledgerChipHTML(led) {
    if (!led) return '';
    return `<div class="ledger-chip" id="ledgerChip">
      <span class="lc-icon" style="background:${led.color}">${led.icon}</span>
      <b>${esc(led.name)}</b>
      <span class="muted">${led.baseCurrency}</span>
      <span class="lc-caret">▾</span>
    </div>`;
  }

  // 付款方式下拉（含「新增」入口，全局通用）
  function accountOpts(selectedId) {
    const accs = S.listAccounts();
    const opts = accs.map((a) =>
      `<option value="${a.id}" ${a.id === selectedId ? 'selected' : ''}>${a.icon} ${esc(a.name)}</option>`
    ).join('');
    return opts + `<option value="__new__">＋ 新增付款方式…</option>`;
  }
  function txAccountName(t) {
    if (t.accountId) { const a = S.accountById(t.accountId); if (a) return a.name; }
    return t.account || '';
  }

  /* ---------------- 通用抽屉 ---------------- */
  function openSheet(html, onMount) {
    const body = $('#sheetBody');
    body.innerHTML = html;
    $('#sheetMask').hidden = false;
    $('#recordSheet').hidden = false;
    if (onMount) onMount(body);
  }
  function closeSheet() {
    $('#sheetMask').hidden = true;
    $('#recordSheet').hidden = true;
  }
  // 二次确认抽屉（比 window.confirm 更适配 iOS，且可自定义按钮文案）
  function confirmSheet(opts, onYes) {
    openSheet(`
      <div class="sheet-handle"></div>
      <div class="confirm-box">
        <div class="confirm-title">${esc(opts.title || '确认操作')}</div>
        ${opts.desc ? `<div class="confirm-desc">${opts.desc}</div>` : ''}
      </div>
      <div class="btn-row" style="margin-top:16px">
        <button class="btn secondary" id="cfNo">${esc(opts.cancelText || '取消')}</button>
        <button class="btn ${opts.danger ? 'danger' : ''}" id="cfYes">${esc(opts.okText || '确定')}</button>
      </div>
    `, (body) => {
      $('#cfNo', body).addEventListener('click', closeSheet);
      $('#cfYes', body).addEventListener('click', () => { closeSheet(); onYes(); });
    });
  }

  /* ---------------- 路由 ---------------- */
  function go(view) {
    if (view === 'add') { openRecordSheet(null); return; }
    currentView = view;
    $$('.tab-item').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
    $('#headerTitle').textContent = $('.tab-item[data-view="' + view + '"]').dataset.label || '记账';
    const main = $('#appMain');
    if (view === 'record') renderRecord(main);
    else if (view === 'split') renderSplit(main);
    else if (view === 'stats') renderStats(main);
    else if (view === 'me') renderMe(main);
    main.scrollTop = 0;
  }

  /* ---------------- 账本选择 / 管理 ---------------- */
  function openLedgerPicker(cb) {
    const ls = S.listLedgers();
    const cur = currentLedgerId;
    openSheet(`
      <div class="sheet-handle"></div>
      <div class="section-title">选择账本</div>
      <div id="ledgerPick"></div>
      <button class="btn secondary" id="newLedgerFromPick" style="margin-top:12px">＋ 新建账本</button>
    `, (body) => {
      const box = $('#ledgerPick', body);
      box.innerHTML = ls.map((l) => `
        <div class="ledger-row ${l.id === cur ? 'on' : ''}" data-id="${l.id}">
          <span class="lc-icon" style="background:${l.color}">${l.icon}</span>
          <div class="lr-mid"><b>${esc(l.name)}</b><span class="muted">${l.baseCurrency}${l.isDefault ? ' · 默认' : ''}${l.startDate ? ' · ' + l.startDate + '~' + l.endDate : ''}</span></div>
          ${l.id === cur ? '<span class="lr-check">✓</span>' : ''}
        </div>`).join('');
      on(box, '.ledger-row', 'click', (e) => {
        const id = e.currentTarget.dataset.id;
        closeSheet();
        cb(id);
      });
      $('#newLedgerFromPick', body).addEventListener('click', () => {
        closeSheet();
        openLedgerEditor(null);
      });
    });
  }

  function openLedgerManager() {
    function draw() {
      const ls = S.listLedgers();
      openSheet(`
        <div class="sheet-handle"></div>
        <div class="card-row"><div class="section-title" style="margin:0">账本管理</div><button class="btn secondary" id="mgrNew" style="width:auto;padding:8px 14px">＋ 新建</button></div>
        <div id="mgrList" style="margin-top:8px"></div>
      `, (body) => {
        const list = $('#mgrList', body);
        list.innerHTML = ls.map((l) => `
          <div class="ledger-row">
            <span class="lc-icon" style="background:${l.color}">${l.icon}</span>
            <div class="lr-mid"><b>${esc(l.name)}</b><span class="muted">${l.baseCurrency}${l.isDefault ? ' · 默认' : ''}${l.startDate ? ' · ' + l.startDate + '~' + l.endDate : ''}</span></div>
            <button class="btn secondary lr-edit" data-edit="${l.id}" style="width:auto;padding:6px 12px;font-size:13px">编辑</button>
            <button class="btn danger lr-del" data-del="${l.id}" ${l.isDefault ? 'disabled style="opacity:.4"' : ''} style="width:auto;padding:6px 12px;font-size:13px">删除</button>
          </div>`).join('');
        on(list, '[data-edit]', 'click', (e) => { closeSheet(); openLedgerEditor(e.currentTarget.dataset.edit); });
        on(list, '[data-del]', 'click', (e) => {
          const id = e.currentTarget.dataset.del;
          confirmSheet({ title: '删除该账本？', desc: '其下交易会移回默认账本。', okText: '删除', danger: true }, () => {
            if (S.deleteLedger(id)) { toast('已删除'); if (currentLedgerId === id) currentLedgerId = S.defaultLedger().id; draw(); }
            else toast('默认账本不可删');
          });
        });
        $('#mgrNew', body).addEventListener('click', () => { closeSheet(); openLedgerEditor(null); });
      });
    }
    draw();
  }

  function openLedgerEditor(id) {
    const led = id ? S.ledgerById(id) : null;
    const state = {
      icon: led ? led.icon : '✈️',
      color: led ? led.color : '#007aff',
      currency: led ? led.currency : 'CNY',
      baseCurrency: led ? led.baseCurrency : 'CNY',
      isDefault: led ? led.isDefault : false,
      companions: led ? led.companions.slice() : []
    };
    openSheet(`
      <div class="sheet-handle"></div>
      <div class="field"><label>账本名称</label><input class="input" id="lName" placeholder="如：日本旅游" value="${led ? esc(led.name) : ''}" /></div>
      <div class="field"><label>图标</label><div class="cat-grid" id="lIcons">${S.LEDGER_ICONS.map((ic) => `<div class="cat-cell ${ic === state.icon ? 'active' : ''}" data-ic="${ic}"><span class="emoji">${ic}</span></div>`).join('')}</div></div>
      <div class="field"><label>颜色</label><div class="color-row" id="lColors">${S.LEDGER_COLORS.map((c) => `<span class="color-dot ${c === state.color ? 'on' : ''}" data-c="${c}" style="background:${c}"></span>`).join('')}</div></div>
      <div class="field"><label>起始日期（旅游账本可选，期间开销自动归入）</label><input class="input" id="lStart" type="date" value="${led && led.startDate ? led.startDate : ''}" /></div>
      <div class="field"><label>结束日期</label><input class="input" id="lEnd" type="date" value="${led && led.endDate ? led.endDate : ''}" /></div>
      <div class="field"><label>默认记账货币</label><select class="select" id="lCur">${S.CURRENCIES.map((c) => `<option value="${c.code}" ${c.code === state.currency ? 'selected' : ''}>${c.code} ${c.name}</option>`).join('')}</select></div>
      <div class="field"><label>基准货币（统计换算目标）</label><select class="select" id="lBase">${S.CURRENCIES.map((c) => `<option value="${c.code}" ${c.code === state.baseCurrency ? 'selected' : ''}>${c.code} ${c.name}</option>`).join('')}</select></div>
      <div class="field"><label>预算（基准货币，可选）</label><input class="input" id="lBudget" type="number" inputmode="decimal" placeholder="如 10000" value="${led && led.budget != null ? led.budget : ''}" /></div>
      <div class="field">
        <label>同行人 / 成员（用于快捷分账，自动带入新分账）</label>
        <div class="chips" id="lCompanions"></div>
        <div class="card-row" style="margin-top:6px">
          <input class="input" id="lCompanionInput" placeholder="输入姓名后点添加" style="flex:1"/>
          <button class="btn secondary" id="lCompanionAdd" style="width:auto;padding:10px 14px;margin-left:8px">添加</button>
        </div>
      </div>
      <div class="field"><label class="chk"><input type="checkbox" id="lDefault" ${state.isDefault ? 'checked' : ''}/> 设为默认账本</label></div>
      <div class="btn-row">
        <button class="btn secondary" id="lCancel">取消</button>
        <button class="btn" id="lSave">${led ? '保存' : '创建'}</button>
      </div>
    `, (body) => {
      on(body, '#lIcons .cat-cell', 'click', (e) => {
        state.icon = e.currentTarget.dataset.ic;
        $$('#lIcons .cat-cell', body).forEach((c) => c.classList.toggle('active', c.dataset.ic === state.icon));
      });
      on(body, '#lColors .color-dot', 'click', (e) => {
        state.color = e.currentTarget.dataset.c;
        $$('#lColors .color-dot', body).forEach((c) => c.classList.toggle('on', c.dataset.c === state.color));
      });
      $('#lCur', body).addEventListener('change', (e) => (state.currency = e.target.value));
      $('#lBase', body).addEventListener('change', (e) => (state.baseCurrency = e.target.value));
      // 同行人编辑
      const compBox = $('#lCompanions', body);
      function renderCompanions() {
        compBox.innerHTML = state.companions.map((n, i) =>
          `<span class="chip" data-i="${i}">${esc(n)} <span class="chip-x" data-x="${i}">✕</span></span>`).join('')
          || '<span class="muted">暂无，添加同行人后分账可一键带入</span>';
        $$('[data-x]', compBox).forEach((b) => b.addEventListener('click', (e) => {
          e.stopPropagation();
          state.companions.splice(+e.currentTarget.dataset.x, 1);
          renderCompanions();
        }));
      }
      renderCompanions();
      $('#lCompanionAdd', body).addEventListener('click', () => {
        const v = $('#lCompanionInput', body).value.trim();
        if (!v) return;
        if (!state.companions.includes(v)) state.companions.push(v);
        $('#lCompanionInput', body).value = '';
        renderCompanions();
      });
      $('#lCompanionInput', body).addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#lCompanionAdd', body).click(); } });
      $('#lCancel', body).addEventListener('click', closeSheet);
      $('#lSave', body).addEventListener('click', () => {
        const name = $('#lName', body).value.trim();
        if (!name) { toast('请填写名称'); return; }
        const start = $('#lStart', body).value || null;
        const end = $('#lEnd', body).value || null;
        const patch = {
          name, icon: state.icon, color: state.color,
          startDate: start, endDate: end,
          currency: state.currency, baseCurrency: state.baseCurrency,
          budget: $('#lBudget', body).value,
          companions: state.companions
        };
        if (led) {
          S.updateLedger(led.id, patch);
          if ($('#lDefault', body).checked) S.setDefaultLedger(led.id);
          toast('已保存');
        } else {
          const nl = S.addLedger(patch);
          if ($('#lDefault', body).checked) S.setDefaultLedger(nl.id);
          toast('已创建');
          currentLedgerId = nl.id;
        }
        closeSheet();
        if (currentView === 'record') renderRecord($('#appMain'));
        else if (currentView === 'stats') renderStats($('#appMain'));
        else if (currentView === 'me') renderMe($('#appMain'));
      });
    });
  }

  /* ---------------- 记账视图 ---------------- */
  function renderRecord(main) {
    const led = S.ledgerById(currentLedgerId) || S.defaultLedger();
    currentLedgerId = led.id;
    const base = led.baseCurrency;
    const month = S.nowDate().slice(0, 7);
    const sum = S.monthRange(led.id, month);
    main.innerHTML = `
      ${ledgerChipHTML(led)}
      <div class="card">
        <div class="card-row"><span class="muted">本月（${month}）· ${base}</span></div>
        <div class="big-amount amount-expense">支出 ${fmtMoney(sum.expense, base)}</div>
        <div class="card-row" style="margin-top:6px">
          <span class="muted">收入 ${fmtMoney(sum.income, base)}</span>
          <span class="muted">结余 ${fmtMoney(sum.net, base)}</span>
        </div>
        ${sum.discount > 0 ? `<div class="muted" style="margin-top:4px">本月累计优惠 ${fmtMoney(sum.discount, base)}</div>` : ''}
      </div>
      <div class="card" style="padding:10px 16px"><button class="btn secondary" id="transferBtn" style="width:100%">💸 账户间转账</button></div>
      <div class="section-title">明细（${esc(led.name)}）</div>
      <div class="card" style="padding:6px 16px"><div id="txList" class="tx-list"></div></div>
    `;
    $('#ledgerChip').addEventListener('click', () =>
      openLedgerPicker((id) => { currentLedgerId = id; renderRecord($('#appMain')); })
    );
    $('#transferBtn').addEventListener('click', () => openTransferSheet(null));
    renderTxList($('#txList'), S.load().transactions.filter((t) => !S.isDeleted(t) && S.belongsToLedger(t, led.id)));
  }

  function renderTxList(box, txs) {
    if (!txs.length) {
      box.innerHTML = `<div class="empty"><div class="big">📭</div>还没有记录，点下方「＋」记一笔吧</div>`;
      return;
    }
    const base = (S.ledgerById(currentLedgerId) || {}).baseCurrency || 'CNY';
    const groups = {};
    txs.forEach((t) => { (groups[t.date] = groups[t.date] || []).push(t); });
    const dates = Object.keys(groups).sort().reverse();
    let html = '';
    dates.forEach((d) => {
      // 同一天内按时间倒序（最新的在最上面，方便回看）
      const list = groups[d].slice().sort((a, b) =>
        S.txSortKey(b).localeCompare(S.txSortKey(a)) || ((b.createdAt || 0) - (a.createdAt || 0)));
      // 退款不计入当日支/收小计（退款行本身已作为负数单独展示，避免重复扣减）
      const dayExp = list.filter((t) => t.type === 'expense').reduce((a, t) => a + S.baseAmount(t), 0);
      const dayInc = list.filter((t) => t.type === 'income').reduce((a, t) => a + S.baseAmount(t), 0);
      html += `<div class="tx-date-head"><span>${fmtDate(d)}</span><span>支 ${fmtMoney(dayExp, base)} · 收 ${fmtMoney(dayInc, base)}</span></div>`;
      list.forEach((t) => {
        const cm = S.currencyMeta(t.currency);
        if (t.type === 'transfer') {
          const from = S.accountById(t.fromId), to = S.accountById(t.toId);
          const cross = t.toCurrency && t.toCurrency !== t.currency;
          const fc = S.currencyMeta(t.currency), tc = S.currencyMeta(t.toCurrency || t.currency);
          html += `
            <div class="tx-item" data-id="${t.id}">
              <div class="tx-emoji">💸</div>
              <div class="tx-mid">
                <div class="tx-cat">转账 ${esc(from ? from.name : '?')} → ${esc(to ? to.name : '?')}${cross ? ' · 跨货币' : ''}</div>
                <div class="tx-note">${esc(t.note || '')}${cross ? ' · ' + esc(t.currency) + '→' + esc(t.toCurrency) : (t.currency ? ' · ' + esc(t.currency) : '')}${stampHTML(t)}</div>
              </div>
              <div class="tx-amt">${fc.sym}${money(t.amount)}<span class="tx-code">${esc(t.currency)}</span>${cross ? ` <span class="muted">→ ${tc.sym}${money(t.toAmount)} ${esc(t.toCurrency)}</span>` : ''}</div>
            </div>`;
          return;
        }
        // 退款行：显示为 ↩️ 负数
        if (t.type === 'refund') {
          html += `
            <div class="tx-item" data-id="${t.id}">
              <div class="tx-emoji">↩️</div>
              <div class="tx-mid">
                <div class="tx-cat">退款 <span class="pill refund">${t.parentType === 'income' ? '收入退回' : '支出退回'}</span></div>
                <div class="tx-note">${esc(txAccountName(t))}${t.note ? ' · ' + esc(t.note) : ''} · ${esc(t.currency)}${stampHTML(t)}</div>
              </div>
              <div class="tx-amt refund">-${cm.sym}${money(t.amount)}<span class="tx-code">${esc(t.currency)}</span></div>
            </div>`;
          return;
        }
        const meta = S.catMeta(t.type, t.category);
        const sign = t.type === 'income' ? '+' : '-';
        const cls = t.type === 'income' ? 'inc' : 'exp';
        const refunded = S.refundedAmount(t.id);
        let refundPill = '';
        if (refunded > 0) {
          const full = refunded >= (Number(t.amount) - 0.005);
          refundPill = `<span class="pill ${full ? 'refund' : 'refund-part'}">${full ? '已退款' : `已退 ${cm.sym}${money(refunded)}`}</span>`;
        }
        html += `
          <div class="tx-item" data-id="${t.id}">
            <div class="tx-emoji">${meta.emoji}</div>
            <div class="tx-mid">
              <div class="tx-cat">${esc(meta.name)} ${t.splitId ? '<span class="pill">已分账</span>' : ''}${refundPill}</div>
              <div class="tx-note">${esc(txAccountName(t))}${t.note ? ' · ' + esc(t.note) : ''}${t.currency ? ' · ' + esc(t.currency) : ''}${stampHTML(t)}</div>
            </div>
            <div class="tx-amt ${cls}">${sign}${cm.sym}${money(t.amount)}<span class="tx-code">${esc(t.currency)}</span></div>
          </div>`;
      });
    });
    box.innerHTML = html;
    on(box, '.tx-item', 'click', (e) => {
      const id = e.currentTarget.dataset.id;
      const tx = S.getTransaction(id);
      if (!tx) return;
      openTxActions(tx);
    });
  }

  /* ---------------- 快速记账（快捷指令 / Siri / 分享面板） ---------------- */
  // 面板本体：展示解析结果，允许改类型 / 分类 / 付款方式 / 日期后确认
  function openQuickPanel(parsed, o) {
    o = o || {};
    const st = {
      type: (parsed.record && parsed.record.type) || 'expense',
      category: (parsed.record && parsed.record.category) || '',
      accountId: '',
      date: (parsed.record && parsed.record.date) || S.nowDate(),
      time: (parsed.record && parsed.record.time) || S.nowTime(),
      amount: (parsed.record && parsed.record.amount) || 0,
      currency: (parsed.record && parsed.record.currency) || 'CNY',
      note: (parsed.record && parsed.record.note) || '',
    };
    // 账户：按解析出的名字匹配，找不到就用现金
    const accs = S.listAccounts();
    const wantName = (parsed.record && parsed.record.accountName) || '';
    let acc = wantName ? accs.filter((a) => a.name === wantName || a.id === wantName)[0] : null;
    if (!acc) acc = accs.filter((a) => a.name === '现金')[0] || accs[0];
    st.accountId = acc ? acc.id : '';

    const cats = () => S.getCategories(st.type === 'income' ? 'income' : 'expense');
    const catHTML = () => cats().map((c) =>
      `<div class="cat-cell ${c.key === st.category ? 'active' : ''}" data-cat="${c.key}"><span class="emoji">${c.emoji}</span><span class="name">${c.name}</span></div>`
    ).join('');
    const accHTML = () => accs.map((a) =>
      `<option value="${a.id}" ${a.id === st.accountId ? 'selected' : ''}>${a.icon} ${esc(a.name)}</option>`
    ).join('');

    openSheet(`
      <div class="sheet-handle"></div>
      <div class="quick-head">
        <span class="quick-badge">⚡ 快速记账</span>
        ${parsed.raw ? `<div class="quick-raw">「${esc(parsed.raw)}」</div>` : '<div class="quick-raw">手动填一笔</div>'}
      </div>
      ${!parsed.ok ? `<div class="quick-warn">${esc((parsed.tips || ['没识别出金额'])[0])}</div>` : ''}
      ${(parsed.tips || []).filter(() => parsed.ok).map((t) => `<div class="quick-tip">提示：${esc(t)}</div>`).join('')}
      <div class="seg" id="qfType">
        <button data-type="expense" class="${st.type === 'expense' ? 'on-expense' : ''}">支出</button>
        <button data-type="income" class="${st.type === 'income' ? 'on-income' : ''}">收入</button>
      </div>
      <div class="field" style="margin-top:14px"><label>金额</label>
        <input class="input" id="qfAmount" type="number" inputmode="decimal" placeholder="0.00" value="${st.amount ? money(st.amount) : ''}" /></div>
      <div class="field"><label>分类</label><div class="cat-grid" id="qfCat">${catHTML()}</div></div>
      <div class="field"><label>付款方式</label><select class="select" id="qfAcc">${accHTML()}</select></div>
      <div class="field"><label>日期 / 时间</label>
        <div class="dt-row">
          <input class="input" id="qfDate" type="date" value="${st.date}" />
          <input class="input dt-time" id="qfTime" type="time" value="${st.time || ''}" />
        </div></div>
      <div class="field"><label>备注</label><input class="input" id="qfNote" placeholder="可选" value="${esc(st.note)}" /></div>
      <div class="btn-row" style="margin-top:14px">
        <button class="btn secondary" id="qfCancel">取消</button>
        <button class="btn" id="qfSave">记一笔</button>
      </div>
    `, (body) => {
      on(body, '#qfType button', 'click', (e) => {
        st.type = e.currentTarget.dataset.type;
        $$('#qfType button', body).forEach((b) => {
          b.classList.toggle('on-expense', b.dataset.type === 'expense' && st.type === 'expense');
          b.classList.toggle('on-income', b.dataset.type === 'income' && st.type === 'income');
        });
        st.category = ((cats()[0]) || {}).key || '';
        $('#qfCat', body).innerHTML = catHTML();
        bindCatGrid(body, st, '#qfCat');
      });
      bindCatGrid(body, st, '#qfCat');
      $('#qfAcc', body).addEventListener('change', (e) => { st.accountId = e.target.value; });
      $('#qfCancel', body).addEventListener('click', closeSheet);
      $('#qfSave', body).addEventListener('click', () => {
        const amount = parseFloat($('#qfAmount', body).value);
        if (!amount || amount <= 0) { toast('请输入有效金额'); return; }
        const tx = S.addTransaction({
          ledgerId: currentLedgerId,
          type: st.type,
          amount,
          currency: st.currency || 'CNY',
          rate: 1,
          discount: 0,
          category: st.category,
          accountId: st.accountId || null,
          date: $('#qfDate', body).value || S.nowDate(),
          time: $('#qfTime', body).value || '',
          note: ($('#qfNote', body).value || '').trim(),
          source: 'quick',
        });
        closeSheet();
        toast(`已记录 ${st.type === 'income' ? '+' : '-'}${money(tx.amount)}`);
        refreshAfterChange();
      });
    });
  }

  // 设置 → 快捷指令说明
  function openShortcutSheet() {
    const base = location.origin + location.pathname;
    const ex = base + '?quick=1&text=' + encodeURIComponent('午饭35') + '&auto=1';
    openSheet(`
      <div class="sheet-handle"></div>
      <div class="section-title">⚡ 用快捷指令记账</div>
      <div class="muted" style="line-height:1.7;margin-bottom:10px">
        把下面这条网址存进 iPhone「快捷指令」，以后说一句话、点一下图标就能记账，不用打开 App。
      </div>
      <div class="field"><label>识别网址（把 text 换成你要记的话）</label>
        <textarea class="input" id="scUrl" readonly rows="3" style="font-size:12px">${esc(ex)}</textarea>
      </div>
      <div class="btn-row"><button class="btn" id="scCopy">复制网址</button></div>
      <div class="field" style="margin-top:14px"><label>试试手输一句</label>
        <input class="input" id="scTry" placeholder="例：昨天打车 12.5 微信" />
      </div>
      <div class="btn-row"><button class="btn secondary" id="scGo">识别并记账</button></div>
      <div class="muted" style="line-height:1.8;margin-top:12px;font-size:13px">
        <b>几个例子</b><br/>
        · 午饭35 → 支出 ¥35 · 餐饮<br/>
        · 打车 12.5 微信 → 支出 ¥12.5 · 交通 · 微信<br/>
        · 昨天超市120支付宝 → 日期自动昨天<br/>
        · 工资8000 → 收入 ¥8000 · 工资<br/>
        · 房租两千三 → 支持中文数字<br/><br/>
        <b>参数说明</b><br/>
        · <code>text=</code> 要识别的话（必填）<br/>
        · <code>auto=1</code> 直接记账不弹窗<br/>
        · <code>type=income</code> 强制收入<br/>
        · <code>cat=food</code> 强制分类 · <code>acc=微信</code> 强制付款方式<br/>
        · <code>date=2026-09-01</code> 指定日期<br/><br/>
        详细步骤见仓库里的 <b>SHORTCUT.md</b>。
      </div>
      <div class="btn-row" style="margin-top:12px"><button class="btn secondary" id="scClose">关闭</button></div>
    `, (body) => {
      $('#scClose', body).addEventListener('click', closeSheet);
      $('#scCopy', body).addEventListener('click', () => {
        const v = $('#scUrl', body).value;
        if (navigator.clipboard) navigator.clipboard.writeText(v).then(() => toast('已复制网址'), () => toast('复制失败，请长按选择'));
        else { $('#scUrl', body).select(); toast('请长按选择复制'); }
      });
      $('#scGo', body).addEventListener('click', () => {
        const t = $('#scTry', body).value.trim();
        if (!t) { toast('先输入一句话'); return; }
        closeSheet();
        openQuickPanel(window.QuickAdd ? window.QuickAdd.parse(t) : { ok: false, tips: ['解析模块未加载'], raw: t }, {});
      });
    });
  }

  /* ---------------- 单单操作菜单（编辑 / 退款 / 删除） ---------------- */
  function openTxActions(tx) {
    const isRefund = tx.type === 'refund';
    const isTransfer = tx.type === 'transfer';
    const canRefund = S.canRefund(tx);
    const refunded = canRefund ? S.refundedAmount(tx.id) : 0;
    const cm = S.currencyMeta(tx.currency);
    const kindText = isTransfer ? '转账' : (isRefund ? '退款' : (tx.type === 'income' ? '收入' : '支出'));
    openSheet(`
      <div class="sheet-handle"></div>
      <div class="confirm-box">
        <div class="confirm-title">${esc(kindText)} ${cm.sym}${money(tx.amount)} <span class="muted">${esc(tx.currency || '')}</span></div>
        <div class="confirm-desc">${esc(S.txDateTime(tx))}${tx.note ? ' · ' + esc(tx.note) : ''}${refunded > 0 ? `<br>已退款 ${cm.sym}${money(refunded)}` : ''}</div>
      </div>
      <div class="act-list">
        <button class="act-item" id="axEdit"><span>✏️</span><span>编辑</span></button>
        ${canRefund ? `<button class="act-item" id="axRefund"><span>↩️</span><span>退款（全退 / 部分）</span></button>` : ''}
        ${isRefund ? `<button class="act-item danger" id="axVoid"><span>🗑️</span><span>撤销此退款</span></button>` : `<button class="act-item danger" id="axDel"><span>🗑️</span><span>删除</span></button>`}
      </div>
      <div class="btn-row" style="margin-top:12px"><button class="btn secondary" id="axCancel">取消</button></div>
    `, (body) => {
      $('#axCancel', body).addEventListener('click', closeSheet);
      $('#axEdit', body).addEventListener('click', () => { closeSheet(); isTransfer ? openTransferSheet(tx) : openRecordSheet(tx); });
      const rf = $('#axRefund', body);
      if (rf) rf.addEventListener('click', () => { closeSheet(); openRefundSheet(tx); });
      const del = $('#axDel', body);
      if (del) del.addEventListener('click', () => {
        closeSheet();
        const extra = S.refundChildren(tx.id).length ? '<br>该记录已有退款，删除后退款也会一并移除。' : '';
        confirmSheet({ title: '删除这条记录？', desc: `删除后账本收支与账户余额会相应恢复。<br>（删除会同步到你的其它设备）${extra}`, okText: '删除', danger: true }, () => {
          S.deleteTransaction(tx.id);
          toast('已删除');
          refreshAfterChange();
        });
      });
      const vd = $('#axVoid', body);
      if (vd) vd.addEventListener('click', () => {
        closeSheet();
        confirmSheet({ title: '撤销这笔退款？', desc: '撤销后该笔退款金额会重新计回原记录。', okText: '撤销退款', danger: true }, () => {
          S.removeRefund(tx.id);
          toast('已撤销退款');
          refreshAfterChange();
        });
      });
    });
  }

  // 按当前视图就地刷新
  function refreshAfterChange() {
    if (currentView === 'record') renderRecord($('#appMain'));
    else if (currentView === 'stats') renderStats($('#appMain'));
    else if (currentView === 'me') renderMe($('#appMain'));
    else if (currentView === 'split') renderSplit($('#appMain'));
  }

  /* ---------------- 退款抽屉（全退 / 部分退款） ---------------- */
  function openRefundSheet(tx) {
    const cm = S.currencyMeta(tx.currency);
    const total = Number(tx.amount) || 0;
    const already = S.refundedAmount(tx.id);
    const remain = Math.round((total - already) * 100) / 100;
    const accs = S.listAccounts();
    const st = { mode: remain > 0 ? 'full' : 'part', date: S.nowDate(), time: S.nowTime(), note: '', toAccountId: tx.accountId || (accs[0] || {}).id };
    const isExpense = tx.type === 'expense';

    function amountOf(body) {
      if (st.mode === 'full') return remain;
      return Math.round((parseFloat($('#rfAmount', body).value) || 0) * 100) / 100;
    }
    function preview(body) {
      const amt = amountOf(body);
      const eff = isExpense ? `原支出减少 ${cm.sym}${money(amt)}` : `原收入减少 ${cm.sym}${money(amt)}`;
      const bal = isExpense ? '账户余额增加' : '账户余额减少';
      $('#rfPreview', body).innerHTML = amt > 0
        ? `退款 <b>${cm.sym}${money(amt)} ${esc(tx.currency)}</b> · ${eff} · ${bal} ${cm.sym}${money(amt)}`
        : '请输入退款金额';
    }

    openSheet(`
      <div class="sheet-handle"></div>
      <div class="field"><label>原记录</label>
        <div class="muted" style="font-size:14px">${esc(S.catMeta(tx.type, tx.category).name)} · ${cm.sym}${money(total)} ${esc(tx.currency)} · ${esc(S.txDateTime(tx))}
        ${already > 0 ? `<br>已退 ${cm.sym}${money(already)}，本次最多可退 ${cm.sym}${money(remain)}` : ''}</div>
      </div>
      <div class="seg" id="rfMode">
        <button data-m="full" class="${st.mode === 'full' ? 'on-expense' : ''}">全额退款</button>
        <button data-m="part" class="${st.mode === 'part' ? 'on-expense' : ''}">部分退款</button>
      </div>
      <div class="field" id="rfAmtField" style="margin-top:14px" ${st.mode === 'full' ? 'hidden' : ''}>
        <label>退款金额（${esc(tx.currency)}，最多 ${money(remain)}）</label>
        <input class="input" id="rfAmount" type="number" inputmode="decimal" placeholder="0.00" />
      </div>
      <div class="muted" id="rfPreview" style="font-size:13px;margin:-4px 0 12px"></div>
      <div class="field"><label>退回账户（默认原路退回）</label>
        <select class="select" id="rfAcc">${accs.map((a) => `<option value="${a.id}" ${a.id === st.toAccountId ? 'selected' : ''}>${a.icon} ${esc(a.name)}（${esc(a.currency)}）</option>`).join('')}</select>
      </div>
      <div class="field"><label>退款日期 / 时间</label>
        <div class="dt-row">
          <input class="input" id="rfDate" type="date" value="${st.date}" />
          <input class="input dt-time" id="rfTime" type="time" value="${st.time || ''}" />
        </div></div>
      <div class="field"><label>备注</label><textarea class="input" id="rfNote" placeholder="可选，如「商家退款」"></textarea></div>
      <div class="btn-row" style="margin-top:14px">
        <button class="btn secondary" id="rfCancel">取消</button>
        <button class="btn" id="rfSave">确认退款</button>
      </div>
    `, (body) => {
      preview(body);
      on(body, '#rfMode button', 'click', (e) => {
        st.mode = e.currentTarget.dataset.m;
        $$('#rfMode button', body).forEach((b) => b.classList.toggle('on-expense', b.dataset.m === st.mode));
        $('#rfAmtField', body).hidden = st.mode === 'full';
        preview(body);
      });
      $('#rfAmount', body).addEventListener('input', () => preview(body));
      $('#rfAcc', body).addEventListener('change', (e) => { st.toAccountId = e.target.value; });
      $('#rfCancel', body).addEventListener('click', closeSheet);
      $('#rfSave', body).addEventListener('click', () => {
        const amount = amountOf(body);
        if (!(amount > 0)) { toast('请输入有效退款金额'); return; }
        if (amount > remain + 0.005) { toast(`最多可退 ${remain} ${tx.currency}`); return; }
        const r = S.addRefund({
          parentId: tx.id, amount,
          date: $('#rfDate', body).value || S.nowDate(),
          time: $('#rfTime', body).value || '',
          note: $('#rfNote', body).value.trim(),
          toAccountId: st.toAccountId
        });
        if (r.error) { toast(r.error); return; }
        toast(st.mode === 'full' ? '已全额退款' : '已部分退款');
        closeSheet();
        refreshAfterChange();
      });
    });
  }

  /* ---------------- 记账抽屉 ---------------- */
  function openRecordSheet(tx) {
    const led = tx ? (S.ledgerById(tx.ledgerId) || S.defaultLedger()) : (S.ledgerById(currentLedgerId) || S.defaultLedger());
    currentLedgerId = led.id;
    const base = led.baseCurrency;
    const st = {
      editId: tx ? tx.id : null,
      type: tx ? tx.type : 'expense',
      category: tx ? tx.category : S.getCategories('expense')[0].key,
      ledgerId: led.id,
      accountId: tx ? tx.accountId : (S.listAccounts()[0] || {}).id || null,
      currency: tx ? tx.currency : led.currency,
      rate: tx ? tx.rate : (led.currency === base ? 1 : ''),
      discount: tx ? tx.discount : 0,
      time: tx ? S.txTime(tx) : S.nowTime(),
      split: { enabled: false, method: 'equal', members: [{ name: SELF }], paidBy: SELF, _prefilled: false }
    };
    const cats = () => S.getCategories(st.type === 'income' ? 'income' : 'expense');
    const rateLabel = () => `汇率（1 ${st.currency} = ? ${base}）`;

    function catHTML() {
      return cats().map((c) =>
        `<div class="cat-cell ${c.key === st.category ? 'active' : ''}" data-cat="${c.key}"><span class="emoji">${c.emoji}</span><span class="name">${c.name}</span></div>`
      ).join('');
    }
    function curBase() { return S.ledgerById(st.ledgerId).baseCurrency; }

    openSheet(`
      <div class="sheet-handle"></div>
      <div class="field"><label>账本</label>
        <select class="select" id="fLedger">${S.listLedgers().map((l) => `<option value="${l.id}" ${l.id === st.ledgerId ? 'selected' : ''}>${l.icon} ${esc(l.name)}（${l.baseCurrency}）</option>`).join('')}</select>
      </div>
      <div class="seg" id="typeSeg">
        <button data-type="expense" class="${st.type === 'expense' ? 'on-expense' : ''}">支出</button>
        <button data-type="income" class="${st.type === 'income' ? 'on-income' : ''}">收入</button>
      </div>
      <div class="field" style="margin-top:14px"><label>金额（实际支付）</label>
        <input class="input" id="fAmount" type="number" inputmode="decimal" placeholder="0.00" value="${tx ? money(tx.amount) : ''}" /></div>
      <div class="field"><label>货币</label>
        <select class="select" id="fCur">${S.CURRENCIES.map((c) => `<option value="${c.code}" ${c.code === st.currency ? 'selected' : ''}>${c.code} ${c.name}</option>`).join('')}</select>
      </div>
      <div class="field" id="rateField"><label>${rateLabel()}</label>
        <input class="input" id="fRate" type="number" inputmode="decimal" placeholder="如 7.2" value="${st.rate !== '' ? st.rate : ''}" /></div>
      <div class="field"><label>优惠（选填，记录省下的）</label>
        <input class="input" id="fDiscount" type="number" inputmode="decimal" placeholder="0.00" value="${tx && tx.discount ? money(tx.discount) : ''}" /></div>
      <div class="field"><label>分类</label><div class="cat-grid" id="catGrid">${catHTML()}</div></div>
      <div class="field"><label>日期 / 时间</label>
        <div class="dt-row">
          <input class="input" id="fDate" type="date" value="${tx ? tx.date : S.nowDate()}" />
          <input class="input dt-time" id="fTime" type="time" value="${tx ? S.txTime(tx) : S.nowTime()}" />
        </div></div>
      <div class="field"><label>付款方式</label>
        <select class="select" id="fAccount">${accountOpts(st.accountId)}</select></div>
      <div class="field"><label>备注</label><textarea class="input" id="fNote" placeholder="可选">${tx ? esc(tx.note) : ''}</textarea></div>

      <div class="split-toggle" id="splitToggle">
        <span>🤝 同时发起分账</span><span class="st-arrow">▸</span>
      </div>
      <div id="splitBox" hidden></div>

      <div class="btn-row" style="margin-top:14px">
        ${tx ? '<button class="btn danger" id="sheetDel" style="flex:0 0 96px">删除</button>' : ''}
        <button class="btn secondary" id="sheetCancel">取消</button>
        <button class="btn" id="sheetSave">${tx ? '保存修改' : '保存'}</button>
      </div>
    `, (body) => {
      const rateField = $('#rateField', body);

      // 类型切换
      on(body, '#typeSeg button', 'click', (e) => {
        st.type = e.currentTarget.dataset.type;
        $$('#typeSeg button', body).forEach((b) =>
          b.classList.toggle('on-expense', b.dataset.type === 'expense' && st.type === 'expense') ||
          b.classList.toggle('on-income', b.dataset.type === 'income' && st.type === 'income'));
        st.category = cats()[0].key;
        $('#catGrid', body).innerHTML = catHTML();
        bindCatGrid(body, st);
      });
      bindCatGrid(body, st);

      // 货币切换 → 更新汇率默认值与标签
      $('#fCur', body).addEventListener('change', (e) => {
        st.currency = e.target.value;
        if (st.currency === curBase()) { st.rate = 1; $('#fRate', body).value = 1; }
        else if (st.rate === 1) { st.rate = ''; $('#fRate', body).value = ''; }
        $('label', rateField).textContent = rateLabel();
      });

      // 付款方式选择（含新增入口）
      $('#fAccount', body).addEventListener('change', (e) => {
        const v = e.target.value;
        if (v === '__new__') {
          openAccountEditor(null, st.ledgerId, (newId) => {
            const sel = $('#fAccount', body);
            if (sel) { sel.innerHTML = accountOpts(newId); st.accountId = newId; }
          });
        } else {
          st.accountId = v;
        }
      });

      // 账本切换 → 仅更新基准货币相关标签（付款方式全局通用，无需重置）
      $('#fLedger', body).addEventListener('change', (e) => {
        st.ledgerId = e.target.value;
        const nl = S.ledgerById(st.ledgerId);
        const nb = nl.baseCurrency;
        // 若货币等于新基准，汇率归 1
        if (st.currency === nb) { st.rate = 1; $('#fRate', body).value = 1; }
        $('label', rateField).textContent = `汇率（1 ${st.currency} = ? ${nb}）`;
      });

      // 分账折叠
      const toggle = $('#splitToggle', body);
      const splitBox = $('#splitBox', body);
      toggle.addEventListener('click', () => {
        st.split.enabled = !st.split.enabled;
        if (st.split.enabled) {
          // 若该账本有同行人且尚未预填，则一键带入（含本人）
          if (!st.split._prefilled && led.companions && led.companions.length) {
            const set = unique([SELF].concat(led.companions));
            st.split.members = set.map((n) => ({ name: n }));
            st.split.paidBy = SELF;
            st.split._prefilled = true;
          }
          splitBox.hidden = false;
          toggle.classList.add('on');
          buildSplitSection(splitBox, st.split, base);
        } else {
          splitBox.hidden = true;
          toggle.classList.remove('on');
        }
      });

      $('#sheetCancel', body).addEventListener('click', closeSheet);
      const delBtn = $('#sheetDel', body);
      if (delBtn) delBtn.addEventListener('click', () => {
        if (!tx) return;
        const extra = S.refundChildren(tx.id).length ? '<br>该记录已有退款，删除后退款也会一并移除。' : '';
        confirmSheet({ title: '删除这条记录？', desc: `删除后账本收支与账户余额会相应恢复。<br>（删除会同步到你的其它设备）${extra}`, okText: '删除', danger: true }, () => {
          S.deleteTransaction(tx.id);
          toast('已删除');
          refreshAfterChange();
        });
      });
      $('#sheetSave', body).addEventListener('click', () => {
        const amount = parseFloat($('#fAmount', body).value);
        if (!amount || amount <= 0) { toast('请输入有效金额'); return; }
        const cur = $('#fCur', body).value;
        let rate = parseFloat($('#fRate', body).value);
        const cb = curBase();
        if (cur === cb) rate = 1;
        if ((cur !== cb) && (!rate || rate <= 0)) { toast('请填写汇率'); return; }
        const discount = parseFloat($('#fDiscount', body).value) || 0;
        const payload = {
          ledgerId: st.ledgerId, type: st.type, amount, currency: cur, rate,
          discount, category: st.category,
          accountId: st.accountId,
          date: $('#fDate', body).value || S.nowDate(),
          time: $('#fTime', body).value || '',
          note: $('#fNote', body).value.trim()
        };
        let txObj;
        if (st.editId) { S.updateTransaction(st.editId, payload); txObj = S.getTransaction(st.editId); toast('已保存'); }
        else { txObj = S.addTransaction(payload); toast('已记录'); }

        // 关联分账
        if (st.split.enabled) {
          const members = st.split.members.filter((m) => m.name.trim());
          if (members.length >= 2) {
            const baseTotal = S.baseAmount(txObj);
            const sp = S.addSplit({
              ledgerId: st.ledgerId,
              title: payload.note || S.catMeta(payload.type, payload.category).name || '分账',
              total: baseTotal, paidBy: st.split.paidBy || members[0].name,
              method: st.split.method, members: members.map((m) => ({ name: m.name.trim(), share: m.share, amount: m.amount })),
              date: payload.date, note: payload.note,
              currency: cur, rate: rate, baseCurrency: base, linkedTx: txObj.id
            });
            S.updateTransaction(txObj.id, { splitId: sp.id });
            toast('已记录并分账');
          } else {
            toast('分账至少需要 2 名成员');
          }
        }
        closeSheet();
        if (currentView === 'record') renderRecord($('#appMain'));
        else if (currentView === 'stats') renderStats($('#appMain'));
      });
    });
  }

  function bindCatGrid(body, st, gridSel) {
    const grid = gridSel || '#catGrid';
    on(body, grid + ' .cat-cell', 'click', (e) => {
      const key = e.currentTarget.dataset.cat;
      if (st) st.category = key;
      $$(grid + ' .cat-cell', body).forEach((c) => c.classList.toggle('active', c.dataset.cat === key));
    });
  }

  // 分账内嵌区块（记账抽屉 / 独立分账共用）
  function buildSplitSection(container, state, baseCode) {
    container.innerHTML = `
      <div class="field" style="margin-top:6px"><label>分摊方式</label>
        <div class="seg" id="spMethod">
          <button data-m="equal" class="${state.method === 'equal' ? 'on-expense' : ''}">均摊</button>
          <button data-m="share" class="${state.method === 'share' ? 'on-expense' : ''}">按比例</button>
          <button data-m="exact" class="${state.method === 'exact' ? 'on-expense' : ''}">精确</button>
        </div>
      </div>
      <div id="spMembers"></div>
      <button class="btn secondary" id="spAdd" style="margin-top:6px">＋ 添加成员</button>
      <div class="field" style="margin-top:10px"><label>由谁付款</label><select class="select" id="spPaid"></select></div>
      <div class="muted" style="font-size:12px">分账金额按基准货币 ${baseCode} 结算（= 本笔金额 × 汇率）。</div>
    `;
    const rows = $('#spMembers', container);
    const paid = $('#spPaid', container);
    paid.addEventListener('change', (e) => { state.paidBy = e.target.value; });
    function renderRows() {
      rows.innerHTML = state.members.map((mem, i) => {
        const extra = state.method === 'share'
          ? `<input class="input" data-i="${i}" data-k="share" type="number" inputmode="decimal" placeholder="份额" value="${mem.share != null ? mem.share : ''}" style="width:80px"/>`
          : state.method === 'exact'
          ? `<input class="input" data-i="${i}" data-k="amount" type="number" inputmode="decimal" placeholder="金额" value="${mem.amount != null ? mem.amount : ''}" style="width:80px"/>`
          : '';
        return `<div class="card-row" style="margin-bottom:8px">
          <input class="input" data-i="${i}" data-k="name" placeholder="姓名" value="${esc(mem.name)}" style="flex:1"/>
          ${extra}
          <button class="btn danger" data-rm="${i}" style="width:auto;padding:10px 12px">✕</button>
        </div>`;
      }).join('');
      $$('input', rows).forEach((inp) => inp.addEventListener('input', (e) => {
        const i = +e.target.dataset.i, k = e.target.dataset.k;
        state.members[i][k] = e.target.value;
        if (k === 'name') refreshPaid();
      }));
      $$('[data-rm]', rows).forEach((b) => b.addEventListener('click', (e) => {
        const i = +e.target.dataset.rm;
        state.members.splice(i, 1);
        if (!state.members.length) state.members.push({ name: '' });
        renderRows();
      }));
      refreshPaid();
    }
    function refreshPaid() {
      const names = state.members.map((m) => m.name).filter(Boolean);
      paid.innerHTML = names.map((n) => `<option ${n === state.paidBy ? 'selected' : ''}>${esc(n)}</option>`).join('') || '<option value="">（先填成员）</option>';
      if (names.length && !names.includes(state.paidBy)) state.paidBy = names[0];
    }
    $('#spAdd', container).addEventListener('click', () => { state.members.push({ name: '' }); renderRows(); });
    $('#spMethod', container).addEventListener('click', (e) => {
      if (!e.target.dataset.m) return;
      state.method = e.target.dataset.m;
      state.members.forEach((m) => { delete m.share; delete m.amount; });
      $$('#spMethod button', container).forEach((b) => b.classList.toggle('on-expense', b.dataset.m === state.method));
      renderRows();
    });
    renderRows();
  }

  /* ---------------- 转账（账户间互转，支持跨货币） ---------------- */
  function openTransferSheet(tx, preset) {
    const led = tx ? (S.ledgerById(tx.ledgerId) || S.defaultLedger()) : (S.ledgerById(currentLedgerId) || S.defaultLedger());
    currentLedgerId = led.id;
    const accs = S.listAccounts();
    const accById = (id) => accs.find((a) => a.id === id) || null;
    const fromAcc = accById((preset && preset.fromId) || (tx ? tx.fromId : (accs[0] || {}).id));
    const toAcc = accById(tx ? tx.toId : (accs[1] || accs[0] || {}).id);
    const st = {
      editId: tx ? tx.id : null,
      fromId: fromAcc ? fromAcc.id : (accs[0] || {}).id,
      toId: toAcc ? toAcc.id : (accs[0] || {}).id,
      amount: tx ? Number(tx.amount) : null,
      toAmount: tx ? (tx.toAmount != null ? Number(tx.toAmount) : Number(tx.amount)) : null,
      currency: tx ? tx.currency : (fromAcc ? fromAcc.currency : 'CNY'),
      toCurrency: tx ? (tx.toCurrency || tx.currency) : (toAcc ? toAcc.currency : 'CNY'),
      rate: tx ? (tx.rate != null ? Number(tx.rate) : 1) : 1,
      mode: 'out', // 'out' 填写转出金额；'in' 填写到账金额
      date: tx ? tx.date : S.nowDate(),
      time: tx ? S.txTime(tx) : S.nowTime(),
      note: tx ? tx.note : ''
    };
    function opts(sel) {
      return accs.map((a) => `<option value="${a.id}" ${a.id === sel ? 'selected' : ''}>${a.icon} ${esc(a.name)}（${a.currency}）</option>`).join('');
    }
    function isCross() { return st.currency !== st.toCurrency; }
    openSheet(`
      <div class="sheet-handle"></div>
      <div class="field"><label>从（付款账户 · ${st.currency}）</label><select class="select" id="tFrom">${opts(st.fromId)}</select></div>
      <div class="field"><label>转到（收款账户 · ${st.toCurrency}）</label><select class="select" id="tTo">${opts(st.toId)}</select></div>
      <div class="seg" id="tMode" ${isCross() ? '' : 'hidden'}>
        <button data-mode="out" class="${st.mode === 'out' ? 'on-expense' : ''}">填转出金额</button>
        <button data-mode="in" class="${st.mode === 'in' ? 'on-expense' : ''}">填到账金额</button>
      </div>
      <div class="field"><label id="tAmtLabel">转出金额（${st.currency}）</label><input class="input" id="tAmount" type="number" inputmode="decimal" placeholder="0.00" value="${st.amount != null ? money(st.amount) : ''}" /></div>
      <div class="field" id="tRateField" ${isCross() ? '' : 'hidden'}><label id="tRateLabel">汇率（1 ${st.currency} = ? ${st.toCurrency}）</label><input class="input" id="tRate" type="number" inputmode="decimal" placeholder="如 20" value="${isCross() && st.rate !== 1 ? st.rate : ''}" /></div>
      <div class="muted" id="tPreview" style="margin:-4px 0 8px"></div>
      <div class="field"><label>日期 / 时间</label>
        <div class="dt-row">
          <input class="input" id="tDate" type="date" value="${st.date}" />
          <input class="input dt-time" id="tTime" type="time" value="${st.time || ''}" />
        </div></div>
      <div class="field"><label>备注</label><textarea class="input" id="tNote" placeholder="可选">${tx ? esc(tx.note) : ''}</textarea></div>
      <div class="btn-row" style="margin-top:14px">
        <button class="btn secondary" id="tCancel">取消</button>
        <button class="btn" id="tSave">${tx ? '保存修改' : '确认转账'}</button>
      </div>
    `, (body) => {
      const amtInput = $('#tAmount', body);
      const rateInput = $('#tRate', body);
      const rateField = $('#tRateField', body);
      const modeSeg = $('#tMode', body);
      const preview = $('#tPreview', body);
      const amtLabel = $('#tAmtLabel', body);
      const rateLabel = $('#tRateLabel', body);

      function recompute() {
        const cross = isCross();
        rateField.hidden = !cross;
        modeSeg.hidden = !cross;
        if (!cross) {
          st.toCurrency = st.currency;
          st.toAmount = st.amount != null ? st.amount : null;
          st.rate = 1;
          preview.textContent = '';
          amtLabel.textContent = `金额（${st.currency}）`;
          return;
        }
        const rate = parseFloat(rateInput.value) || 0;
        st.rate = rate;
        rateLabel.textContent = `汇率（1 ${st.currency} = ? ${st.toCurrency}）`;
        amtLabel.textContent = st.mode === 'out'
          ? `转出金额（${st.currency}）`
          : `到账金额（${st.toCurrency}）`;
        if (rate > 0) {
          if (st.mode === 'out') {
            const ta = S.round2((st.amount != null ? st.amount : 0) * rate);
            st.toAmount = ta;
            preview.textContent = `按汇率折算，到账 ${S.currencyMeta(st.toCurrency).sym}${money(ta)} ${st.toCurrency}`;
          } else {
            const sa = S.round2((st.toAmount != null ? st.toAmount : 0) / rate);
            st.amount = sa;
            preview.textContent = `按汇率折算，需转出 ${S.currencyMeta(st.currency).sym}${money(sa)} ${st.currency}`;
          }
        } else {
          preview.textContent = '请填写汇率';
        }
      }

      on(body, '#tMode button', 'click', (e) => {
        st.mode = e.currentTarget.dataset.mode;
        $$('#tMode button', body).forEach((b) => b.classList.toggle('on-expense', b.dataset.mode === st.mode));
        amtInput.value = (st.mode === 'out' ? (st.amount != null ? money(st.amount) : '') : (st.toAmount != null ? money(st.toAmount) : ''));
        recompute();
      });
      $('#tFrom', body).addEventListener('change', (e) => {
        st.fromId = e.target.value;
        const a = accById(st.fromId);
        st.currency = a ? a.currency : 'CNY';
        if (st.mode === 'out') { st.amount = null; amtInput.value = ''; }
        recompute();
      });
      $('#tTo', body).addEventListener('change', (e) => {
        st.toId = e.target.value;
        const a = accById(st.toId);
        st.toCurrency = a ? a.currency : 'CNY';
        if (st.mode === 'in') { st.toAmount = null; amtInput.value = ''; }
        recompute();
      });
      amtInput.addEventListener('input', (e) => {
        const v = parseFloat(e.target.value);
        if (st.mode === 'out') st.amount = v; else st.toAmount = v;
        recompute();
      });
      rateInput.addEventListener('input', () => { st.rate = parseFloat(rateInput.value) || 0; recompute(); });

      $('#tCancel', body).addEventListener('click', closeSheet);
      $('#tSave', body).addEventListener('click', () => {
        const cross = isCross();
        if (st.mode === 'out') { if (st.amount == null || st.amount <= 0) { toast('请输入有效金额'); return; } }
        else { if (st.toAmount == null || st.toAmount <= 0) { toast('请输入有效金额'); return; } }
        if (st.fromId === st.toId) { toast('转出和转入账户不能相同'); return; }
        if (cross && (!st.rate || st.rate <= 0)) { toast('请填写汇率'); return; }
        const payload = {
          ledgerId: led.id, fromId: st.fromId, toId: st.toId,
          amount: st.amount != null ? st.amount : 0,
          toAmount: st.toAmount != null ? st.toAmount : (st.amount != null ? st.amount : 0),
          currency: st.currency, toCurrency: st.toCurrency,
          rate: cross ? st.rate : 1,
          date: $('#tDate', body).value || S.nowDate(), time: $('#tTime', body).value || '',
          note: $('#tNote', body).value.trim()
        };
        if (st.editId) { S.updateTransfer(st.editId, payload); toast('已保存'); }
        else { S.addTransfer(payload); toast('转账成功'); }
        closeSheet();
        if (currentView === 'record') renderRecord($('#appMain'));
        else if (currentView === 'stats') renderStats($('#appMain'));
        else if (currentView === 'me') renderMe($('#appMain'));
      });

      recompute();
    });
  }

  /* ---------------- 分账视图（按账本隔离） ---------------- */
  function renderSplit(main) {
    const led = S.ledgerById(currentLedgerId) || S.defaultLedger();
    currentLedgerId = led.id;
    const base = led.baseCurrency;
    const data = S.load();
    const ledgerSplits = data.splits.filter((s) => s.ledgerId === led.id);
    const net = S.allBalances(led.id);
    const settles = S.settlement(led.id);
    const clears = data.clears.filter((c) => c.ledgerId === led.id);
    let html = `
      ${ledgerChipHTML(led)}
      <div class="card">
        <div class="card-row"><span class="section-title" style="margin:0">结算总览（${(led.companions || []).length ? esc(led.companions.join('、')) : '本账本'}，按 ${base}）</span><span class="muted">${ledgerSplits.length} 笔账单</span></div>
        <div id="settleBox"></div>
      </div>
      ${clears.length ? `
      <div class="card">
        <div class="section-title">已结算记录</div>
        <div id="clearBox"></div>
      </div>` : ''}
      <div class="card-row" style="margin:8px 4px">
        <span class="section-title" style="margin:0">账单列表</span>
        <button class="btn secondary" id="newSplit" style="width:auto;padding:8px 14px">＋ 新建分账</button>
      </div>
      <div id="splitList"></div>
    `;
    main.innerHTML = html;

    // 账本切换
    $('#ledgerChip').addEventListener('click', () =>
      openLedgerPicker((id) => { currentLedgerId = id; renderSplit($('#appMain')); })
    );

    // 结算总览
    const sb = $('#settleBox');
    const names = Object.keys(net);
    if (!names.length) sb.innerHTML = `<div class="muted" style="padding:8px 0">本账本暂无分账，先新建一笔吧。</div>`;
    else {
      let s = '<div style="margin:8px 0">';
      names.forEach((n) => {
        const v = net[n];
        const cls = v > 0.005 ? 'pos' : v < -0.005 ? 'neg' : '';
        s += `<div class="member-row"><span class="member-name">${esc(n)}</span><span class="member-bal ${cls}">${v >= 0 ? '应收 ' : '应付 '}${fmtMoney(Math.abs(v), base)}</span></div>`;
      });
      s += '</div>';
      if (settles.length) {
        s += `<div class="section-title" style="margin-top:6px">建议转账（点「确认结算」即清账）</div>`;
        settles.forEach((x) => {
          s += `<div class="settle-row">${esc(x.from)} → ${esc(x.to)}：<b>${fmtMoney(x.amount, base)}</b>
            <button class="btn" data-clear="${esc(x.from)}|${esc(x.to)}|${x.amount}" style="width:auto;padding:5px 10px;font-size:13px;margin-left:8px">确认结算</button></div>`;
        });
      } else s += `<div class="muted" style="padding:6px 0">🎉 已结清，互不欠款。</div>`;
      sb.innerHTML = s;
      on(sb, '[data-clear]', 'click', (e) => {
        const [from, to, amount] = e.currentTarget.dataset.clear.split('|');
        S.addClear({ ledgerId: led.id, from, to, amount: Number(amount), date: S.nowDate() });
        toast('已结算清账');
        renderSplit($('#appMain'));
      });
    }

    // 已结算记录（可撤销）
    const cb = $('#clearBox');
    if (cb) {
      cb.innerHTML = clears.map((c) =>
        `<div class="settle-row">${esc(c.from)} → ${esc(c.to)}：${fmtMoney(c.amount, base)}
          <button class="btn secondary" data-undo="${c.id}" style="width:auto;padding:5px 10px;font-size:13px;margin-left:8px">撤销</button></div>`
      ).join('');
      on(cb, '[data-undo]', 'click', (e) => {
        S.deleteClear(e.currentTarget.dataset.undo);
        toast('已撤销');
        renderSplit($('#appMain'));
      });
    }

    // 账单列表（仅本账本）
    const list = $('#splitList');
    if (!ledgerSplits.length) list.innerHTML = `<div class="empty"><div class="big">🤝</div>还没有分账记录</div>`;
    else {
      list.innerHTML = ledgerSplits.map((sp) => {
        const owes = S.splitOwes(sp);
        const rows = sp.members.map((m) =>
          `<div class="member-row"><span class="member-name">${esc(m.name)} <span class="muted">应付 ${fmtMoney(owes[m.name], sp.baseCurrency)}</span></span></div>`
        ).join('');
        return `
          <div class="card split-card" data-id="${sp.id}">
            <div class="card-row">
              <span class="split-title">${esc(sp.title)} ${sp.linkedTx ? '<span class="pill">已记账</span>' : ''}</span>
              <span><span class="pill">${fmtMoney(sp.total, sp.baseCurrency)}</span><span class="pill paid">${esc(sp.paidBy)}付</span></span>
            </div>
            <div class="muted" style="margin:4px 0 6px">${fmtDateTime(sp.date, S.txTime(sp))} · ${sp.method === 'equal' ? '均摊' : sp.method === 'share' ? '按比例' : '精确'}${sp.note ? ' · ' + esc(sp.note) : ''}</div>
            ${rows}
            <div class="btn-row" style="margin-top:10px">
              <button class="btn secondary" data-edit="${sp.id}" style="padding:8px">编辑</button>
              <button class="btn danger" data-del="${sp.id}" style="padding:8px">删除</button>
            </div>
          </div>`;
      }).join('');
    }

    $('#newSplit').addEventListener('click', () => openSplitSheet(null));
    on(list, '[data-edit]', 'click', (e) => {
      e.stopPropagation();
      const sp = S.load().splits.find((x) => x.id === e.currentTarget.dataset.edit);
      if (sp) openSplitSheet(sp);
    });
    on(list, '[data-del]', 'click', (e) => {
      e.stopPropagation();
      const sid = e.currentTarget.dataset.del;
      confirmSheet({ title: '确定删除这笔分账？', okText: '删除', danger: true }, () => {
        S.deleteSplit(sid); toast('已删除'); renderSplit($('#appMain'));
      });
    });
  }

  function openSplitSheet(sp) {
    const state = {
      ledgerId: sp ? sp.ledgerId : currentLedgerId,
      method: sp ? sp.method : 'equal',
      members: sp ? sp.members.map((m) => ({ name: m.name, share: m.share, amount: m.amount })) : [{ name: SELF }],
      paidBy: sp ? sp.paidBy : SELF,
      baseCurrency: sp ? sp.baseCurrency : (S.ledgerById(currentLedgerId) || {}).baseCurrency || 'CNY'
    };
    const curBase = () => S.ledgerById(state.ledgerId).baseCurrency;
    openSheet(`
      <div class="sheet-handle"></div>
      <div class="field"><label>所属账本</label>
        <select class="select" id="sLedger">${S.listLedgers().map((l) => `<option value="${l.id}" ${l.id === state.ledgerId ? 'selected' : ''}>${l.icon} ${esc(l.name)}（${l.baseCurrency}）</option>`).join('')}</select>
      </div>
      <div class="field"><label>账单名称</label><input class="input" id="sTitle" placeholder="如：周末聚餐" value="${sp ? esc(sp.title) : ''}" /></div>
      <div class="field"><label>总金额（基准货币 <span id="sBaseCode">${state.baseCurrency}</span>）</label><input class="input" id="sTotal" type="number" inputmode="decimal" placeholder="0.00" value="${sp ? money(sp.total) : ''}" /></div>
      <div id="spSection"></div>
      <div class="field" style="margin-top:10px"><label>备注</label><textarea class="input" id="sNote" placeholder="可选">${sp ? esc(sp.note) : ''}</textarea></div>
      <div class="btn-row" style="margin-top:10px">
        <button class="btn secondary" id="sCancel">取消</button>
        <button class="btn" id="sSave">${sp ? '保存修改' : '创建'}</button>
      </div>
    `, (body) => {
      buildSplitSection($('#spSection', body), state, curBase());
      $('#sCancel', body).addEventListener('click', closeSheet);
      // 账本切换 → 更新基准货币标签，并在成员为空时带入该账本同行人
      $('#sLedger', body).addEventListener('change', (e) => {
        state.ledgerId = e.target.value;
        state.baseCurrency = curBase();
        $('#sBaseCode', body).textContent = state.baseCurrency;
        if (!state.members.some((m) => m.name.trim())) {
          const comp = (S.ledgerById(state.ledgerId).companions) || [];
          state.members = comp.length ? comp.map((n) => ({ name: n })) : [{ name: '' }];
          state.paidBy = comp[0] || '';
        }
        buildSplitSection($('#spSection', body), state, state.baseCurrency);
      });
      // 新建且当前账本有同行人 → 默认带入（含本人）
      if (!sp) {
        const comp = (S.ledgerById(state.ledgerId).companions) || [];
        if (comp.length) { state.members = unique([SELF].concat(comp)).map((n) => ({ name: n })); state.paidBy = SELF; }
        buildSplitSection($('#spSection', body), state, curBase());
      }
      $('#sSave', body).addEventListener('click', () => {
        const total = parseFloat($('#sTotal', body).value);
        if (!total || total <= 0) { toast('请输入有效总金额'); return; }
        const names = state.members.map((m) => m.name.trim()).filter(Boolean);
        if (!names.length) { toast('请至少填写一名成员'); return; }
        const clean = state.members.filter((m) => m.name.trim()).map((m) => ({
          name: m.name.trim(), share: state.method === 'share' ? Number(m.share) || 0 : undefined,
          amount: state.method === 'exact' ? Number(m.amount) || 0 : undefined
        }));
        const payload = {
          ledgerId: state.ledgerId,
          title: $('#sTitle', body).value.trim() || '未命名账单',
          total, method: state.method, members: clean,
          paidBy: state.paidBy || names[0], date: sp ? sp.date : S.nowDate(),
          note: $('#sNote', body).value.trim(), baseCurrency: state.baseCurrency
        };
        if (sp) { S.updateSplit(sp.id, payload); toast('已保存'); }
        else { S.addSplit(payload); toast('已创建'); }
        closeSheet(); renderSplit($('#appMain'));
      });
    });
  }

  /* ---------------- 统计视图 ---------------- */
  function renderStats(main) {
    const led = S.ledgerById(currentLedgerId) || S.defaultLedger();
    currentLedgerId = led.id;
    const base = led.baseCurrency;
    const data = S.load();
    const months = [];
    data.transactions.filter((t) => !S.isDeleted(t) && S.belongsToLedger(t, led.id)).forEach((t) => {
      const m = (t.date || '').slice(0, 7);
      if (m && months.indexOf(m) < 0) months.push(m);
    });
    months.sort();
    if (!months.includes(statMonth)) statMonth = months[months.length - 1] || S.nowDate().slice(0, 7);
    const sel = months.length
      ? months.map((m) => `<option ${m === statMonth ? 'selected' : ''}>${m}</option>`).join('')
      : `<option>${statMonth}</option>`;

    const sum = S.monthRange(led.id, statMonth);
    const prev = prevMonth(statMonth);
    const prevSum = S.monthRange(led.id, prev);
    const spend = S.ledgerSpend(led.id);

    let budgetHTML = '';
    if (spend.budget != null) {
      const pct = spend.budget > 0 ? Math.min(100, Math.round((spend.spent / spend.budget) * 100)) : 0;
      const over = spend.spent > spend.budget;
      const scope = (led.startDate && led.endDate) ? `${led.startDate} ~ ${led.endDate}` : '本账本累计';
      budgetHTML = `
        <div class="card">
          <div class="card-row"><span class="section-title" style="margin:0">预算（${base}）</span><span class="muted">${scope}</span></div>
          <div class="stat-summary" style="margin-top:8px">
            <div class="stat-box"><div class="v">${fmtMoney(spend.spent, base)}</div><div class="l">已花</div></div>
            <div class="stat-box"><div class="v">${fmtMoney(spend.budget, base)}</div><div class="l">预算</div></div>
            <div class="stat-box"><div class="v ${over ? 'amount-expense' : ''}">${fmtMoney(Math.max(0, spend.budget - spend.spent), base)}</div><div class="l">剩余</div></div>
          </div>
          <div class="budget-bar"><div class="budget-fill ${over ? 'over' : ''}" style="width:${pct}%"></div></div>
          <div class="muted" style="text-align:center;margin-top:6px">已用 ${pct}%${over ? ' · 超支！' : ''}</div>
        </div>`;
    }

    main.innerHTML = `
      ${ledgerChipHTML(led)}
      <div class="field">
        <label>统计月份</label>
        <select class="select" id="statMonth">${sel}</select>
      </div>
      <div class="card">
        <div class="section-title">付款方式余额（各卡按自身货币）</div>
        <div id="accBalBox"></div>
      </div>
      <div class="card">
        <div class="stat-summary">
          <div class="stat-box"><div class="v amount-expense">${fmtMoney(sum.expense, base)}</div><div class="l">支出</div></div>
          <div class="stat-box"><div class="v amount-income">${fmtMoney(sum.income, base)}</div><div class="l">收入</div></div>
          <div class="stat-box"><div class="v">${fmtMoney(sum.net, base)}</div><div class="l">结余</div></div>
        </div>
        <div class="muted" style="margin-top:10px;text-align:center">
          环比上月支出 ${prevSum.expense ? (sum.expense - prevSum.expense >= 0 ? '↑' : '↓') + Math.abs(Math.round((sum.expense - prevSum.expense) / prevSum.expense * 100)) + '%' : '—'}
          ${sum.discount > 0 ? ' · 优惠 ' + fmtMoney(sum.discount, base) : ''}
        </div>
      </div>
      ${budgetHTML}
      <div class="card">
        <div class="section-title">支出分类占比（${base}）</div>
        <div class="chart-wrap" id="donutBox"></div>
        <div class="legend" id="legendBox"></div>
        ${sum.cats.length ? '' : '<div class="muted" style="text-align:center;padding:10px">本月暂无支出</div>'}
      </div>
      <div class="card">
        <div class="section-title">近 6 个月趋势（红=支出 绿=收入）</div>
        <div id="barsBox"></div>
      </div>
    `;

    $('#ledgerChip').addEventListener('click', () =>
      openLedgerPicker((id) => { currentLedgerId = id; renderStats($('#appMain')); })
    );
    $('#statMonth').addEventListener('change', (e) => { statMonth = e.target.value; renderStats($('#appMain')); });

    const donutBox = $('#donutBox');
    if (sum.cats.length) {
      C.donut(donutBox, sum.cats, { centerLabel: '支出' });
      $('#legendBox').innerHTML = sum.cats.map((c, i) => {
        const pct = ((c.amount / (sum.expense || 1)) * 100).toFixed(1);
        return `<div class="legend-item"><span class="legend-dot" style="background:${C.color(i)}"></span>${c.emoji} ${esc(c.name)} ${fmtMoney(c.amount, base)} (${pct}%)</div>`;
      }).join('');
    }

    const trend = S.monthlyTrend(led.id, 6);
    C.bars($('#barsBox'), trend.map((t) => ({ label: t.month.slice(5), income: t.income, expense: t.expense })));

    // 付款方式余额卡片（点开看明细与流水）
    const abb = $('#accBalBox');
    const accs2 = S.listAccounts();
    if (!accs2.length) abb.innerHTML = '<div class="muted" style="padding:6px 0">暂无付款方式，可在「我的」中新增。</div>';
    else {
      abb.innerHTML = accs2.map((a) => {
        const b = S.accountBalance(a.id);
        return `<div class="ledger-row acc-row" data-id="${a.id}">
          <span class="lc-icon" style="background:${a.color}">${a.icon}</span>
          <div class="lr-mid"><b>${esc(a.name)}</b></div>
          <b class="acc-bal">${fmtMoney(b.balance, b.currency)}</b>
        </div>`;
      }).join('');
      on(abb, '.acc-row', 'click', (e) => openAccountDetail(e.currentTarget.dataset.id));
    }
  }

  function prevMonth(m) {
    const [y, mo] = m.split('-').map(Number);
    const d = new Date(y, mo - 2, 1);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}`;
  }

  /* ---------------- 付款方式 / 账户 ---------------- */
  function openAccountEditor(id, ledgerId, cb) {
    const acc = id ? S.accountById(id) : null;
    const state = { icon: acc ? acc.icon : '💳', color: acc ? acc.color : '#007aff' };
    const base = acc ? acc.currency : 'CNY';
    openSheet(`
      <div class="sheet-handle"></div>
      <div class="field"><label>名称（如：招商银行储蓄卡）</label><input class="input" id="aName" placeholder="付款方式名称" value="${acc ? esc(acc.name) : ''}" /></div>
      <div class="field"><label>图标</label><div class="cat-grid" id="aIcons">${S.ACCOUNT_ICONS.map((ic) => `<div class="cat-cell ${ic === state.icon ? 'active' : ''}" data-ic="${ic}"><span class="emoji">${ic}</span></div>`).join('')}</div></div>
      <div class="field"><label>颜色</label><div class="color-row" id="aColors">${S.LEDGER_COLORS.map((c) => `<span class="color-dot ${c === state.color ? 'on' : ''}" data-c="${c}" style="background:${c}"></span>`).join('')}</div></div>
      <div class="field"><label>初始余额（${base}，选了它的收支会自动核算）</label><input class="input" id="aInit" type="number" inputmode="decimal" placeholder="0.00" value="${acc ? money(acc.initialBalance) : '0'}" /></div>
      <div class="field"><label>货币（该卡余额按此货币记账）</label><select class="select" id="aCur">${S.CURRENCIES.map((c) => `<option value="${c.code}" ${c.code === base ? 'selected' : ''}>${c.code} ${c.name}</option>`).join('')}</select></div>
      <div class="btn-row">
        <button class="btn secondary" id="aCancel">取消</button>
        <button class="btn" id="aSave">${acc ? '保存' : '创建'}</button>
      </div>
    `, (body) => {
      on(body, '#aIcons .cat-cell', 'click', (e) => {
        state.icon = e.currentTarget.dataset.ic;
        $$('#aIcons .cat-cell', body).forEach((c) => c.classList.toggle('active', c.dataset.ic === state.icon));
      });
      on(body, '#aColors .color-dot', 'click', (e) => {
        state.color = e.currentTarget.dataset.c;
        $$('#aColors .color-dot', body).forEach((c) => c.classList.toggle('on', c.dataset.c === state.color));
      });
      $('#aCancel', body).addEventListener('click', closeSheet);
      $('#aSave', body).addEventListener('click', () => {
        const name = $('#aName', body).value.trim();
        if (!name) { toast('请填写名称'); return; }
        const init = parseFloat($('#aInit', body).value) || 0;
        const cur = $('#aCur', body).value;
        let savedId = acc ? acc.id : null;
        if (acc) { S.updateAccount(acc.id, { name, icon: state.icon, color: state.color, initialBalance: init, currency: cur }); toast('已保存'); }
        else { const na = S.addAccount({ name, icon: state.icon, color: state.color, initialBalance: init, currency: cur }); savedId = na.id; toast('已创建'); }
        closeSheet();
        if (currentView === 'record') renderRecord($('#appMain'));
        else if (currentView === 'stats') renderStats($('#appMain'));
        else if (currentView === 'me') renderMe($('#appMain'));
        if (cb) cb(savedId);
      });
    });
  }

  function openAccountDetail(id) {
    const info = S.accountTransactions(id);
    const acc = info.account;
    if (!acc) return;
    const bal = S.accountBalance(id);
    const base = acc.currency;
    const rows = info.items.map((it) => {
      const t = it.tx;
      const m = S.currencyMeta(t.currency);
      if (it.transfer) {
        const other = S.accountById(it.otherId);
        const arrow = it.direction === 'out' ? '→' : '←';
        const sign = it.direction === 'out' ? '-' : '+';
        const cls = it.direction === 'out' ? 'exp' : 'inc';
        const dm = S.currencyMeta(it.displayCurrency);
        const cross = it.displayCurrency && it.displayCurrency !== t.currency;
        return `<div class="tx-item" data-id="${t.id}">
            <div class="tx-emoji">💸</div>
            <div class="tx-mid">
              <div class="tx-cat">转账 ${arrow} ${esc(other ? other.name : '?')}${cross ? ' · 跨货币' : ''}</div>
              <div class="tx-note">${fmtDateTime(t.date, S.txTime(t))}${t.note ? ' · ' + esc(t.note) : ''}</div>
            </div>
            <div class="tx-amt ${cls}">${sign}${dm.sym}${money(it.displayAmount)}<span class="tx-code">${esc(it.displayCurrency)}</span></div>
          </div>
          <div class="muted" style="text-align:right;margin:-6px 6px 8px">余额 ${fmtMoney(it.after, base)}</div>`;
      }
      const meta = S.catMeta(t.type, t.category);
      if (t.type === 'refund') {
        const dir = t.parentType === 'expense' ? '+' : '-';
        const dc = S.currencyMeta(it.displayCurrency);
        return `<div class="tx-item" data-id="${t.id}">
            <div class="tx-emoji">↩️</div>
            <div class="tx-mid">
              <div class="tx-cat">退款 <span class="pill refund">${t.parentType === 'income' ? '收入退回' : '支出退回'}</span></div>
              <div class="tx-note">${fmtDateTime(t.date, S.txTime(t))}${t.note ? ' · ' + esc(t.note) : ''}</div>
            </div>
            <div class="tx-amt refund">${dir}${dc.sym}${money(it.displayAmount)}<span class="tx-code">${esc(it.displayCurrency)}</span></div>
          </div>
          <div class="muted" style="text-align:right;margin:-6px 6px 8px">余额 ${fmtMoney(it.after, base)}</div>`;
      }
      const sign = t.type === 'income' ? '+' : '-';
      const cls = t.type === 'income' ? 'inc' : 'exp';
      return `<div class="tx-item" data-id="${t.id}">
          <div class="tx-emoji">${meta.emoji}</div>
          <div class="tx-mid">
            <div class="tx-cat">${esc(meta.name)}</div>
            <div class="tx-note">${fmtDate(t.date)}${t.note ? ' · ' + esc(t.note) : ''}</div>
          </div>
          <div class="tx-amt ${cls}">${sign}${m.sym}${money(t.amount)}</div>
        </div>
        <div class="muted" style="text-align:right;margin:-6px 6px 8px">余额 ${fmtMoney(it.after, base)}</div>`;
    }).join('');
    openSheet(`
      <div class="sheet-handle"></div>
      <div class="card-row"><span class="lc-icon" style="background:${acc.color}">${acc.icon}</span>
        <div class="lr-mid"><b>${esc(acc.name)}</b><span class="muted">初始余额 ${fmtMoney(bal.initialBalance, base)}</span></div></div>
      <div class="big-amount ${bal.balance >= 0 ? '' : 'amount-expense'}">当前余额 ${fmtMoney(bal.balance, base)}</div>
      <div class="card-row" style="margin-top:6px">
        <button class="btn secondary" id="accTransfer" style="flex:1">💸 转账</button>
        <button class="btn secondary" id="accEdit" style="flex:1;margin-left:8px">编辑</button>
        <button class="btn danger" id="accDel" style="flex:1;margin-left:8px">删除</button>
      </div>
      <div class="section-title" style="margin-top:12px">流水（${info.items.length} 笔，最新在前）</div>
      <div id="accTx" class="tx-list"></div>
    `, (body) => {
      $('#accTx', body).innerHTML = rows || '<div class="muted" style="padding:10px;text-align:center">暂无流水</div>';
      on($('#accTx', body), '.tx-item', 'click', (e) => {
        const t = S.getTransaction(e.currentTarget.dataset.id);
        if (!t) return;
        openTxActions(t);
      });
      $('#accTransfer', body).addEventListener('click', () => { closeSheet(); openTransferSheet(null, { fromId: id }); });
      $('#accEdit', body).addEventListener('click', () => { closeSheet(); openAccountEditor(id, acc.ledgerId, () => openAccountDetail(id)); });
      $('#accDel', body).addEventListener('click', () => {
        closeSheet();
        confirmSheet({ title: '删除该付款方式？', desc: '有流水的账户不可删除。', okText: '删除', danger: true }, () => {
          if (S.deleteAccount(id)) { toast('已删除'); renderMe($('#appMain')); }
          else toast('该付款方式已有流水，无法删除');
        });
      });
    });
  }

  /* ---------------- 类别管理 ---------------- */
  function renderCatManager(box, type) {
    const title = type === 'income' ? '收入类别' : '支出类别';
    const cats = S.getCategories(type);
    box.innerHTML = `<div class="muted" style="margin:8px 0 6px">${title}</div>
      <div class="chips">${cats.map((c) => `<span class="chip cat-chip" data-key="${c.key}">${c.emoji} ${esc(c.name)} <span class="chip-x" data-del="${c.key}">✕</span></span>`).join('')}
      <span class="chip chip-add" data-add="${type}">＋ 添加</span></div>`;
    on(box, '[data-del]', 'click', (e) => {
      e.stopPropagation();
      const key = e.currentTarget.dataset.del;
      if (S.getCategories(type).length <= 1) { toast('至少保留一个类别'); return; }
      S.deleteCategory(type, key); toast('已删除');
      if (type === 'expense') renderCatManager($('#catExp'), 'expense');
      else renderCatManager($('#catInc'), 'income');
    });
    on(box, '[data-add]', 'click', () => openCategoryEditor(type, null));
  }

  function openCategoryEditor(type, key) {
    const cat = key ? S.getCategories(type).find((c) => c.key === key) : null;
    const state = { emoji: cat ? cat.emoji : S.CAT_EMOJIS[0] };
    openSheet(`
      <div class="sheet-handle"></div>
      <div class="field"><label>类别名称</label><input class="input" id="cName" placeholder="如：打车" value="${cat ? esc(cat.name) : ''}" /></div>
      <div class="field"><label>图标</label><div class="cat-grid" id="cEmojis">${S.CAT_EMOJIS.map((e) => `<div class="cat-cell ${e === state.emoji ? 'active' : ''}" data-e="${e}"><span class="emoji">${e}</span></div>`).join('')}</div></div>
      <div class="btn-row">
        <button class="btn secondary" id="cCancel">取消</button>
        <button class="btn" id="cSave">${cat ? '保存' : '添加'}</button>
      </div>
    `, (body) => {
      const grid = $('#cEmojis', body);
      on(grid, '.cat-cell', 'click', (e) => {
        state.emoji = e.currentTarget.dataset.e;
        $$('.cat-cell', grid).forEach((c) => c.classList.toggle('active', c.dataset.e === state.emoji));
      });
      $('#cCancel', body).addEventListener('click', closeSheet);
      $('#cSave', body).addEventListener('click', () => {
        const name = $('#cName', body).value.trim();
        if (!name) { toast('请填写名称'); return; }
        if (cat) { S.updateCategory(type, key, { name, emoji: state.emoji }); toast('已保存'); }
        else { S.addCategory(type, { name, emoji: state.emoji }); toast('已添加'); }
        closeSheet();
        if (type === 'expense') renderCatManager($('#catExp'), 'expense');
        else renderCatManager($('#catInc'), 'income');
      });
    });
  }

  /* ---------------- 我的 ---------------- */
  function renderMe(main) {
    const led = S.ledgerById(currentLedgerId) || S.defaultLedger();
    const accs = S.listAccounts();
    main.innerHTML = `
      <div class="card" id="cloudCard">
        <div class="section-title">云端同步（Supabase）</div>
        <div id="cloudBody"></div>
      </div>
      <div class="card">
        <div class="section-title">快捷记账</div>
        <div class="set-item" id="quickEntry">⚡ 快捷指令 <span class="muted">说一句话就记账 ▾</span></div>
      </div>
      <div class="card">
        <div class="section-title">账本</div>
        <div class="set-item" id="openMgr">账本管理 <span class="muted">新建 / 编辑 / 删除 ▾</span></div>
      </div>
      <div class="card">
        <div class="card-row"><div class="section-title" style="margin:0">付款方式（全局通用）</div><button class="btn secondary" id="addAcc" style="width:auto;padding:6px 12px;font-size:13px">＋ 新增</button></div>
        <div id="accList" style="margin-top:8px"></div>
      </div>
      <div class="card">
        <div class="section-title">类别管理</div>
        <div id="catExp"></div>
        <div id="catInc"></div>
      </div>
      <div class="card">
        <div class="section-title">数据备份（本地存储）</div>
        <button class="btn" id="exportBtn">导出备份（复制 JSON）</button>
        <textarea class="input" id="backupBox" readonly placeholder="点击上方导出，会把全部数据以 JSON 显示在这里，可复制保存。" style="margin-top:8px"></textarea>
        <textarea class="input" id="importBox" placeholder="把备份 JSON 粘贴到这里，再点导入。" style="margin-top:8px"></textarea>
        <div class="btn-row" style="margin-top:8px">
          <button class="btn secondary" id="copyBtn">复制导出</button>
          <button class="btn" id="importBtn">导入</button>
        </div>
      </div>
      <div class="card">
        <div class="section-title">操作</div>
        <div class="set-item" id="clearBtn">清空所有数据 <span class="muted">⚠️ 不可恢复</span></div>
      </div>
      <div class="card">
        <div class="section-title">关于</div>
        <div class="muted" style="line-height:1.6">
          随手记账 · 纯本地 PWA<br/>
          数据仅保存在本机浏览器，不会上传。<br/>
          在 iPhone 上：用 Safari 打开 → 点击底部「分享」→「添加到主屏幕」，即可像 App 一样使用。
        </div>
      </div>
    `;
    // 付款方式列表（点开看明细与流水）
    const accBox = $('#accList');
    if (!accs.length) accBox.innerHTML = '<div class="muted" style="padding:8px 0">暂无付款方式，点「＋ 新增」添加（如银行卡并设定余额）。</div>';
    else {
      const base = led.baseCurrency;
      accBox.innerHTML = accs.map((a) => {
        const b = S.accountBalance(a.id);
        return `<div class="ledger-row acc-row" data-id="${a.id}">
          <span class="lc-icon" style="background:${a.color}">${a.icon}</span>
          <div class="lr-mid"><b>${esc(a.name)}</b><span class="muted">初始 ${fmtMoney(b.initialBalance, b.currency)}</span></div>
          <b class="acc-bal">${fmtMoney(b.balance, b.currency)}</b>
        </div>`;
      }).join('');
      on(accBox, '.acc-row', 'click', (e) => openAccountDetail(e.currentTarget.dataset.id));
    }
    $('#addAcc').addEventListener('click', () => openAccountEditor(null, led.id, () => renderMe($('#appMain'))));
    // 类别管理
    renderCatManager($('#catExp'), 'expense');
    renderCatManager($('#catInc'), 'income');
    $('#openMgr').addEventListener('click', openLedgerManager);
    $('#quickEntry').addEventListener('click', openShortcutSheet);
    $('#exportBtn').addEventListener('click', () => { $('#backupBox').value = S.exportAll(); toast('已生成备份'); });
    $('#copyBtn').addEventListener('click', () => {
      const v = $('#backupBox').value;
      if (!v) { toast('请先导出'); return; }
      if (navigator.clipboard) navigator.clipboard.writeText(v).then(() => toast('已复制'), () => toast('复制失败，请手动'));
      else toast('请手动复制');
    });
    $('#importBtn').addEventListener('click', () => {
      const v = $('#importBox').value.trim();
      if (!v) { toast('请先粘贴备份'); return; }
      try { S.importAll(v); toast('导入成功'); currentLedgerId = S.defaultLedger().id; renderMe($('#appMain')); }
      catch (e) { toast('JSON 格式错误'); }
    });
    $('#clearBtn').addEventListener('click', () => {
      confirmSheet({ title: '确定清空所有数据？', desc: '记账、分账与账本数据将全部清除，<b>此操作不可恢复</b>！', okText: '清空', danger: true }, () => {
        localStorage.removeItem('ledger_data_v1'); S.ensureSeed();
        currentLedgerId = S.defaultLedger().id; toast('已清空'); renderMe($('#appMain'));
      });
    });
    renderCloudBody();
  }

  /* ---------------- 云端同步 UI ---------------- */
  function statusText(s) {
    return ({ local: '仅本地', syncing: '同步中…', synced: '已同步', error: '同步出错' })[s] || s;
  }
  function renderCloudBody() {
    const box = $('#cloudBody'); if (!box) return;
    const Hub = window.SyncHub;
    if (!Hub) { box.innerHTML = '<div class="muted">同步模块未加载</div>'; return; }
    if (!Hub.isConfigured()) {
      box.innerHTML = `
        <div class="muted" style="line-height:1.6;margin-bottom:8px">尚未配置云端。在 Supabase 免费创建项目、执行 supabase_schema.sql、填入 URL 与 anon key，即可开启多设备同步与备份（详见 SETUP.md）。</div>
        <button class="btn" id="cfgCloud">配置云端</button>`;
      $('#cfgCloud', box).addEventListener('click', openCloudSheet);
      return;
    }
    const sess = (Hub.currentUser && Hub.currentUser()) || null;
    if (!sess) {
      box.innerHTML = `
        <div class="muted" style="margin-bottom:8px">已配置云端，但尚未登录。</div>
        <button class="btn" id="loginCloud">登录 / 注册</button>
        <button class="btn secondary" id="reCfg" style="margin-left:8px">修改配置</button>`;
      $('#loginCloud', box).addEventListener('click', openCloudSheet);
      $('#reCfg', box).addEventListener('click', openCloudSheet);
      return;
    }
    const st = S.getSyncState();
    const last = st.lastSync ? new Date(st.lastSync).toLocaleString() : '尚未同步';
    box.innerHTML = `
      <div class="card-row"><span class="muted">已登录</span><b>${esc(sess.email || (sess.phone || '账号'))}</b></div>
      <div class="muted" style="margin:4px 0">状态：${esc(statusText(st.status))} · 上次同步：${last}</div>
      <div class="btn-row">
        <button class="btn" id="syncNowBtn">立即同步</button>
        <button class="btn secondary" id="logoutCloud" style="margin-left:8px">退出登录</button>
      </div>`;
    $('#syncNowBtn', box).addEventListener('click', async () => {
      toast('同步中…');
      const r = await S.pullAndMerge();
      toast(r.error ? ('同步失败：' + r.error) : '已同步');
      updateSyncUI();
    });
    $('#logoutCloud', box).addEventListener('click', async () => {
      await Hub.signOut(); updateSyncUI(); toast('已退出登录');
    });
  }

  function updateSyncUI() {
    renderCloudBody();
    const dot = $('#cloudDot');
    if (dot) {
      const Hub = window.SyncHub;
      const logged = Hub && Hub.isSignedIn && Hub.isSignedIn();
      const st = S.getSyncState();
      dot.textContent = logged ? '☁' : '☁︎';
      dot.style.opacity = logged ? '1' : '0.35';
      dot.classList.toggle('spin', st.status === 'syncing');
    }
  }

  function openCloudSheet() {
    const Hub = window.SyncHub;
    if (!Hub) { toast('同步模块未加载'); return; }
    if (!Hub.isConfigured()) { openCloudConfigSheet(); return; }
    const sess = (Hub.currentUser && Hub.currentUser()) || null;
    if (!sess) { openLoginSheet(); return; }
    openCloudAccountSheet(sess);
  }

  function openCloudConfigSheet() {
    const Hub = window.SyncHub;
    const cfg = (window.loadCloudConfig && window.loadCloudConfig()) || { supabaseUrl: '', supabaseAnonKey: '' };
    openSheet(`
      <div class="sheet-handle"></div>
      <div class="section-title">配置云端（Supabase）</div>
      <div class="muted" style="margin-bottom:8px">在 supabase.com 免费建项目 → SQL Editor 执行项目里的 supabase_schema.sql → 后台 Settings/API 复制 URL 与 anon key 填这里。详见 SETUP.md。</div>
      <div class="field"><label>Supabase URL</label><input class="input" id="cUrl" placeholder="https://xxxx.supabase.co" value="${esc(cfg.supabaseUrl || '')}"/></div>
      <div class="field"><label>Anon Key（公开，可放前端）</label><input class="input" id="cKey" placeholder="eyJ..." value="${esc(cfg.supabaseAnonKey || '')}"/></div>
      <div class="btn-row">
        <button class="btn secondary" id="cCancel">取消</button>
        <button class="btn" id="cSave">保存并继续</button>
      </div>
    `, (body) => {
      $('#cCancel', body).addEventListener('click', closeSheet);
      $('#cSave', body).addEventListener('click', () => {
        const url = $('#cUrl', body).value.trim();
        const key = $('#cKey', body).value.trim();
        if (!url || !key) { toast('请填写完整'); return; }
        window.saveCloudConfig(url, key);
        Hub.init();
        closeSheet();
        openLoginSheet();
      });
    });
  }

  function openLoginSheet() {
    const Hub = window.SyncHub;
    openSheet(`
      <div class="sheet-handle"></div>
      <div class="section-title">登录 / 注册（同一邮箱多设备即同步）</div>
      <div class="field"><label>邮箱</label><input class="input" id="lEmail" type="email" placeholder="you@example.com" autocomplete="email"/></div>
      <div class="field"><label>密码（至少 6 位）</label><input class="input" id="lPass" type="password" placeholder="******" autocomplete="current-password"/></div>
      <div class="muted" style="margin:4px 0 8px">首次使用点「注册」；如注册后要求验证邮箱，可在 Supabase 后台关闭 Email Confirmation。</div>
      <div class="btn-row">
        <button class="btn secondary" id="lReg">注册</button>
        <button class="btn" id="lSign">登录</button>
      </div>
    `, (body) => {
      $('#lReg', body).addEventListener('click', async () => {
        const email = $('#lEmail', body).value.trim();
        const pass = $('#lPass', body).value;
        if (!email || pass.length < 6) { toast('邮箱有效且密码≥6位'); return; }
        toast('注册中…');
        const r = await Hub.signUp(email, pass);
        if (r.error) { toast('注册失败：' + r.error); return; }
        if (!r.session) { toast('注册成功，请查收验证邮件后登录（或关闭邮箱确认）'); closeSheet(); updateSyncUI(); return; }
        toast('注册并登录成功'); closeSheet(); afterLogin();
      });
      $('#lSign', body).addEventListener('click', async () => {
        const email = $('#lEmail', body).value.trim();
        const pass = $('#lPass', body).value;
        if (!email || !pass) { toast('请填写邮箱和密码'); return; }
        toast('登录中…');
        const r = await Hub.signIn(email, pass);
        if (r.error) { toast('登录失败：' + r.error); return; }
        toast('登录成功'); closeSheet(); afterLogin();
      });
    });
  }

  function openCloudAccountSheet(sess) {
    const Hub = window.SyncHub;
    const st = S.getSyncState();
    const last = st.lastSync ? new Date(st.lastSync).toLocaleString() : '尚未同步';
    openSheet(`
      <div class="sheet-handle"></div>
      <div class="section-title">云端同步</div>
      <div class="card-row"><span class="muted">已登录</span><b>${esc(sess.email || '账号')}</b></div>
      <div class="muted" style="margin:6px 0">状态：${esc(statusText(st.status))} · 上次同步：${last}</div>
      <div class="btn-row">
        <button class="btn" id="csSync">立即同步</button>
        <button class="btn secondary" id="csCfg" style="margin-left:8px">修改配置</button>
      </div>
      <div class="btn-row" style="margin-top:8px">
        <button class="btn danger" id="csLogout">退出登录</button>
      </div>
    `, (body) => {
      $('#csSync', body).addEventListener('click', async () => {
        toast('同步中…'); const r = await S.pullAndMerge(); toast(r.error ? ('失败：' + r.error) : '已同步'); updateSyncUI();
      });
      $('#csCfg', body).addEventListener('click', () => { closeSheet(); openCloudConfigSheet(); });
      $('#csLogout', body).addEventListener('click', async () => { await Hub.signOut(); closeSheet(); updateSyncUI(); toast('已退出'); });
    });
  }

  function afterLogin() {
    updateSyncUI();
    S.pullAndMerge().then((r) => {
      if (!r.error) {
        currentLedgerId = (S.defaultLedger() || {}).id;
        if (currentView === 'record') renderRecord($('#appMain'));
        else if (currentView === 'me') renderMe($('#appMain'));
      } else {
        toast('首次同步：已上传本地数据');
      }
    });
  }

  async function initCloud() {
    const Hub = window.SyncHub;
    if (!Hub || !Hub.isConfigured || !Hub.isConfigured()) return;
    Hub.init();
    let sess = null;
    try { sess = await Hub.getSession(); } catch (e) {}
    S.onSync(updateSyncUI);
    if (sess) {
      const r = await S.pullAndMerge();
      if (!r.error) currentLedgerId = (S.defaultLedger() || {}).id;
    }
    Hub.onAuthChange(function (s2) {
      updateSyncUI();
      if (s2) S.pullAndMerge();
    });
    updateSyncUI();
  }

  /* ---------------- 启动 ---------------- */
  async function init() {
    S.ensureSeed();
    S.normalize();
    currentLedgerId = (S.defaultLedger() || {}).id;
    $$('.tab-item').forEach((b) => b.addEventListener('click', () => go(b.dataset.view)));
    $('#sheetMask').addEventListener('click', closeSheet);
    const dot = $('#cloudDot');
    if (dot) dot.addEventListener('click', openCloudSheet);
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
    }
    await initCloud();
    go('record');
    // 交接给快速记账模块：处理 ?quick=1 网址调用与分享面板文本
    if (window.QuickAdd && window.QuickAdd.boot) {
      window.QuickAdd.boot({
        toast: toast,
        close: closeSheet,
        refresh: refreshAfterChange,
        openQuickPanel: openQuickPanel,
      });
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
