import { createAwsDependencies } from './aws';
import { createIngestHandler } from './handler';

export const handler = createIngestHandler(createAwsDependencies());
