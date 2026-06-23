# Matching Transcriptor · Trompeta Sib

Web estática para capturar ideas melódicas de trompeta en Sib:

- afinador en tiempo real
- grabación con pausa/reanudar
- tap tempo
- entrada de un compás opcional
- división aproximada por compases
- transcripción redondeada por sensibilidad de afinación y ritmo
- consola técnica oculta para copiar datos de sesión y ajustar parámetros
- exportación de audio y JSON técnico

## Uso rápido

1. Sube estos archivos a un repositorio de GitHub:
   - `index.html`
   - `style.css`
   - `app.js`
   - `README.md`
2. Activa GitHub Pages:
   - Settings → Pages → Deploy from branch → `main` → `/root`
3. Abre la web publicada en HTTPS.
4. Da permiso al micrófono.

> El micrófono del navegador necesita HTTPS o `localhost`. En GitHub Pages funciona.

## Controles

- `Grabar`: inicia entrada, micrófono y análisis.
- `Pausa`: pausa el tiempo musical y la grabación.
- `Stop`: analiza y genera transcripción.
- `Tap tempo`: calcula BPM aproximado.
- `Consola técnica`: abre datos de depuración.
- `Ctrl+D`: abre/cierra consola técnica.
- `Espacio`: grabar o pausar, salvo cuando estás editando texto.

## Modo trompeta en Sib

La app escucha tono real y muestra nota escrita transpuesta.

Ejemplo:

- suena `Bb3`
- muestra `C4` escrito

## Cómo pasar feedback a ChatGPT

Después de grabar:

1. Abre `Consola técnica`.
2. Pulsa `Copiar informe para ChatGPT`.
3. Pega el JSON en el chat junto con una frase tipo:

```txt
En esta sesión me puso demasiadas corcheas. Yo quería que lo redondeara a negras.
```

Con ese informe se pueden ajustar:

- sensibilidad de afinación
- duración mínima de nota
- detección de silencios
- cuantización rítmica
- modo estricto/humano/suelto

## Limitaciones actuales

Esta versión es un MVP. No intenta ser Sibelius ni Dorico. Sirve para capturar una idea monofónica y limpiarla.

No detecta todavía:

- tresillos complejos
- ligaduras reales
- articulaciones
- dinámicas
- tonalidad inteligente para decidir enharmonías complejas
- exportación MIDI/MusicXML

Eso se puede añadir después.
