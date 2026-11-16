/*
 * BSP.h
 *
 * Board Support Package (ESP32 / ESP32-C3): constantes, tipos y prototipos.
 *
 *  Created on: 13 oct 2026
 *      Author: Elian
 */

#ifndef MAIN_BSP_H_
#define MAIN_BSP_H_

#include <stdbool.h>
#include <stdint.h>
#include "sdkconfig.h"
#include "driver/gpio.h"
#include "esp_err.h"
#include "esp_adc/adc_oneshot.h"

/* ------------------------------------------------------------------ */
/* Pines (segun la placa elegida con "idf.py set-target")             */
/* ------------------------------------------------------------------ */
#if CONFIG_IDF_TARGET_ESP32
/* ESP32 (DevKitC / DevKit V1). Consola por UART0 (GPIO1/GPIO3) a traves
 * del puente USB-UART de la placa.
 * Potenciometros en ADC1 (ADC2 no se puede usar junto con WiFi), todos en
 * un lado de la placa. GPIO34, 35, 36 (VP) y 39 (VN) son solo entrada.
 * LEDs y boton en el otro lado: GPIO21, 19 y 18 son pines juntos de uso
 * general (no son de arranque, ni de flash, ni de la consola). */
#define PLACA            "ESP32"
#define PIN_LED_ESTADO   19      // LED verde: estado del sistema (OFF/RUN)
#define PIN_LED_SALIDA   18      // LED azul : salida y del perceptron
#define PIN_BTN_MODO     21      // Boton a GND (pull-up interno)

#define PIN_POT0         36      // VP  - ADC1_CH0
#define PIN_POT1         39      // VN  - ADC1_CH3
#define PIN_POT2         34      //       ADC1_CH6
#define PIN_POT3         35      //       ADC1_CH7
#define PIN_POT4         32      //       ADC1_CH4

#elif CONFIG_IDF_TARGET_ESP32C3
/* ESP32-C3 Super Mini. GPIO20/21 son la UART0: la consola debe ir por
 * USB Serial/JTAG (menuconfig) para poder usarlos como LEDs.
 * GPIO2 es pin de strapping: mantener el 3er potenciometro arriba al
 * reiniciar la placa. */
#define PLACA            "ESP32-C3"
#define PIN_LED_ESTADO   20
#define PIN_LED_SALIDA   21
#define PIN_BTN_MODO     10

#define PIN_POT0         0       // ADC1_CH0
#define PIN_POT1         1       // ADC1_CH1
#define PIN_POT2         2       // ADC1_CH2
#define PIN_POT3         3       // ADC1_CH3
#define PIN_POT4         4       // ADC1_CH4

#else
#error "Placa no soportada: agrega sus pines en BSP.h"
#endif

#define MIN_POTS         2
#define MAX_POTS         5

/* ------------------------------------------------------------------ */
/* ADC                                                                */
/* ------------------------------------------------------------------ */
#define ADC_ATENUACION   ADC_ATTEN_DB_12     // rango efectivo ~0.15 a 2.5 V
#define ADC_RESOLUCION   ADC_BITWIDTH_12     // 0 a 4095
#define ADC_UMBRAL       2048                // valor inicial; se ajusta en ejecucion con adc_set_umbral() (comando UMBRAL=)
#define ADC_HISTERESIS   100                 // evita oscilacion alrededor del umbral

/* ------------------------------------------------------------------ */
/* Boton                                                              */
/* ------------------------------------------------------------------ */
#define DB_DELAY         200000              // debouncer de 200 ms (en us)

typedef enum{LED_ESTADO, LED_SALIDA, NUMLEDS}leds_e;
typedef enum{BTN_MODO, NUMBTNS}btns_e;
typedef enum{MODO_OFF, MODO_RUN}modo_e;

/* Estructura generica para GPIO (leds y botones) */
typedef struct{

	uint8_t				pin;
	gpio_pull_mode_t 	pull_mode;
	gpio_mode_t 		direction;
	gpio_int_type_t		int_type;
	bool 				state;
	volatile uint32_t	lastEdgeTime;
	volatile bool		flag_click;

}gen_gpio_strc;

/* Estructura para un canal de ADC (un potenciometro) */
typedef struct{

	uint8_t				pin;        // GPIO del potenciometro
	adc_unit_t			unit;       // se llena con adc_oneshot_io_to_channel()
	adc_channel_t		channel;
	adc_atten_t			atten;
	adc_bitwidth_t		bitwidth;
	int					raw;        // ultima lectura (0 a 4095)
	int					mv;         // ultima lectura en milivolts (calibrada)
	bool				bit;        // lectura binarizada (0 o 1)

}adc_chan_strc;

/* ------------------------------------------------------------------ */
/* GPIO.c                                                             */
/* ------------------------------------------------------------------ */
void leds_default_config(gen_gpio_strc *cfg);
void botones_default_config(gen_gpio_strc *cfg);
void gpio_init(gen_gpio_strc *cfg, int n);
bool gpio_leer_bit(const gen_gpio_strc *g);
void gpio_escribir_bit(gen_gpio_strc *g, bool valor);

/* ------------------------------------------------------------------ */
/* ADC.c                                                              */
/* ------------------------------------------------------------------ */
void pots_default_config(adc_chan_strc *cfg, int n);
void adc_init(adc_chan_strc *cfg, int n);
bool adc_calibrado(void);                                   // true si hay calibracion de fabrica
esp_err_t adc_read_all(adc_chan_strc *cfg, int n);          // lee y binariza
uint32_t adc_patron(const adc_chan_strc *cfg, int n);       // bits -> indice del patron
void adc_set_umbral(int umbral);                            // cambia el umbral de binarizacion en ejecucion
int  adc_get_umbral(void);

/* ------------------------------------------------------------------ */
/* PRINT.c (puerto serie: consola y protocolo con la interfaz HTML)  */
/* ------------------------------------------------------------------ */
void print_init(void);
int  print_leer_linea(char *buf, int tam, bool eco);        // espera una linea completa
void print_lecturas(const adc_chan_strc *pots, int n, modo_e modo, uint32_t patron, int y);

#endif /* MAIN_BSP_H_ */
