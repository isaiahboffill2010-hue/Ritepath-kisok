import fs from 'node:fs/promises';

// WeatherAPI.com client for the RitePath shell.
//
// FREE PLAN ONLY. The single endpoint used here (forecast.json) returns current
// conditions, hourly data, daily data and astronomy in one request, which is
// everything the widget needs while keeping quota usage minimal.
//
// Deliberately NOT used because they are paid/trial-only features:
//   - aqi=yes (air quality)      - alerts=yes (weather alerts)
//   - history.json / future.json - marine.json / solar irradiance fields
//   - days > 3 (the Free plan caps the forecast at 3 days)
const API_URL = 'https://api.weatherapi.com/v1/forecast.json';
const FORECAST_DAYS = 3;
const CACHE_TTL_MS = 12 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10000;
const HOURLY_COUNT = 12;

// Location handling is intentionally isolated to this one function so that a
// future RitePath Settings screen can supply the location without touching any
// of the request or caching logic below.
// 'auto:ip' is supported on the Free plan and resolves from the public IP.
export function resolveLocation() {
  const configured = process.env.WEATHER_LOCATION?.trim();
  return configured || 'auto:ip';
}

let cacheFilePath = null;
let cached = null; // { data, fetchedAt }
let inFlight = null;

export function configureWeather({ cacheFile }) {
  cacheFilePath = cacheFile;
}

function emojiForCondition(code, isDay) {
  if (code === 1000) return isDay ? '☀️' : '🌙';
  if (code === 1003) return isDay ? '⛅' : '☁️';
  if ([1006, 1009].includes(code)) return '☁️';
  if ([1030, 1135, 1147].includes(code)) return '🌫️';
  if ([1087, 1273, 1276, 1279, 1282].includes(code)) return '⛈️';
  if (code >= 1210 && code <= 1264) return '❄️';
  if ([1066, 1069, 1072, 1114, 1117, 1204, 1207, 1237].includes(code)) return '❄️';
  if (code >= 1063 && code <= 1201) return '🌧️';
  if (code >= 1240 && code <= 1252) return '🌧️';
  return '🌡️';
}

function normalizeIcon(icon) {
  if (typeof icon !== 'string' || !icon) {
    return null;
  }

  // WeatherAPI returns protocol-relative URLs such as //cdn.weatherapi.com/...
  return icon.startsWith('//') ? `https:${icon}` : icon;
}

function toCondition(raw, isDay = 1) {
  const code = Number(raw?.code ?? 0);
  return {
    text: typeof raw?.text === 'string' ? raw.text : 'Unknown',
    icon: normalizeIcon(raw?.icon),
    code,
    emoji: emojiForCondition(code, Boolean(isDay)),
  };
}

function hourLabel(epochSeconds, timeString) {
  if (Number.isFinite(epochSeconds)) {
    return new Date(epochSeconds * 1000).toLocaleTimeString([], { hour: 'numeric' });
  }

  return typeof timeString === 'string' ? timeString.slice(11) : '--';
}

function dayLabel(dateEpoch, dateString, index) {
  if (index === 0) {
    return 'Today';
  }

  if (Number.isFinite(dateEpoch)) {
    return new Date(dateEpoch * 1000).toLocaleDateString([], { weekday: 'short' });
  }

  return typeof dateString === 'string' ? dateString : '--';
}

function round(value) {
  return Number.isFinite(Number(value)) ? Math.round(Number(value)) : null;
}

// Converts the WeatherAPI response into exactly what the renderer needs.
// The API key is never part of this structure.
function sanitize(payload) {
  const current = payload?.current ?? {};
  const forecastDays = Array.isArray(payload?.forecast?.forecastday)
    ? payload.forecast.forecastday
    : [];
  const today = forecastDays[0] ?? {};
  const isDay = current.is_day ?? 1;

  const nowEpoch = Math.floor(Date.now() / 1000);
  const hourly = forecastDays
    .flatMap((day) => (Array.isArray(day?.hour) ? day.hour : []))
    .filter((hour) => Number(hour?.time_epoch) >= nowEpoch - 3600)
    .slice(0, HOURLY_COUNT)
    .map((hour) => ({
      timeEpoch: Number(hour?.time_epoch) || null,
      label: hourLabel(Number(hour?.time_epoch), hour?.time),
      tempF: round(hour?.temp_f),
      tempC: round(hour?.temp_c),
      condition: toCondition(hour?.condition, hour?.is_day),
      chanceOfRain: round(hour?.chance_of_rain) ?? 0,
    }));

  const daily = forecastDays.map((day, index) => ({
    label: dayLabel(Number(day?.date_epoch), day?.date, index),
    date: typeof day?.date === 'string' ? day.date : null,
    condition: toCondition(day?.day?.condition, 1),
    maxF: round(day?.day?.maxtemp_f),
    maxC: round(day?.day?.maxtemp_c),
    minF: round(day?.day?.mintemp_f),
    minC: round(day?.day?.mintemp_c),
    chanceOfRain: round(day?.day?.daily_chance_of_rain) ?? 0,
  }));

  return {
    location: {
      name: typeof payload?.location?.name === 'string' ? payload.location.name : 'Unknown',
      region: typeof payload?.location?.region === 'string' ? payload.location.region : '',
      country: typeof payload?.location?.country === 'string' ? payload.location.country : '',
    },
    current: {
      tempF: round(current.temp_f),
      tempC: round(current.temp_c),
      feelsLikeF: round(current.feelslike_f),
      feelsLikeC: round(current.feelslike_c),
      condition: toCondition(current.condition, isDay),
      isDay: Boolean(isDay),
      humidity: round(current.humidity),
      windMph: round(current.wind_mph),
      windKph: round(current.wind_kph),
      windDir: typeof current.wind_dir === 'string' ? current.wind_dir : '',
      uv: round(current.uv),
      lastUpdatedEpoch: Number(current.last_updated_epoch) * 1000 || null,
    },
    today: {
      maxF: round(today?.day?.maxtemp_f),
      maxC: round(today?.day?.maxtemp_c),
      minF: round(today?.day?.mintemp_f),
      minC: round(today?.day?.mintemp_c),
      chanceOfRain: round(today?.day?.daily_chance_of_rain) ?? 0,
      sunrise: typeof today?.astro?.sunrise === 'string' ? today.astro.sunrise : null,
      sunset: typeof today?.astro?.sunset === 'string' ? today.astro.sunset : null,
    },
    hourly,
    daily,
  };
}

// Maps every failure mode onto a short code. The request URL (which carries the
// API key) is never included in anything returned or logged.
function classifyError(error) {
  if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
    return { code: 'timeout', message: 'Weather request timed out' };
  }

  const cause = error?.cause?.code ?? error?.code;
  if (['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ENETUNREACH'].includes(cause)) {
    return { code: 'offline', message: 'No internet connection' };
  }

  return { code: 'offline', message: 'Weather service unreachable' };
}

function classifyApiError(status, body) {
  const apiCode = Number(body?.error?.code) || 0;

  if (status === 401 || status === 403 || [1002, 2006, 2008].includes(apiCode)) {
    return { code: 'invalid-key', message: 'Weather API key rejected' };
  }

  if (apiCode === 2007) {
    return { code: 'rate-limit', message: 'Weather API quota exceeded' };
  }

  if (apiCode === 2009) {
    return { code: 'plan-restricted', message: 'Weather plan does not allow this request' };
  }

  if ([1003, 1005, 1006].includes(apiCode) || status === 400) {
    return { code: 'invalid-location', message: 'Weather location not found' };
  }

  if (status >= 500) {
    return { code: 'server-error', message: 'Weather service error' };
  }

  return { code: 'bad-response', message: 'Unexpected weather response' };
}

async function readCacheFile() {
  if (!cacheFilePath) {
    return null;
  }

  try {
    const raw = await fs.readFile(cacheFilePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && parsed.data && Number.isFinite(parsed.fetchedAt)) {
      return { data: parsed.data, fetchedAt: parsed.fetchedAt };
    }
  } catch {
    // A missing or corrupt cache is not an error - we just refetch.
  }

  return null;
}

async function writeCacheFile() {
  if (!cacheFilePath || !cached) {
    return;
  }

  try {
    // Write + rename so a crash or power cut can never leave a half-written
    // cache behind for the next start to read.
    const tempPath = `${cacheFilePath}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(cached), 'utf8');
    await fs.rename(tempPath, cacheFilePath);
  } catch {
    // Cache persistence is best-effort only.
  }
}

function buildResult(error) {
  if (!cached) {
    return {
      ok: false,
      stale: false,
      fetchedAt: null,
      error: error ?? { code: 'unavailable', message: 'Weather unavailable' },
      data: null,
    };
  }

  return {
    ok: true,
    stale: Boolean(error) || Date.now() - cached.fetchedAt > CACHE_TTL_MS,
    fetchedAt: cached.fetchedAt,
    error: error ?? null,
    data: cached.data,
  };
}

// Restores the last known weather from disk so a cold start (or a start with no
// internet) can show something immediately.
export async function loadCachedWeather() {
  if (!cached) {
    cached = await readCacheFile();
  }

  return buildResult(null);
}

async function requestWeather() {
  const apiKey = process.env.WEATHER_API_KEY?.trim();
  if (!apiKey) {
    return buildResult({ code: 'no-key', message: 'WEATHER_API_KEY is not configured' });
  }

  const url = new URL(API_URL);
  url.searchParams.set('key', apiKey);
  url.searchParams.set('q', resolveLocation());
  url.searchParams.set('days', String(FORECAST_DAYS));
  url.searchParams.set('aqi', 'no');
  url.searchParams.set('alerts', 'no');

  let response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { accept: 'application/json' },
    });
  } catch (error) {
    return buildResult(classifyError(error));
  }

  let body = null;
  try {
    body = await response.json();
  } catch {
    return buildResult({ code: 'bad-response', message: 'Unexpected weather response' });
  }

  if (!response.ok || body?.error) {
    return buildResult(classifyApiError(response.status, body));
  }

  if (!body?.current || !body?.forecast) {
    return buildResult({ code: 'bad-response', message: 'Unexpected weather response' });
  }

  try {
    cached = { data: sanitize(body), fetchedAt: Date.now() };
  } catch {
    return buildResult({ code: 'bad-response', message: 'Unexpected weather response' });
  }

  void writeCacheFile();
  return buildResult(null);
}

export async function getWeather({ force = false } = {}) {
  if (!cached) {
    cached = await readCacheFile();
  }

  const isFresh = cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS;
  if (isFresh && !force) {
    return buildResult(null);
  }

  // Collapse concurrent callers onto a single in-flight request so that opening
  // and closing the widget never multiplies API calls.
  if (!inFlight) {
    inFlight = requestWeather().finally(() => {
      inFlight = null;
    });
  }

  return inFlight;
}

export const WEATHER_REFRESH_MS = CACHE_TTL_MS;
