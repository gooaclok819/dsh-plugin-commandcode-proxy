/**
 * dsh-commandcode-proxy — host half.
 *
 * Two responsibilities:
 *  1. Keep the local Command-Code reverse proxy (`proxy.mjs`) alive for as long
 *     as this plugin is loaded, so DSH's `command` provider
 *     (http://127.0.0.1:3050/v1) always has a live upstream. The child process
 *     is owned by a cordis effect: unloading or reloading stops it, and an
 *     unexpected exit restarts it with backoff while the plugin stays active.
 *  2. Serve `/api/dsh-commandcode-proxy/usage`, aggregated from the Harness
 *     usage ledger for the `command` provider, plus the live proxy status. The
 *     browser half (`./client`) renders it as a Settings section.
 *
 * Plain ESM, no runtime dependencies.
 */

import { spawn } from 'node:child_process'
import { existsSync, statSync, readFileSync } from 'node:fs'
import { join, isAbsolute } from 'node:path'
import { request } from 'node:http'
import { homedir } from 'node:os'

/** Stable cordis plugin name. */
export const name = 'commandcode-proxy'

/** Required services: none. `webServer` is mounted optionally below. */
export const inject = []

const DEFAULTS = {
  enabled: true,
  proxyDir: 'G:\\DshWork\\1104\\commandcode-proxy',
  script: 'proxy.mjs',
  nodePath: '',
  port: 3050,
  autoRestart: true,
  restartDelayMs: 3000,
  healthTimeoutMs: 1200,
  maxRestarts: 5,
  provider: 'command',
  usageRoute: '/api/dsh-commandcode-proxy/usage',
}

function resolveConfig(input) {
  const cfg = { ...DEFAULTS }
  if (input && typeof input === 'object') {
    for (const key of Object.keys(DEFAULTS)) {
      const value = input[key]
      if (value !== undefined && value !== null) cfg[key] = value
    }
  }
  return cfg
}

function findNode(config, log) {
  const candidates = []
  if (config.nodePath) candidates.push(config.nodePath)
  if (process.env.DSH_NODE_EXE) candidates.push(process.env.DSH_NODE_EXE)
  for (const dir of String(process.env.PATH || '').split(';')) {
    if (!dir) continue
    candidates.push(join(dir, 'node.exe'), join(dir, 'node'))
  }
  candidates.push('C:\\Program Files\\nodejs\\node.exe')
  for (const candidate of candidates) {
    try {
      if (candidate && existsSync(candidate) && statSync(candidate).isFile()) return candidate
    } catch {
      /* ignore */
    }
  }
  log.error('no Node.js executable found; set nodePath in the plugin config')
  return null
}

function probeHealth(port, timeoutMs) {
  return new Promise((resolve) => {
    const req = request({ host: '127.0.0.1', port, path: '/health', method: 'GET', timeout: timeoutMs }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (d) => { if (body.length < 512) body += d })
      res.on('end', () => resolve({ ok: res.statusCode === 200, body: body.trim() }))
    })
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, body: '' }) })
    req.on('error', () => resolve({ ok: false, body: '' }))
    req.end()
  })
}

async function waitUntilHealthy(port, budgetMs) {
  const deadline = Date.now() + budgetMs
  while (Date.now() < deadline) {
    if ((await probeHealth(port, 800)).ok) return true
    await new Promise((r) => setTimeout(r, 300))
  }
  return false
}

function lineSplitter(onLine) {
  let buffer = ''
  return (chunk) => {
    buffer += chunk.toString('utf8')
    let index = buffer.indexOf('\n')
    while (index >= 0) {
      const line = buffer.slice(0, index).replace(/\r$/, '')
      buffer = buffer.slice(index + 1)
      if (line) onLine(line)
      index = buffer.indexOf('\n')
    }
  }
}

/* ------------------------------------------------------------------ */
/* Usage ledger                                                        */
/* ------------------------------------------------------------------ */

/** Resolve the Harness home directory the same way the Host does. */
function dshHome() {
  if (process.env.DSH_HOME) return process.env.DSH_HOME
  return join(homedir(), '.dsh')
}

/** Read the usage ledger; a missing or malformed file yields an empty ledger. */
function readLedger() {
  const file = join(dshHome(), 'dsh-usage', 'usage-ledger.json')
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    return { file, days: parsed?.days ?? {}, version: parsed?.version ?? null }
  } catch (error) {
    return { file, days: {}, version: null, error: error?.message ?? String(error) }
  }
}

function emptyTotals() {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, calls: 0, cost: 0 }
}

function addInto(target, bucket) {
  target.inputTokens += Number(bucket?.inputTokens ?? 0)
  target.outputTokens += Number(bucket?.outputTokens ?? 0)
  target.cacheReadTokens += Number(bucket?.cacheReadTokens ?? 0)
  target.cacheWriteTokens += Number(bucket?.cacheWriteTokens ?? 0)
  target.reasoningTokens += Number(bucket?.reasoningTokens ?? 0)
  target.calls += Number(bucket?.calls ?? 0)
  target.cost += Number(bucket?.cost ?? 0)
}

/** Local calendar day as YYYY-MM-DD (matches the ledger's key format). */
function todayKey() {
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/**
 * Aggregate the ledger for one provider.
 *
 * @param provider — provider id as used in the ledger (`command` here).
 * @param days — how many calendar days back the recent table should cover.
 */
function aggregateUsage(provider, days = 14) {
  const ledger = readLedger()
  const total = emptyTotals()
  const today = emptyTotals()
  const byModel = new Map()
  const recent = []
  const today_ = todayKey()
  const cutoff = new Date(Date.now() - (days - 1) * 86400000)
  const pad = (n) => String(n).padStart(2, '0')
  const cutoffKey = `${cutoff.getFullYear()}-${pad(cutoff.getMonth() + 1)}-${pad(cutoff.getDate())}`

  const dayKeys = Object.keys(ledger.days).sort()
  for (const dayKey of dayKeys) {
    const providerBucket = ledger.days[dayKey]?.[provider]
    if (!providerBucket) continue
    const dayTotal = emptyTotals()
    for (const [modelId, bucket] of Object.entries(providerBucket)) {
      addInto(dayTotal, bucket)
      const model = byModel.get(modelId) ?? { model: modelId, ...emptyTotals(), firstDay: dayKey, lastDay: dayKey }
      addInto(model, bucket)
      model.lastDay = dayKey
      byModel.set(modelId, model)
    }
    addInto(total, dayTotal)
    if (dayKey === today_) addInto(today, dayTotal)
    if (dayKey >= cutoffKey) {
      recent.push({ date: dayKey, ...dayTotal })
    }
  }

  recent.sort((a, b) => (a.date < b.date ? 1 : -1))
  const models = [...byModel.values()].sort((a, b) => b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens))

  return {
    provider,
    generatedAt: Date.now(),
    ledgerFile: ledger.file,
    ledgerError: ledger.error ?? null,
    firstDay: dayKeys.find((k) => ledger.days[k]?.[provider]) ?? null,
    lastDay: [...dayKeys].reverse().find((k) => ledger.days[k]?.[provider]) ?? null,
    today: { date: today_, ...today },
    total,
    models,
    recent,
  }
}

function writeJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

/* ------------------------------------------------------------------ */
/* Plugin entry                                                        */
/* ------------------------------------------------------------------ */

function applyInner(ctx, input) {
  const config = resolveConfig(input)
  const log = ctx.logger('commandcode-proxy')

  /** Live supervision state, read by the usage route. */
  const state = { pid: null, startedAt: null, lastExit: null, restarts: 0, autoStarted: false }

  if (config.enabled !== false) {
    const nodePath = findNode(config, log)
    if (nodePath) {
      const proxyDir = isAbsolute(config.proxyDir) ? config.proxyDir : join(process.cwd(), config.proxyDir)
      const scriptPath = join(proxyDir, config.script)

      if (!existsSync(scriptPath)) {
        log.error('proxy script not found at %s; check proxyDir in the plugin config', scriptPath)
      } else {
        ctx.effect(() => {
          let child = null
          let stopped = false
          let restartTimer = null
          let readyTimer = null

          const stopChild = () => {
            if (!child || child.exitCode !== null) return
            const pid = child.pid
            try {
              if (process.platform === 'win32' && pid) {
                spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
              } else {
                child.kill('SIGTERM')
              }
            } catch (error) {
              log.warn('failed to stop proxy process: %s', error?.message ?? error)
            }
          }

          const scheduleRestart = (reason) => {
            state.lastExit = { at: Date.now(), reason }
            if (stopped || !config.autoRestart) return
            if (state.restarts >= config.maxRestarts) {
              log.error('giving up after %d restarts (%s); the proxy stays down until the plugin reloads', state.restarts, reason)
              return
            }
            state.restarts += 1
            const delay = config.restartDelayMs * state.restarts
            log.warn('proxy exited (%s); restarting in %dms (%d/%d)', reason, delay, state.restarts, config.maxRestarts)
            restartTimer = setTimeout(() => {
              restartTimer = null
              start()
            }, delay)
          }

          const start = () => {
            if (stopped) return
            child = spawn(nodePath, [scriptPath], {
              cwd: proxyDir,
              env: { ...process.env, PORT: String(config.port) },
              stdio: ['ignore', 'pipe', 'pipe'],
              windowsHide: true,
            })
            state.pid = child.pid ?? null
            state.startedAt = Date.now()
            state.autoStarted = true
            log.info('starting proxy (pid %d) on port %d', child.pid ?? -1, config.port)

            child.stdout.on('data', lineSplitter((line) => log.info('%s', line)))
            child.stderr.on('data', lineSplitter((line) => log.warn('%s', line)))
            child.on('error', (error) => {
              log.error('failed to spawn the proxy: %s', error?.message ?? error)
              scheduleRestart('spawn error')
            })
            child.on('exit', (code, signal) => {
              if (stopped) return
              child = null
              state.pid = null
              scheduleRestart(`code ${code ?? 'null'} signal ${signal ?? 'none'}`)
            })

            if (readyTimer) clearTimeout(readyTimer)
            readyTimer = setTimeout(async () => {
              readyTimer = null
              if (stopped) return
              const healthy = await waitUntilHealthy(config.port, config.healthTimeoutMs * 5)
              if (stopped) return
              if (healthy) {
                log.info('proxy is healthy at http://127.0.0.1:%d (OpenAI: /v1/chat/completions)', config.port)
                state.restarts = 0
              } else {
                log.warn('proxy did not answer /health within %dms; check its own logs', config.healthTimeoutMs * 5)
              }
            }, 0)
          }

          probeHealth(config.port, config.healthTimeoutMs).then((already) => {
            if (stopped) return
            if (already.ok) {
              state.autoStarted = false
              log.info('a proxy is already listening on port %d; adopted it without spawning', config.port)
              return
            }
            start()
          })

          return () => {
            stopped = true
            if (restartTimer) clearTimeout(restartTimer)
            if (readyTimer) clearTimeout(readyTimer)
            stopChild()
            state.pid = null
            log.info('plugin unloaded; proxy stopped')
          }
        }, 'commandcode-proxy:child-process')
      }
    }
  } else {
    log.info('proxy supervision disabled by config; the usage page still works')
  }

  /* Usage route: mounted only in profiles that serve HTTP.
   * Kept fully defensive — a route failure must never prevent proxy supervision. */
  const handler = async (req, res) => {
    if (req.method !== 'GET') {
      writeJson(res, 405, { error: `method not allowed: ${req.method}` })
      return
    }
    try {
      const usage = aggregateUsage(config.provider)
      const health = await probeHealth(config.port, config.healthTimeoutMs)
      writeJson(res, 200, {
        ...usage,
        proxy: {
          port: config.port,
          pid: state.pid,
          autoStarted: state.autoStarted,
          uptimeMs: state.startedAt ? Date.now() - state.startedAt : null,
          health: health.ok ? 'ok' : 'down',
          healthBody: health.body,
          restarts: state.restarts,
          lastExit: state.lastExit,
          baseUrl: `http://127.0.0.1:${config.port}/v1`,
        },
      })
    } catch (error) {
      writeJson(res, 500, { error: error?.message ?? String(error) })
    }
  }

  if (typeof ctx.inject !== 'function') {
    log.warn('ctx.inject is unavailable; the usage route was not mounted')
    return
  }

  ctx.inject(['webServer'], (webCtx) => {
    try {
      const server = webCtx.webServer
      if (!server || typeof server.register !== 'function') {
        log.warn('webServer.register is unavailable; the usage route was not mounted')
        return
      }
      ctx.effect(() => {
        const dispose = server.register({ kind: 'exact', path: config.usageRoute, handler })
        return typeof dispose === 'function' ? dispose : () => {}
      }, 'commandcode-proxy:usage-route')
      log.info('usage route mounted at %s', config.usageRoute)
    } catch (error) {
      log.warn('usage route not mounted: %s', error?.message ?? error)
    }
  })
}

/**
 * Cordis entry point. Any failure inside is reported through the plugin logger
 * instead of surfacing as an inert fiber, so a broken usage route can never
 * stop the proxy from being supervised.
 */
export function apply(ctx, input) {
  try {
    applyInner(ctx, input)
  } catch (error) {
    try {
      ctx.logger('commandcode-proxy').error('plugin failed to apply: %s', error?.message ?? error)
    } catch {
      /* logging itself failed: nothing left to report to */
    }
  }
}
