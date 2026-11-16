# Componente principal. Cada carpeta es una capa del sistema embebido:
#   .            main / RTOS (tareas FreeRTOS y comandos de la HMI)
#   perceptron/  capa Perceptron (sin hardware; se puede probar en PC)
#   bsp/         Board Support Package (BSP.h, ADC.c, GPIO.c, PRINT.c)
idf_component_register(
    SRCS
        "main.c"
        "perceptron/perceptron.c"
        "perceptron/lms.c"
        "perceptron/patterns.c"
        "bsp/ADC.c"
        "bsp/GPIO.c"
        "bsp/PRINT.c"
    INCLUDE_DIRS "." "bsp" "perceptron"
    REQUIRES driver esp_adc esp_timer esp_driver_uart esp_driver_usb_serial_jtag
)
