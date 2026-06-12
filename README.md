# zerodb-trigger

Drop-in Trigger.dev replacement backed by ZeroDB event hooks. Zero config — auto-provisions on first use.

## Why?

Trigger.dev is great for background jobs, but you need infrastructure. `zerodb-trigger` gives you the same `defineJob()` API backed by ZeroDB's managed event hooks. No server, no config, no signup — just `npm install` and go.

## Install

```bash
npm install zerodb-trigger
```

## Quick Start

```javascript
import { ZeroDBTrigger } from 'zerodb-trigger';

const trigger = new ZeroDBTrigger();

// Define a triggered function
trigger.defineJob({
  id: 'process-upload',
  name: 'Process File Upload',
  trigger: 'zerodb.file.uploaded',
  run: async (event, io) => {
    const file = event.data;
    await io.logger.info('Processing:', file.file_name);
    // ... process file
    return { processed: true };
  }
});

// Emit an event (triggers matching jobs)
await trigger.emit('zerodb.file.uploaded', {
  file_name: 'report.pdf',
  size: 1024,
});
```

That's it. On first use, a free ZeroDB project is auto-provisioned. You'll see a claim URL in the console to keep it permanently.

## Supported Triggers

| Trigger | Fires When |
|---------|-----------|
| `zerodb.vector.stored` | A vector embedding is stored |
| `zerodb.memory.stored` | A memory is stored |
| `zerodb.file.uploaded` | A file is uploaded |
| `zerodb.table.row_inserted` | A NoSQL table row is inserted |
| `zerodb.event.published` | Any event is published to the stream |
| `custom.*` | Custom events (any name starting with `custom.`) |

## Trigger.dev Migration Guide

Replace `@trigger.dev/sdk` with `zerodb-trigger`:

```diff
- import { TriggerClient } from '@trigger.dev/sdk';
+ import { ZeroDBTrigger } from 'zerodb-trigger';

- const client = new TriggerClient({ id: 'my-app' });
+ const trigger = new ZeroDBTrigger();

// defineJob works the same way
trigger.defineJob({
  id: 'sync-data',
  name: 'Sync Data',
- trigger: eventTrigger({ name: 'sync.requested' }),
+ trigger: 'zerodb.event.published',
  run: async (event, io) => {
    await io.logger.info('Syncing...');
    const result = await io.runTask('fetch-data', async () => {
      return fetchData();
    });
    return result;
  },
});
```

### What's different?

| Feature | Trigger.dev | zerodb-trigger |
|---------|------------|---------------|
| Setup | Self-host or cloud signup | Zero config, auto-provisions |
| Triggers | Custom event triggers | 5 built-in + custom.* |
| IO helpers | `io.runTask`, `io.wait`, `io.logger` | Same API |
| Webhooks | Built-in | `registerHook()` / `handleWebhook()` |
| Polling | N/A | `startPolling()` for pull-based |
| Dependencies | Many | Zero (native fetch) |

## Webhooks

Register a webhook to get notified of events:

```javascript
// Register webhook
const hook = await trigger.registerHook(
  'zerodb.file.uploaded',
  'https://your-app.com/api/webhook'
);

// In your webhook handler (Express/Fastify/etc)
app.post('/api/webhook', async (req, res) => {
  const results = await trigger.handleWebhook(req.body);
  res.json({ results });
});

// List & remove hooks
const hooks = await trigger.listHooks();
await trigger.removeHook(hook.hookId);
```

## Polling Mode

For serverless or when webhooks aren't practical:

```javascript
const trigger = new ZeroDBTrigger();

trigger.defineJob({
  id: 'watcher',
  trigger: 'zerodb.memory.stored',
  run: async (event) => console.log('New memory:', event.data),
});

// Poll every 5 seconds
await trigger.startPolling(5000);

// Stop when done
trigger.stopPolling();
```

## Job Management

```javascript
// List all jobs
const jobs = trigger.getJobs();

// Get specific job
const job = trigger.getJob('process-upload');

// Disable/enable
trigger.disableJob('process-upload');
trigger.enableJob('process-upload');
```

## Configuration

```javascript
const trigger = new ZeroDBTrigger({
  apiKey: 'your-zerodb-api-key',    // or env ZERODB_API_KEY / TRIGGER_API_KEY
  projectId: 'your-project-id',     // or env ZERODB_PROJECT_ID / TRIGGER_PROJECT_ID
  apiUrl: 'https://api.ainative.studio', // default
  silent: false,                     // suppress console output
});
```

## CommonJS

```javascript
const { ZeroDBTrigger } = require('zerodb-trigger');
const trigger = new ZeroDBTrigger();
```

---

**ZeroDB** is an AI-native database with vectors, NoSQL, files, events, and Postgres — all auto-provisioned.

Get a free database instantly at [zerodb.ai](https://zerodb.ai) | [Docs](https://docs.ainative.studio) | [npm](https://www.npmjs.com/package/zerodb-trigger)

---

## Zero-Config Auto-Provisioning

**No account needed to start.** On first run, this package automatically:

1. Provisions a **free ZeroDB instance** (~800ms)
2. Saves credentials locally (`.env`, `.mcp.json`)
3. Prints a **claim link** in your terminal

### The 72-Hour Window

Your auto-provisioned instance is **free for 72 hours**. To keep your data permanently, visit the **claim URL** printed in your terminal.

### For AI Agents

If a coding agent (Claude Code, Cursor, Windsurf) installs this package:
- Auto-provisions without human intervention
- The **claim URL** appears in agent output — visit it to take ownership
- `.claude/CLAUDE.md` instructs agents to surface the claim link to you
- Check `.env` or `~/.ainative/config.json` for your project ID if you miss it
