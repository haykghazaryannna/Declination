// Serves the whole Declination API (all /api/* routes) from one function.
import { handle } from '../../src/app.js';

export default (req, context) => handle(req, context);

export const config = {
  path: '/api/*',
};
