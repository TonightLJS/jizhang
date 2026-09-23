/* 随手记账 —— 快速记账 / 快捷指令解析层
 *
 * 用途：把一句中文口语（"午饭35"、"打车 12.5 微信"、"昨天超市120"）解析成一条记账记录，
 *       并支持通过 URL 参数直接被 iOS 快捷指令 / 分享面板 / Siri 调用。
 *
 * ── 快捷指令调用格式（最常用）─────────────────────────────
 *   https://tonightljs.github.io/jizhang/?quick=1&text=午饭35&auto=1
 *     quick=1  打开 App 并弹出「快速记账」面板
 *     text=... 要识别的那句话（中文需 URL 编码，快捷指令会自动编码）
 *     auto=1   识别成功且金额唯一时直接记账，不弹面板（适合 Siri 无感记账）
 *     type=    强制指定 expense / income（可选）
 *     cat=     强制指定分类 key（可选，如 food）
 *     acc=     强制指定付款方式名或 id（可选，如 微信）
 *     date=    指定日期 YYYY-MM-DD（可选）
 *     back=1   记完后自动收起面板（可选）
 *
 * ── 页面内调用 ─────────────────────────────────────────────
 *   QuickAdd.parse('午饭35')        -> { ok, record, tips, ... }
 *   QuickAdd.record(record)         -> 真正写入
 *   QuickAdd.open('午饭35', {auto:true})
 *
 * 设计原则：纯本地、零依赖、失败绝不抛异常，一律返回带 tips 的结果对象。
 */
(function () {
  'use strict';

  var S = null; // 延迟取 window.Store（本文件在 store.js 之后加载）

  /* ============================ 词库 ============================ */

  // 分类别名（key 为 Store 里的分类 key）。命中即作为分类提示。
  var CAT_WORDS = {
    food: ['午饭', '午饭', '早餐', '早饭', '午餐', '中饭', '晚饭', '晚餐', '夜宵', '宵夜', '外卖', '吃饭', '吃饭', '聚餐', '下馆子', '食堂', '饭店', '餐厅', '火锅', '烧烤', '奶茶', '咖啡', '星巴克', '瑞幸', '麦当劳', '肯德基', 'kfc', '必胜客', '面包', '蛋糕', '水果', '零食', '饮料', '可乐', '啤酒', '喝酒', 'food', 'lunch', 'dinner', 'breakfast', 'coffee'],
    transport: ['打车', '打的', '滴滴', '出租车', '地铁', '公交', '巴士', '高铁', '火车', '飞机', '车票', '加油', '油费', '停车', '停车费', '过路费', '高速费', '共享单车', '单车', '骑车', 'taxi', 'uber', 'metro', 'bus', 'train', 'flight', 'gas', 'parking'],
    shopping: ['购物', '买东西', '买了个', '买了', '淘宝', '天猫', '京东', '拼多多', '网购', '快递', '日用品', '衣服', '鞋', '裤子', '裙子', '包包', '化妆品', '护肤品', '电器', '数码', '手机', '电脑', '耳机', 'shopping', 'taobao', 'jd'],
    home: ['房租', '租金', '水电', '电费', '水费', '燃气', 'gas费', '物业', '物业费', '宽带', '网费', '家政', '保洁', '维修', '家具', '房租', 'rent', 'utility', 'utilities'],
    fun: ['娱乐', '电影', '看电影', '游戏', '充游戏', '演唱会', '门票', 'ktv', '唱歌', '酒吧', '密室', '剧本杀', '按摩', '足疗', 'spa', '健身', '健身房', '游泳', '运动', '球票', 'movie', 'game', 'entertainment', 'gym'],
    medical: ['医疗', '看病', '挂号', '医院', '药', '买药', '药品', '体检', '牙医', '看牙', '诊所', '疫苗', 'medical', 'hospital', 'medicine', 'doctor'],
    study: ['学习', '买书', '书', '图书', '课程', '网课', '培训', '考试', '报名费', '学费', '文具', 'study', 'course', 'book', 'tuition'],
    phone: ['通讯', '话费', '充值话费', '流量', '手机费', '宽带费', '电话费', 'phone', 'mobile', 'data'],
    travel: ['旅行', '旅游', '酒店', '住宿', '民宿', '门票', '景点', '出差', '机票', '度假', 'travel', 'hotel', 'trip', 'flight'],
    pet: ['宠物', '猫', '狗', '猫粮', '狗粮', '猫砂', '宠物医院', '疫苗', '铲屎', '宠物用品', 'pet', 'cat', 'dog'],
    gift: ['人情', '红包', '送礼', '礼物', '份子钱', '随礼', '请客', 'gift', 'present'],
    other_exp: ['其他', '杂费', '罚款', '捐款', 'other']
  };

  // 收入分类别名
  var INCOME_WORDS = {
    salary: ['工资', '薪水', '发薪', '月薪', 'salary', 'payroll', 'wage'],
    bonus: ['奖金', '年终奖', '绩效', '提成', 'bonus'],
    invest: ['理财', '基金', '股票', '利息', '分红', '收益', '投资', 'invest', 'dividend', 'interest'],
    parttime: ['兼职', '外快', '副业', '接活', 'parttime', 'freelance'],
    redbag: ['红包', '收红包', '微信红包', '压岁钱', 'redbag', 'red packet'],
    other_inc: ['退款', '报销', '退货', '补偿', '收到', '收入', '进账', 'other income']
  };

  // 强收入信号词（出现即判为收入，除非用户显式写"支出"）
  var INCOME_SIGNALS = ['收入', '收到', '进账', '到账', '赚了', '赚', '报销', '发工资', '发了工资', '中奖', '退款到账', '收了'];
  // 强支出信号词
  var EXPENSE_SIGNALS = ['支出', '花了', '付了', '消费', '支出', '扣款', '支付了', '买了', '买了单', '买单'];

  // 账户别名（映射到 Store 里账户的 name）
  var ACCOUNT_WORDS = [  // re 带 /g，用 .match() 前需重置 lastIndex
    { re: /(微信|wechat|wx)/gi, name: '微信' },
    { re: /(支付宝|alipay|zfb)/gi, name: '支付宝' },
    { re: /(银行卡|储蓄卡|信用卡|储蓄|借记|招行|工行|建行|农行|中行|交行|visa|master|银联)/gi, name: '银行卡' },
    { re: /(现金|现钞|钞票|钱包|cash)/gi, name: '现金' }
  ];

  // 货币符号 / 代码
  // 注意：每个 re 必须带 /g —— 下面用 .test() 探测后会复用同一个正则对象，
  //       缺 /g 时 lastIndex 不会推进反而更危险；带 /g 且每次 test 前重置才安全。
  var CURRENCY_WORDS = [
    { re: /(人民币|rmb|cny|￥|¥)/gi, code: 'CNY' },
    { re: /(美元|美金|usd|[$])/gi, code: 'USD' },
    { re: /(欧元|eur|€)/gi, code: 'EUR' },
    { re: /(港币|港元|hkd|hk[$])/gi, code: 'HKD' },
    { re: /(日元|日圆|jpy|円)/gi, code: 'JPY' },
    { re: /(韩元|韩币|krw|₩)/gi, code: 'KRW' },
    { re: /(英镑|gbp|£)/gi, code: 'GBP' },
    { re: /(泰铢|thb|฿)/gi, code: 'THB' },
    { re: /(新币|新加坡元|sgd|s[$])/gi, code: 'SGD' }
  ];

  /** 安全探测：带 /g 的正则用 .test() 会污染 lastIndex，必须先归零 */
  function reTest(re, str) { re.lastIndex = 0; return re.test(str); }

  // 相对日期
  var DAY_WORDS = [
    { re: /(前天)/, offset: -2 },
    { re: /(昨天|昨晚|昨日)/, offset: -1 },
    { re: /(今天|今晚|今早|今日|刚刚|刚才|现在)/, offset: 0 },
    { re: /(明天|明早|明晚)/, offset: 1 },
    { re: /(后天)/, offset: 2 }
  ];

  var CN_NUM = { '零': 0, '〇': 0, '一': 1, '壹': 1, '二': 2, '两': 2, '贰': 2, '三': 3, '叁': 3, '四': 4, '肆': 4, '五': 5, '伍': 5, '六': 6, '陆': 6, '七': 7, '柒': 7, '八': 8, '捌': 8, '九': 9, '玖': 9 };
  var CN_UNIT = { '十': 10, '拾': 10, '百': 100, '佰': 100, '千': 1000, '仟': 1000, '万': 10000, '亿': 100000000 };
  var CN_NUM_ALL = '零〇一壹二两贰三叁四肆五伍六陆七柒八捌九玖十拾百佰千仟万';

  /* ============================ 工具 ============================ */

  function store() {
    if (!S) S = (typeof window !== 'undefined' && window.Store) || null;
    return S;
  }

  function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function shiftDate(days) {
    var d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() + days);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function todayStr() { return shiftDate(0); }

  /** 中文数字 → 阿拉伯数字
   *  "三十五"→35  "十五"→15  "两百"→200  "两千三"→2300  "一千二"→1200  "一万二"→12000
   *  口诀：「一千二」= 1000 + 200（末位是倍率单位 百/千/万/亿 时，省略的数字按下一级单位补）
   */
  function cnToNum(s) {
    if (!s) return NaN;
    if (/^\d+(\.\d+)?$/.test(s)) return parseFloat(s);
    var LOW = { '十': 10, '拾': 10, '百': 100, '佰': 100, '千': 1000, '仟': 1000 };
    var HIGH = { '万': 10000, '亿': 100000000 };
    var total = 0, section = 0, num = null, lastUnit = 0, hasUnit = false;
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      // 进位数：把当前累积的 section 进位（"两百" → 200，"两千三" → 2000+）
      if (ch in LOW) {
        var lu = LOW[ch];
        section += (num == null ? 1 : num) * lu;
        num = null; lastUnit = lu; hasUnit = true; continue;
      }
      // 万/亿：先结清 section 再进位
      if (ch in HIGH) {
        var hu = HIGH[ch];
        section = (section + (num == null ? 0 : num)) * hu;
        total += section; section = 0; num = null; lastUnit = hu; hasUnit = true; continue;
      }
      // 数字：若上一位是进位数单位，说明这是「省略了单位的下一级」
      //   "两千三" → 遇到「三」时上一位是「千」→ 三应理解为 3 百 → +300
      //   "三十五" → 遇到「五」时上一位是「十」→ 5 无需补位（十是最低级）
      if (ch in CN_NUM) {
        var v = CN_NUM[ch];
        if (lastUnit >= 100) section += v * (lastUnit / 10);
        else num = v;
        lastUnit = 0; continue;
      }
      return NaN; // 混入非数字字符
    }
    var value = total + section + (num == null ? 0 : num);
    if (value === 0 && !hasUnit) return NaN;
    return value;
  }

  /* ============================ 解析 ============================ */

  /**
   * 解析一句中文口语为记账草稿。
   * @returns {{ok:boolean, record?:object, tips:string[], raw:string, candidates?:number[]}}
   */
  function parse(input, opts) {
    opts = opts || {};
    var raw = String(input == null ? '' : input).trim();
    var tips = [];
    var text = raw;

    if (!text) {
      return { ok: false, tips: ['没有识别到内容，试着说「午饭35」'], raw: raw };
    }

    // 0) 预处理
    //   先保护小数点：中文口语「打车12.5」里的 . 不能被当句读切掉，否则会拆成 12 和 5
    text = text.replace(/(\d)\s*\.\s*(\d)/g, '$1\u0001$2');
    text = text
      .replace(/[，。！？、；：,.!?;:]/g, ' ')   // 此处切分句读
      .replace(/[（(]([^）)]*)[）)]/g, ' ')
      .replace(/花了|花掉|一共|总共|共计|合计|大概|差不多|大约|左右|消费了/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\u0001/g, '.');                 // 还原小数点

    var consumed = []; // 记录已消费的片段，剩余的作为备注

    /* ---- 1) 日期 ---- */
    var dateStr = opts.date || '';
    for (var i = 0; i < DAY_WORDS.length; i++) {
      if (reTest(DAY_WORDS[i].re, text)) {
        if (!dateStr) dateStr = shiftDate(DAY_WORDS[i].offset);
        text = text.replace(DAY_WORDS[i].re, ' ');
        break;
      }
    }
    // 显式日期 9月23日 / 09-23 / 2026-09-23
    var mdate = text.match(/(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})/);
    if (mdate && !dateStr) {
      dateStr = mdate[1] + '-' + pad2(+mdate[2]) + '-' + pad2(+mdate[3]);
      text = text.replace(mdate[0], ' ');
    } else {
      var md = text.match(/(\d{1,2})月(\d{1,2})[日号]?/);
      if (md && !dateStr) {
        var y = new Date().getFullYear();
        dateStr = y + '-' + pad2(+md[1]) + '-' + pad2(+md[2]);
        text = text.replace(md[0], ' ');
      }
    }
    if (!dateStr) dateStr = todayStr();

    /* ---- 1.5) 货币（必须在裁掉金额之前识别，否则「30美元」的「美元」会被当金额单位吃掉）---- */
    var currency = opts.currency || '';
    if (!currency) {
      for (var ci = 0; ci < CURRENCY_WORDS.length; ci++) {
        if (reTest(CURRENCY_WORDS[ci].re, raw)) { currency = CURRENCY_WORDS[ci].code; break; }
      }
    }

    /* ---- 2) 金额 ---- */
    // 优先级：带前缀/后缀关键词 > 带货币符号 > 带小数 > 第一个数字
    var amount = NaN;
    var candidates = [];

    // 2a) 金额候选：货币符号前缀 / 数字+单位后缀 / 裸数字
    //     注意：符号类正则必须放在「裸数字」之前，否则 ¥/$ 会被当成普通字符跳过
    //     单位要用整词边界，避免「30美元」只吃到「30」（美元属于货币词，不是金额单位）
    var MONEY_UNIT = '(?:元钱|块钱|元|块|圆|人民币|rmb|刀|dollars?|yuan)';
    var moneys = [
      { re: /(?:¥|￥|\$|€|£|₩|฿)\s*(\d+(?:\.\d{1,2})?)/g, money: true },
      { re: new RegExp('(\\d+(?:\\.\\d{1,2})?)\\s*' + MONEY_UNIT, 'gi'), money: true },
      { re: /(\d+(?:\.\d{1,2})?)/g, money: false }
    ];
    var seen = {};
    moneys.forEach(function (spec) {
      var m;
      while ((m = spec.re.exec(text)) !== null) {
        var v = parseFloat(m[1]);
        if (isNaN(v) || v <= 0) continue;
        var key = m.index + ':' + m[1];
        if (seen[key]) continue;
        seen[key] = 1;
        var hasUnit = /元钱|块钱|元|块|圆/.test(m[0]);
        candidates.push({ v: v, money: spec.money || hasUnit, raw: m[0], idx: m.index });
      }
    });

    // 2b) 中文数字金额：三十五块 / 两百 / 两千三
    var cnRe = new RegExp('([' + CN_NUM_ALL + ']+)\\s*(?:元钱|块钱|元|块|圆)?', 'g');
    var mc;
    while ((mc = cnRe.exec(text)) !== null) {
      // 只统计真正的数字词，避免把「两」之类单字噪声算进来（长度>=1 即可，但必须能换算成数）
      var cnv = cnToNum(mc[1]);
      if (isNaN(cnv) || cnv <= 0) continue;
      candidates.push({ v: cnv, money: /元钱|块钱|元|块|圆/.test(mc[0]), raw: mc[0], idx: mc.index, cn: true, len: mc[0].length });
    }

    if (candidates.length) {
      // 先按「覆盖长度长优先」——这能解决两处歧义：
      //   · 「打车12.5」：数字候选 "12"(len2) 与 "12.5"(len4) 并存时取 12.5
      //   · 「房租两千三」：中文候选 "两"(1) 与 "两千三"(3) 并存时取 2300
      // 长度相同再比「带货币单位 > 带小数 > 数值大 > 靠前」
      candidates.forEach(function (c) { c.len = c.len || (c.raw ? c.raw.length : 0); });
      var maxLen = Math.max.apply(null, candidates.map(function (c) { return c.len; }));
      var top = candidates.filter(function (c) { return c.len === maxLen; });
      top.sort(function (a, b) {
        if ((b.money ? 1 : 0) !== (a.money ? 1 : 0)) return (b.money ? 1 : 0) - (a.money ? 1 : 0);
        var ad = /\./.test(a.raw) ? 1 : 0, bd = /\./.test(b.raw) ? 1 : 0;
        if (bd !== ad) return bd - ad;
        if (b.v !== a.v) return b.v - a.v;
        return a.idx - b.idx;
      });
      amount = top[0].v;
      text = text.replace(top[0].raw, ' ');
      if (candidates.length > 1) tips.push('识别到多个数字，取「' + top[0].v + '」作为金额，请核对');
    }

    if (isNaN(amount) || amount <= 0) {
      return { ok: false, tips: ['没找到金额，试着说「午饭35」或「打车 12.5」'], raw: raw, date: dateStr };
    }
    amount = round2(amount);

    /* ---- 3) 收 / 支方向 ---- */
    var type = opts.type || '';
    if (!type) {
      var hitInc = INCOME_SIGNALS.some(function (w) { return text.indexOf(w) >= 0; });
      var hitExp = EXPENSE_SIGNALS.some(function (w) { return text.indexOf(w) >= 0; });
      if (hitInc && !hitExp) type = 'income';
      else type = 'expense';
    }

    /* ---- 4) 分类 ---- */
    var catKey = opts.cat || '';
    var catWord = '';
    if (!catKey) {
      var hit = matchCategory(text, type);
      // 本方向没命中时，试试另一个方向（"收到退款/红包"这类词可能落在收入表里）
      if (!hit.hit) {
        var alt = type === 'income' ? 'expense' : 'income';
        var hit2 = matchCategory(text, alt);
        if (hit2.hit) {
          hit = hit2;
          if (!opts.type) type = alt; // 反向词库命中 → 顺带修正方向
        }
      }
      if (hit.hit) {
        catKey = hit.key;
        // 保留分类词本身作为备注素材：「午饭35」→ 备注「午饭」，
        // 若用户另外写了内容（「周三聚餐 火锅260」）则优先用那段内容
        catWord = hit.word;
        text = text.replace(hit.word, ' ');
      }
    }

    /* ---- 5) 账户 ---- */
    var accId = null, accName = '';
    if (opts.acc) {
      accName = opts.acc;
    } else {
      for (var a = 0; a < ACCOUNT_WORDS.length; a++) {
        ACCOUNT_WORDS[a].re.lastIndex = 0;
        var mm = text.match(ACCOUNT_WORDS[a].re);
        if (mm) { accName = ACCOUNT_WORDS[a].name; text = text.replace(mm[0], ' '); break; }
      }
    }

    /* ---- 6) 货币（已在 1.5 处理，此处仅兜底）---- */
    if (!currency) {
      for (var c = 0; c < CURRENCY_WORDS.length; c++) {
        if (reTest(CURRENCY_WORDS[c].re, raw)) { currency = CURRENCY_WORDS[c].code; break; }
      }
    }

    /* ---- 7) 备注：先清掉货币词，剩余文字即备注 ---- */
    if (currency) {
      var cw = CURRENCY_WORDS.filter(function (x) { return x.code === currency; })[0];
      if (cw) text = text.replace(new RegExp(cw.re.source, 'gi'), ' ');
    }
    var note = text.replace(/\s+/g, ' ').trim();
    if (note === raw) note = '';            // 什么都没消费掉就不必重复
    if (!note && catWord) note = catWord;   // 「午饭35」→ 备注「午饭」

    var st2 = store();
    var record = {
      type: type,
      amount: amount,
      currency: currency || (st2 ? (st2.defaultLedger() || {}).currency || 'CNY' : 'CNY'),
      category: catKey || (st2 ? defaultCat(type) : ''),
      accountName: accName || '',
      date: dateStr,
      note: note
    };

    return {
      ok: true,
      record: record,
      tips: tips,
      raw: raw,
      date: dateStr,
      matched: { amount: amount, type: type, category: catKey, account: accName, currency: currency, note: note }
    };
  }

  /** 在指定方向的词库里找最长命中；返回 {hit, key, word} */
  function matchCategory(text, type) {
    var table = type === 'income' ? INCOME_WORDS : CAT_WORDS;
    var lower = text.toLowerCase();
    var best = null, bestLen = 0;
    Object.keys(table).forEach(function (k) {
      table[k].forEach(function (w) {
        if (w.length > bestLen && lower.indexOf(w.toLowerCase()) >= 0) {
          best = k; bestLen = w.length;
        }
      });
    });
    return best ? { hit: true, key: best, word: table[best].filter(function (w) { return w.length === bestLen; })[0] } : { hit: false };
  }

  function defaultCat(type) {
    var st = store();
    if (!st) return type === 'income' ? 'other_inc' : 'other_exp';
    var list = st.getCategories(type);
    // 默认落在「其他」，比落第一个（餐饮）更不误导
    var other = list.filter(function (c) { return /other/.test(c.key); })[0];
    return (other || list[0] || {}).key || '';
  }

  /* ============================ 写入 ============================ */

  /** 把解析结果写入 Store（会做金额校验与账户匹配） */
  function record(rec) {
    var st = store();
    if (!st) return { ok: false, error: '数据模块未加载' };
    if (!rec || !rec.amount || Number(rec.amount) <= 0) return { ok: false, error: '金额无效' };

    var led = st.defaultLedger() || {};
    var accounts = st.listAccounts();
    var acc = null;
    if (rec.accountName) {
      acc = accounts.filter(function (a) { return a.name === rec.accountName || a.id === rec.accountName; })[0] || null;
    }
    if (!acc) {
      // 没指定就用「现金」，其次第一个
      acc = accounts.filter(function (a) { return a.name === '现金'; })[0] || accounts[0] || null;
    }

    var payload = {
      ledgerId: led.id,
      type: rec.type === 'income' ? 'income' : 'expense',
      amount: round2(rec.amount),
      currency: rec.currency || led.currency || 'CNY',
      rate: 1,
      discount: 0,
      category: rec.category || defaultCat(rec.type),
      accountId: acc ? acc.id : null,
      date: rec.date || todayStr(),
      note: rec.note || '',
      source: 'quick'
    };
    var tx = st.addTransaction(payload);
    return { ok: true, tx: tx, account: acc };
  }

  /* ============================ URL 入口 ============================ */

  function getParams(href) {
    var u = href || (typeof location !== 'undefined' ? location.href : '');
    var q = u.split('?')[1] || '';
    q = q.split('#')[0];
    var out = {};
    q.split('&').forEach(function (kv) {
      if (!kv) return;
      var i = kv.indexOf('=');
      var k = decodeURIComponent(i < 0 ? kv : kv.slice(0, i));
      var v = i < 0 ? '' : kv.slice(i + 1).replace(/\+/g, ' ');
      try { v = decodeURIComponent(v); } catch (e) {}
      out[k] = v;
    });
    return out;
  }

  /* ============================ 面板 UI ============================ */

  var DRAFT_KEY = 'ledger_quick_draft';
  var _deferred = null; // 等 app 就绪后要执行的动作

  function ui() { return window.__quickUI || null; }

  /** 打开快速记账面板 */
  function open(text, o) {
    o = o || {};
    var UI = ui();
    if (!UI) { _deferred = { text: text, o: o }; return { ok: false, error: 'UI 未就绪' }; }

    var parsed = parse(text, o);
    if (o.auto && parsed.ok) {
      var r = record(parsed.record);
      if (r.ok) {
        UI.toast('已记：' + (parsed.record.type === 'income' ? '+' : '-') + parsed.record.amount + ' ' + (r.tx.note || ''));
        if (UI.refresh) UI.refresh();
        if (UI.close) UI.close();
        return { ok: true, auto: true, parsed: parsed, tx: r.tx };
      }
      UI.toast(r.error || '记账失败');
    }

    // 打开可编辑面板，让用户确认
    UI.openQuickPanel(parsed, o);
    return { ok: parsed.ok, parsed: parsed };
  }

  /** app.js 初始化完成后调用，接管延迟请求 */
  function boot(handlers) {
    window.__quickUI = handlers || window.__quickUI;
    var p = getParams();
    var isQuick = p.quick === '1' || p.quick === 'true';
    var text = p.text || p.q || p.content || '';

    if (isQuick || text) {
      setTimeout(function () {
        open(text, {
          auto: p.auto === '1' || p.auto === 'true',
          type: p.type || '',
          cat: p.cat || '',
          acc: p.acc || '',
          date: p.date || '',
          back: p.back === '1' || p.back === 'true'
        });
      }, 180);
    }
    // 分享面板：PWA 收到共享文本
    try { consumeShareTarget(); } catch (e) {}
    return { isQuick: isQuick, text: text };
  }

  function consumeShareTarget() {
    var p = getParams();
    if (p.title || p.text) {
      try { window.history.replaceState({}, '', location.pathname); } catch (e) {}
    }
  }

  /* ============================ 导出 ============================ */
  window.QuickAdd = {
    parse: parse,
    record: record,
    open: open,
    boot: boot,
    cnToNum: cnToNum,
    getParams: getParams,
    todayStr: todayStr,
    CAT_WORDS: CAT_WORDS,
    INCOME_WORDS: INCOME_WORDS
  };
})();
