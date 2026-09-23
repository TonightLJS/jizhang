/* 随手记账 —— 轻量 SVG 图表（无外部依赖） */
(function (global) {
  'use strict';

  const COLORS = [
    '#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#00c7be',
    '#30b0c7', '#007aff', '#5856d6', '#af52de', '#ff2d55',
    '#a2845e', '#8e8e93'
  ];

  function color(i) { return COLORS[i % COLORS.length]; }

  // 环形图：data = [{name, amount}]
  function donut(container, data, opts) {
    opts = opts || {};
    const size = opts.size || 200;
    const r = size / 2 - 14;
    const cx = size / 2, cy = size / 2;
    const total = data.reduce((a, d) => a + d.amount, 0) || 1;
    let angle = -Math.PI / 2;
    let svg = `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img">`;
    // 背景环
    svg += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#e5e5ea" stroke-width="18"/>`;
    data.forEach((d, i) => {
      const frac = d.amount / total;
      const sweep = frac * Math.PI * 2;
      const a2 = angle + sweep;
      const x1 = cx + r * Math.cos(angle), y1 = cy + r * Math.sin(angle);
      const x2 = cx + r * Math.cos(a2), y2 = cy + r * Math.sin(a2);
      const large = sweep > Math.PI ? 1 : 0;
      svg += `<path d="M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}" fill="none" stroke="${color(i)}" stroke-width="18" stroke-linecap="butt"/>`;
      angle = a2;
    });
    svg += `<text x="${cx}" y="${cy - 4}" text-anchor="middle" font-size="13" fill="#8e8e93">${opts.centerLabel || '支出'}</text>`;
    svg += `<text x="${cx}" y="${cy + 16}" text-anchor="middle" font-size="18" font-weight="700" fill="#1c1c1e">¥${(total).toFixed(2)}</text>`;
    svg += `</svg>`;
    container.innerHTML = svg;
  }

  // 柱状图：data = [{label, income, expense}]
  function bars(container, data) {
    const w = container.clientWidth || 320;
    const h = 180;
    const padL = 30, padR = 10, padT = 12, padB = 24;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;
    const maxV = Math.max(
      1,
      ...data.map((d) => Math.max(d.income, d.expense))
    );
    const n = data.length || 1;
    const groupW = plotW / n;
    const barW = Math.min(14, groupW / 3);
    let svg = `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" role="img">`;
    // y 轴网格
    for (let g = 0; g <= 4; g++) {
      const y = padT + (plotH * g) / 4;
      const val = maxV * (1 - g / 4);
      svg += `<line x1="${padL}" y1="${y}" x2="${w - padR}" y2="${y}" stroke="#e5e5ea" stroke-width="1"/>`;
      svg += `<text x="${padL - 4}" y="${y + 3}" text-anchor="end" font-size="9" fill="#8e8e93">${Math.round(val)}</text>`;
    }
    data.forEach((d, i) => {
      const gx = padL + groupW * i + groupW / 2;
      const hi = (d.income / maxV) * plotH;
      const he = (d.expense / maxV) * plotH;
      // 收入（绿）
      svg += `<rect x="${gx - barW - 1}" y="${padT + plotH - hi}" width="${barW}" height="${hi}" rx="2" fill="#34c759"/>`;
      // 支出（红）
      svg += `<rect x="${gx + 1}" y="${padT + plotH - he}" width="${barW}" height="${he}" rx="2" fill="#ff3b30"/>`;
      svg += `<text x="${gx}" y="${h - 8}" text-anchor="middle" font-size="9" fill="#8e8e93">${d.label}</text>`;
    });
    svg += `</svg>`;
    container.innerHTML = svg;
  }

  global.Charts = { donut, bars, color };
})(window);
