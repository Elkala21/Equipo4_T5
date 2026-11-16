/*
 * test_perceptron.c  -  prueba en PC del modulo perceptron (sin ESP32).
 *
 * Compilar:  gcc -Wall -Wextra -I../main/perceptron test_perceptron.c ../main/perceptron/*.c -o test_perceptron -lm
 * Ejecutar:  ./test_perceptron
 */
#include <stdio.h>
#include <string.h>
#include "perceptron.h"

static void probar(const char *nombre, int n, tabla_e tipo, const char *tabla)
{
	perceptron_t p;
	if(!perceptron_crear(&p, n)){ printf("sin memoria\n"); return; }

	if(tipo == TABLA_PERSONALIZADA) perceptron_tabla_texto(&p, tabla);
	else                            perceptron_tabla_preset(&p, tipo);

	int ep = perceptron_entrenar(&p, PER_MAX_EPOCAS);
	int ac = perceptron_evaluar(&p);

	printf("%-6s N=%d  epocas=%4d  MSE=%.4f  umbral=%.3f  aciertos=%2d/%2d (%.1f%%)\n",
		   nombre, n, ep, p.mse, p.theta, ac, p.patrones, 100.0 * ac / p.patrones);

	perceptron_liberar(&p);
}

int main(void)
{
	for(int n = 2; n <= 5; n++) probar("AND", n, TABLA_AND, NULL);
	for(int n = 2; n <= 5; n++) probar("OR",  n, TABLA_OR,  NULL);
	probar("XOR", 2, TABLA_PERSONALIZADA, "0110");         // no linealmente separable
	probar("PERS", 3, TABLA_PERSONALIZADA, "00010111");    // mayoria de 3 entradas
	return 0;
}
