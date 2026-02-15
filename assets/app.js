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

  const statusEl = document.getElementById('status');
  const debugEl = document.getElementById('debug');
  const btnUpload = document.getElementById('btnUpload');

  btnUpload.addEventListener('click', onUploadClick);

  function setStatus(message) {
    statusEl.textContent = message;
  }

  function setDebug(content) {
    debugEl.textContent = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
  }

  function getCustomField(entity, fieldId) {
    if (!entity) {
      return '';
    }

    const id = String(fieldId);
    const candidateMaps = [entity.custom_fields, entity.customFields, entity.custom_field_values];

    for (const map of candidateMaps) {
      if (map && Object.prototype.hasOwnProperty.call(map, id)) {
        return map[id];
      }
      if (map && Object.prototype.hasOwnProperty.call(map, fieldId)) {
        return map[fieldId];
      }
    }

    if (Array.isArray(entity.custom_fields)) {
      const hit = entity.custom_fields.find((x) => String(x.id) === id || String(x.custom_field_id) === id);
      if (hit) {
        return hit.value;
      }
    }

    return '';
  }

  async async function getSettings() {
    // En Sell, los settings pueden venir en distintos lugares según instalación/versión.
    const metadata = await client.metadata().catch(() => ({}));
    let settings =
      (metadata && metadata.settings) ||
      (metadata && metadata.installationSettings) ||
      (metadata && metadata.config) ||
      {};

    // Fallback: algunos entornos exponen settings vía client.get('settings')
    const got = await client.get('settings').catch(() => ({}));
    if (got && Object.keys(got).length) {
      const fromGet = got.settings && Object.keys(got.settings).length ? got.settings : got;
      settings = Object.assign({}, settings, fromGet);
    }
// Normalizar nombres posibles
    const baseUrl =
      settings.backend_base_url ||
      settings.backendBaseUrl ||
      settings.base_url ||
      settings.baseUrl ||
      '';
    const apiKey =
      settings.backend_api_key ||
      settings.backendApiKey ||
      settings.api_key ||
      settings.apiKey ||
      '';
    const timeout =
      settings.backend_timeout_ms ||
      settings.backendTimeoutMs ||
      settings.timeout_ms ||
      settings.timeoutMs ||
      20000;

    return {
      backend_base_url: String(baseUrl || '').trim().replace(/\/$/, ''),
      backend_api_key: String(apiKey || '').trim(),
      backend_timeout_ms: Number(timeout || 20000),
    };
  }

  async function getDealContext() {
    const sources = [];
    const tryPush = (value) => {
      if (value) {
        sources.push(Number(value));
      }
    };

    const fromGet = await client.get([
      'deal.id',
      'deal',
      'currentDeal.id',
      'currentDeal',
      'dealId',
      'context.dealId',
      'ticket.id',
    ]).catch(() => ({}));

    tryPush(fromGet['deal.id']);
    tryPush(fromGet['currentDeal.id']);
    tryPush(fromGet.dealId);
    tryPush(fromGet['context.dealId']);
    if (fromGet.deal && fromGet.deal.id) {
      tryPush(fromGet.deal.id);
    }
    if (fromGet.currentDeal && fromGet.currentDeal.id) {
      tryPush(fromGet.currentDeal.id);
    }

    const ctx = await client.context().catch(() => ({}));
    tryPush(ctx.dealId);
    tryPush(ctx.entityId);
    tryPush(ctx.resource_id);

    const urlParams = new URLSearchParams(window.location.search);
    tryPush(urlParams.get('deal_id'));
    tryPush(urlParams.get('dealId'));

    const dealId = sources.find((x) => Number.isFinite(x) && x > 0);
    if (!dealId) {
      throw new Error('No fue posible determinar el Deal actual.');
    }

    const dealResponse = await client.request({
      url: `/v2/deals/${dealId}`,
      type: 'GET',
      contentType: 'application/json',
    });

    const deal = dealResponse && dealResponse.data ? dealResponse.data : dealResponse;
    if (!deal || !deal.id) {
      throw new Error('No se pudo cargar el Deal.');
    }

    return deal;
  }

  async function getContactContext(deal) {
    const contactId = deal.contact_id || (deal.contact && deal.contact.id);
    if (!contactId) {
      throw new Error('El Deal no tiene contacto asociado.');
    }

    const contactResponse = await client.request({
      url: `/v2/contacts/${contactId}`,
      type: 'GET',
      contentType: 'application/json',
    });

    const contact = contactResponse && contactResponse.data ? contactResponse.data : contactResponse;
    if (!contact || !contact.id) {
      throw new Error('No se pudo cargar el Contact.');
    }

    return contact;
  }

  function selectEmail(contact) {
    const emailA = String(getCustomField(contact, FIELD_IDS.emailPrimary) || '').trim();
    const emailB = String(getCustomField(contact, FIELD_IDS.emailSecondary) || '').trim();
    return emailA || emailB || '';
  }

  function normalizePhone(phone) {
    const digits = String(phone || '').replace(/\D+/g, '');
    if (!digits) {
      return '';
    }

    if (digits.startsWith('56') && digits.length >= 11) {
      return digits.slice(2);
    }

    return digits;
  }

  function pickTel1Tel2(contact) {
    const candidates = [FIELD_IDS.telA, FIELD_IDS.telB, FIELD_IDS.telC]
      .map((id) => String(getCustomField(contact, id) || '').trim())
      .filter(Boolean);

    const tel1 = candidates[0] || '';
    if (!tel1) {
      return { tel1: '', tel2: '' };
    }

    const normalizedTel1 = normalizePhone(tel1);
    const tel2Distinct = candidates.find((tel) => normalizePhone(tel) && normalizePhone(tel) !== normalizedTel1);
    return { tel1, tel2: tel2Distinct || tel1 };
  }

  function computeAseguradora(tramoModalidad) {
    const fonasa = new Set(['Tramo A', 'Tramo B', 'Tramo C', 'Tramo D']);
    return fonasa.has(tramoModalidad) ? 'Fonasa' : tramoModalidad;
  }

  async function resolveTramoModalidadName(deal) {
    const rawValue = getCustomField(deal, FIELD_IDS.tramoModalidad);
    if (!rawValue) {
      return '';
    }

    if (typeof rawValue === 'string' && Number.isNaN(Number(rawValue))) {
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
          type: 'GET',
          contentType: 'application/json',
        });

        const definition = definitionResponse && definitionResponse.data ? definitionResponse.data : definitionResponse;
        const options = definition && (definition.options || definition.choices || definition.values || []);
        if (Array.isArray(options)) {
          const hit = options.find((opt) => String(opt.id) === selectedId || String(opt.value) === selectedId);
          if (hit) {
            return String(hit.name || hit.label || hit.value || '').trim();
          }
        }
      } catch (error) {
        // Continuar con fallback si un endpoint no existe.
      }
    }

    return String(rawValue).trim();
  }

  function validateRequired(fields) {
    const missing = [];
    if (!fields.birth_date) missing.push('Fecha nacimiento');
    if (!fields.email) missing.push('Email');
    if (!fields.telefono1) missing.push('Tel1');
    if (!fields.direccion) missing.push('Dirección');
    if (!fields.comuna) missing.push('Comuna');
    if (!fields.tramo_modalidad) missing.push('Tramo/Modalidad');
    return missing;
  }

  async function postWithTimeout(url, requestOptions, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...requestOptions,
        signal: controller.signal,
      });

      const json = await response.json().catch(() => ({}));
      return { ok: response.ok, statusCode: response.status, body: json };
    } finally {
      clearTimeout(timer);
    }
  }

  async function onUploadClick() {
    btnUpload.disabled = true;
    setStatus('Procesando...');

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

      if (!settings.backend_base_url || !settings.backend_api_key) {
        throw new Error('Faltan settings: backend_base_url o backend_api_key.');
      }

      const deal = await getDealContext();
      const contact = await getContactContext(deal);

      const firstName = String(contact.first_name || '').trim();
      const lastName = String(contact.last_name || '').trim();
      if (!firstName || !lastName) {
        debug.block_reason = 'Faltan nombre/apellido';
        setDebug(debug);
        setStatus('Faltan nombre/apellido');
        return;
      }

      const rut = String(getCustomField(contact, FIELD_IDS.rut) || '').trim();
      if (!rut) {
        debug.block_reason = 'Sin RUN/RUT: carga manual en Medinet';
        setDebug(debug);
        setStatus('Sin RUN/RUT: carga manual en Medinet');
        return;
      }

      const birthDate = String(getCustomField(contact, FIELD_IDS.birthDate) || '').trim();
      const email = selectEmail(contact);
      const direccion = String(getCustomField(contact, FIELD_IDS.direccion) || '').trim();
      const comuna = String(getCustomField(contact, FIELD_IDS.comuna) || '').trim();
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
        telefono2: phones.tel2,
        direccion,
        comuna,
        tramo_modalidad: tramoModalidad,
        aseguradora: computeAseguradora(tramoModalidad),
        source: 'zendesk_sell_deal_card',
      };

      debug.payload = payload;

      const missing = validateRequired(payload);
      if (missing.length > 0) {
        const message = `No se puede subir a Medinet. Faltan: ${missing.join(', ')}`;
        debug.block_reason = message;
        setDebug(debug);
        setStatus(message);
        return;
      }

      const requestResult = await postWithTimeout(
        `${settings.backend_base_url}/medinet/import`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': settings.backend_api_key,
          },
          body: JSON.stringify(payload),
        },
        settings.backend_timeout_ms
      );

      debug.backend_response = requestResult;
      setDebug(debug);

      const responseBody = requestResult.body || {};
      if (responseBody.status === 'ok') {
        setStatus(responseBody.message || 'Listo ✅');
        if (responseBody.download_url) {
          window.open(responseBody.download_url, '_blank');
        }
      } else {
        setStatus(responseBody.message || 'Error');
      }
    } catch (error) {
      const isAbort = error && error.name === 'AbortError';
      const message = isAbort ? 'Timeout de backend' : error.message || 'Error';
      debug.backend_error = {
        name: error.name,
        message,
      };
      setDebug(debug);
      setStatus(message);
    } finally {
      btnUpload.disabled = false;
    }
  }
})();
