import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '..', '..', '..', '.env') });

import { app } from './app';
import './worker';

const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`[API] Server is running on port ${port}`);
});
