// Design probe: pass this whole file's contents as the function to evaluate in the page
// (for example Playwright's browser_evaluate `function`). It returns JSON facts that
// support a design review: contrast, type, line length, spacing, overflow, targets,
// outline and alt text. It reads the page only and changes nothing.
() => {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const toRgba = (css) => {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = '#000';
    ctx.fillStyle = css;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    return { r, g, b, a: a / 255 };
  };
  const over = (top, under) => ({
    r: top.r * top.a + under.r * (1 - top.a),
    g: top.g * top.a + under.g * (1 - top.a),
    b: top.b * top.a + under.b * (1 - top.a),
    a: 1,
  });
  const lum = ({ r, g, b }) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const hex = ({ r, g, b }) => '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
  const label = (el) => {
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    else if (typeof el.className === 'string' && el.className.trim()) s += '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.');
    return s;
  };
  const visible = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const effectiveBg = (el) => {
    const layers = [];
    let imageBehind = false;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') imageBehind = true;
      const c = toRgba(cs.backgroundColor);
      if (c.a > 0) { layers.push(c); if (c.a >= 1) break; }
    }
    let bg = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = layers.length - 1; i >= 0; i--) bg = over(layers[i], bg);
    return { bg, imageBehind };
  };
  const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
  const bump = (map, k) => map.set(k, (map.get(k) || 0) + 1);
  const top = (map, n) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([value, count]) => ({ value, count }));

  const vw = document.documentElement.clientWidth;
  const all = [...document.body.querySelectorAll('*')].filter((el) => !['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE'].includes(el.tagName));
  const textEls = all.filter((el) => visible(el) && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1));

  const contrastFails = [];
  const families = new Map(), sizes = new Map(), textColors = new Map(), bgColors = new Map();
  let imageBgText = 0;
  let smallest = null;
  for (const el of textEls) {
    const cs = getComputedStyle(el);
    const size = parseFloat(cs.fontSize);
    const weight = parseInt(cs.fontWeight, 10) || 400;
    bump(families, cs.fontFamily.split(',')[0].replace(/["']/g, '').trim());
    bump(sizes, Math.round(size) + 'px');
    const { bg, imageBehind } = effectiveBg(el);
    const fg = over(toRgba(cs.color), bg);
    bump(textColors, hex(fg));
    bump(bgColors, hex(bg));
    const text = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' ').trim().replace(/\s+/g, ' ');
    if (!smallest || size < smallest.px) smallest = { px: size, el: label(el), text: text.slice(0, 60) };
    if (imageBehind) { imageBgText++; continue; }
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const need = large ? 3 : 4.5;
    const r = ratio(fg, bg);
    if (r < need) contrastFails.push({ ratio: +r.toFixed(2), need, fg: hex(fg), bg: hex(bg), px: size, el: label(el), text: text.slice(0, 60) });
  }
  contrastFails.sort((a, b) => a.ratio - b.ratio);

  const lineLengths = [];
  const bodyLineHeight = [];
  const clamped = [];
  for (const el of document.querySelectorAll('p, li, dd, blockquote')) {
    if (!visible(el)) continue;
    const cs = getComputedStyle(el);
    // Clamped or cut-off text hides part of textContent, so it would skew the line length.
    if (el.scrollHeight > el.clientHeight + 2 && cs.overflow !== 'visible') {
      clamped.push({ el: label(el), text: el.textContent.trim().slice(0, 60) });
      continue;
    }
    const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2;
    const lines = Math.round(el.getBoundingClientRect().height / lh);
    const chars = el.textContent.trim().length;
    bodyLineHeight.push(+(lh / parseFloat(cs.fontSize)).toFixed(2));
    if (lines >= 2 && chars > 80) lineLengths.push(Math.round(chars / lines));
  }

  const spacing = new Map();
  for (const el of all.slice(0, 3000)) {
    const cs = getComputedStyle(el);
    for (const p of ['marginTop', 'marginBottom', 'paddingTop', 'paddingBottom', 'paddingLeft', 'rowGap', 'columnGap']) {
      const v = parseFloat(cs[p]);
      if (v > 0) bump(spacing, Math.round(v));
    }
  }
  const spacingValues = [...spacing.keys()];

  const overflowing = all.filter((el) => { const r = el.getBoundingClientRect(); return visible(el) && r.right > vw + 1 && getComputedStyle(el).position !== 'fixed'; })
    .filter((el) => !el.closest('[style*="overflow"], pre, table') || el.tagName === 'TABLE')
    .slice(0, 10).map((el) => ({ el: label(el), right: Math.round(el.getBoundingClientRect().right) }));

  const interactive = [...document.querySelectorAll('a[href], button, input, select, textarea, [role="button"], [tabindex]:not([tabindex="-1"])')].filter(visible);
  const smallTargets = interactive.filter((el) => { const r = el.getBoundingClientRect(); return r.width < 24 || r.height < 24; })
    .filter((el) => !(el.tagName === 'A' && getComputedStyle(el).display === 'inline'))
    .slice(0, 15).map((el) => { const r = el.getBoundingClientRect(); return { el: label(el), w: Math.round(r.width), h: Math.round(r.height), text: (el.innerText || el.getAttribute('aria-label') || '').trim().slice(0, 40) }; });

  const headings = [...document.querySelectorAll('h1, h2, h3, h4, h5, h6')].filter(visible).map((h) => ({ level: +h.tagName[1], text: h.textContent.trim().slice(0, 80) }));
  const skipped = headings.filter((h, i) => i > 0 && h.level > headings[i - 1].level + 1).map((h) => h.text);
  const imgsNoAlt = [...document.querySelectorAll('img')].filter((i) => !i.hasAttribute('alt')).map((i) => i.currentSrc || i.src).slice(0, 10);
  const brokenImgs = [...document.querySelectorAll('img')].filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.src).slice(0, 10);

  return {
    url: location.href,
    title: document.title,
    lang: document.documentElement.lang || null,
    viewport: { width: vw, height: innerHeight },
    colorScheme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
    pageHeight: document.documentElement.scrollHeight,
    horizontalScroll: document.documentElement.scrollWidth > vw + 1,
    overflowing,
    text: {
      nodes: textEls.length,
      fontFamilies: top(families, 8),
      fontSizes: top(sizes, 12),
      smallest,
      bodyLineHeightMedian: median(bodyLineHeight),
      charsPerLineMedian: median(lineLengths),
      charsPerLineMax: lineLengths.length ? Math.max(...lineLengths) : null,
      truncated: { count: clamped.length, samples: clamped.slice(0, 5) },
    },
    contrast: { failures: contrastFails.length, worst: contrastFails.slice(0, 15), textOverImagesNotChecked: imageBgText },
    color: { distinctTextColors: textColors.size, distinctBackgrounds: bgColors.size, textColors: top(textColors, 8), backgrounds: top(bgColors, 8) },
    spacing: {
      distinctValues: spacingValues.length,
      offScale4: spacingValues.filter((v) => v % 4 !== 0 && v > 2).length,
      mostUsed: top(spacing, 12),
    },
    targets: { interactive: interactive.length, under24px: smallTargets },
    outline: { h1Count: headings.filter((h) => h.level === 1).length, skippedLevels: skipped, headings: headings.slice(0, 40) },
    images: { total: document.images.length, missingAlt: imgsNoAlt, broken: brokenImgs },
  };
}
