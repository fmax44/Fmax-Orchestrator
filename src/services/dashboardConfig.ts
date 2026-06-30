import { readFile, stat } from "node:fs/promises";
import path from "node:path";

export interface DashboardCommandConfig {
  label: string;
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
}

export interface DashboardAppConfig {
  chatgptUrl: string;
  browserPath?: string;
  codexPath?: string;
  vpnPath?: string;
}

export interface DashboardHealthConfig {
  tunnelHealthUrl: string;
  tunnelReadyUrl: string;
  mcpHealthUrl?: string;
}

export interface DashboardWorkerConfig {
  pollIntervalMs: number;
  statusFilePath: string;
  pidFilePath: string;
  directExecution: {
    enabled: boolean;
    command: string;
    sandbox: "read-only" | "workspace-write" | "danger-full-access";
    extraArgs: string[];
    timeoutMs: number;
    dryRun: boolean;
  };
}

export interface DashboardProjectConfig {
  name: string;
  path: string;
}

export interface DashboardConfig {
  version: number;
  dashboardPort: number;
  refreshIntervalSeconds: number;
  publicIpLookupUrl: string;
  publicIpGeoLookupUrlTemplate: string;
  publicIpTimeoutMs: number;
  apps: DashboardAppConfig;
  commands: {
    mcpServer?: DashboardCommandConfig;
    tunnel?: DashboardCommandConfig;
    codexWorker?: DashboardCommandConfig;
  };
  health: DashboardHealthConfig;
  worker: DashboardWorkerConfig;
  managedProjects: DashboardProjectConfig[];
}

export interface DashboardConfigLoadResult {
  config: DashboardConfig;
  exampleConfigPath: string;
  localConfigPath: string;
  localConfigExists: boolean;
}

export async function loadDashboardConfig(orchestratorRoot: string): Promise<DashboardConfigLoadResult> {
  const root = path.resolve(orchestratorRoot);
  const exampleConfigPath = path.join(root, "scripts", "fmax-orchestrator.config.example.json");
  const localConfigPath = path.join(root, "scripts", "fmax-orchestrator.config.local.json");
  const defaults = createDefaultDashboardConfig(root);
  const localConfigExists = await fileExists(localConfigPath);
  const localConfig = localConfigExists ? await readJson<Partial<DashboardConfig>>(localConfigPath) : undefined;

  return {
    config: mergeDashboardConfig(defaults, localConfig),
    exampleConfigPath,
    localConfigPath,
    localConfigExists
  };
}

export function createDefaultDashboardConfig(orchestratorRoot: string): DashboardConfig {
  const root = path.resolve(orchestratorRoot);
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

  return {
    version: 1,
    dashboardPort: 47821,
    refreshIntervalSeconds: 20,
    publicIpLookupUrl: "https://api.ipify.org?format=json",
    publicIpGeoLookupUrlTemplate: "https://ipwho.is/{ip}",
    publicIpTimeoutMs: 2500,
    apps: {
      chatgptUrl: "https://chatgpt.com/"
    },
    commands: {
      mcpServer: {
        label: "Start MCP server",
        command: npmCommand,
        args: ["run", "dev"],
        cwd: root
      },
      codexWorker: {
        label: "Start Codex Worker",
        command: npmCommand,
        args: ["run", "codex:worker"],
        cwd: root
      }
    },
    health: {
      tunnelHealthUrl: "http://127.0.0.1:8080/healthz",
      tunnelReadyUrl: "http://127.0.0.1:8080/readyz"
    },
    worker: {
      pollIntervalMs: 5_000,
      statusFilePath: path.join(root, "scripts", "fmax-orchestrator-codex-worker-status.json"),
      pidFilePath: path.join(root, "scripts", "fmax-orchestrator-codex-worker.pid"),
      directExecution: {
        enabled: false,
        command: "codex",
        sandbox: "read-only",
        extraArgs: [],
        timeoutMs: 1_200_000,
        dryRun: false
      }
    },
    managedProjects: [
      {
        name: "chatgpt-codex-mcp",
        path: root
      },
      {
        name: "orchestrator-product-trial",
        path: "D:/projects/orchestrator-product-trial"
      }
    ]
  };
}

function mergeDashboardConfig(defaults: DashboardConfig, override: Partial<DashboardConfig> | undefined): DashboardConfig {
  if (!override) {
    return defaults;
  }

  return {
    ...defaults,
    ...override,
    apps: {
      ...defaults.apps,
      ...override.apps
    },
    commands: {
      ...defaults.commands,
      ...override.commands
    },
    health: {
      ...defaults.health,
      ...override.health
    },
    worker: {
      ...defaults.worker,
      ...override.worker
    },
    managedProjects: override.managedProjects ?? defaults.managedProjects
  };
}

async function readJson<T>(filePath: string): Promise<T | undefined> {
  return readFile(filePath, "utf8")
    .then((content) => JSON.parse(content) as T)
    .catch(() => undefined);
}

async function fileExists(filePath: string): Promise<boolean> {
  return stat(filePath)
    .then(() => true)
    .catch(() => false);
}
