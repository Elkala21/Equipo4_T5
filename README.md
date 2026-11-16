# Equipo 4 · Tarea 5 · Perceptrón simple (LMS) en ESP32

Nodo de monitoreo de voltaje y control ON-OFF. Entre 2 y 5 potenciómetros se
leen con el ADC, cada lectura se convierte en 0 o 1 con un umbral, y ese
patrón de bits entra a un **perceptrón simple** entrenado con **LMS**. La
salida `y` del perceptrón enciende un LED. Un botón cambia el sistema entre
**OFF** y **RUN**, y una página web (HMI) permite configurarlo, entrenarlo y
verlo funcionar en vivo.

Proyecto ESP-IDF 5.5 con FreeRTOS · Inteligencia Artificial · Instituto Tecnológico de Chihuahua.

**Contenido**

1. [Qué necesitas](#1-qué-necesitas)
2. [Conexiones (pines)](#2-conexiones-pines)
3. [Compilar y cargar el firmware](#3-compilar-y-cargar-el-firmware)
4. [Guía de pruebas: qué debes ver](#4-guía-de-pruebas-qué-debes-ver)
5. [Cómo funciona el código](#5-cómo-funciona-el-código)
6. [Problemas comunes](#6-problemas-comunes)
7. [Referencia: protocolo serie y LMS](#7-referencia-protocolo-serie-y-lms)

---

## 1. Qué necesitas

**Hardware**

| Material | Cantidad |
|---|---|
| ESP32 DevKit (DevKitC o DevKit V1) con cable USB de datos | 1 |
| Potenciómetro (1 kΩ a 100 kΩ) | 2 a 5 |
| Botón (push button) | 1 |
| LED verde y LED azul (o de cualquier color) | 2 |
| Resistencia de 220 Ω a 330 Ω (para los LEDs) | 2 |
| Protoboard y cables | — |

**Software**

- [ESP-IDF 5.5](https://docs.espressif.com/projects/esp-idf/en/stable/esp32/get-started/) (con la extensión *ESP-IDF* de VS Code o desde terminal).
- **Chrome** o **Edge** para la interfaz web (Firefox y Safari no soportan Web Serial).
- Si Windows no reconoce la placa, instala el driver de su chip USB: **CP210x** o **CH340**.
- Opcional: `gcc` para probar el perceptrón en la PC.

---

## 2. Conexiones (pines)

### ¿En qué archivo están los pines?

En **[`main/bsp/BSP.h`](main/bsp/BSP.h)**, sección *Pines*. Hay un bloque por
placa y el compilador usa el que corresponde al *target* elegido (`esp32` o
`esp32c3`), así que no hay que tocar nada más:

```c
#if CONFIG_IDF_TARGET_ESP32
#define PIN_LED_ESTADO   19      // LED verde: estado del sistema (OFF/RUN)
#define PIN_LED_SALIDA   18      // LED azul : salida y del perceptron
#define PIN_BTN_MODO     21      // Boton a GND (pull-up interno)
#define PIN_POT0         36      // VP  - ADC1_CH0
...
```

| Función | ESP32 | ESP32-C3 | Tipo |
|---|---|---|---|
| Potenciómetro P0 → entrada x0 | GPIO36 (VP) | GPIO0 | entrada analógica |
| Potenciómetro P1 → entrada x1 | GPIO39 (VN) | GPIO1 | entrada analógica |
| Potenciómetro P2 → entrada x2 | GPIO34 | GPIO2 | entrada analógica |
| Potenciómetro P3 → entrada x3 | GPIO35 | GPIO3 | entrada analógica |
| Potenciómetro P4 → entrada x4 | GPIO32 | GPIO4 | entrada analógica |
| LED de estado (verde) | GPIO19 | GPIO20 | salida digital |
| LED de salida y (azul) | GPIO18 | GPIO21 | salida digital |
| Botón de modo | GPIO21 | GPIO10 | entrada digital |

Si usas N = 3, conecta solo P0, P1 y P2. Los demás pueden quedar sin conectar.

En el ESP32 los **potenciómetros** quedan en un lado de la placa (junto a VP/VN)
y los **LEDs y el botón** en el otro (D21, D19 y D18 están juntos), tanto en la
DevKit V1 de 30 pines como en la DevKitC de 38.

### Diagrama (ESP32)

```
            3V3 ──┬─────────┬─────────┐
                  │         │         │
                 ┌┴┐       ┌┴┐       ┌┴┐
         P0      │ │◄─┐    │ │◄─┐    │ │◄─┐       (un extremo a 3V3,
                 └┬┘  │    └┬┘  │    └┬┘  │        otro a GND,
                  │   │     │   │     │   │        pata central al GPIO)
            GND ──┴───┼─────┴───┼─────┴───┼──
                      │         │         │
                   GPIO36    GPIO39    GPIO34
                    (x0)      (x1)      (x2)

   ── otro lado de la placa ──

   GPIO19 ──[220 Ω]──►|── GND        LED verde (estado): ánodo (pata larga) hacia la resistencia
   GPIO18 ──[220 Ω]──►|── GND        LED azul (salida y)

   GPIO21 ──[ botón ]── GND          sin resistencia: el ESP32 usa su pull-up interno
```

> **Importante:** todos los GND (placa, potenciómetros, LEDs, botón) deben estar
> unidos. Usa solo **3V3** para los potenciómetros, nunca 5V: los pines del ESP32 no toleran 5 V.

### ¿Por qué esos pines? (por si necesitas cambiarlos)

Si tu placa no tiene alguno de esos pines o ya los usas, cámbialos en `BSP.h`
siguiendo estas reglas del ESP32:

| Pines | Restricción | ¿LED o botón? |
|---|---|---|
| 6–11 | Conectados a la memoria flash interna | ❌ Nunca |
| 1, 3 (TX0, RX0) | UART0: consola USB para cargar el programa y hablar con la HMI | ❌ Evitar |
| 34, 35, 36, 39 | **Solo entrada**, sin pull-up/pull-down interno | ❌ LED · ⚠️ botón solo con resistencia externa |
| 0, 2, 5, 12, 15 | Pines de *strapping*: su nivel al encender decide cómo arranca (GPIO0 es el botón BOOT; GPIO12 fija el voltaje de la flash) | ⚠️ Evitar: pueden impedir que arranque o que se cargue el programa |
| 5, 14, 15 | Emiten señales durante el arranque | ⚠️ Un LED parpadearía al encender |
| 16, 17 | PSRAM en módulos WROVER | ⚠️ Bien en WROOM (la DevKit común) |
| ADC2: 0, 2, 4, 12–15, 25–27 | Su ADC no funciona con WiFi activo | Solo importa para potenciómetros |

- **Potenciómetros:** usa **ADC1**: GPIO32, 33, 34, 35, 36 o 39.
- **LEDs y botón:** buenos candidatos son GPIO4, 13, 16–19, 21–23, 25–27, 32 y 33.
- Cada pin entrega como máximo ~20 mA: pon siempre una resistencia en serie con el LED.

---

## 3. Compilar y cargar el firmware

### Con VS Code (extensión ESP-IDF)

1. Abre la carpeta del proyecto (`perceptronXnLMS`).
2. En la barra inferior selecciona:
   - **Target:** `esp32`.
   - **Puerto:** el COM de la placa (en Windows: *Administrador de dispositivos → Puertos COM*).
   - **Método de flasheo:** `UART`. *JTAG* necesita un depurador externo y **no** funciona con el cable USB.
3. Pulsa **Build** (ícono de llave) y luego **Flash** (ícono de rayo).
4. Pulsa **Monitor** (ícono de pantalla) para ver los mensajes.

### Desde terminal (ESP-IDF PowerShell / CMD)

```
idf.py set-target esp32         # solo la primera vez o si cambias de placa
idf.py build
idf.py -p COM5 flash monitor    # cambia COM5 por tu puerto
```

Para salir del monitor: `Ctrl + ]` (o `Ctrl + T` y luego `Ctrl + X`).

---

## 4. Guía de pruebas: qué debes ver

Haz las pruebas en orden. Cada una tiene el resultado esperado. Si algo no
coincide, revisa [Problemas comunes](#6-problemas-comunes).

### Prueba 0 · El perceptrón en la PC (sin placa)

Comprueba que el algoritmo LMS funciona antes de usar el ESP32:

```
cd test
gcc -Wall -Wextra -I../main/perceptron test_perceptron.c ../main/perceptron/*.c -o test_perceptron -lm
./test_perceptron
```

✅ **Esperado:** AND y OR con 100 % de aciertos para N = 2 a 5, y XOR con 25 %.
XOR no es linealmente separable, así que un perceptrón simple no puede
aprenderla. Compara con [`test/host_results.txt`](test/host_results.txt).
Puede haber diferencias de ±1 época según el compilador.

### Prueba 1 · Arranque

Carga el firmware y abre el monitor.

✅ **Esperado:** después de los mensajes de arranque de ESP-IDF aparece:

```
LISTO,proyecto=perceptron_lms,placa=ESP32,version=2
LECT,OFF,n=3,P0=0,V0=142,P1=4095,V1=3110,P2=1820,V2=1530,patron=2,y=0
LECT,OFF,n=3,...                      ← una línea cada 200 ms
```

El sistema arranca en **OFF**, con N = 3 y la tabla **OR** sin entrenar. Los dos LEDs están apagados.

### Prueba 2 · Lectura de los potenciómetros

Mira las líneas `LECT` mientras giras cada potenciómetro.

✅ **Esperado:** el `P` del potenciómetro que giras va de **0** a **4095**
(valor crudo del ADC de 12 bits) y `V` va de unos **150** a **3100** mV.
Al pasar el umbral (2048 por omisión) cambia el bit correspondiente en
`patron`. Por ejemplo, con P0 y P2 arriba, `patron=5` (binario `101`).

❌ Si todos marcan 4095 fijo o 0 fijo, revisa GND y la pata central (ver [Problemas comunes](#6-problemas-comunes)).

### Prueba 3 · Abrir la interfaz web (HMI)

1. **Cierra el monitor serie** (solo un programa puede usar el puerto).
2. Abre `hmi/index.html` con Chrome o Edge (doble clic sobre el archivo).
3. Pulsa **Conectar** y elige el puerto de la placa.

✅ **Esperado:** el indicador cambia a **Conectado** y aparece *Placa: ESP32*.
En *Monitoreo* los medidores se mueven al girar los potenciómetros. La casilla
de bit de cada uno se pone azul (1) cuando su voltaje pasa la línea del umbral.

> Sin placa, el botón **Modo demo** simula todo en el navegador. Sirve para
> conocer la interfaz, pero sus datos no son reales.

### Prueba 4 · Entrenar el perceptrón

En la pestaña **Entrenamiento**:

1. Elige **N = 3** y la tabla **OR**.
2. Pulsa **Entrenar (LMS)**.

✅ **Esperado:**
- El LED verde **parpadea** mientras entrena.
- La curva del MSE baja rápido y se aplana. Termina en unas **40 épocas** con MSE ≈ 0.07.
- Aparece *8 de 8 patrones correctos* y la columna `y` de la tabla coincide con `d`.
- En *Modelo* se ven los pesos (todos positivos para OR) y el diagrama del perceptrón.

### Prueba 5 · Modo RUN (inferencia)

Pulsa el **botón físico** (o el interruptor de *Modo* en la página).

✅ **Esperado:**
- El **LED verde se enciende** (sistema en RUN).
- El **LED azul** sigue la tabla entrenada. Con **OR** se enciende si **al
  menos un** potenciómetro está arriba del umbral, y se apaga cuando **todos**
  están abajo.
- En la página, *Salida del perceptrón* muestra `y` y el cálculo `a = … ≥ θ`.

Pulsa el botón otra vez: el sistema vuelve a **OFF** y se apagan ambos LEDs.
Un clic cambia el modo una sola vez, aunque mantengas el botón presionado.

### Prueba 6 · Otras tablas de verdad

| Tabla | El LED azul se enciende cuando… |
|---|---|
| AND | **todos** los potenciómetros están arriba |
| NOR | **todos** están abajo |
| Mayoría | más de la mitad están arriba |
| Personalizada | lo que marques en la columna `d` (clic para cambiar 0/1) |
| XOR (N = 2) | el entrenamiento termina con errores (*no linealmente separable*): es el límite del perceptrón simple |

Al cambiar N o la tabla, el sistema pasa a OFF y hay que **volver a entrenar**.
Si pulsas el botón sin entrenar, el sistema no pasa a RUN (mensaje `ERR,sin_entrenar`).

### Prueba 7 · Umbral

En *Monitoreo* mueve el control **Umbral de binarización** y pulsa **Aplicar**.

✅ **Esperado:** la marca del umbral se mueve en los medidores y en la
gráfica, y los bits cambian con otro ángulo del potenciómetro. Hay una
histéresis de ±100 para que el bit no oscile cuando el voltaje está justo en el umbral.

### Prueba sin interfaz (solo monitor serie)

También puedes escribir los comandos a mano en el monitor de ESP-IDF:

```
STREAM=0          ← pausa las lecturas para que no tapen la pantalla
ECO=1             ← muestra lo que escribes
N=2
TABLA=AND
ENTRENAR          ← responde EPOCA,... MODELO,... OK,ENTRENAR
MODO=RUN
STREAM=1
AYUDA             ← lista todos los comandos
```

---

## 5. Cómo funciona el código

### Capas

El código sigue las capas que pide la tarea. Cada carpeta es una capa:

```
┌────────────────────────────────────────────┐
│ HMI            hmi/  (página web)          │  Software de aplicación
├────────────────────────────────────────────┤
│ Perceptrón     main/perceptron/            │
│ main / RTOS    main/main.c                 │  Software de sistema
│ BSP            main/bsp/                   │
│ Drivers        ESP-IDF (esp_adc, gpio...)  │
├────────────────────────────────────────────┤
│ Hardware       ESP32, potenciómetros...    │  Hardware
└────────────────────────────────────────────┘
```

```
perceptronXnLMS/
├── hmi/
│   ├── index.html          estructura de las 5 pantallas
│   ├── css/estilos.css     estilos (tema claro y oscuro)
│   └── js/
│       ├── enlace.js       comunicación Web Serial + simulador (modo demo)
│       ├── graficas.js     gráficas en <canvas>, sin librerías
│       └── app.js          estado, protocolo y pantallas
├── main/
│   ├── main.c              tareas FreeRTOS y comandos de la HMI
│   ├── perceptron/
│   │   ├── perceptron.h    tipos y prototipos
│   │   ├── perceptron.c    crear/liberar (memoria dinámica) e inferencia
│   │   ├── lms.c           entrenamiento LMS
│   │   └── patterns.c      tablas de verdad
│   └── bsp/
│       ├── BSP.h           pines, constantes, estructuras y prototipos
│       ├── ADC.c           ADC1, calibración y binarización con umbral
│       ├── GPIO.c          LEDs, botón con interrupción y debounce
│       └── PRINT.c         consola serie: leer comandos e imprimir lecturas
└── test/
    └── test_perceptron.c   prueba del perceptrón en la PC
```

### Recorrido de un dato: del potenciómetro al LED

```
 Potenciómetro ─► ADC.c ─────────► patrón de bits ─► perceptron.c ─► GPIO.c ─► LED azul
   (voltaje)     raw 0–4095        x2 x1 x0 = 101     y = (a ≥ θ)     y = 1      enciende
                 umbral → 0/1      patron = 5         a = w·x + b
```

1. **Lectura (`ADC.c`)**: `adc_read_all()` lee cada potenciómetro (valor
   crudo 0–4095), lo convierte a milivolts con la calibración de fábrica y lo
   **binariza**: 1 si supera el umbral, 0 si no.
2. **Patrón (`ADC.c`)**: `adc_patron()` junta los bits en un número. P0 es el
   bit menos significativo: P0 = 1, P1 = 0, P2 = 1 da el patrón 5 (`101`).
3. **Inferencia (`perceptron.c`)**: `perceptron_inferir()` calcula
   `a = w0·x0 + w1·x1 + … + b` y responde `y = 1` si `a ≥ θ`.
4. **Salida (`GPIO.c`)**: `gpio_escribir_bit()` enciende o apaga el LED azul con `y`.

### El perceptrón y el entrenamiento LMS

- **Crear** (`perceptron_crear`): reserva con `malloc`/`calloc` los N pesos +
  el sesgo (N + 1 pesos) y la tabla de 2^N patrones, como pide la tarea
  (*memoria dinámica*). Cambiar N libera y vuelve a crear todo.
- **Tabla de verdad** (`patterns.c`): define la salida deseada `d` de cada patrón (OR, AND o personalizada).
- **Entrenar** (`lms.c`): en cada **época** recorre los 2^N patrones y ajusta los pesos:

  ```
  a = w·x + b          salida lineal
  e = d − a            error
  w ← w + η·e·x        η = 0.1
  b ← b + η·e
  ```

  Se detiene cuando el error cuadrático medio (MSE) deja de cambiar
  (ΔMSE < 10⁻⁶) o a las 2000 épocas. Al final calcula el umbral **θ** a la
  mitad entre la menor `a` de los patrones con d = 1 y la mayor con d = 0.

### Tareas FreeRTOS (`main.c`)

`app_main()` inicializa el BSP (GPIO, ADC, consola), crea el perceptrón con
N = 3 y lanza cuatro tareas que corren en paralelo:

| Tarea | Cada | Qué hace |
|---|---|---|
| `adc` | 50 ms | Lee los potenciómetros y, en RUN, hace la inferencia y escribe el LED azul |
| `modo` | 20 ms | Revisa si se presionó el botón y alterna OFF ↔ RUN (LED verde) |
| `cmd` | al llegar un comando | Lee una línea del puerto serie y la ejecuta (`N=`, `TABLA=`, `ENTRENAR`…) |
| `print` | 200 ms | Envía una línea `LECT` con las lecturas a la HMI |

Un **mutex** evita que dos tareas modifiquen el perceptrón o las lecturas al
mismo tiempo. Por ejemplo, impide que `adc` infiera mientras `cmd` cambia N.

### El botón y el debounce (`GPIO.c` y `main.c`)

El botón funciona como **toggle**: cada clic cambia OFF ↔ RUN una sola vez,
sin importar cuánto tiempo lo mantengas presionado.

1. Va a GND con el **pull-up interno**, así que al presionarlo el pin baja de 1 a 0.
2. Ese flanco de bajada genera una **interrupción**. La rutina de interrupción
   ignora los rebotes de los siguientes 200 ms y solo levanta una bandera.
3. La tarea `modo` ve la bandera, espera 30 ms y confirma que el botón **sigue
   presionado**, para descartar ruido. Entonces cambia el modo.
4. Después espera a que el botón quede **suelto** de forma estable (50 ms) y
   borra la bandera. Así el rebote al soltarlo no cuenta como un segundo clic.

### La HMI (`hmi/`)

La página usa la **Web Serial API** del navegador para abrir el puerto USB.
Envía los mismos comandos de texto que podrías escribir a mano, y dibuja lo
que recibe (`LECT`, `EPOCA`, `MODELO`…). Tiene 5 pantallas:

| Pantalla | Para qué |
|---|---|
| Monitoreo | Modo, patrón, salida y, voltaje de cada potenciómetro, LEDs, umbral e historial de 30 s |
| Entrenamiento | N, tabla de verdad, curva del MSE, resultados e historial exportable a CSV |
| Modelo | Diagrama del perceptrón en vivo, pesos, salida lineal por patrón y frontera de decisión (N = 2) |
| Sistema | Capas, pines de la placa conectada y tareas FreeRTOS |
| Consola | Mensajes del puerto y envío manual de comandos |

---

## 6. Problemas comunes

| Síntoma | Causa probable | Solución |
|---|---|---|
| Todos los potenciómetros marcan **4095** fijo | GND desconectado o mal soldado | Revisa con multímetro la continuidad de GND entre la placa y los potenciómetros |
| Un potenciómetro marca **0** fijo o valores al azar | Pata central desconectada o en otro pin | Verifica que la pata central vaya al GPIO de la tabla |
| El valor salta aunque no muevas nada | Ruido normal del ADC | Es normal ±20; la histéresis evita que el bit oscile |
| No aparece el puerto COM | Cable solo de carga o falta el driver | Usa otro cable; instala el driver CP210x o CH340 |
| El flasheo se queda en *Connecting…* | La placa no entra a modo de carga | Mantén **BOOT**, presiona y suelta **EN/RESET**, suelta **BOOT** |
| El flasheo falla con *JTAG* | Método de flasheo equivocado | Elige **UART** en la barra de VS Code |
| La página no conecta o *El ESP32 no responde* | El monitor serie sigue abierto | Cierra el monitor (`Ctrl + ]`) y vuelve a conectar |
| El botón no cambia a RUN | Perceptrón sin entrenar | Entrena primero (aparece `ERR,sin_entrenar`) |
| El botón no hace nada | Botón mal conectado | Una pata a GPIO21 y la otra a **GND** |
| Un LED no enciende | LED al revés | La pata larga (ánodo) va hacia la resistencia y el GPIO |
| Al pasar la mitad del potenciómetro el bit no cambia | Umbral muy alto o muy bajo | Ajusta el umbral en la HMI (comando `UMBRAL=`) |

---

## 7. Referencia: protocolo serie y LMS

Texto a 115200 baudios, una línea por mensaje.

| PC → ESP32 | Efecto |
|---|---|
| `HOLA` / `ESTADO` | Responde `ESTADO,...` |
| `N=3` | Número de potenciómetros (2 a 5); crea el perceptrón (memoria dinámica) |
| `TABLA=OR` / `AND` / `00010111` | Tabla de verdad (2^N bits, patrón 0 primero) |
| `ENTRENAR` | LMS; responde `EPOCA,...`, `MODELO,...`, `OK,ENTRENAR` |
| `MODO=RUN` / `OFF` / `TOGGLE` | Igual que el botón físico |
| `UMBRAL=2048` | Umbral del ADC para binarizar (100 a 3995) |
| `STREAM=0` / `1` | Pausa o activa el envío de lecturas |
| `ECO=0` / `1` | Eco de lo que se escribe (para consola manual) |
| `AYUDA` | Lista los comandos |

| ESP32 → PC | Contenido |
|---|---|
| `LISTO,...` | Arranque terminado |
| `LECT,RUN,n=3,P0=1234,V0=1012,...,patron=2,y=0` | Lecturas cada 200 ms (`P` crudo, `V` en mV) |
| `ESTADO,modo=OFF,n=3,tabla=01111111,entrenado=0,umbral=2048,stream=1,placa=ESP32,cal=1` | Estado completo |
| `EPOCA,k=12,mse=0.08410` | Avance del entrenamiento |
| `MODELO,n=3,w=..;..;..,b=..,theta=..,epocas=..,mse=..,aciertos=8,patrones=8,d=..,y=..` | Resultado del entrenamiento |
| `MODO,RUN` | Cambio de modo |
| `OK,<cmd>` / `ERR,<motivo>` | Confirmación o error |

En la tabla de verdad, el patrón `i` tiene `x_j` = bit `j` de `i`. P0 es el bit
menos significativo, así que `TABLA=01111111` con N = 3 es OR.

**Volver al ESP32-C3:** `idf.py set-target esp32c3` y en *menuconfig* →
*Component config → ESP System Settings → Channel for console output* elige
**USB Serial/JTAG** (sus GPIO20/21 se usan para los LEDs).

*El código de la plantilla original es de dominio público (CC0).*
