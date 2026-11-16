/*
 * patterns.c
 *
 * Tablas de verdad (salida deseada d de cada patron).
 * El patron i tiene x_j = bit j de i, es decir, x0 es el bit menos significativo.
 */

#include <string.h>
#include "perceptron.h"

void perceptron_tabla_preset(perceptron_t *p, tabla_e tipo)
{
	for(int i = 0; i < p->patrones; i++){
		uint8_t v = (uint8_t)p->X[i * p->n];
		for(int j = 1; j < p->n; j++){
			uint8_t x = (uint8_t)p->X[i * p->n + j];
			v = (tipo == TABLA_OR) ? (v | x) : (v & x);
		}
		p->d[i] = v;
	}
}

/* bits: cadena de 2^n caracteres '0'/'1'; el caracter i es la salida del patron i */
bool perceptron_tabla_texto(perceptron_t *p, const char *bits)
{
	if((int)strlen(bits) != p->patrones) return false;

	for(int i = 0; i < p->patrones; i++){
		if(bits[i] != '0' && bits[i] != '1') return false;
	}
	for(int i = 0; i < p->patrones; i++){
		p->d[i] = (uint8_t)(bits[i] - '0');
	}
	return true;
}
