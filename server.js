'use strict';

const express = require('express');
const path    = require('path');
const fs      = require('fs');

const app       = express();
const DATA_FILE = path.join(__dirname, 'data.json');

// ---------------------------------------------------------------------------
// JSON file storage helpers
// ---------------------------------------------------------------------------
function readEntries() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function writeEntries(entries) {
  // Atomic write: write to temp file first, then rename
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(entries), 'utf8');
  fs.renameSync(tmp, DATA_FILE);
}

// Initialise storage file if it does not exist
if (!fs.existsSync(DATA_FILE)) {
  writeEntries([]);
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// Haversine distance (returns km)
// ---------------------------------------------------------------------------
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ---------------------------------------------------------------------------
// POST /api/submit
// ---------------------------------------------------------------------------
app.post('/api/submit', (req, res) => {
  const { latitude, longitude, fejfajas, faradsag } = req.body;

  // --- Input validation ---
  if (
    typeof latitude  !== 'number' ||
    typeof longitude !== 'number' ||
    typeof fejfajas  !== 'number' ||
    typeof faradsag  !== 'number'
  ) {
    return res.status(400).json({ error: 'Érvénytelen adatok: minden mező szükséges' });
  }

  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return res.status(400).json({ error: 'Érvénytelen koordináták' });
  }

  if (
    !Number.isInteger(fejfajas) || fejfajas < 0 || fejfajas > 10 ||
    !Number.isInteger(faradsag) || faradsag < 0 || faradsag > 10
  ) {
    return res.status(400).json({ error: 'Az értékeknek egész számnak kell lenniük 0 és 10 között' });
  }

  const now     = Date.now();
  const entries = readEntries();

  // --- Append new entry ---
  entries.push({ timestamp: now, latitude, longitude, fejfajas, faradsag });

  // --- Prune entries older than 24 h to keep the file small ---
  const cutoff24h = now - 24 * 60 * 60 * 1000;
  const pruned    = entries.filter((e) => e.timestamp > cutoff24h);

  try {
    writeEntries(pruned);
  } catch (err) {
    console.error('Storage write error:', err.message);
    return res.status(500).json({ error: 'Szerverhiba' });
  }

  // --- Find similar entries in the last 3 hours (excluding the one just added) ---
  const cutoff3h = now - 3 * 60 * 60 * 1000;
  const recent   = pruned.filter(
    (e) => e.timestamp > cutoff3h && e.timestamp !== now
  );

  // --- Dynamic radius: 30 → 60 → 100 km ---
  const RADII_KM    = [30, 60, 100];
  const MIN_MATCHES = 3;
  let similarCount  = 0;
  let usedRadius    = RADII_KM[0];

  for (const radius of RADII_KM) {
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

  // --- Categorise ---
  let category;
  if      (similarCount === 0)  category = 'egyedül';
  else if (similarCount <= 3)   category = 'kevesen';
  else if (similarCount <= 10)  category = 'közepesen';
  else                          category = 'sokan';

  res.json({ count: similarCount, category, radius: usedRadius });
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅  Fejfájás.hu szerver fut: http://localhost:${PORT}`);
});
