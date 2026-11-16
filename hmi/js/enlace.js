/* ==========================================================================
 * enlace.js · Comunicación con el ESP32
 *
 *   SerialLink  puerto serie real (Web Serial API, Chrome / Edge)
 *   DemoLink    simulador del firmware en el navegador (modo demo)
 *
 * Ambos tienen la misma interfaz: send(linea), close() y llaman a
 * onLine(linea) por cada línea recibida. Protocolo (texto, una línea):
 *   PC -> ESP : HOLA | ESTADO | N=3 | TABLA=OR|AND|<bits> | ENTRENAR |
 *               MODO=RUN|OFF|TOGGLE | UMBRAL=2048 | STREAM=0|1 | AYUDA
 *   ESP -> PC : LISTO,.. ESTADO,.. EPOCA,.. MODELO,.. MODO,.. LECT,.. OK,.. ERR,..
 * ========================================================================== */
"use strict";

class SerialLink{
  constructor(onLine, onClose){
    this.onLine = onLine; this.onClose = onClose;
    this.enc = new TextEncoder();
  }

  async open(){
    this.port = await navigator.serial.requestPort();
    await this.port.open({ baudRate: 115200 });
    /* DTR y RTS en reposo: en placas con puente USB-UART evita dejar el
       ESP32 en reset o en modo de descarga */
    try{ await this.port.setSignals({ dataTerminalReady: false, requestToSend: false }); }catch(e){}
    this.writer = this.port.writable.getWriter();
    this.reader = this.port.readable.getReader();
    this.loop();
  }

  async loop(){
    const dec = new TextDecoder();
    let buf = "";
    try{
      while(true){
        const { value, done } = await this.reader.read();
        if(done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while((i = buf.search(/\r?\n/)) >= 0){
          const line = buf.slice(0, i).replace(/\x1b\[[0-9;]*m/g, "").trim();   // quita colores de ESP-IDF
          buf = buf.slice(buf[i] === "\r" ? i + 2 : i + 1);
          if(line) this.onLine(line);
        }
        if(buf.length > 4000) buf = "";
      }
    }catch(e){
      this.onLine("#Error de lectura: " + e.message);
    }
    this.onClose();
  }

  send(line){
    this.writer.write(this.enc.encode(line + "\n"))
      .catch(e => this.onLine("#Error al enviar: " + e.message));
  }

  async close(){
    try{ await this.reader.cancel(); }catch(e){}
    try{ this.reader.releaseLock(); this.writer.releaseLock(); await this.port.close(); }catch(e){}
  }
}

/* -------------------------------------------------------------------------
 * Simulador: reproduce la lógica del firmware (main.c, ADC.c, lms.c) para
 * poder ver la interfaz sin placa. Los potenciómetros se mueven con sliders.
 * ------------------------------------------------------------------------- */
class DemoLink{
  constructor(onLine){
    this.onLine = onLine;
    this.n = 3; this.d = []; this.entrenado = false; this.modo = "OFF";
    this.umbral = 2048; this.stream = true; this.w = []; this.b = 0; this.theta = .5;
    this.pots = [400, 3300, 3300, 400, 400];
    this.bits = [0, 0, 0, 0, 0];
    this.setTabla("OR");
    this.timer = setInterval(() => this.lect(), 200);
    setTimeout(() => this.onLine("LISTO,proyecto=perceptron_lms,placa=ESP32,version=2"), 120);
  }

  close(){ clearInterval(this.timer); clearInterval(this.tr); }
  emit(l){ setTimeout(() => this.onLine(l), 8); }

  setTabla(t){
    const P = 1 << this.n;
    if(t === "OR" || t === "AND"){
      this.d = [];
      for(let i = 0; i < P; i++){
        let v = i & 1;
        for(let j = 1; j < this.n; j++){ const x = (i >> j) & 1; v = t === "OR" ? (v | x) : (v & x); }
        this.d.push(v);
      }
      return true;
    }
    if(t.length !== P || /[^01]/.test(t)) return false;
    this.d = t.split("").map(Number);
    return true;
  }

  mv(raw){ return Math.round(140 + raw * (2950 - 140) / 4095); }   // curva aproximada del ADC con 12 dB

  patron(){                                   // binariza con histéresis, igual que ADC.c
    let p = 0;
    for(let i = 0; i < this.n; i++){
      const v = this.pots[i];
      this.bits[i] = this.bits[i] ? (v > this.umbral - 100 ? 1 : 0) : (v >= this.umbral + 100 ? 1 : 0);
      if(this.bits[i]) p |= 1 << i;
    }
    return p;
  }

  lineal(i){ let a = this.b; for(let j = 0; j < this.n; j++) a += this.w[j] * ((i >> j) & 1); return a; }

  estado(){
    this.emit(`ESTADO,modo=${this.modo},n=${this.n},tabla=${this.d.join("")},entrenado=${this.entrenado ? 1 : 0},` +
              `umbral=${this.umbral},stream=${this.stream ? 1 : 0},placa=ESP32,cal=1`);
  }

  lect(){
    if(!this.stream) return;
    const p = this.patron();
    const y = (this.modo === "RUN" && this.entrenado) ? (this.lineal(p) >= this.theta ? 1 : 0) : 0;
    let s = `LECT,${this.modo},n=${this.n}`;
    for(let i = 0; i < this.n; i++){
      const raw = Math.max(0, Math.min(4095, Math.round(this.pots[i] + (Math.random() - .5) * 18)));   // ruido del ADC
      s += `,P${i}=${raw},V${i}=${this.mv(raw)}`;
    }
    this.onLine(s + `,patron=${p},y=${y}`);
  }

  send(line){
    const k = line.indexOf("=");
    const c = (k < 0 ? line : line.slice(0, k)).trim().toUpperCase();
    const a = k < 0 ? "" : line.slice(k + 1).trim();

    if(c === "HOLA" || c === "ESTADO") return this.estado();
    if(c === "AYUDA" || c === "?") return this.emit("AYUDA,Comandos: HOLA | ESTADO | N=<2..5> | TABLA=OR|AND|<bits> | ENTRENAR | MODO=RUN|OFF|TOGGLE | UMBRAL=<0..4095> | STREAM=0|1 | ECO=0|1");
    if(c === "N"){
      const n = parseInt(a, 10);
      if(!(n >= 2 && n <= 5)) return this.emit("ERR,n_fuera_de_rango(2..5)");
      this.n = n; this.modo = "OFF"; this.entrenado = false; this.setTabla("OR");
      this.emit("OK,N"); return this.estado();
    }
    if(c === "TABLA"){
      const t = a.toUpperCase();
      if(!this.setTabla(t === "OR" || t === "AND" ? t : a)) return this.emit(`ERR,tabla_invalida(se_requieren_${1 << this.n}_bits)`);
      this.modo = "OFF"; this.entrenado = false;
      this.emit("OK,TABLA"); return this.estado();
    }
    if(c === "UMBRAL"){
      const u = parseInt(a, 10);
      if(!(u >= 100 && u <= 3995)) return this.emit("ERR,umbral_fuera_de_rango");
      this.umbral = u; return this.emit("OK,UMBRAL");
    }
    if(c === "STREAM"){ this.stream = a !== "0"; return this.emit("OK,STREAM"); }
    if(c === "ECO") return this.emit("OK,ECO");
    if(c === "MODO"){
      const m = a.toUpperCase();
      const nuevo = m === "TOGGLE" ? (this.modo === "OFF" ? "RUN" : "OFF") : m;
      if(nuevo !== "RUN" && nuevo !== "OFF") return this.emit("ERR,modo_invalido");
      if(nuevo === "RUN" && !this.entrenado) return this.emit("ERR,sin_entrenar");
      this.modo = nuevo; return this.emit("MODO," + nuevo);
    }
    if(c === "ENTRENAR") return this.entrenar();
    this.emit("ERR,comando_desconocido");
  }

  entrenar(){                                 // misma regla que lms.c, una época cada 20 ms
    this.modo = "OFF"; this.entrenado = false;
    const P = 1 << this.n, eta = .1;
    this.w = new Array(this.n).fill(0); this.b = 0;
    let prev = 1e9, k = 0;
    clearInterval(this.tr);
    this.tr = setInterval(() => {
      for(let rep = 0; rep < 2; rep++){
        let mse = 0;
        for(let i = 0; i < P; i++){
          const e = this.d[i] - this.lineal(i);
          for(let j = 0; j < this.n; j++) this.w[j] += eta * e * ((i >> j) & 1);
          this.b += eta * e; mse += e * e;
        }
        mse /= P; k++;
        const fin = Math.abs(prev - mse) < 1e-6 || k >= 2000;
        if(k < 200 || k % 10 === 0 || fin) this.onLine(`EPOCA,k=${k},mse=${mse.toFixed(5)}`);
        prev = mse;
        if(fin){ clearInterval(this.tr); this.terminar(k, mse); return; }
      }
    }, 20);
  }

  terminar(k, mse){
    const P = 1 << this.n;
    let min1 = 1e9, max0 = -1e9;
    for(let i = 0; i < P; i++){
      const a = this.lineal(i);
      if(this.d[i] && a < min1) min1 = a;
      if(!this.d[i] && a > max0) max0 = a;
    }
    this.theta = (min1 < 1e9 && max0 > -1e9 && min1 > max0) ? (min1 + max0) / 2 : .5;
    const y = []; let ac = 0;
    for(let i = 0; i < P; i++){ y.push(this.lineal(i) >= this.theta ? 1 : 0); if(y[i] === this.d[i]) ac++; }
    this.entrenado = true;
    this.onLine(`MODELO,n=${this.n},w=${this.w.map(v => v.toFixed(4)).join(";")},b=${this.b.toFixed(4)},` +
                `theta=${this.theta.toFixed(4)},epocas=${k},mse=${mse.toFixed(5)},aciertos=${ac},patrones=${P},` +
                `d=${this.d.join("")},y=${y.join("")}`);
    this.onLine("OK,ENTRENAR");
  }

  /* botón físico simulado */
  boton(){ this.send("MODO=TOGGLE"); }
}
