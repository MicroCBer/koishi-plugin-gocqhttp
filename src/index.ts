import { Context, Schema, interpolate, Logger } from 'koishi'
import onebot, { OneBotBot } from '@koishijs/plugin-adapter-onebot'
import {} from '@koishijs/plugin-console'
import { spawn } from 'cross-spawn'
import { ChildProcess } from 'child_process'
import { resolve } from 'path'
import { promises as fsp } from 'fs'
import { URL } from 'url'

const { mkdir, copyFile, readFile, writeFile } = fsp

declare module '@koishijs/plugin-adapter-onebot/lib/bot' {
  interface BotConfig {
    gocqhttp?: boolean
  }

  interface OneBotBot {
    process: ChildProcess
  }
}

export const logger = new Logger('gocqhttp')

export const name = 'go-cqhttp'

export interface Config {}

export const Config: Schema<Config> = Schema.object({})

const logLevelMap = {
  DEBUG: 'debug',
  INFO: 'debug',
  WARNING: 'warn',
  ERROR: 'error',
}

async function start(bot: OneBotBot) {
  // create working folder
  const cwd = resolve(bot.app.baseDir, 'accounts/' + bot.selfId)
  const file = '/go-cqhttp' + (process.platform === 'win32' ? '.exe' : '')
  await mkdir(cwd, { recursive: true })
  await copyFile(resolve(__dirname, '../bin/go-cqhttp'), cwd + file)

  // create config.yml
  const { port, host = 'localhost' } = bot.app.options
  const { path = '/onebot' } = bot.app.registry.get(onebot).config
  const template = await readFile(resolve(__dirname, '../template.yml'), 'utf8')
  await writeFile(cwd + '/config.yml', interpolate(template, {
    bot: bot.config,
    adapter: bot.adapter.config,
    endpoint: bot.config.endpoint && new URL(bot.config.endpoint),
    selfUrl: `${host}:${port}${path}`,
  }, /\$\{\{(.+?)\}\}/g))

  // spawn go-cqhttp process
  bot.process = spawn('.' + file, ['faststart'], { cwd })
  return new Promise<void>((resolve, reject) => {
    bot.process.stderr.on('data', (data) => {
      data = data.toString().trim()
      if (!data) return
      for (const line of data.split('\n')) {
        const text = line.slice(23)
        const [type] = text.split(']: ', 1)
        if (type in logLevelMap) {
          logger[logLevelMap[type]](text.slice(type.length + 3))
        } else {
          logger.info(line.trim())
        }
        if (text.includes('アトリは、高性能ですから')) resolve()
      }
    })
    bot.process.on('exit', reject)
  })
}

export interface Config {
  logLevel?: number
}

export function apply(ctx: Context, config: Config = {}) {
  logger.level = config.logLevel || 2

  ctx.on('bot-connect', async (bot: OneBotBot) => {
    if (!bot.config.gocqhttp) return
    return start(bot)
  })

  ctx.on('bot-disconnect', async (bot: OneBotBot) => {
    if (!bot.config.gocqhttp) return
    bot.process?.kill()
  })

  ctx.using(['console'], (ctx) => {
    if (ctx.console.config.devMode) {
      ctx.console.addEntry(resolve(__dirname, '../client/index.ts'))
    } else {
      ctx.console.addEntry(resolve(__dirname, '../dist'))
    }
  })
}
