import {
  MAPBOX_ACCESS_TOKEN as ENV_MAPBOX_ACCESS_TOKEN,
  GEOAPIFY_API_KEY as ENV_GEOAPIFY_API_KEY,
} from '@env';

/**
 * Mapbox public access token.
 */
export const MAPBOX_ACCESS_TOKEN = ENV_MAPBOX_ACCESS_TOKEN;

/**
 * Geoapify API key for city and area geocoding.
 */
export const GEOAPIFY_API_KEY = ENV_GEOAPIFY_API_KEY;

export const MapConfig = {
  userZoomLevel: 15,
  defaultZoomLevel: 1,
  animationDuration: 800,
};