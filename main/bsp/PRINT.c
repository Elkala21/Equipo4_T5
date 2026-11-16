/*
 * PRINT.c
 *
 * Modulo de puerto serie: lectura de lineas de comando e impresion de las
 * lecturas del ADC. Lo usan tanto la interfaz HTML como una consola manual.
 *
 * Se instala el driver de la consola (UART0 en el ESP32, USB Serial/JTAG en
 * el ESP32-C3) para que getchar() espere a que lleguen datos en vez de
 * regresar EOF.
 */

#include <stdio.h>
#include "BSP.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#if CONFIG_ESP_CONSOLE_USB_SERIAL_JTAG
#include "driver/usb_serial_jtag.h"
#include "driver/usb_serial_jtag_vfs.h"
#else
#include "driver/uart.h"
#include "driver/uart_vfs.h"
#endif

#define RX_BUF_TAM    256

void print_init(void)
{
#if CONFIG_ESP_CONSOLE_USB_SERIAL_JTAG
	usb_serial_jtag_driver_config_t usb_cfg = USB_SERIAL_JTAG_DRIVER_CONFIG_DEFAULT();
	usb_cfg.rx_buffer_size = RX_BUF_TAM;
	ESP_ERROR_CHECK(usb_serial_jtag_driver_install(&usb_cfg));
	usb_serial_jtag_vfs_use_driver();
#else
	ESP_ERROR_CHECK(uart_driver_install(CONFIG_ESP_CONSOLE_UART_NUM, RX_BUF_TAM, 0, 0, NULL, 0));
	uart_vfs_dev_use_driver(CONFIG_ESP_CONSOLE_UART_NUM);
#endif

	setvbuf(stdin,  NULL, _IONBF, 0);     // cada caracter llega en cuanto se recibe
	setvbuf(stdout, NULL, _IONBF, 0);     // salida sin buffer
}

/* Lee una linea completa (bloquea hasta recibirla). Regresa el numero de caracteres. */
int print_leer_linea(char *buf, int tam, bool eco)
{
	int i = 0;

	while(true){
		int c = getchar();

		if(c == EOF){
			clearerr(stdin);
			vTaskDelay(pdMS_TO_TICKS(10));
			continue;
		}
		if(c == '\r' || c == '\n'){
			if(i == 0) continue;          // ignora lineas vacias y el \n de un \r\n
			if(eco) putchar('\n');
			break;
		}
		if(i < tam - 1){
			buf[i++] = (char)c;
			if(eco) putchar(c);
		}
	}
	buf[i] = '\0';
	return i;
}

/* Una linea por lectura (P = valor crudo, V = milivolts):
 *   LECT,RUN,n=3,P0=1234,V0=1012,P1=3300,V1=2480,P2=100,V2=160,patron=2,y=0
 * Se arma completa y se envia con un solo printf para que no se mezcle con
 * los mensajes de otras tareas. */
void print_lecturas(const adc_chan_strc *pots, int n, modo_e modo, uint32_t patron, int y)
{
	char linea[160];
	int len = snprintf(linea, sizeof(linea), "LECT,%s,n=%d", modo == MODO_RUN ? "RUN" : "OFF", n);

	for(int i = 0; i < n && len < (int)sizeof(linea); i++){
		len += snprintf(linea + len, sizeof(linea) - len, ",P%d=%d,V%d=%d", i, pots[i].raw, i, pots[i].mv);
	}
	if(len < (int)sizeof(linea)){
		snprintf(linea + len, sizeof(linea) - len, ",patron=%u,y=%d", (unsigned)patron, y);
	}
	printf("%s\n", linea);
}
