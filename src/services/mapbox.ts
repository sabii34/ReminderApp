
import Mapbox from '@rnmapbox/maps';

import { MAPBOX_ACCESS_TOKEN } from '@src/constants/config';

export const initMapbox = () => {
  const token = MAPBOX_ACCESS_TOKEN?.trim();

  if (!token || !token.startsWith('pk.')) {
    throw new Error(
      'Mapbox public access token is missing or invalid. ' +
        'Check the MAPBOX_ACCESS_TOKEN variable in the root .env file.',
    );
  }

  Mapbox.setAccessToken(token);
};
