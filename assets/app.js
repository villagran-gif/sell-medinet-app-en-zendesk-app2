(function () {
  const client = ZAFClient.init();

  const FIELD_IDS = {
    rut: 2540090,
    birthDate: 2618055,
    emailPrimary: 2533760,
    emailSecondary: 2567316,
    direccion: 2567323,
    comuna: 2547816,
    telA: 2528872,
    telB: 2567315,
    telC: 2577564,
    tramoModalidad: 2758483,
  };

  // Aliases por NOMBRE (porque /v2 devuelve custom_fields por nombre, no por ID)
  const FIELD_KEYS = {
    rut: [FIELD_IDS.rut, "RUT o ID", "RUT O ID"],
    birthDate: [FIELD_IDS.birthDate, "Fecha Nacimiento", "Fecha de nacimiento"],
    emailPrimary: [FIELD_IDS.emailPrimary, "Correo electrónico", "Correo"],
    emailSecondary: [FIELD_IDS.emailSecondary, "correo electrónico", "Correo"],
    direccion: [FIELD_IDS.direccion, "Dirección", "Direccion"],
    comuna: [FIELD_IDS.comuna, "Comuna", "Ciudad"],
    telA: [FIELD_IDS.telA, "Teléfono", "Telefono"],
    telB: [FIELD_IDS.telB, "Numero de teléfono", "Número de teléfono", "Telefono"],
    telC: [FIELD_IDS.telC, "Telefono", "Teléfono"],
    tramoModalidad: [FIELD_IDS.tramoModalidad, "Tramo/Modalidad"],
  };

  const statusEl = document.getElementById("status");
  const debugEl = document.getElementById("debug");
  const btnUpload = document.getElementById("btnUpload");

  if (btnUpload) btnUpload.addEventListener("click", onUploadClick);

  function setStatus(message) {
    if (statusEl) statusEl.textContent = message;
  }

  function setDebug(content) {
    if (!debugEl) return;
    debugEl.textContent =
      typeof content === "string" ? content : JSON.stringify(content, null, 2);
  }

  function isObject(x) {
    return x && typeof x === "object" && !Array.isArray(x);
  }

  function toStringValue(val) {
    if (val === null || val === undefined) return "";
    if (isObject(val)) {
      const line1 = val.line1 || val.street || "";
      const city = val.city || "";
      const state = val.state || "";
      const postal = val.postal_code || val.postalCode || "";
      const parts = [line1, city, state, postal]
        .map((s) => String(s || "").trim())
        .filter(Boolean);
      return parts.join(", ");
    }
    return String(val).trim();
  }

  // Busca por ID o por nombre (alias)
  function getField(entity, keys) {
    if (!entity) return "";
    const keyList = (Array.isArray(keys) ? keys : [keys]).filter(
      (k) => k !== undefined && k !== null
    );

    const candidateMaps = [
      entity.custom_fields,
      entity.customFields,
      entity.custom_field_values,
      entity.customFieldValues,
    ];

    for (const key of keyList) {
      const keyStr = String(key);

      for (const map of candidateMaps) {
        if (map && isObject(map)) {
          if (Object.prototype.hasOwnProperty.call(map, keyStr)) return map[keyStr];
          if (Object.prototype.hasOwnProperty.call(map, key)) return map[key];
        }
      }
    }

    // Fallback: si viniera como array
    if (Array.isArray(entity.custom_fields)) {
      for (const key of keyList) {
        const id = String(key);
        const hit = entity.custom_fields.find(
          (x) => String(x.id) === id || String(x.custom_field_id) === id
        );
        if (hit) return hit.value;
      }
    }

    return "";
  }

  async function getSettings() {
    const metadata = await client.metadata().catch(() => ({}));
    let settings =
      (metadata && metadata.settings) ||
      (metadata && metadata.installationSettings) ||
      (metadata && metadata.config) ||
      {};

    const got = await client.get("settings").catch(() => ({}));
    if (got && Object.keys(got).length) {
      const fromGet = got.settings && Object.keys(got.settings).length ? got.settings : got;
      settings = Object.assign({}, settings, fromGet);
    }

    const baseUrl =
      settings.backend_base_url ||
      settings.backendBaseUrl ||
      settings.base_url ||
      settings.baseUrl ||
      "";

    const timeout =
      settings.backend_timeout_ms ||
      settings.backendTimeoutMs ||
      settings.timeout_ms ||
      settings.timeoutMs ||
      20000;

    return {
      backend_base_url: String(baseUrl || "").trim().replace(/\/$/, ""),
      backend_timeout_ms: Number(timeout || 20000),
    };
  }

  async function getDealContext() {
    const sources = [];
    const tryPush = (value) => {
      const n = Number(value);
      if (Number.isFinite(n) && n > 0) sources.push(n);
    };

    const fromGet = await client
      .get([
        "deal.id",
        "deal",
        "currentDeal.id",
        "currentDeal",
        "dealId",
        "context.dealId",
      ])
      .catch(() => ({}));

    tryPush(fromGet["deal.id"]);
    tryPush(fromGet["currentDeal.id"]);
    tryPush(fromGet.dealId);
    tryPush(fromGet["context.dealId"]);
    if (fromGet.deal && fromGet.deal.id) tryPush(fromGet.deal.id);
    if (fromGet.currentDeal && fromGet.currentDeal.id) tryPush(fromGet.currentDeal.id);

    const ctx = await client.context().catch(() => ({}));
    tryPush(ctx.dealId);
    tryPush(ctx.entityId);
    tryPush(ctx.resource_id);

    const urlParams = new URLSearchParams(window.location.search);
    tryPush(urlParams.get("deal_id"));
    tryPush(urlParams.get("dealId"));

    const dealId = sources.find((x) => Number.isFinite(x) && x > 0);
    if (!dealId) throw new Error("No fue posible determinar el Deal actual.");

    const dealResponse = await client.request({
      url: `/v2/deals/${dealId}`,
      type: "GET",
      contentType: "application/json",
    });

    const deal = dealResponse && dealResponse.data ? dealResponse.data : dealResponse;
    if (!deal || !deal.id) throw new Error("No se pudo cargar el Deal.");

    return deal;
  }

  async function getContactContext(deal) {
    const contactId = deal.contact_id || (deal.contact && deal.contact.id);
    if (!contactId) throw new Error("El Deal no tiene contacto asociado.");

    const contactResponse = await client.request({
      url: `/v2/contacts/${contactId}`,
      type: "GET",
      contentType: "application/json",
    });

    const contact =
      contactResponse && contactResponse.data ? contactResponse.data : contactResponse;
    if (!contact || !contact.id) throw new Error("No se pudo cargar el Contact.");

    return contact;
  }

  function normalizePhone(phone) {
    const digits = String(phone || "").replace(/\D+/g, "");
    if (!digits) return "";
    if (digits.startsWith("56") && digits.length >= 11) return digits.slice(2);
    return digits;
  }

  function pickTel1Tel2(contact) {
    const candidates = [
      toStringValue(getField(contact, FIELD_KEYS.telA)),
      toStringValue(getField(contact, FIELD_KEYS.telB)),
      toStringValue(getField(contact, FIELD_KEYS.telC)),
      toStringValue(contact.phone),
      toStringValue(contact.mobile_phone),
      toStringValue(contact.work_phone),
    ]
      .map((x) => String(x || "").trim())
      .filter(Boolean);

    const tel1 = candidates[0] || "";
    if (!tel1) return { tel1: "", tel2: "" };

    const normalizedTel1 = normalizePhone(tel1);
    const tel2Distinct = candidates.find(
      (tel) => normalizePhone(tel) && normalizePhone(tel) !== normalizedTel1
    );

    return { tel1, tel2: tel2Distinct || tel1 };
  }

  function selectEmail(contact) {
    const emailA = toStringValue(getField(contact, FIELD_KEYS.emailPrimary));
    const emailB = toStringValue(getField(contact, FIELD_KEYS.emailSecondary));
    const emailStd = toStringValue(contact.email);
    return (emailA || emailB || emailStd || "").trim();
  }

  function computeAseguradora(tramoModalidad) {
    const t = String(tramoModalidad || "").trim();
    const fonasa = new Set(["Tramo A", "Tramo B", "Tramo C", "Tramo D"]);
    return fonasa.has(t) ? "Fonasa" : t;
  }

  async function resolveTramoModalidadName(deal) {
    const rawValue = getField(deal, FIELD_KEYS.tramoModalidad);
    if (!rawValue) return "";

    // Si ya viene como texto (ej "Tramo C"), usarlo
    if (typeof rawValue === "string" && Number.isNaN(Number(rawValue))) {
      return rawValue.trim();
    }

    const selectedId = String(rawValue);

    const endpoints = [
      `/v2/custom_fields/deals/${FIELD_IDS.tramoModalidad}`,
      `/v2/deal_custom_fields/${FIELD_IDS.tramoModalidad}`,
      `/v2/custom_fields/${FIELD_IDS.tramoModalidad}`,
    ];

    for (const endpoint of endpoints) {
      try {
        const definitionResponse = await client.request({
          url: endpoint,
          type: "GET",
          contentType: "application/json",
        });

        const definition =
          definitionResponse && definitionResponse.data ? definitionResponse.data : definitionResponse;

        const options =
          (definition && (definition.options || definition.choices || definition.values)) || [];

        if (Array.isArray(options)) {
          const hit = options.find(
            (opt) => String(opt.id) === selectedId || String(opt.value) === selectedId
          );
          if (hit) {
            return String(hit.name || hit.label || hit.value || "").trim();
          }
        }
      } catch (_e) {
        // sigue intentando otros endpoints
      }
    }

    return String(rawValue).trim();
  }

  function validateRequired(fields) {
    const missing = [];
    if (!fields.birth_date) missing.push("Fecha nacimiento");
    if (!fields.email) missing.push("Email");
    if (!fields.telefono1) missing.push("Tel1");
    if (!fields.direccion) missing.push("Dirección");
    if (!fields.comuna) missing.push("Comuna");
    if (!fields.tramo_modalidad) missing.push("Tramo/Modalidad");
    return missing;
  }

  function requestWithTimeout(options, timeoutMs) {
    return Promise.race([
      client.request(options),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Timeout de backend")), Number(timeoutMs || 20000))
      ),
    ]);
  }

  async function onUploadClick() {
    if (!btnUpload) return;

    btnUpload.disabled = true;
    setStatus("Procesando...");

    const debug = {
      timestamp: new Date().toISOString(),
      payload: null,
      block_reason: null,
      backend_response: null,
      backend_error: null,
    };

    try {
      const settings = await getSettings();
      debug.settings = settings;

      if (!settings.backend_base_url) {
        throw new Error("Falta setting: backend_base_url.");
      }

      const deal = await getDealContext();
      const contact = await getContactContext(deal);

      const firstName = toStringValue(contact.first_name);
      const lastName = toStringValue(contact.last_name);
      if (!firstName || !lastName) {
        debug.block_reason = "Faltan nombre/apellido";
        setDebug(debug);
        setStatus("Faltan nombre/apellido");
        return;
      }

      const rut = toStringValue(getField(contact, FIELD_KEYS.rut));
      if (!rut) {
        debug.block_reason = "Sin RUN/RUT: carga manual en Medinet";
        setDebug(debug);
        setStatus("Sin RUN/RUT: carga manual en Medinet");
        return;
      }

      const birthDate = toStringValue(getField(contact, FIELD_KEYS.birthDate));
      const email = selectEmail(contact);

      const addrStd = contact.address || {};
      const direccion =
        toStringValue(getField(contact, FIELD_KEYS.direccion)) ||
        toStringValue(addrStd.line1) ||
        toStringValue(addrStd);

      const comuna =
        toStringValue(getField(contact, FIELD_KEYS.comuna)) ||
        toStringValue(addrStd.city);

      const tramoModalidad = await resolveTramoModalidadName(deal);
      const phones = pickTel1Tel2(contact);

      const payload = {
        deal_id: Number(deal.id),
        contact_id: Number(contact.id),
        rut,
        first_name: firstName,
        last_name: lastName,
        birth_date: birthDate,
        email,
        telefono1: phones.tel1,
        telefono2: phones.tel2 || phones.tel1,
        direccion,
        comuna,
        tramo_modalidad: tramoModalidad,
        aseguradora: computeAseguradora(tramoModalidad),
        source: "zendesk_sell_deal_card",
      };

      debug.payload = payload;

      const missing = validateRequired(payload);
      if (missing.length > 0) {
        const message = `No se puede subir a Medinet. Faltan: ${missing.join(", ")}`;
        debug.block_reason = message;
        setDebug(debug);
        setStatus(message);
        return;
      }

      // ✅ Recomendado por Zendesk: usar client.request() + secure settings placeholder
      // backend_api_key (secure) se inyecta server-side por el proxy.
      // Requiere domainWhitelist + scopes:["header"] en manifest.json.
      const options = {
        url: `${settings.backend_base_url}/medinet/import`,
        type: "POST",
        contentType: "application/json",
        data: JSON.stringify(payload),
        headers: {
          "X-API-Key": "{{setting.backend_api_key}}",
        },
        accepts: "application/json",
        secure: true,
      };

      const response = await requestWithTimeout(options, settings.backend_timeout_ms);
      debug.backend_response = response;

      setDebug(debug);

      const responseBody = response || {};
      if (responseBody.status === "ok") {
        setStatus(responseBody.message || "Listo ✅");
        if (responseBody.download_url) window.open(responseBody.download_url, "_blank");
      } else {
        setStatus(responseBody.message || "Error");
      }
    } catch (error) {
      const message = (error && error.message) || "Error";
      debug.backend_error = { name: error && error.name, message };
      setDebug(debug);
      setStatus(message);
    } finally {
      btnUpload.disabled = false;
    }
  }
})();
