/*
 * header.h
 *
 *  Created on: 13 oct 2026
 *      Author: Elian
 */

#ifndef MAIN_HEADER_H_
#define MAIN_HEADER_H_

#include "driver/gpio.h"
#include "esp_err.h"
#include <stdbool.h>
#include <stdint.h>

/*#define PIN_LED_R 25
#define PIN_LED_G 26
#define PIN_LED_B 27

#define PIN_BTN_R 17
#define PIN_BTN_G 18
#define PIN_BTN_B 19*/

#define DB_DELAY 200000 // debouncer de 200ms

typedef enum{LEDR, LEDG, LEDB, NUMLEDS}leds_e;
typedef enum{BTNR, BTNG, BTNB, NUMBTNS}btns_e;

typedef struct{
	
	uint8_t				pin;
	gpio_pull_mode_t 	pull_mode;
	gpio_mode_t 		direction;
	gpio_int_type_t		int_type;
	bool 				state;
	volatile uint32_t	lastEdgeTime;
	volatile bool		flag_click;	
	
}gen_gpio_strc; 

//prototipos de las funciones
void leds_default_config(gen_gpio_strc *cfg);
void botones_default_config(gen_gpio_strc *cfg);
void gpio_init(gen_gpio_strc *cfg, int n);
void process (gen_gpio_strc *botones, gen_gpio_strc *leds);

#endif /* MAIN_HEADER_H_ */
