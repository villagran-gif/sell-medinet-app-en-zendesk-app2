# Medinet Uploader (Zendesk Sell App - ZAF v2)

Esta app privada de Zendesk Sell se muestra en el **sidebar del Deal** (`sell.deal_card`) y permite enviar los datos del Deal + Contact a un backend Medinet.

## 1) ¿Qué es y qué hace la app?

En la ficha de un Deal, la app muestra:

- Título **Medinet**
- Botón **Subir a Medinet**
- Estado textual del proceso
- Sección **Debug** colapsable (payload, bloqueos y respuesta/error)

Al hacer clic en **Subir a Medinet**:

1. Obtiene Deal actual.
2. Obtiene Contact asociado.
3. Aplica validaciones y reglas definidas.
4. Si todo está correcto, hace `POST` a `${backend_base_url}/medinet/import`.
5. Muestra resultado `ok/error` y abre `download_url` en nueva pestaña si existe.

## 2) Configuración de `backend_base_url` / `backend_api_key`

Durante la instalación de la app privada en Sell, configura estos parámetros:

- `backend_base_url` (**required**): URL base de tu backend. Ejemplo: `https://mi-backend.cl`
- `backend_api_key` (**required**, secure): API key enviada en header `X-API-Key`
- `backend_timeout_ms` (opcional, default `20000`): timeout para la llamada al backend

## 3) Cómo generar el ZIP

Desde la raíz del repo, el ZIP debe contener:

- `manifest.json`
- carpeta `assets/` completa

Ejemplo:

```bash
zip -r sell-medinet-app.zip manifest.json assets
```

> Importante: no anidar dentro de otra carpeta al comprimir (el `manifest.json` debe quedar en la raíz del ZIP).

## 4) Dónde instalar en Zendesk Sell

1. Ir a **Settings**.
2. Abrir **Apps**.
3. Entrar a **Private Apps**.
4. Elegir **Upload / Install**.
5. Subir el ZIP generado.
6. Completar parámetros (`backend_base_url`, `backend_api_key`, etc.).

## 5) Cómo probar con un Deal

### Caso A: Contact sin RUN/RUT

- Dejar vacío custom field `2540090`.
- Resultado esperado: estado **“Sin RUN/RUT: carga manual en Medinet”**.
- No se llama backend.

### Caso B: Contact con RUN/RUT pero faltan campos

- Completar `2540090` pero dejar vacío alguno obligatorio.
- Resultado esperado: **“No se puede subir a Medinet. Faltan: ...”**.
- No se llama backend.

### Caso C: Todo OK

- Completar campos obligatorios de contacto y deal.
- Resultado esperado:
  - Llamada `POST /medinet/import`
  - Estado de éxito con `message` del backend o `Listo ✅`
  - Si viene `download_url`, se abre en nueva pestaña

---

## Archivos de la app

- `manifest.json`
- `assets/iframe.html`
- `assets/style.css`
- `assets/app.js`
- `translations/es.json`

Listo para empaquetar e instalar como Private App de Zendesk Sell.
