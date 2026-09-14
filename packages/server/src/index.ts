import { PROTOCOL_VERSION, type EventMessage } from '@parkinglot/protocol';
import type { ServerConfig } from './config.js';
import { loadConfig } from './config.js';
import { EventCache, isCachedEvent } from './event-cache.js';
import { Ledger } from './ledger.js';
import { Router } from './router.js';
import { SessionRegistry } from './session.js';
import { startHttp } from './http.js';
import { ExtensionHub } from './ws/server.js';

export const SERVER_NAME = 'parkinglot-server';
export const SERVER_VERSION = PROTOCOL_VERSION;

export interface RunningServer {
  /** HTTP base URL（Agent CLI/HTTP 通道） */
  url: string;
  /** WebSocket path（extension 通道） */
  wsPath: string;
  token: string;
  config: ServerConfig;
  close(): Promise<void>;
}

/** 组装并启动 server：HTTP（/api/*）+ WebSocket（/ws，extension）。 */
export async function startServer(overrides: Partial<ServerConfig> = {}): Promise<RunningServer> {
  const config: ServerConfig = { ...loadConfig(), ...overrides };
  const ledger = new Ledger(config.stateDir);
  const registry = new SessionRegistry(config.stateDir);
  const events = new EventCache();
  const hub = new ExtensionHub(config.token);
  const router = new Router({ config, registry, hub, ledger });
  hub.on('event', (event: EventMessage) => {
    if (isCachedEvent(event)) events.push(event);
    // tab 关闭：主动解除所有绑定该 tab 的 session（tab.removed 的主动路径）
    if (event.event === 'tab.removed') {
      const tabId = event.params.tabId;
      if (typeof tabId === 'number') registry.unbindTab(tabId);
    }
  });
  const httpServer = startHttp({
    config,
    router,
    registry,
    events,
    ledger,
    isExtensionOnline: () => hub.isOnline(),
  });
  hub.attach(httpServer, '/ws');

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(config.port, config.bind, () => resolve());
  });

  return {
    url: `http://${config.bind}:${config.port}`,
    wsPath: `ws://${config.bind}:${config.port}/ws`,
    token: config.token,
    config,
    close: async () => {
      await hub.close();
      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve());
        // 关闭残留的 keep-alive/空闲 HTTP 连接，避免 close 回调被挂起（Node 18.2+）
        httpServer.closeAllConnections?.();
      });
    },
  };
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url.endsWith(process.argv[1].replace(/^file:\/\//, ''));

if (isMain) {
  const server = await startServer();
  console.log(`${SERVER_NAME} listening on ${server.url}`);
  console.log(`extension websocket: ${server.wsPath}`);
  console.log(`pair token: ${server.token}`);
  console.log('load the extension and connect it with this token; then use `plt status`.');
}
