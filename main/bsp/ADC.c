/*
 * ADC.c
 *
 * Modulo de ADC (ADC1, modo oneshot).
 * Cada potenciometro es un canal; su lectura cruda (0 a 4095) se codifica
 * en 0 o 1 por medio de un umbral con histeresis. Con la calibracion de
 * fabrica (eFuse) tambien se convierte a milivolts.
 */

#include <stddef.h>
#include "BSP.h"
#include "esp_adc/adc_cali.h"
#include "esp_adc/adc_cali_scheme.h"

#define MV_ESCALA_SIN_CAL   3100              // aproximacion si la placa no trae calibracion

static adc_oneshot_unit_handle_t adc1_handle = NULL;
static adc_cali_handle_t cali_handle = NULL;
static volatile int umbral_adc = ADC_UMBRAL;      // modificable en ejecucion

/* Pines definidos en BSP.h segun la placa (todos en ADC1) */
static const uint8_t pines_pot[MAX_POTS] = {
	PIN_POT0, PIN_POT1, PIN_POT2, PIN_POT3, PIN_POT4
};

void pots_default_config(adc_chan_strc *cfg, int n)
{
	for(int i = 0; i < n; i++){
		cfg[i].pin      = pines_pot[i];
		cfg[i].unit     = ADC_UNIT_1;
		cfg[i].channel  = (adc_channel_t)0;       // se resuelve en adc_init()
		cfg[i].atten    = ADC_ATENUACION;
		cfg[i].bitwidth = ADC_RESOLUCION;
		cfg[i].raw      = 0;
		cfg[i].mv       = 0;
		cfg[i].bit      = false;
	}
}

/* Calibracion: curve fitting (ESP32-C3) o line fitting (ESP32) */
static void calibracion_init(void)
{
	esp_err_t err = ESP_ERR_NOT_SUPPORTED;

#if ADC_CALI_SCHEME_CURVE_FITTING_SUPPORTED
	adc_cali_curve_fitting_config_t cal = {
		.unit_id  = ADC_UNIT_1,
		.chan     = ADC_CHANNEL_0,
		.atten    = ADC_ATENUACION,
		.bitwidth = ADC_RESOLUCION,
	};
	err = adc_cali_create_scheme_curve_fitting(&cal, &cali_handle);
#elif ADC_CALI_SCHEME_LINE_FITTING_SUPPORTED
	adc_cali_line_fitting_config_t cal = {
		.unit_id  = ADC_UNIT_1,
		.atten    = ADC_ATENUACION,
		.bitwidth = ADC_RESOLUCION,
#if CONFIG_IDF_TARGET_ESP32
		.default_vref = 1100,                 // si el eFuse no trae Vref
#endif
	};
	err = adc_cali_create_scheme_line_fitting(&cal, &cali_handle);
#endif

	if(err != ESP_OK) cali_handle = NULL;
}

bool adc_calibrado(void){ return cali_handle != NULL; }

void adc_init(adc_chan_strc *cfg, int n)
{
	adc_oneshot_unit_init_cfg_t init_cfg = {
		.unit_id  = ADC_UNIT_1,
		.ulp_mode = ADC_ULP_MODE_DISABLE,
	};
	ESP_ERROR_CHECK(adc_oneshot_new_unit(&init_cfg, &adc1_handle));

	for(int i = 0; i < n; i++){
		adc_unit_t unit;
		ESP_ERROR_CHECK(adc_oneshot_io_to_channel(cfg[i].pin, &unit, &cfg[i].channel));
		cfg[i].unit = unit;

		adc_oneshot_chan_cfg_t ch_cfg = {
			.atten    = cfg[i].atten,
			.bitwidth = cfg[i].bitwidth,
		};
		ESP_ERROR_CHECK(adc_oneshot_config_channel(adc1_handle, cfg[i].channel, &ch_cfg));
	}
	calibracion_init();
}

/* Codifica en 0/1 con histeresis: para pasar a 1 hay que superar
 * (umbral + histeresis); para volver a 0, bajar de (umbral - histeresis). */
static bool binarizar(int raw, bool anterior)
{
	int u = umbral_adc;
	if(anterior) return raw > (u - ADC_HISTERESIS);
	else         return raw >= (u + ADC_HISTERESIS);
}

void adc_set_umbral(int umbral){ umbral_adc = umbral; }
int  adc_get_umbral(void){ return umbral_adc; }

esp_err_t adc_read_all(adc_chan_strc *cfg, int n)
{
	for(int i = 0; i < n; i++){
		int raw = 0;
		esp_err_t err = adc_oneshot_read(adc1_handle, cfg[i].channel, &raw);
		if(err != ESP_OK) return err;

		cfg[i].raw = raw;
		if(cali_handle == NULL || adc_cali_raw_to_voltage(cali_handle, raw, &cfg[i].mv) != ESP_OK){
			cfg[i].mv = raw * MV_ESCALA_SIN_CAL / 4095;
		}
		cfg[i].bit = binarizar(raw, cfg[i].bit);
	}
	return ESP_OK;
}

/* x0 es el bit menos significativo (mismo orden que la tabla de verdad) */
uint32_t adc_patron(const adc_chan_strc *cfg, int n)
{
	uint32_t patron = 0;
	for(int i = 0; i < n; i++){
		if(cfg[i].bit) patron |= (1u << i);
	}
	return patron;
}
