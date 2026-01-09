import { worker } from './worker/modbus-worker';
import { logger } from './lib/logger';

logger.info('============================================');
logger.info('OEE Modbus Worker Starting... 12/12/20-11:08');
logger.info('============================================');

// Start the worker
await worker.start();