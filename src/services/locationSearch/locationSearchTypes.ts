import type { Position } from 'geojson';

export interface SearchResult {
  id: string;
  name: string;
  address: string;
  coordinate: Position;
}

export interface SearchBounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

export interface CitySearchResult {
  id: string;
  name: string;
  address: string;
  coordinate: Position;
  bounds?: SearchBounds;
}