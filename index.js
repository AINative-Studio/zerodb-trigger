/**
 * zerodb-trigger — Drop-in Trigger.dev replacement with ZeroDB event hooks.
 *
 * Zero config: auto-provisions a free ZeroDB project on first use.
 * Trigger.dev-compatible API: defineJob(), on(), trigger patterns.
 *
 * Supported triggers:
 *   zerodb.vector.stored
 *   zerodb.memory.stored
 *   zerodb.file.uploaded
 *   zerodb.table.row_inserted
 *   zerodb.event.published
 *
 * Under the hood this registers webhook hooks via ZeroDB's hooks API
 * and polls the event stream for matching events.
 */

const ZERODB_API_BASE = 'https://api.ainative.studio';
const INSTANT_DB_ENDPOINT = `${ZERODB_API_BASE}/api/v1/public/instant-db`;

const SUPPORTED_TRIGGERS = [
  'zerodb.vector.stored',
  'zerodb.memory.stored',
  'zerodb.file.uploaded',
  'zerodb.table.row_inserted',
  'zerodb.event.published',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildApiUrl(projectId) {
  return `${ZERODB_API_BASE}/v1/zerodb/${projectId}/database`;
}

async function httpRequest(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { ...options.headers },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`ZeroDB API error ${res.status}: ${body}`);
    err.statusCode = res.status;
    throw err;
  }

  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return res.json();
  }
  return res;
}

// ---------------------------------------------------------------------------
// Auto-provisioning
// ---------------------------------------------------------------------------

async function autoProvision(source) {
  const data = await httpRequest(INSTANT_DB_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: source || 'zerodb-trigger' }),
  });

  return {
    projectId: data.project_id,
    apiKey: data.api_key,
    claimUrl: data.claim_url || null,
  };
}

// ---------------------------------------------------------------------------
// IO helper — passed to job run() functions
// ---------------------------------------------------------------------------

class IO {
  constructor(trigger, jobId) {
    this._trigger = trigger;
    this._jobId = jobId;
    this.logger = {
      info: (...args) => { if (!trigger._silent) console.log(`[${jobId}]`, ...args); },
      warn: (...args) => { if (!trigger._silent) console.warn(`[${jobId}]`, ...args); },
      error: (...args) => { if (!trigger._silent) console.error(`[${jobId}]`, ...args); },
    };
  }

  async wait(label, duration) {
    return new Promise((resolve) => setTimeout(resolve, duration));
  }

  async runTask(id, fn) {
    return fn();
  }

  async sendEvent(event) {
    return this._trigger.emit(event.name || event.id, event.payload || event.data || {});
  }
}

// ---------------------------------------------------------------------------
// Job definition
// ---------------------------------------------------------------------------

class Job {
  constructor({ id, name, trigger, run, version, enabled }) {
    this.id = id;
    this.name = name || id;
    this.trigger = trigger;
    this.run = run;
    this.version = version || '1.0.0';
    this.enabled = enabled !== false;
    this._hookId = null;
  }
}

// ---------------------------------------------------------------------------
// ZeroDBTrigger — main client
// ---------------------------------------------------------------------------

export class ZeroDBTrigger {
  /**
   * @param {object} [options]
   * @param {string} [options.apiKey]    - ZeroDB API key (or env ZERODB_API_KEY)
   * @param {string} [options.projectId] - ZeroDB project ID (or env ZERODB_PROJECT_ID)
   * @param {string} [options.apiUrl]    - Override API base URL
   * @param {boolean} [options.silent]   - Suppress console output
   */
  constructor(options = {}) {
    this._apiKey = options.apiKey || process.env.ZERODB_API_KEY || process.env.TRIGGER_API_KEY || null;
    this._projectId = options.projectId || process.env.ZERODB_PROJECT_ID || process.env.TRIGGER_PROJECT_ID || null;
    this._apiBase = options.apiUrl || ZERODB_API_BASE;
    this._silent = options.silent || false;
    this._provisioned = !!(this._apiKey && this._projectId);
    this._claimUrl = null;
    this._jobs = new Map();
    this._listeners = new Map();
    this._polling = false;
    this._pollInterval = null;
  }

  // -------------------------------------------------------------------------
  // Provisioning
  // -------------------------------------------------------------------------

  async _ensureProvisioned() {
    if (this._provisioned) return;

    const creds = await autoProvision('zerodb-trigger');
    this._projectId = creds.projectId;
    this._apiKey = creds.apiKey;
    this._claimUrl = creds.claimUrl;
    this._provisioned = true;

    if (!this._silent && creds.claimUrl) {
      console.log(`\n  ZeroDB auto-provisioned! Claim your project:\n  ${creds.claimUrl}\n`);
    }
  }

  _buildUrl(path) {
    return `${this._apiBase}/v1/zerodb/${this._projectId}/database${path}`;
  }

  _headers() {
    return {
      'Content-Type': 'application/json',
      'X-API-Key': this._apiKey,
    };
  }

  // -------------------------------------------------------------------------
  // defineJob — Trigger.dev compatible
  // -------------------------------------------------------------------------

  defineJob(config) {
    if (!config.id) throw new Error('Job id is required');
    if (!config.trigger) throw new Error('Job trigger is required');
    if (typeof config.run !== 'function') throw new Error('Job run must be a function');

    const triggerName = config.trigger;
    if (!SUPPORTED_TRIGGERS.includes(triggerName) && !triggerName.startsWith('custom.')) {
      throw new Error(
        `Unsupported trigger "${triggerName}". Supported: ${SUPPORTED_TRIGGERS.join(', ')}, or custom.*`
      );
    }

    const job = new Job(config);
    this._jobs.set(config.id, job);

    // Register listener
    if (!this._listeners.has(triggerName)) {
      this._listeners.set(triggerName, []);
    }
    this._listeners.get(triggerName).push(job);

    return job;
  }

  // -------------------------------------------------------------------------
  // on() — simplified event listener
  // -------------------------------------------------------------------------

  on(triggerName, handler) {
    const jobId = `on_${triggerName}_${Date.now()}`;
    return this.defineJob({
      id: jobId,
      name: jobId,
      trigger: triggerName,
      run: async (event, io) => handler(event, io),
    });
  }

  // -------------------------------------------------------------------------
  // emit — publish event to stream + dispatch to local listeners
  // -------------------------------------------------------------------------

  async emit(eventName, data = {}) {
    await this._ensureProvisioned();

    const event = {
      event_type: eventName,
      data: data,
      timestamp: new Date().toISOString(),
    };

    // Publish to ZeroDB event stream
    const result = await httpRequest(this._buildUrl('/events'), {
      method: 'POST',
      headers: this._headers(),
      body: JSON.stringify(event),
    });

    // Dispatch to local listeners
    await this._dispatch(eventName, { ...event, id: result.event_id || result.id });

    return {
      id: result.event_id || result.id,
      eventName,
      timestamp: event.timestamp,
    };
  }

  // -------------------------------------------------------------------------
  // registerHook — register webhook on ZeroDB for a trigger
  // -------------------------------------------------------------------------

  async registerHook(triggerName, webhookUrl) {
    await this._ensureProvisioned();

    const result = await httpRequest(this._buildUrl('/hooks'), {
      method: 'POST',
      headers: this._headers(),
      body: JSON.stringify({
        event_type: triggerName,
        webhook_url: webhookUrl,
        active: true,
      }),
    });

    return {
      hookId: result.hook_id || result.id,
      triggerName,
      webhookUrl,
    };
  }

  // -------------------------------------------------------------------------
  // listHooks — list registered hooks
  // -------------------------------------------------------------------------

  async listHooks() {
    await this._ensureProvisioned();

    const result = await httpRequest(this._buildUrl('/hooks'), {
      method: 'GET',
      headers: this._headers(),
    });

    return Array.isArray(result) ? result : result.hooks || [];
  }

  // -------------------------------------------------------------------------
  // removeHook
  // -------------------------------------------------------------------------

  async removeHook(hookId) {
    await this._ensureProvisioned();

    await httpRequest(this._buildUrl(`/hooks/${hookId}`), {
      method: 'DELETE',
      headers: this._headers(),
    });

    return { deleted: true, hookId };
  }

  // -------------------------------------------------------------------------
  // dispatch — run matching jobs for an event
  // -------------------------------------------------------------------------

  async _dispatch(eventName, event) {
    const jobs = this._listeners.get(eventName) || [];
    const results = [];

    for (const job of jobs) {
      if (!job.enabled) continue;

      const io = new IO(this, job.id);
      try {
        const result = await job.run(
          { name: eventName, data: event.data || event, timestamp: event.timestamp },
          io
        );
        results.push({ jobId: job.id, success: true, result });
      } catch (err) {
        results.push({ jobId: job.id, success: false, error: err.message });
        io.logger.error('Job failed:', err.message);
      }
    }

    return results;
  }

  // -------------------------------------------------------------------------
  // handleWebhook — process incoming webhook payload (for server use)
  // -------------------------------------------------------------------------

  async handleWebhook(payload) {
    const eventName = payload.event_type || payload.trigger || payload.name;
    if (!eventName) throw new Error('Webhook payload missing event_type');

    return this._dispatch(eventName, payload);
  }

  // -------------------------------------------------------------------------
  // startPolling / stopPolling — poll event stream for triggers
  // -------------------------------------------------------------------------

  async startPolling(intervalMs = 5000) {
    if (this._polling) return;
    await this._ensureProvisioned();

    this._polling = true;
    this._lastPollTimestamp = new Date().toISOString();

    const poll = async () => {
      try {
        const events = await httpRequest(
          this._buildUrl(`/events?since=${encodeURIComponent(this._lastPollTimestamp)}`),
          { method: 'GET', headers: this._headers() }
        );

        const list = Array.isArray(events) ? events : events.events || [];
        for (const event of list) {
          const eventName = event.event_type || event.name;
          if (eventName && this._listeners.has(eventName)) {
            await this._dispatch(eventName, event);
          }
          if (event.timestamp) {
            this._lastPollTimestamp = event.timestamp;
          }
        }
      } catch (err) {
        if (!this._silent) console.error('[zerodb-trigger] Poll error:', err.message);
      }
    };

    this._pollInterval = setInterval(poll, intervalMs);
    await poll(); // immediate first poll
  }

  stopPolling() {
    this._polling = false;
    if (this._pollInterval) {
      clearInterval(this._pollInterval);
      this._pollInterval = null;
    }
  }

  // -------------------------------------------------------------------------
  // getJobs / getJob
  // -------------------------------------------------------------------------

  getJobs() {
    return Array.from(this._jobs.values()).map((j) => ({
      id: j.id,
      name: j.name,
      trigger: j.trigger,
      version: j.version,
      enabled: j.enabled,
    }));
  }

  getJob(id) {
    const job = this._jobs.get(id);
    if (!job) return null;
    return { id: job.id, name: job.name, trigger: job.trigger, version: job.version, enabled: job.enabled };
  }

  // -------------------------------------------------------------------------
  // disableJob / enableJob
  // -------------------------------------------------------------------------

  disableJob(id) {
    const job = this._jobs.get(id);
    if (job) job.enabled = false;
  }

  enableJob(id) {
    const job = this._jobs.get(id);
    if (job) job.enabled = true;
  }
}

// ---------------------------------------------------------------------------
// Convenience exports
// ---------------------------------------------------------------------------

export { SUPPORTED_TRIGGERS };

export function createTrigger(options) {
  return new ZeroDBTrigger(options);
}

export default ZeroDBTrigger;
