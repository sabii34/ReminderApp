import type { Position } from 'geojson';
import type { SearchBounds, SearchResult } from './locationSearchTypes';
import { GEOAPIFY_API_KEY } from '@src/constants/config';

/**
 * Geoapify Places is the primary POI search provider.
 * Overpass remains as a fallback if Geoapify fails or returns no matches.
 *
 * The exported function names are intentionally unchanged so
 * ReminderFormSheet.tsx does not need to be modified.
 */

const GEOAPIFY_PLACES_URL = 'https://api.geoapify.com/v2/places';

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
] as const;

const MAX_RESULTS = 20;
const GEOAPIFY_TIMEOUT = 8000;
const OVERPASS_TIMEOUT = 10000;

const GEOAPIFY_CATEGORIES = [
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
] as const;

interface GeoapifyFeature {
  type?: string;
  id?: string;
  geometry?: {
    type?: string;
    coordinates?: number[];
  };
  properties?: {
    name?: string;
    formatted?: string;
    address_line1?: string;
    address_line2?: string;
    lat?: number;
    lon?: number;
    place_id?: string;
  };
}

interface GeoapifyResponse {
  features?: GeoapifyFeature[];
}

interface OsmElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: {
    lat: number;
    lon: number;
  };
  tags?: Record<string, string>;
}

interface OverpassResponse {
  elements?: OsmElement[];
}

const createAbortController = (
  parentSignal: AbortSignal | undefined,
  timeoutMs: number,
) => {
  const controller = new AbortController();
  let timedOut = false;

  const abortFromParent = () => controller.abort();
  parentSignal?.addEventListener('abort', abortFromParent);

  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  return {
    controller,
    timedOut: () => timedOut,
    cleanup: () => {
      clearTimeout(timeout);
      parentSignal?.removeEventListener('abort', abortFromParent);
    },
  };
};

const normalizeGeoapifyFeatures = (
  features: GeoapifyFeature[],
): SearchResult[] => {
  const results = features
    .map((feature, index) => {
      const properties = feature.properties ?? {};
      const coordinates = feature.geometry?.coordinates;

      const longitude =
        typeof properties.lon === 'number'
          ? properties.lon
          : coordinates?.[0];

      const latitude =
        typeof properties.lat === 'number'
          ? properties.lat
          : coordinates?.[1];

      if (
        !properties.name ||
        typeof longitude !== 'number' ||
        typeof latitude !== 'number' ||
        !Number.isFinite(longitude) ||
        !Number.isFinite(latitude)
      ) {
        return null;
      }

      const address =
        properties.formatted ??
        [
          properties.address_line1,
          properties.address_line2,
        ]
          .filter(Boolean)
          .join(', ');

      return {
        id:
          properties.place_id ??
          feature.id ??
          `geoapify-${index}-${longitude}-${latitude}`,
        name: properties.name,
        address: address ?? '',
        coordinate: [longitude, latitude] as Position,
      };
    })
    .filter((item): item is SearchResult => item !== null);

  return Array.from(
    new Map(results.map(item => [item.id, item])).values(),
  );
};

const searchGeoapify = async (
  searchText: string,
  spatialFilter: string,
  signal?: AbortSignal,
): Promise<SearchResult[]> => {
  if (!GEOAPIFY_API_KEY) {
    throw new Error('Geoapify API key is missing.');
  }

  const params = [
    `categories=${encodeURIComponent(GEOAPIFY_CATEGORIES.join(','))}`,
    `name=${encodeURIComponent(searchText.trim())}`,
    `filter=${encodeURIComponent(spatialFilter)}`,
    `limit=${MAX_RESULTS}`,
    'lang=en',
    `apiKey=${encodeURIComponent(GEOAPIFY_API_KEY)}`,
  ];

  const request = createAbortController(signal, GEOAPIFY_TIMEOUT);

  try {
    const response = await fetch(
      `${GEOAPIFY_PLACES_URL}?${params.join('&')}`,
      {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: request.controller.signal,
      },
    );

    if (!response.ok) {
      throw new Error(`Geoapify Places returned HTTP ${response.status}.`);
    }

    const data = (await response.json()) as GeoapifyResponse;
    return normalizeGeoapifyFeatures(data.features ?? []);
  } catch (error) {
    if (signal?.aborted) {
      throw new Error('Search cancelled.');
    }

    if (request.timedOut()) {
      throw new Error('Geoapify Places request timed out.');
    }

    throw error;
  } finally {
    request.cleanup();
  }
};

const escapeOverpassRegex = (value: string): string =>
  value
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');

const getAddress = (tags: Record<string, string>): string => {
  if (tags['addr:full']) {
    return tags['addr:full'];
  }

  return [
    tags['addr:housenumber'],
    tags['addr:street'],
    tags['addr:suburb'],
    tags['addr:city'],
    tags['addr:country'],
  ]
    .filter(Boolean)
    .join(', ');
};

const normalizeOverpassElements = (
  elements: OsmElement[],
): SearchResult[] => {
  const results = elements
    .map(element => {
      const tags = element.tags ?? {};
      const latitude = element.center?.lat ?? element.lat;
      const longitude = element.center?.lon ?? element.lon;

      if (
        !tags.name ||
        typeof latitude !== 'number' ||
        typeof longitude !== 'number' ||
        !Number.isFinite(latitude) ||
        !Number.isFinite(longitude)
      ) {
        return null;
      }

      return {
        id: `osm-${element.type}-${element.id}`,
        name: tags.name,
        address: getAddress(tags),
        coordinate: [longitude, latitude] as Position,
      };
    })
    .filter((item): item is SearchResult => item !== null);

  return Array.from(
    new Map(results.map(item => [item.id, item])).values(),
  );
};

const executeOverpassFallback = async (
  query: string,
  signal?: AbortSignal,
): Promise<SearchResult[]> => {
  let lastError: unknown;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    if (signal?.aborted) {
      throw new Error('Search cancelled.');
    }

    const request = createAbortController(signal, OVERPASS_TIMEOUT);

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: request.controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Overpass returned HTTP ${response.status}.`);
      }

      const data = (await response.json()) as OverpassResponse;
      return normalizeOverpassElements(data.elements ?? []);
    } catch (error) {
      if (signal?.aborted) {
        throw new Error('Search cancelled.');
      }

      lastError = request.timedOut()
        ? new Error(`Overpass timed out at ${endpoint}.`)
        : error;
    } finally {
      request.cleanup();
    }
  }

  const detail =
    lastError instanceof Error ? lastError.message : 'Unknown Overpass error';

  throw new Error(`Overpass fallback failed: ${detail}`);
};

const runSearch = async (
  searchText: string,
  geoapifyFilter: string,
  overpassQuery: string,
  signal?: AbortSignal,
): Promise<SearchResult[]> => {
  const queryText = searchText.trim();

  if (queryText.length < 3) {
    return [];
  }

  if (signal?.aborted) {
    throw new Error('Search cancelled.');
  }

  // Fast path: Geoapify is tried first and normally completes in one request.
  try {
    const geoapifyResults = await searchGeoapify(
      queryText,
      geoapifyFilter,
      signal,
    );

    if (geoapifyResults.length > 0) {
      return geoapifyResults;
    }
  } catch (error) {
    if (signal?.aborted) {
      throw new Error('Search cancelled.');
    }
    // Continue to Overpass only when Geoapify fails.
  }

  if (signal?.aborted) {
    throw new Error('Search cancelled.');
  }

  // Overpass is a secondary fallback; it does not delay successful Geoapify results.
  return executeOverpassFallback(overpassQuery, signal);
};

export const searchNearbyPlaces = async (
  searchText: string,
  coordinate: Position,
  radius = 5000,
  signal?: AbortSignal,
): Promise<SearchResult[]> => {
  const queryText = searchText.trim();

  if (queryText.length < 3) {
    return [];
  }

  const [longitude, latitude] = coordinate;

  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    throw new Error('Invalid GPS coordinates for place search.');
  }

  const safeQueryText = escapeOverpassRegex(queryText);

  const overpassQuery = `
    [out:json][timeout:15];
    (
      nwr(around:${radius},${latitude},${longitude})["name"~"${safeQueryText}",i];
    );
    out center tags ${MAX_RESULTS};
  `;

  return runSearch(
    queryText,
    `circle:${longitude},${latitude},${radius}`,
    overpassQuery,
    signal,
  );
};

export const searchPlacesInBounds = async (
  searchText: string,
  bounds: SearchBounds,
  signal?: AbortSignal,
): Promise<SearchResult[]> => {
  const queryText = searchText.trim();

  if (queryText.length < 3) {
    return [];
  }

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
    throw new Error('Invalid map search boundaries.');
  }

  const safeQueryText = escapeOverpassRegex(queryText);

  const overpassQuery = `
    [out:json][timeout:15];
    (
      nwr(${south},${west},${north},${east})["name"~"${safeQueryText}",i];
    );
    out center tags ${MAX_RESULTS};
  `;

  return runSearch(
    queryText,
    `rect:${west},${south},${east},${north}`,
    overpassQuery,
    signal,
  );
};
