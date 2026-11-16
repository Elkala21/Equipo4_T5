/*
 * GPIO.c
 *
 * Modulo de GPIO: inicializacion, lectura y escritura de un bit.
 * El boton usa interrupcion por flanco de bajada con debounce por tiempo.
 */

#include "BSP.h"
#include "esp_timer.h"

static bool isr_service_instalado = false;

/* ISR del boton: acepta un flanco solo si pasaron DB_DELAY us desde el
 * ultimo aceptado (ignora los rebotes). */
static void IRAM_ATTR isr_boton(void *arg)
{
	gen_gpio_strc *b = (gen_gpio_strc *)arg;
	uint32_t ahora = (uint32_t)esp_timer_get_time();

	if((uint32_t)(ahora - b->lastEdgeTime) > DB_DELAY){
		b->lastEdgeTime = ahora;
		b->flag_click = true;
	}
}

void leds_default_config(gen_gpio_strc *cfg)
{
	const uint8_t pines[NUMLEDS] = {PIN_LED_ESTADO, PIN_LED_SALIDA};

	for(int i = 0; i < NUMLEDS; i++){
		cfg[i].pin          = pines[i];
		cfg[i].pull_mode    = GPIO_FLOATING;
		cfg[i].direction    = GPIO_MODE_OUTPUT;
		cfg[i].int_type     = GPIO_INTR_DISABLE;
		cfg[i].state        = false;
		cfg[i].lastEdgeTime = 0;
		cfg[i].flag_click   = false;
	}
}

void botones_default_config(gen_gpio_strc *cfg)
{
	const uint8_t pines[NUMBTNS] = {PIN_BTN_MODO};

	for(int i = 0; i < NUMBTNS; i++){
		cfg[i].pin          = pines[i];
		cfg[i].pull_mode    = GPIO_PULLUP_ONLY;      // boton a GND
		cfg[i].direction    = GPIO_MODE_INPUT;
		cfg[i].int_type     = GPIO_INTR_NEGEDGE;     // se activa al presionar
		cfg[i].state        = false;
		cfg[i].lastEdgeTime = 0;
		cfg[i].flag_click   = false;
	}
}

void gpio_init(gen_gpio_strc *cfg, int n)
{
	for(int i = 0; i < n; i++){
		bool pu = (cfg[i].pull_mode == GPIO_PULLUP_ONLY) ||
				  (cfg[i].pull_mode == GPIO_PULLUP_PULLDOWN);
		bool pd = (cfg[i].pull_mode == GPIO_PULLDOWN_ONLY) ||
				  (cfg[i].pull_mode == GPIO_PULLUP_PULLDOWN);

		gpio_config_t io = {
			.pin_bit_mask = 1ULL << cfg[i].pin,
			.mode         = cfg[i].direction,
			.pull_up_en   = pu ? GPIO_PULLUP_ENABLE   : GPIO_PULLUP_DISABLE,
			.pull_down_en = pd ? GPIO_PULLDOWN_ENABLE : GPIO_PULLDOWN_DISABLE,
			.intr_type    = cfg[i].int_type,
		};
		ESP_ERROR_CHECK(gpio_config(&io));

		if(cfg[i].direction == GPIO_MODE_OUTPUT){
			gpio_set_level(cfg[i].pin, 0);           // LEDs apagados al inicio
		}

		if(cfg[i].int_type != GPIO_INTR_DISABLE){
			if(!isr_service_instalado){
				ESP_ERROR_CHECK(gpio_install_isr_service(0));
				isr_service_instalado = true;
			}
			ESP_ERROR_CHECK(gpio_isr_handler_add(cfg[i].pin, isr_boton, &cfg[i]));
		}
	}
}

bool gpio_leer_bit(const gen_gpio_strc *g)
{
	return gpio_get_level(g->pin) != 0;
}

void gpio_escribir_bit(gen_gpio_strc *g, bool valor)
{
	gpio_set_level(g->pin, valor ? 1 : 0);
	g->state = valor;
}
