import { describe, expect, it, vi } from 'vitest';

import { bootstrap } from '../src/app/bootstrap.js';

describe('bootstrap agent registration', () => {
  it('registers claude, codex, and gemini adapters', async () => {
    const logger = { info: vi.fn(), error: vi.fn() };

    const app = await bootstrap({
      env: {
        DISCORD_TOKEN: 'token',
        DISCORD_CLIENT_ID: 'client',
        DATA_DIR: '.data/test-bootstrap-agents',
        LOG_LEVEL: 'info',
      },
      logger,
    });

    expect(app.agents.listKinds().sort()).toEqual(['claude', 'codex', 'gemini']);
    expect(app.agents.get('claude')).toBeDefined();
    expect(app.agents.get('codex')).toBeDefined();
    expect(app.agents.get('gemini')).toBeDefined();
  });
});
