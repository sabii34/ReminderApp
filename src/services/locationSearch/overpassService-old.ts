import type { Position } from 'geojson';
import type { SearchBounds, SearchResult } from './locationSearchTypes';

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
] as const;

const MAX_RESULTS = 30;
const REQUEST_TIMEOUT = 20000;

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

/**
 * Escape user input before placing it inside an Overpass regular expression.
 * This keeps punctuation in a search term from changing the regex.
 */
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

const normalizeElements = (elements: OsmElement[]): SearchResult[] => {
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

const executeQueryOnEndpoint = async (
  endpoint: string,
  query: string,
  signal?: AbortSignal,
): Promise<SearchResult[]> => {
  if (signal?.aborted) {
    throw new Error('Search cancelled.');
  }

  const controller = new AbortController();
  let timedOut = false;

  const abortRequest = () => controller.abort();

  signal?.addEventListener('abort', abortRequest);

  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: `data=${encodeURIComponent(query)}`,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Overpass returned HTTP ${response.status}.`);
    }

    const data = (await response.json()) as OverpassResponse;
    return normalizeElements(data.elements ?? []);
  } catch (error) {
    // A change of search text or unmount cancels the request. Do not
    // start another endpoint for a request the user has cancelled.
    if (signal?.aborted) {
      throw new Error('Search cancelled.');
    }

    if (timedOut) {
      throw new Error(`Request timed out at ${endpoint}.`);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abortRequest);
  }
};

/**
 * Try the configured Overpass servers in order. If one server is overloaded
 * or unreachable, automatically try the next server with the same query.
 */
const executeQuery = async (
  query: string,
  signal?: AbortSignal,
): Promise<SearchResult[]> => {
  let lastError: unknown;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    if (signal?.aborted) {
      throw new Error('Search cancelled.');
    }

    try {
      return await executeQueryOnEndpoint(endpoint, query, signal);
    } catch (error) {
      if (signal?.aborted) {
        throw new Error('Search cancelled.');
      }

      lastError = error;
      // Continue to the backup endpoint for network errors, timeouts,
      // server errors (including 429/502/503/504), or invalid responses.
    }
  }

  const detail =
    lastError instanceof Error ? lastError.message : 'Unknown network error';

  throw new Error(
    `Place search failed on both Overpass servers. Last error: ${detail}`,
  );
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

  const query = `
    [out:json][timeout:20];
    (
      nwr(around:${radius},${latitude},${longitude})["name"~"${safeQueryText}",i];
    );
    out center tags ${MAX_RESULTS};
  `;

  return executeQuery(query, signal);
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

  const query = `
    [out:json][timeout:20];
    (
      nwr(${south},${west},${north},${east})["name"~"${safeQueryText}",i];
    );
    out center tags ${MAX_RESULTS};
  `;

  return executeQuery(query, signal);
};
