import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { webServerOptions } from '../../scripts/web-server.mjs';

it('keeps the default Web origin and permits a separate port and build without changing them', () => {
  expect(webServerOptions({})).toEqual({ port: 3100, directory: resolve('apps/mobile/dist') });
  expect(webServerOptions({ SOLVEFLOW_WEB_PORT: '3102', SOLVEFLOW_WEB_DIR: '.runtime/question-only/web' })).toEqual({ port: 3102, directory: resolve('.runtime/question-only/web') });
});
it('rejects invalid ports and empty directories before starting a listener or loading model credentials', () => {
  for (const port of ['', '0', '1023', '65536', '-1', '3102.5', '3e3', '0xc1e', '3102 ', 'invalid']) expect(() => webServerOptions({ SOLVEFLOW_WEB_PORT: port })).toThrow('INVALID_WEB_PORT');
  expect(() => webServerOptions({ SOLVEFLOW_WEB_DIR: '  ' })).toThrow('INVALID_WEB_DIRECTORY');
});
