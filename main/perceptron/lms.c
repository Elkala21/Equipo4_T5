/*
 * lms.c
 *
 * Entrenamiento del perceptron con la regla LMS (Widrow-Hoff):
 *
 *   e   = d - a                error con la salida lineal (no con la umbralizada)
 *   w  <- w + eta * e * x      ajuste de pesos
 *   b  <- b + eta * e          ajuste del sesgo
 *
 * LMS se actualiza con todos los patrones en cada epoca y se detiene cuando
 * el error cuadratico medio (MSE) deja de cambiar. El umbral theta se calibra
 * al final entre la menor salida con d=1 y la mayor salida con d=0.
 */

#include <math.h>
#include "perceptron.h"

/* Una epoca: se presentan los 2^n patrones y se ajustan pesos y sesgo */
bool perceptron_epoca(perceptron_t *p)
{
	float mse = 0.0f;

	for(int i = 0; i < p->patrones; i++){
		const float *x = &p->X[i * p->n];
		float e = (float)p->d[i] - perceptron_salida_lineal(p, x);

		for(int j = 0; j < p->n; j++){
			p->w[j] += p->eta * e * x[j];
		}
		p->b += p->eta * e;
		mse += e * e;
	}
	mse /= (float)p->patrones;

	bool convergio = fabsf(p->mse_prev - mse) < PER_TOL_DEFAULT;
	p->mse_prev = mse;
	p->mse = mse;
	p->epocas++;
	return convergio;
}

void perceptron_calibrar_umbral(perceptron_t *p)
{
	float min1 = 1e9f, max0 = -1e9f;

	for(int i = 0; i < p->patrones; i++){
		float a = perceptron_salida_lineal(p, &p->X[i * p->n]);
		if(p->d[i] == 1 && a < min1) min1 = a;
		if(p->d[i] == 0 && a > max0) max0 = a;
	}

	if(min1 < 1e9f && max0 > -1e9f && min1 > max0) p->theta = (min1 + max0) / 2.0f;
	else                                          p->theta = 0.5f;   // no separable o salida constante
}

int perceptron_entrenar(perceptron_t *p, int max_epocas)
{
	p->epocas = 0;
	p->mse_prev = 1e9f;

	while(p->epocas < max_epocas){
		if(perceptron_epoca(p)) break;
	}
	perceptron_calibrar_umbral(p);
	p->entrenado = true;
	return p->epocas;
}
