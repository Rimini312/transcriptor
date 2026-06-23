# Transcriptor v0.3.1

App web estática para afinar, grabar y transcribir bocetos melódicos de trompeta en Sib.

## Cambios v0.3.1

- Versión visible en la cabecera de la web: `Transcriptor v0.3.1`.
- El informe técnico exporta `app: transcriptor-v0.3.1`.
- Pulso visual visible y activo según BPM/compás, incluso antes de grabar.
- Entrada de micro revisada: fallback `audio:true` si el navegador falla con restricciones avanzadas.
- Afinador más sensible: se reduce la puerta de ruido que podía dejar la app aparentemente sorda.
- Barra de entrada con `rms`, pico y claridad para depurar si realmente entra señal.
- La grabación de transcripción funciona aunque `MediaRecorder` no esté disponible; en ese caso no exporta audio, pero sí texto/JSON/MusicXML.

## Uso

1. Sube `index.html`, `style.css`, `app.js` y `README.md` al repositorio.
2. Activa GitHub Pages.
3. Abre la web en HTTPS.
4. Pulsa **Activar afinador** y acepta el micrófono.
5. Pulsa **Grabar** para capturar la sesión.

URL esperada si el repo es `transcriptor`:

```txt
https://rimini312.github.io/transcriptor/
```
