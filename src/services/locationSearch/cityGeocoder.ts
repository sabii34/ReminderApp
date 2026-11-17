import type {
  CitySearchResult,
  SearchBounds,
} from './locationSearchTypes';

import { GEOAPIFY_API_KEY } from '@src/constants/config';

interface GeoapifyResult {
  place_id?: string;
  formatted?: string;
  city?: string;
  state?: string;
  country?: string;
  lat?: number;
  lon?: number;
  bbox?: {
    lon1?: number;
    lat1?: number;
    lon2?: number;
    lat2?: number;
  };
}

interface GeoapifyResponse {
  results?: GeoapifyResult[];
}

export const searchCities = async (
  searchText: string,
  signal?: AbortSignal,
): Promise<CitySearchResult[]> => {
  if (!GEOAPIFY_API_KEY) {
    throw new Error('Geoapify API key is missing.');
  }

  const query = searchText.trim();

  if (query.length < 3) {
    return [];
  }

  const params = [
    `text=${encodeURIComponent(query)}`,
    'type=city',
    'format=json',
    'limit=5',
    'lang=en',
    `apiKey=${encodeURIComponent(GEOAPIFY_API_KEY)}`,
  ];

  const response = await fetch(
    `https://api.geoapify.com/v1/geocode/search?${params.join('&')}`,
    { signal },
  );

  if (!response.ok) {
    throw new Error(`City search failed: ${response.status}`);
  }

  const data: GeoapifyResponse = await response.json();

  return (data.results ?? [])
    .filter(
      result =>
        typeof result.lat === 'number' &&
        typeof result.lon === 'number',
    )
    .map((result, index) => {
      let bounds: SearchBounds | undefined;

      if (
        result.bbox &&
        typeof result.bbox.lon1 === 'number' &&
        typeof result.bbox.lat1 === 'number' &&
        typeof result.bbox.lon2 === 'number' &&
        typeof result.bbox.lat2 === 'number'
      ) {
        bounds = {
          west: result.bbox.lon1,
          south: result.bbox.lat1,
          east: result.bbox.lon2,
          north: result.bbox.lat2,
        };
      }

      return {
        id: result.place_id ?? `city-${index}`,
        name: result.city ?? query,
        address: result.formatted ?? [
          result.state,
          result.country,
        ]
          .filter(Boolean)
          .join(', '),
        coordinate: [result.lon!, result.lat!],
        bounds,
      };
    });
};