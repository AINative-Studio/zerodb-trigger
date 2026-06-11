/**
 * zerodb-trigger unit tests.
 *
 * All HTTP calls are mocked via globalThis.fetch — no real API calls.
 */

const { ZeroDBTrigger, SUPPORTED_TRIGGERS, createTrigger } = require('../index.cjs');

// ---------------------------------------------------------------------------
// Mock fetch
// ---------------------------------------------------------------------------

const mockResponses = [];

function pushMock(status, body, contentType = 'application/json') {
  mockResponses.push({ status, body, contentType });
}

function createMockFetch() {
  return jest.fn(async (url, opts) => {
    const mock = mockResponses.shift();
    if (!mock) throw new Error(`Unexpected fetch call: ${url}`);

    return {
      ok: mock.status >= 200 && mock.status < 300,
      status: mock.status,
      headers: {
        get: (name) => {
          if (name === 'content-type') return mock.contentType;
          return null;
        },
      },
      json: async () => (typeof mock.body === 'string' ? JSON.parse(mock.body) : mock.body),
      text: async () => (typeof mock.body === 'string' ? mock.body : JSON.stringify(mock.body)),
    };
  });
}

beforeEach(() => {
  mockResponses.length = 0;
  globalThis.fetch = createMockFetch();
});

afterEach(() => {
  delete globalThis.fetch;
});

// ---------------------------------------------------------------------------
// Constructor
// ---------------------------------------------------------------------------

describe('ZeroDBTrigger constructor', () => {
  test('uses provided credentials', () => {
    const t = new ZeroDBTrigger({ apiKey: 'key-1', projectId: 'proj-1', silent: true });
    expect(t._apiKey).toBe('key-1');
    expect(t._projectId).toBe('proj-1');
    expect(t._provisioned).toBe(true);
  });

  test('reads from environment variables', () => {
    process.env.ZERODB_API_KEY = 'env-key';
    process.env.ZERODB_PROJECT_ID = 'env-proj';

    const t = new ZeroDBTrigger({ silent: true });
    expect(t._apiKey).toBe('env-key');
    expect(t._projectId).toBe('env-proj');

    delete process.env.ZERODB_API_KEY;
    delete process.env.ZERODB_PROJECT_ID;
  });

  test('reads TRIGGER_API_KEY for compat', () => {
    process.env.TRIGGER_API_KEY = 'trig-key';
    process.env.TRIGGER_PROJECT_ID = 'trig-proj';

    const t = new ZeroDBTrigger({ silent: true });
    expect(t._apiKey).toBe('trig-key');
    expect(t._projectId).toBe('trig-proj');

    delete process.env.TRIGGER_API_KEY;
    delete process.env.TRIGGER_PROJECT_ID;
  });

  test('not provisioned when no credentials', () => {
    const t = new ZeroDBTrigger({ silent: true });
    expect(t._provisioned).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// createTrigger factory
// ---------------------------------------------------------------------------

describe('createTrigger', () => {
  test('returns ZeroDBTrigger instance', () => {
    const t = createTrigger({ apiKey: 'k', projectId: 'p', silent: true });
    expect(t).toBeInstanceOf(ZeroDBTrigger);
  });
});

// ---------------------------------------------------------------------------
// SUPPORTED_TRIGGERS
// ---------------------------------------------------------------------------

describe('SUPPORTED_TRIGGERS', () => {
  test('contains 5 trigger types', () => {
    expect(SUPPORTED_TRIGGERS).toHaveLength(5);
    expect(SUPPORTED_TRIGGERS).toContain('zerodb.vector.stored');
    expect(SUPPORTED_TRIGGERS).toContain('zerodb.memory.stored');
    expect(SUPPORTED_TRIGGERS).toContain('zerodb.file.uploaded');
    expect(SUPPORTED_TRIGGERS).toContain('zerodb.table.row_inserted');
    expect(SUPPORTED_TRIGGERS).toContain('zerodb.event.published');
  });
});

// ---------------------------------------------------------------------------
// defineJob
// ---------------------------------------------------------------------------

describe('defineJob', () => {
  test('registers a job', () => {
    const t = new ZeroDBTrigger({ apiKey: 'k', projectId: 'p', silent: true });
    const job = t.defineJob({
      id: 'test-job',
      name: 'Test Job',
      trigger: 'zerodb.file.uploaded',
      run: async () => ({ done: true }),
    });

    expect(job.id).toBe('test-job');
    expect(job.name).toBe('Test Job');
    expect(job.trigger).toBe('zerodb.file.uploaded');
    expect(job.enabled).toBe(true);
  });

  test('throws on missing id', () => {
    const t = new ZeroDBTrigger({ apiKey: 'k', projectId: 'p', silent: true });
    expect(() => t.defineJob({ trigger: 'zerodb.file.uploaded', run: async () => {} })).toThrow('Job id is required');
  });

  test('throws on missing trigger', () => {
    const t = new ZeroDBTrigger({ apiKey: 'k', projectId: 'p', silent: true });
    expect(() => t.defineJob({ id: 'j', run: async () => {} })).toThrow('Job trigger is required');
  });

  test('throws on missing run function', () => {
    const t = new ZeroDBTrigger({ apiKey: 'k', projectId: 'p', silent: true });
    expect(() => t.defineJob({ id: 'j', trigger: 'zerodb.file.uploaded' })).toThrow('Job run must be a function');
  });

  test('throws on unsupported trigger', () => {
    const t = new ZeroDBTrigger({ apiKey: 'k', projectId: 'p', silent: true });
    expect(() => t.defineJob({ id: 'j', trigger: 'invalid.trigger', run: async () => {} })).toThrow('Unsupported trigger');
  });

  test('allows custom.* triggers', () => {
    const t = new ZeroDBTrigger({ apiKey: 'k', projectId: 'p', silent: true });
    const job = t.defineJob({
      id: 'custom-job',
      trigger: 'custom.my-event',
      run: async () => {},
    });
    expect(job.trigger).toBe('custom.my-event');
  });

  test('defaults version to 1.0.0', () => {
    const t = new ZeroDBTrigger({ apiKey: 'k', projectId: 'p', silent: true });
    const job = t.defineJob({ id: 'j', trigger: 'zerodb.file.uploaded', run: async () => {} });
    expect(job.version).toBe('1.0.0');
  });
});

// ---------------------------------------------------------------------------
// on() shorthand
// ---------------------------------------------------------------------------

describe('on()', () => {
  test('registers a listener job', () => {
    const t = new ZeroDBTrigger({ apiKey: 'k', projectId: 'p', silent: true });
    const job = t.on('zerodb.file.uploaded', async () => {});
    expect(job.trigger).toBe('zerodb.file.uploaded');
    expect(job.id).toMatch(/^on_zerodb\.file\.uploaded_/);
  });
});

// ---------------------------------------------------------------------------
// Auto-provisioning
// ---------------------------------------------------------------------------

describe('auto-provisioning', () => {
  test('provisions on first emit', async () => {
    pushMock(200, { project_id: 'auto-proj', api_key: 'auto-key', claim_url: 'https://zerodb.ai/claim/x' });
    pushMock(200, { event_id: 'ev-1' });

    const t = new ZeroDBTrigger({ silent: true });
    await t.emit('zerodb.event.published', { test: true });

    expect(t._projectId).toBe('auto-proj');
    expect(t._apiKey).toBe('auto-key');
    expect(t._provisioned).toBe(true);
  });

  test('skips provisioning with existing credentials', async () => {
    pushMock(200, { event_id: 'ev-2' });

    const t = new ZeroDBTrigger({ apiKey: 'k', projectId: 'p', silent: true });
    await t.emit('zerodb.event.published', {});

    expect(globalThis.fetch).toHaveBeenCalledTimes(1); // only the event POST
  });
});

// ---------------------------------------------------------------------------
// emit + dispatch
// ---------------------------------------------------------------------------

describe('emit', () => {
  test('publishes event and dispatches to listeners', async () => {
    pushMock(200, { event_id: 'ev-3' });

    const results = [];
    const t = new ZeroDBTrigger({ apiKey: 'k', projectId: 'p', silent: true });
    t.defineJob({
      id: 'listener-1',
      trigger: 'zerodb.file.uploaded',
      run: async (event) => {
        results.push(event.data);
        return 'ok';
      },
    });

    const emitResult = await t.emit('zerodb.file.uploaded', { file: 'photo.jpg' });
    expect(emitResult.id).toBe('ev-3');
    expect(results).toHaveLength(1);
    expect(results[0].file).toBe('photo.jpg');
  });

  test('handles job errors gracefully', async () => {
    pushMock(200, { event_id: 'ev-4' });

    const t = new ZeroDBTrigger({ apiKey: 'k', projectId: 'p', silent: true });
    t.defineJob({
      id: 'broken-job',
      trigger: 'zerodb.file.uploaded',
      run: async () => { throw new Error('boom'); },
    });

    // Should not throw
    const result = await t.emit('zerodb.file.uploaded', {});
    expect(result.id).toBe('ev-4');
  });
});

// ---------------------------------------------------------------------------
// registerHook / listHooks / removeHook
// ---------------------------------------------------------------------------

describe('hooks', () => {
  test('registerHook sends POST', async () => {
    pushMock(200, { hook_id: 'hook-1' });

    const t = new ZeroDBTrigger({ apiKey: 'k', projectId: 'p', silent: true });
    const result = await t.registerHook('zerodb.file.uploaded', 'https://example.com/webhook');

    expect(result.hookId).toBe('hook-1');
    expect(result.triggerName).toBe('zerodb.file.uploaded');
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  test('listHooks returns array', async () => {
    pushMock(200, [{ hook_id: 'h1', event_type: 'zerodb.file.uploaded' }]);

    const t = new ZeroDBTrigger({ apiKey: 'k', projectId: 'p', silent: true });
    const hooks = await t.listHooks();

    expect(hooks).toHaveLength(1);
    expect(hooks[0].hook_id).toBe('h1');
  });

  test('removeHook sends DELETE', async () => {
    pushMock(200, { deleted: true });

    const t = new ZeroDBTrigger({ apiKey: 'k', projectId: 'p', silent: true });
    const result = await t.removeHook('hook-1');

    expect(result.deleted).toBe(true);
    expect(result.hookId).toBe('hook-1');
  });
});

// ---------------------------------------------------------------------------
// handleWebhook
// ---------------------------------------------------------------------------

describe('handleWebhook', () => {
  test('dispatches to matching jobs', async () => {
    const captured = [];
    const t = new ZeroDBTrigger({ apiKey: 'k', projectId: 'p', silent: true });
    t.defineJob({
      id: 'webhook-handler',
      trigger: 'zerodb.vector.stored',
      run: async (event) => { captured.push(event); return 'handled'; },
    });

    const results = await t.handleWebhook({
      event_type: 'zerodb.vector.stored',
      data: { vector_id: 'v-1' },
    });

    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(true);
    expect(captured[0].data.vector_id).toBe('v-1');
  });

  test('throws on missing event_type', async () => {
    const t = new ZeroDBTrigger({ apiKey: 'k', projectId: 'p', silent: true });
    await expect(t.handleWebhook({})).rejects.toThrow('missing event_type');
  });
});

// ---------------------------------------------------------------------------
// getJobs / getJob / enable / disable
// ---------------------------------------------------------------------------

describe('job management', () => {
  test('getJobs returns all jobs', () => {
    const t = new ZeroDBTrigger({ apiKey: 'k', projectId: 'p', silent: true });
    t.defineJob({ id: 'a', trigger: 'zerodb.file.uploaded', run: async () => {} });
    t.defineJob({ id: 'b', trigger: 'zerodb.memory.stored', run: async () => {} });

    const jobs = t.getJobs();
    expect(jobs).toHaveLength(2);
    expect(jobs[0].id).toBe('a');
    expect(jobs[1].id).toBe('b');
  });

  test('getJob returns single job', () => {
    const t = new ZeroDBTrigger({ apiKey: 'k', projectId: 'p', silent: true });
    t.defineJob({ id: 'x', trigger: 'zerodb.file.uploaded', run: async () => {} });

    expect(t.getJob('x').id).toBe('x');
    expect(t.getJob('nonexistent')).toBeNull();
  });

  test('disableJob / enableJob', async () => {
    pushMock(200, { event_id: 'ev-5' });

    const results = [];
    const t = new ZeroDBTrigger({ apiKey: 'k', projectId: 'p', silent: true });
    t.defineJob({
      id: 'toggle-job',
      trigger: 'zerodb.file.uploaded',
      run: async () => { results.push('ran'); },
    });

    t.disableJob('toggle-job');
    expect(t.getJob('toggle-job').enabled).toBe(false);

    await t.emit('zerodb.file.uploaded', {});
    expect(results).toHaveLength(0); // disabled, should not run

    t.enableJob('toggle-job');
    expect(t.getJob('toggle-job').enabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe('error handling', () => {
  test('API errors include status code', async () => {
    pushMock(403, { error: 'Forbidden' });

    const t = new ZeroDBTrigger({ apiKey: 'bad', projectId: 'p', silent: true });
    await expect(t.registerHook('zerodb.file.uploaded', 'https://x.com')).rejects.toThrow('ZeroDB API error 403');
  });
});

// ---------------------------------------------------------------------------
// IO helper
// ---------------------------------------------------------------------------

describe('IO helper in run()', () => {
  test('provides logger and runTask', async () => {
    pushMock(200, { event_id: 'ev-io' });

    let ioRef;
    const t = new ZeroDBTrigger({ apiKey: 'k', projectId: 'p', silent: true });
    t.defineJob({
      id: 'io-test',
      trigger: 'zerodb.file.uploaded',
      run: async (event, io) => {
        ioRef = io;
        const taskResult = await io.runTask('my-task', () => 42);
        return taskResult;
      },
    });

    await t.emit('zerodb.file.uploaded', {});
    expect(ioRef).toBeDefined();
    expect(typeof ioRef.logger.info).toBe('function');
    expect(typeof ioRef.logger.warn).toBe('function');
    expect(typeof ioRef.logger.error).toBe('function');
    expect(typeof ioRef.runTask).toBe('function');
    expect(typeof ioRef.wait).toBe('function');
  });
});
