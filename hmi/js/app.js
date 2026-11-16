/* ==========================================================================
 * app.js · Lógica de la HMI
 *
 *   1. Estado de la aplicación (S)
 *   2. Mensajes del ESP32 (onLine)
 *   3. Conexión (Web Serial / demo)
 *   4. Pantallas: Monitoreo, Entrenamiento, Modelo, Sistema, Consola
 *   5. Eventos
 * ========================================================================== */
"use strict";

const $  = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const MAXP = 5, VENTANA_S = 30;
const SERIES = ["--s1", "--s2", "--s3", "--s4", "--s5"];
const color = i => Graf.css(SERIES[i]);

/* Pines de cada placa (mismos valores que main/bsp/BSP.h) */
const PINES = {
  "ESP32":    { pots: ["GPIO36 (VP)", "GPIO39 (VN)", "GPIO34", "GPIO35", "GPIO32"], ledEstado: "GPIO19", ledSalida: "GPIO18", boton: "GPIO21" },
  "ESP32-C3": { pots: ["GPIO0", "GPIO1", "GPIO2", "GPIO3", "GPIO4"], ledEstado: "GPIO20", ledSalida: "GPIO21", boton: "GPIO10" },
};

/* ------------------------------------------------------------------------
 * 1. Estado
 * ------------------------------------------------------------------------ */
const S = {
  linked: false, demo: false, gotEstado: false, placa: null, cal: null, version: "—",
  n: 3, tabla: "", preset: "OR", entrenado: false, entrenando: false, modo: "OFF", umbral: 2048, stream: true,
  model: null, curve: [],
  raw: [], mv: [], patron: 0, y: 0, hayLect: false,
  hist: [], pausa: false, lectTimes: [],
  runs: [],
};
let link = null;
let tab = "monitor";

/* ------------------------------------------------------------------------
 * Utilidades
 * ------------------------------------------------------------------------ */
function campos(txt){                       // "a=1,b=x;y" -> {a:"1", b:"x;y"}
  const o = {};
  for(const t of txt.split(",")){ const i = t.indexOf("="); if(i > 0) o[t.slice(0, i)] = t.slice(i + 1); }
  return o;
}
const bitsDe = (i, n) => Array.from({ length: n }, (_, k) => (i >> (n - 1 - k)) & 1).join("");
const hora = () => new Date().toLocaleTimeString("es-MX", { hour12: false });
const esc = s => String(s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

function guardar(k, v){ try{ localStorage.setItem("hmi_" + k, v); }catch(e){} }
function leer(k){ try{ return localStorage.getItem("hmi_" + k); }catch(e){ return null; } }

function toast(txt, tipo){
  const t = document.createElement("div");
  t.className = "toast " + (tipo || "");
  t.textContent = txt;
  $("#toasts").append(t);
  setTimeout(() => t.remove(), 4500);
}

function nota(sel, txt, tipo){
  const icon = tipo === "ok" ? '<path d="M5 12l5 5L20 7"/>' : '<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/>';
  $(sel).innerHTML = txt ? `<div class="note ${tipo || ""}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${icon}</svg><span>${txt}</span></div>` : "";
}

function descargar(nombre, texto, tipo){
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([texto], { type: tipo || "text/plain" }));
  a.download = nombre; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* Tablas de verdad predefinidas (el patrón i tiene x_j = bit j de i) */
function tablaPreset(p, n){
  const P = 1 << n, out = [];
  for(let i = 0; i < P; i++){
    const unos = i.toString(2).split("").filter(c => c === "1").length;
    let d = 0;
    if(p === "OR")   d = unos > 0 ? 1 : 0;
    if(p === "AND")  d = unos === n ? 1 : 0;
    if(p === "NOR")  d = unos === 0 ? 1 : 0;
    if(p === "NAND") d = unos === n ? 0 : 1;
    if(p === "MAY")  d = unos * 2 > n ? 1 : 0;
    if(p === "X0")   d = i & 1;
    if(p === "XOR")  d = unos % 2;
    out.push(d);
  }
  return out.join("");
}
const PRESETS = ["OR", "AND", "NOR", "NAND", "MAY", "X0", "XOR"];
const NOMBRE_PRESET = { OR: "OR", AND: "AND", NOR: "NOR", NAND: "NAND", MAY: "Mayoría", X0: "Copia x0", XOR: "XOR", CUSTOM: "Personalizada" };

/* Umbral raw -> volts, estimado con las lecturas recibidas (raw, mV) */
function umbralVolts(){
  const pares = [];
  for(const h of S.hist.slice(-150)) h.raw.forEach((r, i) => pares.push([r, h.mv[i]]));
  const a = pares.filter(p => p[0] > 50 && p[0] < 4050);
  if(a.length >= 2){
    const mx = a.reduce((s, p) => s + p[0], 0) / a.length, my = a.reduce((s, p) => s + p[1], 0) / a.length;
    const sxx = a.reduce((s, p) => s + (p[0] - mx) ** 2, 0);
    if(sxx > 1e4){
      const m = a.reduce((s, p) => s + (p[0] - mx) * (p[1] - my), 0) / sxx;
      return (my + m * (S.umbral - mx)) / 1000;
    }
  }
  return S.umbral * 3.1 / 4095;
}

/* ------------------------------------------------------------------------
 * 2. Mensajes del ESP32
 * ------------------------------------------------------------------------ */
const ERRORES = {
  sin_entrenar: "Entrena el perceptrón antes de pasar a RUN.",
  sin_memoria: "El ESP32 no tiene memoria para el perceptrón.",
  umbral_fuera_de_rango: "El umbral debe estar entre 100 y 3995.",
  comando_desconocido: "Comando desconocido. Escribe AYUDA para ver la lista.",
  modo_invalido: "Modo inválido: usa RUN, OFF o TOGGLE.",
  falta_tabla: "Falta la tabla de verdad.",
};

function onLine(line){
  if(line[0] === "#"){ log(line.slice(1), "er"); return; }
  const i = line.indexOf(","), tipo = i < 0 ? line : line.slice(0, i), resto = i < 0 ? "" : line.slice(i + 1);
  log(line, tipo === "LECT" || tipo === "EPOCA" ? "lt" : tipo === "ERR" ? "er" : tipo === "OK" ? "ok" : "");

  switch(tipo){
    case "LISTO": {
      const c = campos(resto);
      if(c.placa) S.placa = c.placa;
      if(c.version) S.version = c.version;
      send("HOLA");
      break;
    }
    case "ESTADO": {
      const c = campos(resto);
      const cambioN = S.n !== +c.n;
      S.gotEstado = true; pararSaludo();
      S.n = +c.n; S.tabla = c.tabla || ""; S.entrenado = c.entrenado === "1"; S.modo = c.modo;
      S.umbral = +c.umbral; S.stream = c.stream !== "0";
      if(c.placa) S.placa = c.placa;
      if(c.cal != null) S.cal = c.cal === "1";
      if(!S.entrenado){ S.model = null; }
      if(cambioN){ S.curve = []; S.hist = []; }
      const sigue = S.preset === "CUSTOM" ? !cambioN : tablaPreset(S.preset, S.n) === S.tabla;
      if(!sigue) S.preset = PRESETS.find(p => tablaPreset(p, S.n) === S.tabla) || "CUSTOM";
      $("#umbral").value = S.umbral;
      if(!S.linked){ S.linked = true; toast(S.demo ? "Modo demo iniciado" : `Conectado a ${S.placa || "ESP32"}`, "ok"); }
      pintarConexion(); renderTodo();
      break;
    }
    case "EPOCA": {
      const c = campos(resto);
      if(!S.entrenando){ S.entrenando = true; S.curve = []; S.model = null; }
      S.curve.push([+c.k, +c.mse]);
      $("#trainBar").style.width = Math.min(95, (+c.k) / (+c.k + 40) * 100) + "%";
      nota("#trainMsg", `Entrenando… época <b>${c.k}</b>, MSE = <b>${(+c.mse).toFixed(5)}</b>`);
      if(tab === "train") dibujarMse();
      pintarControles();
      break;
    }
    case "MODELO": {
      const c = campos(resto);
      S.model = { n: +c.n, w: c.w.split(";").map(Number), b: +c.b, theta: +c.theta, epocas: +c.epocas, mse: +c.mse,
                  aciertos: +c.aciertos, patrones: +c.patrones, d: c.d, y: c.y };
      S.entrenado = true; S.entrenando = false;
      $("#trainBar").style.width = "100%";
      S.runs.push({ hora: hora(), preset: S.preset, ...S.model });
      if(S.model.aciertos < S.model.patrones){
        nota("#trainMsg", `La tabla <b>no es linealmente separable</b>: el perceptrón simple acierta ${S.model.aciertos} de ${S.model.patrones} patrones.`, "warn");
        toast("Entrenamiento terminado con errores (tabla no separable)", "warn");
      }else{
        nota("#trainMsg", `Entrenamiento terminado en <b>${S.model.epocas}</b> épocas: ${S.model.aciertos} de ${S.model.patrones} patrones correctos. Ya puedes pasar a RUN.`, "ok");
        toast("Perceptrón entrenado", "ok");
      }
      renderTodo();
      break;
    }
    case "MODO":
      S.modo = resto;
      pintarControles(); renderMonitor(); renderModelo();
      break;
    case "LECT": {
      const c = campos(resto);
      S.modo = resto.split(",")[0];
      const n = +c.n;
      S.raw = []; S.mv = [];
      for(let j = 0; j < n; j++){ S.raw.push(+c["P" + j]); S.mv.push(c["V" + j] != null ? +c["V" + j] : Math.round(+c["P" + j] * 3100 / 4095)); }
      S.patron = +c.patron; S.y = +c.y; S.hayLect = true;
      const t = performance.now() / 1000;
      S.lectTimes.push(t); while(S.lectTimes.length && t - S.lectTimes[0] > 3) S.lectTimes.shift();
      if(!S.pausa){
        S.hist.push({ t, wall: Date.now(), raw: S.raw.slice(), mv: S.mv.slice(), y: S.modo === "RUN" ? S.y : null, patron: S.patron, modo: S.modo });
        if(S.hist.length > 3000) S.hist.splice(0, S.hist.length - 3000);
      }
      renderVivo();
      break;
    }
    case "ERR": {
      const txt = ERRORES[resto] || resto.replace(/_/g, " ");
      toast(txt, "err");
      if(resto.startsWith("tabla_invalida")) nota("#cfgMsg", txt, "err");
      S.entrenando = false; pintarControles();
      break;
    }
    default: break;                         // OK, AYUDA y registros de ESP-IDF solo van a la consola
  }
}

/* ------------------------------------------------------------------------
 * 3. Conexión
 * ------------------------------------------------------------------------ */
function send(cmd){
  if(!link) return;
  log(cmd, "tx", "> ");
  link.send(cmd);
}

let saludo = null;
function iniciarSaludo(){                   // la placa puede reiniciarse al abrir el puerto
  pararSaludo();
  let intentos = 0;
  saludo = setInterval(() => {
    if(S.gotEstado) return pararSaludo();
    if(++intentos > 15){
      pararSaludo();
      toast("El ESP32 no responde. Revisa que el firmware esté cargado y que el monitor serie esté cerrado.", "err");
      return;
    }
    send("HOLA");
  }, 700);
  send("HOLA");
}
function pararSaludo(){ if(saludo){ clearInterval(saludo); saludo = null; } }

async function conectar(){
  if(!("serial" in navigator)){ toast("Este navegador no soporta Web Serial. Usa Chrome o Edge.", "err"); return; }
  try{
    const l = new SerialLink(onLine, () => desconectado());
    await l.open();
    link = l; S.demo = false; S.gotEstado = false;
    log("Puerto abierto. Esperando al ESP32…", "ok", "");
    pintarConexion(); iniciarSaludo();
  }catch(e){
    if(e.name !== "NotFoundError") toast("No se pudo abrir el puerto. ¿Lo está usando otro programa (monitor de VS Code)?", "err");
    log("No se pudo abrir el puerto: " + e.message, "er", "");
  }
}

function iniciarDemo(){
  link = new DemoLink(onLine); S.demo = true; S.gotEstado = false; S.placa = "ESP32";
  log("Modo demo iniciado (simulado).", "ok", "");
  pintarConexion(); iniciarSaludo();
}

async function desconectar(){
  pararSaludo();
  const l = link; link = null;
  if(l) await l.close();
  desconectado();
}

function desconectado(){
  pararSaludo();
  const estaba = S.linked;
  link = null;
  Object.assign(S, { linked: false, gotEstado: false, demo: false, entrenando: false, hayLect: false, raw: [], mv: [], lectTimes: [] });
  if(estaba) toast("Desconectado", "warn");
  pintarConexion(); renderTodo();
}

function pintarConexion(){
  const conectando = !!link && !S.linked;
  $("#connDot").className = "dot " + (S.linked ? (S.demo ? "warn" : "ok") : conectando ? "warn pulse" : "");
  $("#connTxt").textContent = S.linked ? (S.demo ? "Demo (simulado)" : "Conectado") : conectando ? "Conectando…" : "Desconectado";
  $("#btnConn span").textContent = link ? "Desconectar" : "Conectar";
  $("#btnConn").classList.toggle("primary", !link);
  $("#btnDemo").classList.toggle("hide", !!link);
  $("#demoBanner").classList.toggle("hide", !(S.demo && link));
  $("#hello").classList.toggle("hide", !!link);
  const pl = $("#chipPlaca");
  pl.querySelector(".dot").className = "dot " + (S.placa && link ? "ok" : "");
  pl.lastElementChild.textContent = "Placa: " + (S.placa && link ? S.placa : "—");
  pintarControles();
}

/* ------------------------------------------------------------------------
 * 4a. Monitoreo
 * ------------------------------------------------------------------------ */
function pines(){ return PINES[S.placa] || PINES["ESP32"]; }

function construirPots(){
  const box = $("#pots");
  const firma = `${S.n}|${S.demo}|${S.placa}|${S.linked}`;
  if(box.dataset.firma === firma) return;
  box.dataset.firma = firma;
  if(!S.linked){ box.innerHTML = `<div class="empty">Sin datos. Conecta la placa o inicia el modo demo.</div>`; return; }
  box.innerHTML = "";
  for(let i = 0; i < S.n; i++){
    const d = document.createElement("div");
    d.className = "pot";
    d.innerHTML = `
      <div class="pot-h"><span class="sw" style="background:${color(i)}"></span>
        <div><b>P${i} · x${i}</b><br><small>${pines().pots[i]}</small></div>
        <span class="bit" title="Bit codificado">0</span></div>
      <svg class="gauge" viewBox="0 0 200 118" aria-label="Lectura de P${i}">
        <path class="trk" d="M20 104 A80 80 0 0 1 180 104" fill="none" stroke-width="14" stroke-linecap="round"/>
        <path class="arc" d="M20 104 A80 80 0 0 1 180 104" fill="none" stroke="${color(i)}" stroke-width="14" stroke-linecap="round" stroke-dasharray="0 999"/>
        <line class="thr" x1="0" y1="0" x2="0" y2="0" stroke-width="2.5" stroke-linecap="round"/>
        <text class="v" x="100" y="86" text-anchor="middle">—</text>
        <text class="r" x="100" y="106" text-anchor="middle">raw —</text>
      </svg>`;
    if(S.demo){
      const s = document.createElement("input");
      s.type = "range"; s.min = 0; s.max = 4095; s.value = link.pots[i];
      s.setAttribute("aria-label", `Potenciómetro P${i} simulado`);
      s.addEventListener("input", () => { link.pots[i] = +s.value; });
      d.append(s);
    }
    box.append(d);
  }
}

function pintarPots(){
  construirPots();
  if(!S.linked) return;
  const L = Math.PI * 80, uf = S.umbral / 4095, ang = Math.PI * (1 - uf);
  $$("#pots .pot").forEach((d, i) => {
    const raw = S.raw[i], mv = S.mv[i], f = raw != null ? raw / 4095 : 0;
    d.querySelector(".arc").setAttribute("stroke-dasharray", `${f * L} ${L + 10}`);
    const t = d.querySelector(".thr");
    t.setAttribute("x1", 100 + 64 * Math.cos(ang)); t.setAttribute("y1", 104 - 64 * Math.sin(ang));
    t.setAttribute("x2", 100 + 96 * Math.cos(ang)); t.setAttribute("y2", 104 - 96 * Math.sin(ang));
    d.querySelector(".v").textContent = mv != null ? (mv / 1000).toFixed(2) + " V" : "—";
    d.querySelector(".r").textContent = raw != null ? `raw ${raw}` : "raw —";
    const one = (S.patron >> i) & 1, b = d.querySelector(".bit");
    b.textContent = S.hayLect ? one : "–"; b.classList.toggle("one", S.hayLect && !!one);
  });
}

function renderMonitor(){
  const run = S.modo === "RUN";
  $("#kModo").textContent = S.linked ? S.modo : "—";
  $("#swModo").setAttribute("aria-checked", run);
  $("#kModoHint").textContent = !S.linked ? "Sin conexión" : S.entrenado ? "Equivale al botón físico" : "Entrena antes de pasar a RUN";

  $("#kPatBits").textContent = S.hayLect ? bitsDe(S.patron, S.n) : "—";
  $("#kPat").innerHTML = S.hayLect ? `patrón ${S.patron} · x<sub>${S.n - 1}</sub> … x<sub>0</sub>` : "x<sub>N-1</sub> … x<sub>0</sub>";

  const yb = $("#kYBadge");
  if(!S.linked || !S.entrenado){ $("#kY").textContent = "—"; yb.textContent = "sin modelo"; yb.className = "badge"; }
  else if(!run){ $("#kY").textContent = "—"; yb.textContent = "modo OFF"; yb.className = "badge"; }
  else{ $("#kY").textContent = S.y; yb.textContent = S.y ? "LED encendido" : "LED apagado"; yb.className = "badge " + (S.y ? "ok" : ""); }
  if(S.model && S.hayLect && run){
    const a = S.model.b + S.model.w.reduce((s, w, j) => s + w * ((S.patron >> j) & 1), 0);
    $("#kYHint").textContent = `a = ${a.toFixed(3)} ${a >= S.model.theta ? "≥" : "<"} θ = ${S.model.theta.toFixed(3)}`;
  }else $("#kYHint").textContent = "y = 1 si a ≥ θ";

  $("#kUmbral").textContent = S.linked ? `≈ ${umbralVolts().toFixed(2)} V` : "—";
  $("#kUmbralHint").textContent = S.linked ? `raw ${S.umbral} · histéresis ±100` : "raw de 0 a 4095";
  $("#umbralVal").textContent = $("#umbral").value;
  $("#umbralV").textContent = S.linked ? `(raw · ≈ ${(+$("#umbral").value / S.umbral * umbralVolts()).toFixed(2)} V)` : "(raw)";

  $("#ledGreen").classList.toggle("on", S.linked && run);
  $("#ledBlue").classList.toggle("on", S.linked && run && S.y === 1);
  $("#ledGreenPin").textContent = `verde · ${pines().ledEstado} · modo RUN`;
  $("#ledBluePin").textContent = `azul · ${pines().ledSalida} · salida y`;
  $("#potsSub").textContent = S.linked ? `${S.n} canales del ADC1 · ${S.cal ? "calibración de fábrica" : "voltaje aproximado"}` : "Lectura del ADC1 y su codificación en 0 / 1";

  pintarPots();
  if(tab === "monitor") dibujarHistorial();
}

/* leyenda con botones para ocultar series */
const ocultas = new Set();
function pintarLeyendaHist(){
  const box = $("#legHist");
  const firma = S.n + "|" + [...ocultas].join();
  if(box.dataset.firma === firma) return;
  box.dataset.firma = firma;
  box.innerHTML = "";
  for(let i = 0; i < S.n; i++){
    const b = document.createElement("button");
    b.setAttribute("aria-pressed", !ocultas.has(i));
    b.innerHTML = `<span class="sw" style="background:${color(i)}"></span>P${i}`;
    b.addEventListener("click", () => { ocultas.has(i) ? ocultas.delete(i) : ocultas.add(i); pintarLeyendaHist(); dibujarHistorial(); });
    box.append(b);
  }
  const u = document.createElement("span");
  u.innerHTML = `<span class="sw dash" style="display:inline-block;width:16px;vertical-align:3px"></span> umbral`;
  box.append(u);
}

function dibujarHistorial(){
  pintarLeyendaHist();
  const ahora = S.hist.length ? S.hist[S.hist.length - 1].t : 0;
  const vis = S.hist.filter(h => ahora - h.t <= VENTANA_S);
  const series = [];
  for(let i = 0; i < S.n; i++){
    series.push({ name: `P${i}`, short: `P${i}`, color: color(i), hidden: ocultas.has(i),
                  pts: vis.filter(h => h.mv[i] != null).map(h => [h.t - ahora, h.mv[i] / 1000]) });
  }
  Graf.lineas($("#chHist"), {
    series, xMin: -VENTANA_S, xMax: 0, yMin: 0, yMax: 3.3, directLabels: true,
    xFmt: v => v === 0 ? "ahora" : `${v} s`, yFmt: v => v.toFixed(1) + " V",
    tipTitle: x => `${x.toFixed(1)} s`, tipFmt: v => v.toFixed(3) + " V",
    hline: S.linked ? { y: umbralVolts(), label: `umbral ≈ ${umbralVolts().toFixed(2)} V` } : null,
    empty: S.linked ? "Esperando lecturas…" : "Conecta la placa para ver el historial",
  });
  const ys = vis.filter(h => h.y != null).map(h => [h.t - ahora, h.y]);
  Graf.lineas($("#chY"), {
    series: [{ name: "y", color: Graf.css("--s1"), pts: ys, step: true }],
    xMin: -VENTANA_S, xMax: 0, yMin: -.15, yMax: 1.15, xTicks: [], yTicks: [0, 1], left: 48, right: 64,
    yFmt: v => (v === 0 || v === 1) ? String(v) : "", tipFmt: v => String(v), tipTitle: x => `${x.toFixed(1)} s`,
    empty: "La salida y aparece en modo RUN",
  });
}

/* refresco ligero con cada lectura */
function renderVivo(){
  if(tab === "monitor") renderMonitor();
  if(tab === "model") renderModelo();
  if(tab === "train") marcarPatronActivo();
  if(tab === "system") renderSistema();
}

/* ------------------------------------------------------------------------
 * 4b. Entrenamiento
 * ------------------------------------------------------------------------ */
function renderEntrenamiento(){
  $$("#segN button").forEach(b => b.setAttribute("aria-pressed", +b.dataset.n === S.n));
  $$("#presets button").forEach(b => b.setAttribute("aria-pressed", b.dataset.p === S.preset));
  pintarTablaEdit();
  dibujarMse();
  pintarTiles();
  pintarRuns();
  if(S.linked && !S.entrenado && !S.entrenando && !S.curve.length) nota("#trainMsg", "Sin entrenar. Elige N y la tabla de verdad, y pulsa <b>Entrenar</b>.");
  if(!S.linked) nota("#trainMsg", "");
}

function pintarTablaEdit(){
  const n = S.n, P = 1 << n, m = S.model && S.model.patrones === P ? S.model : null;
  const edit = S.linked && !S.entrenando;
  let h = "<thead><tr><th>#</th>";
  for(let j = n - 1; j >= 0; j--) h += `<th>x${j}</th>`;
  h += "<th>d</th><th>y</th><th>a</th></tr></thead><tbody>";
  for(let i = 0; i < P; i++){
    h += `<tr data-i="${i}"><td class="muted">${i}</td>`;
    for(let j = n - 1; j >= 0; j--) h += `<td>${(i >> j) & 1}</td>`;
    const d = S.tabla[i] ?? "·";
    h += `<td class="dcell"><button class="${d === "1" ? "one" : ""}" data-i="${i}" ${edit ? "" : "disabled"} aria-label="Salida deseada del patrón ${bitsDe(i, n)}">${d}</button></td>`;
    if(m){
      const y = m.y[i], a = m.b + m.w.reduce((s, w, j) => s + w * ((i >> j) & 1), 0);
      h += `<td class="${y === d ? "good" : "bad"}">${y}</td><td class="num">${a.toFixed(2)}</td>`;
    }else h += `<td class="muted">—</td><td class="muted">—</td>`;
    h += "</tr>";
  }
  $("#ttEdit").innerHTML = h + "</tbody>";
  marcarPatronActivo();
}

function marcarPatronActivo(){
  $$("#ttEdit tbody tr").forEach(tr => tr.classList.toggle("act", S.hayLect && +tr.dataset.i === S.patron));
}

function dibujarMse(){
  const pts = S.curve;
  const kmax = Math.max(10, pts.length ? pts[pts.length - 1][0] : 10);
  const log = $("#chkLog").checked;
  const ymax = pts.length ? Math.max(...pts.map(p => p[1])) * 1.08 : .5;
  const ymin = log ? Math.max(1e-4, Math.min(...pts.map(p => p[1] || 1e-4)) * .8) : 0;
  Graf.lineas($("#chMse"), {
    series: [{ name: "MSE", color: Graf.css("--s1"), pts }],
    xMin: 0, xMax: kmax, yMin: ymin, yMax: Math.max(ymax, log ? ymin * 10 : .05), logY: log,
    xLabel: "época", yFmt: v => log ? v.toExponential(0) : v.toFixed(2), tipFmt: v => v.toFixed(5),
    tipTitle: x => `Época ${x}`, empty: "La curva aparece al entrenar",
  });
}

function pintarTiles(){
  const m = S.model;
  const t = (k, v) => `<div class="tile"><span>${k}</span><b class="num">${v}</b></div>`;
  $("#trainTiles").innerHTML = m
    ? t("Épocas", m.epocas) + t("MSE final", m.mse.toFixed(4)) + t("Umbral θ", m.theta.toFixed(3)) + t("Aciertos", `${m.aciertos}/${m.patrones}`)
    : S.entrenando && S.curve.length
      ? t("Época", S.curve[S.curve.length - 1][0]) + t("MSE", S.curve[S.curve.length - 1][1].toFixed(4))
      : "";
}

function pintarRuns(){
  const tb = $("#tbHist tbody");
  if(!S.runs.length){ tb.innerHTML = `<tr><td colspan="10" class="muted">Aún no hay entrenamientos.</td></tr>`; return; }
  tb.innerHTML = S.runs.map((r, i) => `<tr><td>${i + 1}</td><td>${r.hora}</td><td>${r.n}</td>
    <td class="mono" title="${NOMBRE_PRESET[r.preset] || ""}">${r.d}</td><td>${r.epocas}</td><td>${r.mse.toFixed(4)}</td>
    <td>${r.theta.toFixed(3)}</td><td class="${r.aciertos === r.patrones ? "good" : "bad"}">${r.aciertos}/${r.patrones}</td>
    <td class="mono">${r.w.map(v => v.toFixed(3)).join(", ")}</td><td class="mono">${r.b.toFixed(3)}</td></tr>`).reverse().join("");
}

let tablaTimer = null;
function enviarTabla(){
  clearTimeout(tablaTimer);
  tablaTimer = setTimeout(() => {
    const p = S.preset;
    send("TABLA=" + (p === "OR" || p === "AND" ? p : S.tabla));
  }, 200);
}

/* ------------------------------------------------------------------------
 * 4c. Modelo
 * ------------------------------------------------------------------------ */
function renderModelo(){
  dibujarNeurona();
  const m = S.model && S.model.n === S.n ? S.model : null;
  const fmt = v => (v >= 0 ? "+" : "") + v.toFixed(3);

  Graf.barras($("#chW"), {
    bars: m ? m.w.map((w, j) => ({ label: `w${j}`, value: w, color: Graf.css(w >= 0 ? "--pos" : "--neg"),
                                   rows: [{ name: `peso de x${j}`, value: fmt(w) }] }))
            .concat([{ label: "b", value: m.b, color: Graf.css(m.b >= 0 ? "--pos" : "--neg"), rows: [{ name: "sesgo", value: fmt(m.b) }] }]) : [],
    yFmt: v => v.toFixed(2), valueLabels: true, empty: "Entrena el perceptrón para ver los pesos",
  });

  const P = 1 << S.n;
  Graf.barras($("#chA"), {
    bars: m ? Array.from({ length: P }, (_, i) => {
      const a = m.b + m.w.reduce((s, w, j) => s + w * ((i >> j) & 1), 0), d = +S.tabla[i];
      return { label: bitsDe(i, S.n), value: a, color: Graf.css(d ? "--s1" : "--s2"), title: `Patrón ${i} · ${bitsDe(i, S.n)}`,
               rows: [{ name: "a = w·x + b", value: a.toFixed(3) }, { name: "deseada d", value: d }, { name: "salida y", value: m.y[i] }] };
    }) : [],
    hline: m ? { y: m.theta, label: `θ = ${m.theta.toFixed(3)}` } : null,
    yFmt: v => v.toFixed(2), empty: "Entrena el perceptrón para ver la salida lineal",
  });

  $("#fronteraSub").textContent = S.n === 2 ? "recta w0·x0 + w1·x1 + b = θ · zona azul: y = 1" : "solo se dibuja con N = 2";
  Graf.frontera($("#chF"), {
    pts: S.n === 2 ? [0, 1, 2, 3].map(i => {
      const a = m ? m.b + m.w[0] * (i & 1) + m.w[1] * (i >> 1 & 1) : null;
      return { i, x0: i & 1, x1: i >> 1 & 1, d: +S.tabla[i] || 0, y: m ? +m.y[i] : null, a,
               act: S.hayLect && S.patron === i, bad: m && m.y[i] !== S.tabla[i] };
    }) : null,
    model: S.n === 2 && m ? { w0: m.w[0], w1: m.w[1], b: m.b, theta: m.theta } : null,
    empty: S.n === 2 ? "" : `Con N = ${S.n} la frontera es un hiperplano en ${S.n}D; usa la gráfica de salida lineal.`,
  });
}

function dibujarNeurona(){
  const svg = $("#neuron"), n = S.n, m = S.model && S.model.n === n ? S.model : null;
  const W = 640, H = 330, xi = 70, sx = 380, sy = 165;
  const filas = n + 1, paso = (H - 60) / (filas - 1 || 1);
  const ys = Array.from({ length: filas }, (_, k) => 30 + paso * k);
  const maxW = m ? Math.max(.001, ...m.w.map(Math.abs), Math.abs(m.b)) : 1;
  const x = j => S.hayLect ? (S.patron >> j) & 1 : 0;
  const a = m ? m.b + m.w.reduce((s, w, j) => s + w * x(j), 0) : null;
  const yOut = m ? (a >= m.theta ? 1 : 0) : null;
  const pos = Graf.css("--pos"), neg = Graf.css("--neg"), axis = Graf.css("--axis");
  let h = "";

  for(let k = 0; k < filas; k++){
    const esB = k === n, j = n - 1 - k;
    const w = m ? (esB ? m.b : m.w[j]) : 0;
    const grosor = m ? 1.5 + 7 * Math.abs(w) / maxW : 1.5, col = m ? (w >= 0 ? pos : neg) : axis;
    const yk = ys[k], mx = (xi + sx) / 2;
    h += `<path class="wire" d="M${xi + 22} ${yk} C ${mx} ${yk}, ${mx} ${sy}, ${sx - 42} ${sy}" stroke="${col}" stroke-width="${grosor}" opacity="${esB || !S.hayLect || x(j) ? 1 : .35}"/>`;
    h += `<text class="lbl" x="${xi + 30}" y="${yk - 9}">${esB ? "b" : "w" + j} = ${m ? w.toFixed(2) : "—"}</text>`;
    const on = esB || (S.hayLect && x(j));
    h += `<circle class="node ${on ? "on" : ""}" cx="${xi}" cy="${yk}" r="20"/>`;
    h += `<text x="${xi}" y="${yk + 5}" text-anchor="middle" font-weight="700">${esB ? 1 : (S.hayLect ? x(j) : "–")}</text>`;
    h += `<text class="lbl" x="${xi - 30}" y="${yk + 5}" text-anchor="end">${esB ? "sesgo" : "x" + j}</text>`;
  }
  h += `<circle class="sum" cx="${sx}" cy="${sy}" r="42"/>`;
  h += `<text x="${sx}" y="${sy - 6}" text-anchor="middle" font-size="26" font-weight="700">Σ</text>`;
  h += `<text x="${sx}" y="${sy + 20}" text-anchor="middle" font-size="13">a = ${a != null ? a.toFixed(2) : "—"}</text>`;
  h += `<path d="M${sx + 42} ${sy} H ${sx + 80}" stroke="${axis}" stroke-width="2"/>`;
  h += `<rect x="${sx + 80}" y="${sy - 32}" width="76" height="64" rx="10" class="sum"/>`;
  h += `<path d="M${sx + 92} ${sy + 16} H ${sx + 118} V ${sy - 16} H ${sx + 144}" stroke="${Graf.css("--ink")}" stroke-width="2.5" fill="none"/>`;
  h += `<text class="lbl" x="${sx + 118}" y="${sy + 50}" text-anchor="middle">θ = ${m ? m.theta.toFixed(2) : "—"}</text>`;
  h += `<path d="M${sx + 156} ${sy} H ${sx + 196}" stroke="${axis}" stroke-width="2"/>`;
  h += `<circle class="out ${yOut && S.modo === "RUN" ? "on" : ""}" cx="${sx + 222}" cy="${sy}" r="24"/>`;
  h += `<text x="${sx + 222}" y="${sy + 6}" text-anchor="middle" font-weight="700" font-size="17">${yOut != null && S.hayLect ? yOut : "y"}</text>`;
  h += `<text class="lbl" x="${sx + 222}" y="${sy + 46}" text-anchor="middle">${S.modo === "RUN" ? "LED azul" : "salida"}</text>`;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.innerHTML = h;
}

/* ------------------------------------------------------------------------
 * 4d. Sistema
 * ------------------------------------------------------------------------ */
function renderSistema(){
  const t = (k, v) => `<div class="tile"><span>${k}</span><b>${v}</b></div>`;
  const tasa = S.lectTimes.length > 1 ? ((S.lectTimes.length - 1) / (S.lectTimes[S.lectTimes.length - 1] - S.lectTimes[0])).toFixed(1) : "—";
  $("#devTiles").innerHTML =
    t("Placa", S.linked ? (S.placa || "ESP32") + (S.demo ? " (demo)" : "") : "—") +
    t("ADC", S.linked ? (S.cal ? "Calibrado" : "Sin calibrar") : "—") +
    t("Lecturas / s", S.linked ? tasa : "—") +
    t("Firmware", S.linked ? "v" + S.version : "—");
  const p = pines();
  $("#pinSub").textContent = S.placa || "ESP32 (por omisión)";
  $("#hwTxt").textContent = `${S.placa || "ESP32"} · ${S.n} potenciómetros · 1 botón · 2 LEDs`;
  let h = "<thead><tr><th>Elemento</th><th>Pin</th><th>Nota</th></tr></thead><tbody>";
  p.pots.forEach((g, i) => { h += `<tr${i >= S.n ? ' class="muted"' : ""}><td>Potenciómetro P${i}</td><td class="mono">${g}</td><td>${i < S.n ? "en uso" : "libre"}</td></tr>`; });
  h += `<tr><td>LED de estado (verde)</td><td class="mono">${p.ledEstado}</td><td>220 Ω a GND</td></tr>`;
  h += `<tr><td>LED de salida (azul)</td><td class="mono">${p.ledSalida}</td><td>220 Ω a GND</td></tr>`;
  h += `<tr><td>Botón de modo</td><td class="mono">${p.boton}</td><td>a GND (pull-up interno)</td></tr></tbody>`;
  $("#tbPins").innerHTML = h;
}

/* ------------------------------------------------------------------------
 * 4e. Consola
 * ------------------------------------------------------------------------ */
const LOG_MAX = 800;
const registro = [];
function log(txt, cls, pre){
  registro.push({ ts: hora(), txt: (pre ?? (cls === "tx" ? "> " : "")) + txt, cls: cls || "" });
  if(registro.length > LOG_MAX) registro.splice(0, registro.length - LOG_MAX);
  if(cls === "lt" && !$("#chkLect").checked) return;
  const el = $("#log"), abajo = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
  const r = registro[registro.length - 1];
  el.insertAdjacentHTML("beforeend", `<div class="${r.cls}"><span class="ts">${r.ts}</span>${esc(r.txt)}</div>`);
  while(el.childElementCount > 400) el.firstElementChild.remove();
  if(abajo) el.scrollTop = el.scrollHeight;
}
function repintarLog(){
  const ver = $("#chkLect").checked;
  $("#log").innerHTML = registro.filter(r => ver || r.cls !== "lt").slice(-400)
    .map(r => `<div class="${r.cls}"><span class="ts">${r.ts}</span>${esc(r.txt)}</div>`).join("");
  $("#log").scrollTop = $("#log").scrollHeight;
}

/* ------------------------------------------------------------------------
 * Render general
 * ------------------------------------------------------------------------ */
function pintarControles(){
  const on = S.linked && !S.entrenando;
  $("#swModo").disabled = !on || (!S.entrenado && S.modo === "OFF");
  $("#btnUmbral").disabled = !on;
  $("#btnTrain").disabled = !on;
  $$("#segN button").forEach(b => b.disabled = !on);
  $$("#presets button").forEach(b => b.disabled = !on);
  $("#cmdSend").disabled = !link;
  $("#btnTrain").lastChild.textContent = S.entrenando ? "Entrenando…" : S.entrenado ? "Volver a entrenar" : "Entrenar (LMS)";
}

function renderTodo(){
  pintarControles();
  renderMonitor();
  renderEntrenamiento();
  renderModelo();
  renderSistema();
}

function cambiarTab(t){
  tab = t; guardar("tab", t);
  $$(".tab").forEach(b => b.setAttribute("aria-selected", b.dataset.tab === t));
  $$(".panel").forEach(p => p.classList.toggle("on", p.id === "tab-" + t));
  renderTodo();
}

/* ------------------------------------------------------------------------
 * 5. Eventos
 * ------------------------------------------------------------------------ */
$("#btnConn").addEventListener("click", () => link ? desconectar() : conectar());
$("#btnDemo").addEventListener("click", iniciarDemo);
$$(".tab").forEach(b => b.addEventListener("click", () => cambiarTab(b.dataset.tab)));

$("#btnTema").addEventListener("click", () => {
  const oscuro = document.documentElement.dataset.theme
    ? document.documentElement.dataset.theme === "dark"
    : matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.dataset.theme = oscuro ? "light" : "dark";
  guardar("tema", document.documentElement.dataset.theme);
  $("#pots").dataset.firma = ""; $("#legHist").dataset.firma = "";
  renderTodo();
});
matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => { $("#pots").dataset.firma = ""; $("#legHist").dataset.firma = ""; renderTodo(); });

$("#swModo").addEventListener("click", () => send(S.modo === "RUN" ? "MODO=OFF" : "MODO=RUN"));
$("#umbral").addEventListener("input", () => renderMonitor());
$("#btnUmbral").addEventListener("click", () => { S.umbral = +$("#umbral").value; send("UMBRAL=" + S.umbral); renderMonitor(); });
$("#btnPausa").addEventListener("click", () => { S.pausa = !S.pausa; $("#btnPausa").textContent = S.pausa ? "Reanudar" : "Pausar"; });
$("#btnCsvLect").addEventListener("click", () => {
  if(!S.hist.length) return toast("No hay lecturas para exportar.", "warn");
  const n = Math.max(...S.hist.map(h => h.raw.length));
  let csv = "fecha_hora,modo,patron,y" + Array.from({ length: n }, (_, i) => `,P${i}_raw,P${i}_mV`).join("") + "\n";
  for(const h of S.hist){
    csv += `${new Date(h.wall).toISOString()},${h.modo},${h.patron},${h.y ?? ""}` + Array.from({ length: n }, (_, i) => `,${h.raw[i] ?? ""},${h.mv[i] ?? ""}`).join("") + "\n";
  }
  descargar("lecturas_adc.csv", csv, "text/csv");
});

$$("#segN button").forEach(b => b.addEventListener("click", () => {
  if(+b.dataset.n === S.n) return;
  S.curve = []; S.model = null; S.preset = "OR"; nota("#cfgMsg", "");
  send("N=" + b.dataset.n);
}));
$$("#presets button").forEach(b => b.addEventListener("click", () => {
  const p = b.dataset.p;
  S.preset = p; nota("#cfgMsg", "");
  if(p !== "CUSTOM"){ S.tabla = tablaPreset(p, S.n); enviarTabla(); }
  if(p === "XOR") nota("#cfgMsg", "XOR no es linealmente separable: el perceptrón simple no puede aprenderla por completo. Sirve para mostrar su límite.", "warn");
  renderEntrenamiento();
}));
$("#ttEdit").addEventListener("click", e => {
  const b = e.target.closest("button[data-i]");
  if(!b || b.disabled) return;
  const i = +b.dataset.i, arr = S.tabla.split("");
  arr[i] = arr[i] === "1" ? "0" : "1";
  S.tabla = arr.join("");
  S.preset = PRESETS.find(p => tablaPreset(p, S.n) === S.tabla) || "CUSTOM";
  if(S.preset !== "XOR") nota("#cfgMsg", "");
  enviarTabla(); renderEntrenamiento();
});
$("#btnTrain").addEventListener("click", () => {
  S.entrenando = true; S.curve = []; S.model = null;
  $("#trainBar").style.width = "0";
  nota("#trainMsg", "Iniciando entrenamiento…");
  send("ENTRENAR"); renderEntrenamiento(); pintarControles();
});
$("#chkLog").addEventListener("change", dibujarMse);
$("#btnCsvHist").addEventListener("click", () => {
  if(!S.runs.length) return toast("Aún no hay entrenamientos.", "warn");
  let csv = "n,hora,N,tabla,d,epocas,mse,theta,aciertos,patrones,w,b\n";
  S.runs.forEach((r, i) => { csv += `${i + 1},${r.hora},${r.n},${NOMBRE_PRESET[r.preset] || ""},'${r.d},${r.epocas},${r.mse},${r.theta},${r.aciertos},${r.patrones},"${r.w.join(";")}",${r.b}\n`; });
  descargar("entrenamientos.csv", csv, "text/csv");
});

/* consola */
const histCmd = []; let posCmd = 0;
$("#cmdForm").addEventListener("submit", e => {
  e.preventDefault();
  const v = $("#cmdIn").value.trim();
  if(!v || !link) return;
  send(v); histCmd.push(v); posCmd = histCmd.length; $("#cmdIn").value = "";
});
$("#cmdIn").addEventListener("keydown", e => {
  if(e.key === "ArrowUp" && posCmd > 0){ $("#cmdIn").value = histCmd[--posCmd]; e.preventDefault(); }
  if(e.key === "ArrowDown"){ posCmd = Math.min(histCmd.length, posCmd + 1); $("#cmdIn").value = histCmd[posCmd] || ""; e.preventDefault(); }
});
$$("#quick button").forEach(b => b.addEventListener("click", () => send(b.dataset.c)));
$("#chkLect").addEventListener("change", repintarLog);
$("#btnLogClr").addEventListener("click", () => { registro.length = 0; $("#log").innerHTML = ""; });
$("#btnLogDl").addEventListener("click", () => descargar("consola.txt", registro.map(r => `${r.ts} ${r.txt}`).join("\n")));

let rsz = null;
window.addEventListener("resize", () => { clearTimeout(rsz); rsz = setTimeout(renderTodo, 120); });

/* inicio */
(function inicio(){
  const tema = leer("tema"); if(tema === "dark" || tema === "light") document.documentElement.dataset.theme = tema;
  if(!("serial" in navigator)) $("#noSerial").classList.remove("hide");
  const t = leer("tab");
  pintarConexion();
  cambiarTab(["monitor", "train", "model", "system", "console"].includes(t) ? t : "monitor");
})();
