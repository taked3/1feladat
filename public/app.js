/* ============================================================
   Fejfájás.hu – Frontend logic
   ============================================================ */

'use strict';

// ── DOM refs ───────────────────────────────────────────────────
const fejfajasSlider      = document.getElementById('fejfajas');
const faradsagSlider      = document.getElementById('faradsag');
const fejfajasValueBadge  = document.getElementById('fejfajasValueBadge');
const faradsagValueBadge  = document.getElementById('faradsagValueBadge');
const submitBtn           = document.getElementById('submitBtn');
const retryBtn            = document.getElementById('retryBtn');
const formSection         = document.getElementById('formSection');
const loadingSection      = document.getElementById('loadingSection');
const resultSection       = document.getElementById('resultSection');
const locationStatus      = document.getElementById('locationStatus');
const locationIcon        = document.getElementById('locationIcon');
const locationText        = document.getElementById('locationText');

// ── Severity colour scale ─────────────────────────────────────
function severityColor(value) {
  if (value <= 2) return '#22c55e';   // green
  if (value <= 5) return '#eab308';   // yellow
  if (value <= 7) return '#f97316';   // orange
  return '#ef4444';                   // red
}

// ── Update slider track fill and value badge ──────────────────
function refreshSlider(slider, badge) {
  const value = parseInt(slider.value, 10);
  const pct   = (value / 10) * 100;
  const color = severityColor(value);

  // Gradient fill: colour up to thumb position, neutral grey after
  slider.style.background =
    `linear-gradient(to right, ${color} ${pct}%, #e5e7eb ${pct}%)`;

  badge.textContent = value;
  if (value === 0) {
    badge.style.background = '';
    badge.style.color = '';
  } else {
    badge.style.background = `${color}22`; // ~13 % opacity tint
    badge.style.color = color;
  }
}

// Initialise on load
refreshSlider(fejfajasSlider, fejfajasValueBadge);
refreshSlider(faradsagSlider, faradsagValueBadge);

fejfajasSlider.addEventListener('input', () => refreshSlider(fejfajasSlider, fejfajasValueBadge));
faradsagSlider.addEventListener('input', () => refreshSlider(faradsagSlider, faradsagValueBadge));

// ── Section switcher ─────────────────────────────────────────
function showOnly(section) {
  formSection.hidden    = true;
  loadingSection.hidden = true;
  resultSection.hidden  = true;
  section.hidden        = false;
}

// ── Geolocation ───────────────────────────────────────────────
function requestLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('A böngésző nem támogatja a helymeghatározást'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({
        latitude:  pos.coords.latitude,
        longitude: pos.coords.longitude,
      }),
      (err) => {
        if (err.code === 1) reject(new Error('A helymeghatározáshoz engedély szükséges'));
        else if (err.code === 3) reject(new Error('Helymeghatározás időtúllépés'));
        else                     reject(new Error('Helymeghatározás sikertelen'));
      },
      { timeout: 12000, maximumAge: 300000 }
    );
  });
}

// ── Result content map ────────────────────────────────────────
const RESULTS = {
  'egyedül': {
    icon:  '🌟',
    title: 'Te vagy az első a közeledben!',
    detail: (_count, radius) =>
      `Az elmúlt 3 órában nem találtunk hasonló tüneteket a ${radius} km-es körzetedben. Osztd meg az oldalt, hogy minél több adat gyűljön!`,
  },
  'kevesen': {
    icon:  '😌',
    title: 'Kevesen érzik így',
    detail: (count, radius) =>
      `${count} hasonló állapotú felhasználót találtunk ${radius} km-es körzetedben az elmúlt 3 órában.`,
  },
  'közepesen': {
    icon:  '😕',
    title: 'Sokan érzik így',
    detail: (count, radius) =>
      `${count} hasonló állapotú felhasználót találtunk ${radius} km-es körzetedben az elmúlt 3 órában.`,
  },
  'sokan': {
    icon:  '🌡️',
    title: 'Nagyon sokan érzik így!',
    detail: (count, radius) =>
      `${count} hasonló állapotú felhasználót találtunk ${radius} km-es körzetedben az elmúlt 3 órában.`,
  },
};

// ── Submit ────────────────────────────────────────────────────
submitBtn.addEventListener('click', async () => {
  const fejfajasVal = parseInt(fejfajasSlider.value, 10);
  const faradsagVal = parseInt(faradsagSlider.value, 10);

  // Show location request indicator
  locationStatus.hidden = false;
  locationIcon.textContent = '📡';
  locationText.textContent = 'Helymeghatározás…';
  submitBtn.disabled = true;

  let location;
  try {
    location = await requestLocation();
    locationIcon.textContent = '✅';
    locationText.textContent = 'Lokáció meghatározva';
  } catch (err) {
    locationIcon.textContent = '❌';
    locationText.textContent = err.message;
    submitBtn.disabled = false;
    return;
  }

  showOnly(loadingSection);

  try {
    const response = await fetch('/api/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        latitude:  location.latitude,
        longitude: location.longitude,
        fejfajas:  fejfajasVal,
        faradsag:  faradsagVal,
      }),
    });

    if (!response.ok) {
      throw new Error(`Szerverhiba (${response.status})`);
    }

    const data = await response.json();
    const content = RESULTS[data.category] || RESULTS['kevesen'];

    document.getElementById('resultIcon').textContent   = content.icon;
    document.getElementById('resultTitle').textContent  = content.title;
    document.getElementById('resultDetail').textContent = content.detail(data.count, data.radius);
    document.getElementById('resultMeta').textContent   =
      `Elmúlt 3 óra adatai · Hasonlóság ±2 eltérés · Sugár: ${data.radius} km`;

    showOnly(resultSection);

  } catch (err) {
    showOnly(formSection);
    locationStatus.hidden = false;
    locationIcon.textContent = '❌';
    locationText.textContent = 'Hiba történt, próbáld újra';
    submitBtn.disabled = false;
  }
});

// ── Retry ─────────────────────────────────────────────────────
retryBtn.addEventListener('click', () => {
  showOnly(formSection);
  locationStatus.hidden = true;
  submitBtn.disabled = false;
});
