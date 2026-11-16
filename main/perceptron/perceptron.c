/*
 * perceptron.c
 *
 * Estructura del perceptron simple (memoria dinamica) e inferencia.
 *
 *   a = w . x + b            salida lineal (potencial de activacion)
 *   y = 1 si a >= theta, y = 0 en otro caso
 *
 * El entrenamiento LMS esta en lms.c y las tablas de verdad en patterns.c.
 */

#include <stdlib.h>
#include <string.h>
#include "perceptron.h"

bool perceptron_crear(perceptron_t *p, int n)
{
	memset(p, 0, sizeof(*p));

	p->n        = n;
	p->patrones = 1 << n;
	p->eta      = PER_ETA_DEFAULT;
	p->theta    = 0.5f;

	p->w = calloc(n, sizeof(float));                          // n pesos en 0
	p->X = malloc((size_t)p->patrones * n * sizeof(float));
	p->d = calloc(p->patrones, sizeof(uint8_t));
	p->y = calloc(p->patrones, sizeof(uint8_t));

	if(!p->w || !p->X || !p->d || !p->y){
		perceptron_liberar(p);
		return false;
	}

	/* Entradas binarias: x_j = bit j del patron i */
	for(int i = 0; i < p->patrones; i++){
		for(int j = 0; j < n; j++){
			p->X[i * n + j] = (float)((i >> j) & 1);
		}
	}
	p->mse_prev = 1e9f;
	return true;
}

void perceptron_liberar(perceptron_t *p)
{
	free(p->w);
	free(p->X);
	free(p->d);
	free(p->y);
	memset(p, 0, sizeof(*p));
}

/* Deja los pesos en cero y borra las estadisticas; conserva la tabla de verdad */
void perceptron_reiniciar(perceptron_t *p)
{
	for(int j = 0; j < p->n; j++) p->w[j] = 0.0f;
	p->b         = 0.0f;
	p->theta     = 0.5f;
	p->mse       = 0.0f;
	p->mse_prev  = 1e9f;
	p->epocas    = 0;
	p->entrenado = false;
	memset(p->y, 0, (size_t)p->patrones);
}

float perceptron_salida_lineal(const perceptron_t *p, const float *x)
{
	float a = p->b;
	for(int j = 0; j < p->n; j++){
		a += x[j] * p->w[j];                                  // producto punto
	}
	return a;
}

/* Inferencia a partir del patron leido (bit j = entrada x_j) */
uint8_t perceptron_inferir(const perceptron_t *p, uint32_t patron)
{
	float x[32];
	for(int j = 0; j < p->n; j++){
		x[j] = (float)((patron >> j) & 1u);
	}
	return perceptron_salida_lineal(p, x) >= p->theta ? 1 : 0;
}

int perceptron_evaluar(perceptron_t *p)
{
	int aciertos = 0;
	for(int i = 0; i < p->patrones; i++){
		p->y[i] = perceptron_inferir(p, (uint32_t)i);
		if(p->y[i] == p->d[i]) aciertos++;
	}
	return aciertos;
}
