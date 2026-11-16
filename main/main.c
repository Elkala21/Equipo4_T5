/*
 * main.c
 *
 * Nodo de monitoreo de voltaje y control ON-OFF con perceptron simple (LMS)
 * en ESP32 / ESP32-C3 (ESP-IDF + FreeRTOS).
 *
 * Capas:  HMI (pagina HTML / consola) -> main/RTOS + Perceptron -> BSP -> Drivers -> HW
 *
 * El firmware se controla con comandos de texto, una linea por comando, por
 * el puerto serie (USB). La interfaz HTML (hmi/index.html) los envia sola; en
 * una consola manual se pueden escribir a mano (comando AYUDA).
 *
 *   HOLA | ESTADO        estado actual
 *   N=<2..5>             numero de potenciometros (crea el perceptron: memoria dinamica)
 *   TABLA=OR|AND|<bits>  tabla de verdad: 2^N caracteres 0/1, el patron 0 primero
 *   ENTRENAR             entrenamiento LMS (responde EPOCA,... y MODELO,...)
 *   MODO=RUN|OFF|TOGGLE  equivale al boton fisico
 *   UMBRAL=<raw>         umbral del ADC (0-4095) para binarizar los potenciometros
 *   STREAM=0|1           activa o pausa el envio periodico de lecturas
 *   ECO=0|1              eco de lo que se escribe (para consola manual)
 *
 * Respuestas:  OK,<cmd> | ERR,<texto> | ESTADO,... | EPOCA,... | MODELO,... |
 *              MODO,<OFF|RUN> | LECT,... (cada T_PRINT_MS)
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <ctype.h>
#include "BSP.h"
#include "perceptron.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/semphr.h"

#define T_MODO_MS     20
#define T_CONFIRMA_MS 30            // el boton debe seguir presionado este tiempo
#define T_SUELTO_MS   50            // y quedar suelto este tiempo antes del siguiente clic
#define T_ADC_MS      50
#define T_PRINT_MS    200
#define N_INICIAL     3

static gen_gpio_strc leds[NUMLEDS];
static gen_gpio_strc botones[NUMBTNS];
static adc_chan_strc pots[MAX_POTS];

static perceptron_t red;
static int  numPots = 0;
static char tabla_txt[33] = "";                 // salidas deseadas actuales (2^N caracteres)

static volatile modo_e modo = MODO_OFF;
static volatile bool   entrenado = false;
static volatile bool   stream = true;
static volatile bool   eco = false;
static volatile int    salida_y = 0;
static volatile uint32_t patron_actual = 0;
static SemaphoreHandle_t mtx;                   // protege red, numPots, pots[], modo, salida_y

/* ------------------------------------------------------------------ */
/* Utilidades                                                         */
/* ------------------------------------------------------------------ */
static void tabla_a_texto(void)
{
	for(int i = 0; i < red.patrones; i++) tabla_txt[i] = (char)('0' + red.d[i]);
	tabla_txt[red.patrones] = '\0';
}

static void enviar_estado(void)
{
	xSemaphoreTake(mtx, portMAX_DELAY);
	printf("ESTADO,modo=%s,n=%d,tabla=%s,entrenado=%d,umbral=%d,stream=%d,placa=%s,cal=%d\n",
		   modo == MODO_RUN ? "RUN" : "OFF", numPots, tabla_txt,
		   entrenado ? 1 : 0, adc_get_umbral(), stream ? 1 : 0, PLACA, adc_calibrado() ? 1 : 0);
	xSemaphoreGive(mtx);
}

static void enviar_modelo(void)
{
	/* La salida del perceptron y de cada patron se envia como cadena de bits */
	char ybits[33];
	for(int i = 0; i < red.patrones; i++) ybits[i] = (char)('0' + red.y[i]);
	ybits[red.patrones] = '\0';

	int aciertos = 0;
	for(int i = 0; i < red.patrones; i++) if(red.y[i] == red.d[i]) aciertos++;

	char pesos[96] = "";
	int len = 0;
	for(int j = 0; j < red.n; j++){
		len += snprintf(pesos + len, sizeof(pesos) - len, j ? ";%.4f" : "%.4f", red.w[j]);
	}
	printf("MODELO,n=%d,w=%s,b=%.4f,theta=%.4f,epocas=%d,mse=%.5f,aciertos=%d,patrones=%d,d=%s,y=%s\n",
		   red.n, pesos, red.b, red.theta, red.epocas, red.mse, aciertos, red.patrones, tabla_txt, ybits);
}

/* ------------------------------------------------------------------ */
/* Cambios de configuracion y de modo                                 */
/* ------------------------------------------------------------------ */

/* Apaga el sistema: modo OFF, LEDs apagados. Llamar con el mutex tomado. */
static void forzar_off(void)
{
	modo = MODO_OFF;
	salida_y = 0;
	gpio_escribir_bit(&leds[LED_ESTADO], false);
	gpio_escribir_bit(&leds[LED_SALIDA], false);
}

/* Crea el perceptron para n entradas (memoria dinamica) con la tabla OR por omisión */
static bool aplicar_n(int n)
{
	bool ok = true;

	xSemaphoreTake(mtx, portMAX_DELAY);
	forzar_off();
	entrenado = false;
	perceptron_liberar(&red);
	numPots = 0;

	if(perceptron_crear(&red, n)){
		numPots = n;
		perceptron_tabla_preset(&red, TABLA_OR);
		tabla_a_texto();
	}else{
		ok = false;
	}
	xSemaphoreGive(mtx);
	return ok;
}

/* Cambia el modo. Devuelve false si se pide RUN sin perceptron entrenado. */
static bool cambiar_modo(int nuevo)       // -1 = alternar
{
	bool ok = true;

	xSemaphoreTake(mtx, portMAX_DELAY);
	modo_e m = (nuevo < 0) ? (modo == MODO_OFF ? MODO_RUN : MODO_OFF) : (modo_e)nuevo;

	if(m == MODO_RUN && !entrenado){
		ok = false;
	}else if(m == MODO_RUN){
		modo = MODO_RUN;
		gpio_escribir_bit(&leds[LED_ESTADO], true);
	}else{
		forzar_off();
	}
	modo_e actual = modo;
	xSemaphoreGive(mtx);

	if(ok) printf("MODO,%s\n", actual == MODO_RUN ? "RUN" : "OFF");
	else   printf("ERR,sin_entrenar\n");
	return ok;
}

/* Entrenamiento LMS: una linea EPOCA por epoca (por 10 si son muchas) */
static void entrenar(void)
{
	xSemaphoreTake(mtx, portMAX_DELAY);
	forzar_off();
	entrenado = false;
	perceptron_reiniciar(&red);
	xSemaphoreGive(mtx);

	while(red.epocas < PER_MAX_EPOCAS){
		bool convergio = perceptron_epoca(&red);
		gpio_escribir_bit(&leds[LED_ESTADO], (red.epocas & 1));       // parpadeo durante el entrenamiento
		if(red.epocas < 200 || red.epocas % 10 == 0 || convergio){
			printf("EPOCA,k=%d,mse=%.5f\n", red.epocas, red.mse);
		}
		if(convergio) break;
		vTaskDelay(1);                                                // cede la CPU (y deja ver la curva)
	}

	xSemaphoreTake(mtx, portMAX_DELAY);
	perceptron_calibrar_umbral(&red);
	perceptron_evaluar(&red);
	red.entrenado = true;
	entrenado = true;
	gpio_escribir_bit(&leds[LED_ESTADO], false);
	xSemaphoreGive(mtx);

	enviar_modelo();
	printf("OK,ENTRENAR\n");
}

/* ------------------------------------------------------------------ */
/* HMI: interpreta una linea de comando                               */
/* ------------------------------------------------------------------ */
static void ayuda(void)
{
	printf("AYUDA,Comandos: HOLA | ESTADO | N=<2..5> | TABLA=OR|AND|<bits> | ENTRENAR | MODO=RUN|OFF|TOGGLE | UMBRAL=<0..4095> | STREAM=0|1 | ECO=0|1\n");
}

static void hmi_procesar(char *linea)
{
	/* quita espacios finales; separa COMANDO=ARGUMENTO y pasa el comando a mayusculas */
	for(int i = (int)strlen(linea) - 1; i >= 0 && linea[i] == ' '; i--) linea[i] = '\0';
	char *arg = strchr(linea, '=');
	if(arg) *arg++ = '\0';
	for(char *p = linea; *p; p++) *p = (char)toupper((unsigned char)*p);

	if(!strcmp(linea, "HOLA") || !strcmp(linea, "ESTADO")){
		enviar_estado();
	}
	else if(!strcmp(linea, "AYUDA") || !strcmp(linea, "?")){
		ayuda();
	}
	else if(!strcmp(linea, "N")){
		int n = arg ? atoi(arg) : 0;
		if(n < MIN_POTS || n > MAX_POTS){
			printf("ERR,n_fuera_de_rango(%d..%d)\n", MIN_POTS, MAX_POTS);
		}else if(!aplicar_n(n)){
			printf("ERR,sin_memoria\n");
		}else{
			printf("OK,N\n");
			enviar_estado();
		}
	}
	else if(!strcmp(linea, "TABLA")){
		if(!arg){
			printf("ERR,falta_tabla\n");
			return;
		}
		xSemaphoreTake(mtx, portMAX_DELAY);
		bool ok = true;
		if(!strcasecmp(arg, "OR"))        perceptron_tabla_preset(&red, TABLA_OR);
		else if(!strcasecmp(arg, "AND"))  perceptron_tabla_preset(&red, TABLA_AND);
		else                              ok = perceptron_tabla_texto(&red, arg);

		if(ok){
			forzar_off();
			entrenado = false;
			tabla_a_texto();
		}
		xSemaphoreGive(mtx);

		if(ok){ printf("OK,TABLA\n"); enviar_estado(); }
		else  { printf("ERR,tabla_invalida(se_requieren_%d_bits)\n", red.patrones); }
	}
	else if(!strcmp(linea, "ENTRENAR")){
		entrenar();
	}
	else if(!strcmp(linea, "MODO")){
		if(!arg)                          printf("ERR,falta_modo\n");
		else if(!strcasecmp(arg, "RUN"))  cambiar_modo(MODO_RUN);
		else if(!strcasecmp(arg, "OFF"))  cambiar_modo(MODO_OFF);
		else if(!strcasecmp(arg, "TOGGLE")) cambiar_modo(-1);
		else                              printf("ERR,modo_invalido\n");
	}
	else if(!strcmp(linea, "UMBRAL")){
		int u = arg ? atoi(arg) : -1;
		if(u < ADC_HISTERESIS || u > 4095 - ADC_HISTERESIS){
			printf("ERR,umbral_fuera_de_rango\n");
		}else{
			adc_set_umbral(u);
			printf("OK,UMBRAL\n");
		}
	}
	else if(!strcmp(linea, "STREAM")){
		stream = arg && atoi(arg) != 0;
		printf("OK,STREAM\n");
	}
	else if(!strcmp(linea, "ECO")){
		eco = arg && atoi(arg) != 0;
		printf("OK,ECO\n");
	}
	else{
		printf("ERR,comando_desconocido\n");
	}
}

/* ------------------------------------------------------------------ */
/* Procesos (tareas FreeRTOS)                                         */
/* ------------------------------------------------------------------ */

/* Comandos: espera lineas por el puerto serie y las ejecuta */
static void tarea_cmd(void *arg)
{
	(void)arg;
	char linea[80];

	while(true){
		print_leer_linea(linea, sizeof(linea), eco);
		hmi_procesar(linea);
	}
}

/* Modo: atiende el boton fisico como toggle.
 * La ISR avisa del flanco de bajada; aqui se confirma que el boton sigue
 * presionado (descarta ruido) y despues se espera a que se suelte de forma
 * estable, para que el rebote al soltarlo no cuente como otro clic. */
static void tarea_modo(void *arg)
{
	(void)arg;
	gen_gpio_strc *btn = &botones[BTN_MODO];

	while(true){
		if(btn->flag_click){
			vTaskDelay(pdMS_TO_TICKS(T_CONFIRMA_MS));
			if(!gpio_leer_bit(btn)){                       // sigue en 0: clic real
				printf("BOTON,clic\n");
				cambiar_modo(-1);

				int suelto_ms = 0;                         // espera a que se suelte
				while(suelto_ms < T_SUELTO_MS){
					vTaskDelay(pdMS_TO_TICKS(10));
					suelto_ms = gpio_leer_bit(btn) ? suelto_ms + 10 : 0;
				}
			}
			btn->flag_click = false;                       // descarta los rebotes
		}
		vTaskDelay(pdMS_TO_TICKS(T_MODO_MS));
	}
}

/* ADC: lee y codifica los potenciometros; en RUN hace la inferencia */
static void tarea_adc(void *arg)
{
	(void)arg;
	while(true){
		xSemaphoreTake(mtx, portMAX_DELAY);

		if(numPots > 0 && adc_read_all(pots, numPots) == ESP_OK){
			patron_actual = adc_patron(pots, numPots);
			if(modo == MODO_RUN && entrenado){
				salida_y = perceptron_inferir(&red, patron_actual);
				gpio_escribir_bit(&leds[LED_SALIDA], salida_y != 0);
			}
		}

		xSemaphoreGive(mtx);
		vTaskDelay(pdMS_TO_TICKS(T_ADC_MS));
	}
}

/* Print: envia periodicamente las lecturas del ADC */
static void tarea_print(void *arg)
{
	(void)arg;
	adc_chan_strc copia[MAX_POTS];

	while(true){
		if(stream){
			xSemaphoreTake(mtx, portMAX_DELAY);
			int n = numPots;
			modo_e m = modo;
			uint32_t patron = patron_actual;
			int y = salida_y;
			memcpy(copia, pots, sizeof(adc_chan_strc) * n);
			xSemaphoreGive(mtx);

			if(n > 0) print_lecturas(copia, n, m, patron, y);
		}
		vTaskDelay(pdMS_TO_TICKS(T_PRINT_MS));
	}
}

/* ------------------------------------------------------------------ */
void app_main(void)
{
	print_init();
	mtx = xSemaphoreCreateMutex();

	leds_default_config(leds);
	botones_default_config(botones);
	gpio_init(leds, NUMLEDS);
	gpio_init(botones, NUMBTNS);

	/* ADC: los 5 canales se configuran una vez; solo se leen los primeros N */
	pots_default_config(pots, MAX_POTS);
	adc_init(pots, MAX_POTS);

	/* Perceptron inicial (N_INICIAL entradas, tabla OR) sin entrenar */
	if(!aplicar_n(N_INICIAL)){
		printf("ERR,sin_memoria\n");
		return;
	}

	printf("\nLISTO,proyecto=perceptron_lms,placa=%s,version=3\n", PLACA);

	/* Pila en bytes. printf (con numeros flotantes en "cmd") usa bastante pila
	 * en el ESP32 (Xtensa); con menos de ~4 KB la tarea se desborda y reinicia. */
	xTaskCreate(tarea_modo,  "modo",  4096, NULL, 3, NULL);
	xTaskCreate(tarea_adc,   "adc",   4096, NULL, 4, NULL);
	xTaskCreate(tarea_print, "print", 4096, NULL, 2, NULL);
	xTaskCreate(tarea_cmd,   "cmd",   6144, NULL, 3, NULL);
}
