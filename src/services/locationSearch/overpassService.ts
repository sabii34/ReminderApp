import type { Position } from 'geojson';
import type { SearchBounds, SearchResult } from './locationSearchTypes';
import { GEOAPIFY_API_KEY } from '@src/constants/config';

const GEOAPIFY_GEOCODING_URL = 'https://api.geoapify.com/v1/geocode/search';
const GEOAPIFY_PLACES_URL = 'https://api.geoapify.com/v2/places';
const REQUEST_TIMEOUT_MS = 8000;
const MAX_RESULTS = 20;

// Geoapify Places requires categories. These parent categories cover
// common businesses and public places (shops, healthcare, food, leisure, etc.).
const PLACE_CATEGORIES = [
  'commercial',
  'healthcare',
  'catering',
  'education',
  'leisure',
  'entertainment',
  'accommodation',
  'service',
  'public_transport',
  'tourism',
  'activity',
  'office',
  'sport',
  'parking',
  'airport',
];

interface GeoapifyGeocodeItem {
  place_id?: string;
  name?: string;
  formatted?: string;
  address_line1?: string;
  address_line2?: string;
  lat?: number;
  lon?: number;
}

interface GeoapifyGeocodeResponse {
  results?: GeoapifyGeocodeItem[];
  message?: string;
}

interface GeoapifyPlaceFeature {
  id?: string;
  geometry?: { coordinates?: number[] };
  properties?: {
    place_id?: string;
    name?: string;
    formatted?: string;
    address_line1?: string;
    address_line2?: string;
    lat?: number;
    lon?: number;
  };
}

interface GeoapifyPlacesResponse {
  features?: GeoapifyPlaceFeature[];
  message?: string;
}

const normalizeCoordinate = (
  id: string,
  name: string | undefined,
  address: string | undefined,
  longitude: number | undefined,
  latitude: number | undefined,
): SearchResult | null => {
  if (
    !name ||
    typeof longitude !== 'number' ||
    typeof latitude !== 'number' ||
    !Number.isFinite(longitude) ||
    !Number.isFinite(latitude) ||
    longitude < -180 ||
    longitude > 180 ||
    latitude < -90 ||
    latitude > 90
  ) {
    return null;
  }

  return {
    id,
    name,
    address: address ?? '',
    coordinate: [longitude, latitude] as Position,
  };
};

const normalizeGeocoding = (
  items: GeoapifyGeocodeItem[],
): SearchResult[] =>
  items
    .map((item, index) =>
      normalizeCoordinate(
        item.place_id ?? `geoapify-geocode-${index}`,
        item.name ?? item.address_line1 ?? item.formatted,
        item.formatted ??
        [item.address_line1, item.address_line2].filter(Boolean).join(', '),
        item.lon,
        item.lat,
      ),
    )
    .filter((item): item is SearchResult => item !== null);

const normalizePlaces = (
  features: GeoapifyPlaceFeature[],
): SearchResult[] =>
  features
    .map((feature, index) => {
      const properties = feature.properties ?? {};
      const coordinates = feature.geometry?.coordinates;
      return normalizeCoordinate(
        properties.place_id ??
        feature.id ??
        `geoapify-place-${index}`,
        properties.name,
        properties.formatted ??
        [properties.address_line1, properties.address_line2]
          .filter(Boolean)
          .join(', '),
        typeof properties.lon === 'number'
          ? properties.lon
          : coordinates?.[0],
        typeof properties.lat === 'number'
          ? properties.lat
          : coordinates?.[1],
      );
    })
    .filter((item): item is SearchResult => item !== null);

const fetchJson = async <T>(
  url: string,
  signal?: AbortSignal,
): Promise<T> => {
  if (signal?.aborted) {
    throw new Error('Search cancelled.');
  }

  const controller = new AbortController();
  let timedOut = false;
  const abortFromParent = () => controller.abort();
  signal?.addEventListener('abort', abortFromParent);

  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });

    if (!response.ok) {
      let detail = '';
      try {
        const body = (await response.json()) as { message?: string };
        detail = body.message ?? '';
      } catch {
        // Some error responses are not JSON.
      }
      throw new Error(
        `Geoapify returned HTTP ${response.status}${detail ? `: ${detail}` : ''}.`,
      );
    }

    return (await response.json()) as T;
  } catch (error) {
    if (signal?.aborted) {
      throw new Error('Search cancelled.');
    }
    if (timedOut) {
      throw new Error('Geoapify search timed out. Please try again.');
    }
    throw error instanceof Error
      ? error
      : new Error('Unable to connect to Geoapify.');
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abortFromParent);
  }
};

const buildSpatialFilter = (
  filter: string,
): string => filter;

const searchGeoapify = async (
  searchText: string,
  spatialFilter: string,
  signal?: AbortSignal,
): Promise<SearchResult[]> => {
  if (!GEOAPIFY_API_KEY) {
    throw new Error(
      'Geoapify API key is missing. Check GEOAPIFY_API_KEY in your .env file.',
    );
  }

  const query = searchText.trim();
  if (query.length < 3) return [];

  const common = `&filter=${encodeURIComponent(
    buildSpatialFilter(spatialFilter),
  )}&limit=${MAX_RESULTS}&lang=en&apiKey=${encodeURIComponent(
    GEOAPIFY_API_KEY,
  )}`;

  // Geocoding supports free-form place/amenity names. Places API complements
  // it with indexed POIs that have Geoapify place categories.
  const geocodingUrl =
    `${GEOAPIFY_GEOCODING_URL}?text=${encodeURIComponent(query)}` +
    `&format=json${common}`;

  const placesParams = new URLSearchParams({
    categories: PLACE_CATEGORIES.join(','),
    name: query,
    filter: spatialFilter,
    limit: String(MAX_RESULTS),
    lang: 'en',
    apiKey: GEOAPIFY_API_KEY,
  });

  const placesUrl = `${GEOAPIFY_PLACES_URL}?${placesParams.toString()}`;

  // Run both providers in parallel so one slow endpoint does not delay the
  // other. Each request is independently cancellable through the parent.
  const [geocodeOutcome, placesOutcome] = await Promise.allSettled([
    fetchJson<GeoapifyGeocodeResponse>(geocodingUrl, signal),
    fetchJson<GeoapifyPlacesResponse>(placesUrl, signal),
  ]);

  if (signal?.aborted) {
    throw new Error('Search cancelled.');
  }

  const geocodeResults =
    geocodeOutcome.status === 'fulfilled'
      ? normalizeGeocoding(geocodeOutcome.value.results ?? [])
      : [];

  const placesResults =
    placesOutcome.status === 'fulfilled'
      ? normalizePlaces(placesOutcome.value.features ?? [])
      : [];

  const merged = new Map<string, SearchResult>();
  for (const result of [...geocodeResults, ...placesResults]) {
    merged.set(result.id, result);
  }

  if (merged.size > 0) {
    return Array.from(merged.values()).slice(0, MAX_RESULTS);
  }

  if (
    geocodeOutcome.status === 'rejected' &&
    placesOutcome.status === 'rejected'
  ) {
    const firstError = geocodeOutcome.reason;
    throw firstError instanceof Error
      ? firstError
      : new Error('Both Geoapify search requests failed.');
  }

  return [];
};

export const searchNearbyPlaces = async (
  searchText: string,
  coordinate: Position,
  radius = 5000,
  signal?: AbortSignal,
): Promise<SearchResult[]> => {
  const [longitude, latitude] = coordinate;

  if (
    !Number.isFinite(longitude) ||
    !Number.isFinite(latitude) ||
    longitude < -180 ||
    longitude > 180 ||
    latitude < -90 ||
    latitude > 90
  ) {
    throw new Error('Invalid GPS coordinates for place search.');
  }

  if (!Number.isFinite(radius) || radius <= 0) {
    throw new Error('Invalid GPS search radius.');
  }

  return searchGeoapify(
    searchText,
    `circle:${longitude},${latitude},${radius}`,
    signal,
  );
};

export const searchPlacesInBounds = async (
  searchText: string,
  bounds: SearchBounds,
  signal?: AbortSignal,
): Promise<SearchResult[]> => {
  const { south, west, north, east } = bounds;

  const validBounds =
    Number.isFinite(south) &&
    Number.isFinite(west) &&
    Number.isFinite(north) &&
    Number.isFinite(east) &&
    south >= -90 &&
    north <= 90 &&
    west >= -180 &&
    east <= 180 &&
    south < north &&
    west < east;

  if (!validBounds) {
    throw new Error('Invalid visible map boundaries for place search.');
  }

  return searchGeoapify(
    searchText,
    `rect:${west},${south},${east},${north}`,
    signal,
  );
};
