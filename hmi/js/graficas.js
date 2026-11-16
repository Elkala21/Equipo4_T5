/* ==========================================================================
 * graficas.js · Gráficas en <canvas> sin librerías externas
 *
 *   Graf.lineas(el, opts)      series en el tiempo / por época (con cursor)
 *   Graf.barras(el, opts)      barras con línea de referencia opcional
 *   Graf.frontera(el, opts)    patrones de 2 entradas y recta de decisión
 *
 * `el` es el contenedor .chart (con un <canvas> y un .tip). Cada gráfica
 * guarda sus opciones en el y se vuelve a dibujar al mover el cursor.
 * ========================================================================== */
"use strict";

const Graf = (() => {
  const FONT = "12px system-ui,-apple-system,'Segoe UI',sans-serif";
  const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  function preparar(el){
    const cv = el.querySelector("canvas");
    if(!cv.dataset.h) cv.dataset.h = cv.getAttribute("height") || 200;
    const h = +cv.dataset.h, w = cv.clientWidth || el.clientWidth || 300, dpr = window.devicePixelRatio || 1;
    cv.style.height = h + "px";
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    const g = cv.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    g.font = FONT; g.lineJoin = "round"; g.lineCap = "round";
    if(!el._hover) instalarHover(el, cv);
    return { g, w, h };
  }

  function instalarHover(el, cv){
    el._hover = true;
    const tip = el.querySelector(".tip");
    const mover = ev => {
      const r = cv.getBoundingClientRect();
      el._mouse = { x: ev.clientX - r.left, y: ev.clientY - r.top };
      if(el._redraw) el._redraw();
      const info = el._tipInfo;
      if(!info){ tip.style.display = "none"; return; }
      tip.innerHTML = `<div class="t">${info.title}</div>` + info.rows.map(rw =>
        `<div class="r">${rw.color ? `<span class="sw" style="background:${rw.color}"></span>` : ""}${rw.name}<b>${rw.value}</b></div>`).join("");
      tip.style.display = "block";
      const tw = tip.offsetWidth, th = tip.offsetHeight;
      let x = el._mouse.x + 14; if(x + tw > r.width) x = el._mouse.x - tw - 14; if(x < 0) x = 0;
      let y = el._mouse.y - th / 2; y = Math.max(0, Math.min(y, r.height - th));
      tip.style.left = x + "px"; tip.style.top = y + "px";
    };
    const salir = () => { el._mouse = null; el._tipInfo = null; tip.style.display = "none"; if(el._redraw) el._redraw(); };
    cv.addEventListener("pointermove", mover);
    cv.addEventListener("pointerdown", mover);
    cv.addEventListener("pointerleave", salir);
  }

  function vacio(g, w, h, txt){
    g.fillStyle = css("--muted"); g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(txt, w / 2, h / 2);
  }

  /* marcas "bonitas" para un eje */
  function ticks(min, max, n){
    const span = max - min || 1, paso0 = span / n, mag = Math.pow(10, Math.floor(Math.log10(paso0)));
    const paso = [1, 2, 2.5, 5, 10].map(m => m * mag).find(p => span / p <= n) || mag * 10;
    const out = [];
    for(let v = Math.ceil(min / paso) * paso; v <= max + paso * 1e-9; v += paso) out.push(+v.toFixed(10));
    return out;
  }

  function rejillaY(g, L, R, T, B, w, h, yMin, yMax, fmt, logY, fijos){
    g.strokeStyle = css("--grid"); g.lineWidth = 1; g.fillStyle = css("--muted");
    g.textAlign = "right"; g.textBaseline = "middle";
    const vals = fijos || (logY ? decadas(yMin, yMax) : ticks(yMin, yMax, 4));
    const Y = v => logY ? T + (h - T - B) * (1 - (Math.log10(v) - Math.log10(yMin)) / (Math.log10(yMax) - Math.log10(yMin)))
                        : T + (h - T - B) * (1 - (v - yMin) / (yMax - yMin));
    for(const v of vals){
      const y = Math.round(Y(v)) + .5;
      g.beginPath(); g.moveTo(L, y); g.lineTo(w - R, y); g.stroke();
      g.fillText(fmt(v), L - 8, y);
    }
    return Y;
  }
  function decadas(a, b){ const o = []; for(let e = Math.floor(Math.log10(a)); e <= Math.ceil(Math.log10(b)); e++) o.push(Math.pow(10, e)); return o.filter(v => v >= a * .999 && v <= b * 1.001); }

  /* ---------------------------------------------------------------- líneas */
  function lineas(el, o){
    el._opts = o;
    el._redraw = () => dibujarLineas(el);
    dibujarLineas(el);
  }

  function dibujarLineas(el){
    const o = el._opts, { g, w, h } = preparar(el);
    const L = o.left ?? 48, R = o.right ?? (o.directLabels ? 64 : 14), T = 10, B = o.xLabel ? 34 : 22;
    const series = o.series.filter(s => !s.hidden && s.pts.length);
    el._tipInfo = null;
    if(!series.length){ vacio(g, w, h, o.empty || "Sin datos"); return; }

    const xMin = o.xMin, xMax = o.xMax;
    let yMin = o.yMin, yMax = o.yMax;
    if(o.logY){ yMin = Math.max(o.yMin || 1e-6, 1e-6); }
    const X = x => L + (w - L - R) * (x - xMin) / (xMax - xMin || 1);
    const Y = rejillaY(g, L, R, T, B, w, h, yMin, yMax, o.yFmt || (v => v), o.logY, o.yTicks);
    const Yc = v => Y(o.logY ? Math.max(v, yMin) : v);

    /* eje x */
    g.strokeStyle = css("--axis"); g.beginPath(); g.moveTo(L, h - B + .5); g.lineTo(w - R, h - B + .5); g.stroke();
    g.fillStyle = css("--muted"); g.textBaseline = "top"; g.textAlign = "center";
    for(const v of (o.xTicks || ticks(xMin, xMax, Math.max(2, Math.floor((w - L - R) / 90))))){
      if(v < xMin || v > xMax) continue;
      g.fillText((o.xFmt || (x => x))(v), X(v), h - B + 6);
    }
    if(o.xLabel){ g.fillText(o.xLabel, (L + w - R) / 2, h - 14); }

    /* línea de referencia (umbral) */
    if(o.hline && o.hline.y >= yMin && o.hline.y <= yMax){
      const y = Math.round(Yc(o.hline.y)) + .5;
      g.save(); g.setLineDash([5, 4]); g.strokeStyle = css("--ink-2"); g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(L, y); g.lineTo(w - R, y); g.stroke(); g.restore();
      g.fillStyle = css("--ink-2"); g.textAlign = "left"; g.textBaseline = "bottom";
      g.fillText(o.hline.label, L + 6, y - 3);
    }

    /* series */
    g.save(); g.beginPath(); g.rect(L, T - 4, w - L - R, h - T - B + 8); g.clip();
    for(const s of series){
      g.strokeStyle = s.color; g.lineWidth = 2; g.beginPath();
      s.pts.forEach(([x, y], i) => {
        const px = X(x), py = Yc(y);
        if(i === 0) g.moveTo(px, py);
        else if(s.step){ g.lineTo(px, Yc(s.pts[i - 1][1])); g.lineTo(px, py); }
        else g.lineTo(px, py);
      });
      g.stroke();
    }
    g.restore();

    /* etiquetas directas al final de cada línea (sin encimarse) */
    if(o.directLabels){
      const labs = series.map(s => ({ s, y: Yc(s.pts[s.pts.length - 1][1]) })).sort((a, b) => a.y - b.y);
      for(let i = 1; i < labs.length; i++) if(labs[i].y - labs[i - 1].y < 14) labs[i].y = labs[i - 1].y + 14;
      g.textAlign = "left"; g.textBaseline = "middle"; g.fillStyle = css("--ink-2");
      for(const lb of labs){
        g.fillStyle = lb.s.color; g.fillRect(w - R + 6, lb.y - 1, 8, 3);
        g.fillStyle = css("--ink-2"); g.fillText(lb.s.short || lb.s.name, w - R + 18, lb.y);
      }
    }

    /* cursor */
    const m = el._mouse;
    if(m && m.x >= L && m.x <= w - R){
      const xv = xMin + (m.x - L) / (w - L - R) * (xMax - xMin);
      const filas = []; let xr = null;
      for(const s of series){
        const p = cercano(s.pts, xv);
        if(!p) continue;
        xr = xr ?? p[0];
        filas.push({ s, p });
      }
      if(filas.length){
        const cx = Math.round(X(xr)) + .5;
        g.strokeStyle = css("--axis"); g.lineWidth = 1; g.beginPath(); g.moveTo(cx, T); g.lineTo(cx, h - B); g.stroke();
        for(const f of filas){
          const py = Yc(f.p[1]);
          g.beginPath(); g.arc(X(f.p[0]), py, 4.5, 0, Math.PI * 2);
          g.fillStyle = f.s.color; g.fill(); g.lineWidth = 2; g.strokeStyle = css("--surface"); g.stroke();
        }
        el._tipInfo = {
          title: (o.tipTitle || (x => x))(xr),
          rows: filas.map(f => ({ name: f.s.name, color: f.s.color, value: (o.tipFmt || o.yFmt || (v => v))(f.p[1], f.s) }))
        };
      }
    }
  }

  function cercano(pts, x){                   // búsqueda binaria del punto más cercano en x
    if(!pts.length) return null;
    let lo = 0, hi = pts.length - 1;
    while(hi - lo > 1){ const mid = (lo + hi) >> 1; if(pts[mid][0] < x) lo = mid; else hi = mid; }
    return Math.abs(pts[lo][0] - x) <= Math.abs(pts[hi][0] - x) ? pts[lo] : pts[hi];
  }

  /* ---------------------------------------------------------------- barras */
  function barras(el, o){
    el._opts = o;
    el._redraw = () => dibujarBarras(el);
    dibujarBarras(el);
  }

  function dibujarBarras(el){
    const o = el._opts, { g, w, h } = preparar(el);
    el._tipInfo = null;
    if(!o.bars.length){ vacio(g, w, h, o.empty || "Sin datos"); return; }
    const L = 48, R = 12, T = 12, B = 26;
    const vals = o.bars.map(b => b.value).concat(o.hline ? [o.hline.y] : []).concat([0]);
    let yMin = Math.min(...vals), yMax = Math.max(...vals);
    const pad = (yMax - yMin || 1) * .12; yMax += pad; if(yMin < 0) yMin -= pad;
    const Y = rejillaY(g, L, R, T, B, w, h, yMin, yMax, o.yFmt || (v => v.toFixed(2)), false);
    const n = o.bars.length, slot = (w - L - R) / n, bw = Math.max(4, Math.min(56, slot * .62));
    const y0 = Math.round(Y(0)) + .5;

    let hov = -1;
    const m = el._mouse;
    if(m && m.x >= L && m.x <= w - R) hov = Math.min(n - 1, Math.floor((m.x - L) / slot));

    const anchoEt = Math.max(...o.bars.map(b => g.measureText(b.label).width)) + 8;
    const cada = Math.max(1, Math.ceil(anchoEt / slot));
    o.bars.forEach((b, i) => {
      const cx = L + slot * (i + .5), yv = Y(b.value), top = Math.min(yv, y0), hgt = Math.max(1, Math.abs(yv - y0));
      g.globalAlpha = hov >= 0 && hov !== i ? .55 : 1;
      g.fillStyle = b.color;
      barraRedondeada(g, cx - bw / 2, top, bw, hgt, 4, b.value >= 0);
      g.globalAlpha = 1;
      g.fillStyle = css("--muted"); g.textAlign = "center"; g.textBaseline = "top";
      if(i % cada === 0) g.fillText(b.label, cx, h - B + 6);
    });

    /* línea base */
    g.strokeStyle = css("--axis"); g.lineWidth = 1; g.beginPath(); g.moveTo(L, y0); g.lineTo(w - R, y0); g.stroke();

    if(o.hline){
      const y = Math.round(Y(o.hline.y)) + .5;
      g.save(); g.setLineDash([5, 4]); g.strokeStyle = css("--ink"); g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(L, y); g.lineTo(w - R, y); g.stroke(); g.restore();
      const tw = g.measureText(o.hline.label).width;
      g.fillStyle = css("--surface"); g.fillRect(w - R - tw - 8, y - 19, tw + 8, 16);
      g.fillStyle = css("--ink"); g.textAlign = "right"; g.textBaseline = "bottom";
      g.fillText(o.hline.label, w - R - 4, y - 4);
    }

    if(o.valueLabels && n <= 8){
      g.fillStyle = css("--ink-2"); g.textAlign = "center";
      o.bars.forEach((b, i) => {
        const cx = L + slot * (i + .5), yv = Y(b.value);
        g.textBaseline = b.value >= 0 ? "bottom" : "top";
        g.fillText((o.yFmt || (v => v.toFixed(2)))(b.value), cx, b.value >= 0 ? yv - 4 : yv + 4);
      });
    }

    if(hov >= 0){
      const b = o.bars[hov];
      el._tipInfo = { title: b.title || b.label, rows: (b.rows || [{ name: "valor", value: (o.yFmt || (v => v.toFixed(3)))(b.value), color: b.color }]) };
    }
  }

  function barraRedondeada(g, x, y, w, h, r, arriba){
    r = Math.min(r, h, w / 2);
    g.beginPath();
    if(arriba){
      g.moveTo(x, y + h); g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y);
      g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r); g.lineTo(x + w, y + h);
    }else{
      g.moveTo(x, y); g.lineTo(x + w, y); g.lineTo(x + w, y + h - r);
      g.quadraticCurveTo(x + w, y + h, x + w - r, y + h); g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
    }
    g.closePath(); g.fill();
  }

  /* ------------------------------------------------------- frontera (N=2) */
  function frontera(el, o){
    el._opts = o;
    el._redraw = () => dibujarFrontera(el);
    dibujarFrontera(el);
  }

  function dibujarFrontera(el){
    const o = el._opts, { g, w, h } = preparar(el);
    el._tipInfo = null;
    if(!o.pts){ vacio(g, w, h, o.empty); return; }
    const S = Math.min(w - 60, h - 50), L = (w - S) / 2 + 12, T = 12;
    const lo = -.25, hi = 1.25;
    const X = v => L + S * (v - lo) / (hi - lo), Y = v => T + S * (1 - (v - lo) / (hi - lo));

    /* semiplano y = 1 */
    if(o.model){
      const { w0, w1, b, theta } = o.model;
      g.save(); g.beginPath(); g.rect(X(lo), Y(hi), S, S); g.clip();
      g.fillStyle = css("--s1"); g.globalAlpha = .1;
      const paso = S / 60;
      for(let px = 0; px < S; px += paso){
        for(let py = 0; py < S; py += paso){
          const x0 = lo + (px + paso / 2) / S * (hi - lo), x1 = hi - (py + paso / 2) / S * (hi - lo);
          if(w0 * x0 + w1 * x1 + b >= theta) g.fillRect(X(lo) + px, Y(hi) + py, paso + .5, paso + .5);
        }
      }
      g.globalAlpha = 1;
      /* recta w0·x0 + w1·x1 + b = θ */
      g.strokeStyle = css("--ink"); g.lineWidth = 2; g.beginPath();
      if(Math.abs(w1) > 1e-6){
        const f = x0 => (theta - b - w0 * x0) / w1;
        g.moveTo(X(lo), Y(f(lo))); g.lineTo(X(hi), Y(f(hi)));
      }else if(Math.abs(w0) > 1e-6){
        const xc = (theta - b) / w0; g.moveTo(X(xc), Y(lo)); g.lineTo(X(xc), Y(hi));
      }
      g.stroke(); g.restore();
    }

    /* ejes */
    g.strokeStyle = css("--axis"); g.lineWidth = 1;
    g.strokeRect(X(lo) + .5, Y(hi) + .5, S, S);
    g.fillStyle = css("--muted"); g.textAlign = "center"; g.textBaseline = "top";
    [0, 1].forEach(v => g.fillText(String(v), X(v), Y(lo) + 6));
    g.fillText("x0 (P0)", X(.5), Y(lo) + 20);
    g.textAlign = "right"; g.textBaseline = "middle";
    [0, 1].forEach(v => g.fillText(String(v), X(lo) - 6, Y(v)));
    g.save(); g.translate(X(lo) - 26, Y(.5)); g.rotate(-Math.PI / 2); g.textAlign = "center"; g.fillText("x1 (P1)", 0, 0); g.restore();

    /* patrones: d = 1 círculo azul, d = 0 cuadrado naranja */
    let hov = null;
    for(const p of o.pts){
      const cx = X(p.x0), cy = Y(p.x1), act = p.act;
      g.lineWidth = 2; g.strokeStyle = css("--surface");
      g.fillStyle = p.d ? css("--s1") : css("--s2");
      g.beginPath();
      if(p.d) g.arc(cx, cy, 9, 0, Math.PI * 2); else g.rect(cx - 8, cy - 8, 16, 16);
      g.fill(); g.stroke();
      if(act){ g.strokeStyle = css("--ink"); g.lineWidth = 2; g.beginPath(); g.arc(cx, cy, 15, 0, Math.PI * 2); g.stroke(); }
      if(p.bad){ g.strokeStyle = css("--critical"); g.lineWidth = 2; g.beginPath(); g.moveTo(cx - 13, cy - 13); g.lineTo(cx + 13, cy + 13); g.stroke(); }
      const m = el._mouse;
      if(m && Math.hypot(m.x - cx, m.y - cy) < 18) hov = p;
    }
    if(hov){
      el._tipInfo = { title: `Patrón ${hov.i} (x1 x0 = ${hov.x1}${hov.x0})`,
        rows: [{ name: "deseada d", value: hov.d }, { name: "salida y", value: hov.y ?? "—" }, { name: "a = w·x + b", value: hov.a != null ? hov.a.toFixed(3) : "—" }] };
    }
  }

  return { lineas, barras, frontera, css };
})();
