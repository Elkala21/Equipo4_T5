/*
 * perceptron.h
 *
 * Capa Perceptron: perceptron simple entrenado con LMS (Widrow-Hoff).
 *   perceptron.c  estructura (memoria dinamica) e inferencia
 *   lms.c         entrenamiento LMS
 *   patterns.c    tablas de verdad
 * Sin dependencias de hardware (se puede probar en PC).
 *
 * Convencion: el patron i de la tabla de verdad tiene x_j = bit j de i,
 * es decir, x0 es el bit menos significativo.
 */

#ifndef MAIN_PERCEPTRON_H_
#define MAIN_PERCEPTRON_H_

#include <stdbool.h>
#include <stdint.h>

#define PER_ETA_DEFAULT      0.1f      // coeficiente de aprendizaje
#define PER_TOL_DEFAULT      1e-6f     // cambio minimo del MSE entre epocas
#define PER_MAX_EPOCAS       2000

typedef enum{TABLA_OR = 1, TABLA_AND, TABLA_PERSONALIZADA}tabla_e;

typedef struct{

	int			n;           // numero de entradas (potenciometros)
	int			patrones;    // 2^n
	float		*w;          // n pesos
	float		b;           // sesgo (peso n+1)
	float		theta;       // umbral de decision sobre la salida lineal
	float		eta;         // coeficiente de aprendizaje
	float		*X;          // patrones x n  (arreglo plano)
	uint8_t		*d;          // salida deseada de cada patron
	uint8_t		*y;          // salida del perceptron de cada patron
	float		mse;         // error cuadratico medio de la ultima epoca
	float		mse_prev;
	int			epocas;      // epocas ejecutadas
	bool		entrenado;

}perceptron_t;

bool  perceptron_crear(perceptron_t *p, int n);                   // memoria dinamica
void  perceptron_liberar(perceptron_t *p);
void  perceptron_reiniciar(perceptron_t *p);                      // pesos en 0 para volver a entrenar

void  perceptron_tabla_preset(perceptron_t *p, tabla_e tipo);     // OR o AND
bool  perceptron_tabla_texto(perceptron_t *p, const char *bits);  // "0111", ...

bool  perceptron_epoca(perceptron_t *p);                          // una epoca de LMS; true si convergio
int   perceptron_entrenar(perceptron_t *p, int max_epocas);       // entrena hasta converger
void  perceptron_calibrar_umbral(perceptron_t *p);

float perceptron_salida_lineal(const perceptron_t *p, const float *x);
uint8_t perceptron_inferir(const perceptron_t *p, uint32_t patron);
int   perceptron_evaluar(perceptron_t *p);                        // llena y[] y regresa aciertos

#endif /* MAIN_PERCEPTRON_H_ */
