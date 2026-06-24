# Transcriptor v0.3.2

Web estática para GitHub Pages: afinador permanente, grabación con pausa y transcripción aproximada para trompeta en Sib.

## Cambios v0.3.2

- Pulso visual colocado junto al afinador: cuadrados grises con el tiempo activo en negro.
- Versión visible en la web y en el JSON técnico.
- Pentagrama rehecho usando `abcjs` en vez del dibujo SVG manual anterior.
- Exportación nueva en `.abc` además de TXT, CSV, MusicXML, JSON y audio.
- La caja editable muestra la notación ABC que genera la partitura.
- Las duraciones se exportan como unidades reales: semicorchea, corchea, negra, blanca, redonda y puntillos cuando proceda.
- Los bemoles/sostenidos se escriben como accidentales ABC (`_` para bemol, `^` para sostenido) y se renderizan en pentagrama.

## Uso

Sube estos archivos a GitHub Pages:

- `index.html`
- `style.css`
- `app.js`
- `README.md`

URL esperada:

`https://rimini312.github.io/transcriptor/`

## Nota técnica

La partitura usa abcjs desde CDN:

`https://cdn.jsdelivr.net/npm/abcjs@6.6.0/dist/abcjs-basic-min.js`

Si no carga internet/CDN, la app mostrará el texto ABC como fallback.
