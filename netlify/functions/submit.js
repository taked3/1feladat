'use strict';

// ---------------------------------------------------------------------------
// Haversine distance (returns km)
// ---------------------------------------------------------------------------
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R     = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat  = toRad(lat2 - lat1);
  const dLon  = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // --- Parse body ---
  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Érvénytelen JSON' }),
    };
  }

  const { latitude, longitude, fejfajas, faradsag } = body;

  // --- Input validation ---
  if (
    typeof latitude  !== 'number' ||
    typeof longitude !== 'number' ||
    latitude < -90  || latitude > 90 ||
    longitude < -180 || longitude > 180
  ) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Érvénytelen koordináták' }) };
  }

  if (
    !Number.isInteger(fejfajas) || fejfajas < 0 || fejfajas > 10 ||
    !Number.isInteger(faradsag) || faradsag < 0 || faradsag > 10
  ) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Az értékeknek egész számnak kell lenniük 0 és 10 között' }),
    };
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('Hiányzó környezeti változók: SUPABASE_URL vagy SUPABASE_ANON_KEY');
    return { statusCode: 500, body: JSON.stringify({ error: 'Szerverkonfigurációs hiba' }) };
  }

  const apiHeaders = {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Prefer': 'return=minimal',
  };

  const now = Date.now();

  // --- Mentés Supabase-be ---
  const insertResp = await fetch(`${SUPABASE_URL}/rest/v1/entries`, {
    method: 'POST',
    headers: apiHeaders,
    body: JSON.stringify({ timestamp: now, latitude, longitude, fejfajas, faradsag }),
  });

  if (!insertResp.ok) {
    const errText = await insertResp.text();
    console.error('Supabase insert error:', errText);
    return { statusCode: 500, body: JSON.stringify({ error: 'Adatmentési hiba' }) };
  }

  // --- Utolsó 3 óra bejegyzéseinek lekérdezése ---
  const cutoff   = now - 3 * 60 * 60 * 1000;
  const queryUrl = `${SUPABASE_URL}/rest/v1/entries` +
    `?timestamp=gt.${cutoff}` +
    `&timestamp=lt.${now}` +       // a most beküldött rekordot kizárjuk
    `&select=latitude,longitude,fejfajas,faradsag`;

  const selectResp = await fetch(queryUrl, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
    },
  });

  if (!selectResp.ok) {
    const errText = await selectResp.text();
    console.error('Supabase select error:', errText);
    return { statusCode: 500, body: JSON.stringify({ error: 'Lekérdezési hiba' }) };
  }

  const recent = await selectResp.json();

  // --- Dinamikus sugár: 30 → 60 → 100 km ---
  const RADII       = [30, 60, 100];
  const MIN_MATCHES = 3;
  let similarCount  = 0;
  let usedRadius    = RADII[0];

  for (const radius of RADII) {
    similarCount = recent.filter((e) => {
      const dist = haversineDistance(latitude, longitude, e.latitude, e.longitude);
      return (
        dist <= radius &&
        Math.abs(e.fejfajas - fejfajas) <= 2 &&
        Math.abs(e.faradsag - faradsag) <= 2
      );
    }).length;
    usedRadius = radius;
    if (similarCount >= MIN_MATCHES) break;
  }

  // --- Kategorizálás ---
  const category =
    similarCount === 0  ? 'egyedül'   :
    similarCount <= 3   ? 'kevesen'   :
    similarCount <= 10  ? 'közepesen' : 'sokan';

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ count: similarCount, category, radius: usedRadius }),
  };
};
