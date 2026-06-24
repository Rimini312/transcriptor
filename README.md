# Transcriptor v0.3.5

App web estática para trompeta en Sib: afinador, pulso visual, grabación, transcripción aproximada y exportación.

## Cambios v0.3.5

- Versión visible en la web y en JSON: `transcriptor-v0.3.5`.
- Cuenta atrás visual antes de grabar: `4 · 3 · 2 · 1 · REC`.
- El audio empieza a grabarse después de la cuenta atrás.
- Botón nuevo: **Prueba Do mayor ♩**.
  - Fuerza cuantización a negras.
  - Activa modo boceto.
  - Bloquea la lectura a notas de Do mayor para evitar cromatismos falsos durante la prueba.
  - El informe técnico incluye `scaleTest` con patrón esperado/detectado.
- Exportación reforzada:
  - Botones de descarga.
  - Enlaces visibles bajo la partitura para móviles/navegadores que bloquean descargas automáticas.
  - TXT, ABC, MusicXML, SVG, PNG A4, JPG A4, CSV, JSON técnico y audio si el navegador lo permite.
- Recorte de silencios iniciales/finales cortos en modos melódicos para evitar compases de espera absurdos al principio.

## Uso recomendado para test

1. BPM: 60.
2. Pulsa **Prueba Do mayor ♩**.
3. Espera la cuenta atrás `4 · 3 · 2 · 1 · REC`.
4. Toca escrito en trompeta Sib: Do Re Mi Fa Sol La Si Do, todo en negras, varias veces.
5. Copia la consola técnica y pásamela.

## GitHub Pages

Sube o sustituye estos archivos en el repositorio:

- `index.html`
- `style.css`
- `app.js`
- `README.md`



## v0.3.5

- Modo Calibrar Do mayor sin bloqueo tonal: compara el patrón esperado, pero no corrige notas.
- Nueva simplificación adaptativa para reducir silencios microscópicos y cromatismos de ataque.
- La cuenta atrás se fuerza antes de grabar para alinear el inicio al pulso 1.
