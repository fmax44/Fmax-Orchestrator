import os from "node:os";
import path from "node:path";
import { ProjectStatusService, type ProjectStatusResult } from "./projectStatus.js";
import { CodexWorkerService, type CodexWorkerStatus } from "./codexWorker.js";
import type { DashboardCommandConfig, DashboardConfig } from "./dashboardConfig.js";

export type DashboardComponentState = "online" | "degraded" | "offline" | "manual";
export type DashboardActionVisualState = "idle" | "starting" | "running" | "failed" | "disabled";

export interface DashboardActionRuntimeState {
  state: "idle" | "starting" | "failed";
  message?: string;
  updatedAt?: string;
}

export type DashboardActionRuntimeMap = Partial<Record<DashboardActionId, DashboardActionRuntimeState>>;

export interface DashboardComponentStatus {
  name: string;
  state: DashboardComponentState;
  details: string;
  actionLabel?: string;
  meta?: string[];
  actionState?: DashboardActionVisualState;
}

export interface DashboardProjectCard {
  name: string;
  path: string;
  ok: boolean;
  summary: string;
  waitingFor?: string;
  nextActor?: string;
  nextAction?: string;
  recommendedAction?: string;
  doctorResult?: string;
  gitStatus?: string;
  currentTask?: string;
  errors: string[];
  warnings: string[];
}

export interface DashboardIpInfo {
  local: string[];
  publicIp?: string;
  publicIpStatus: "available" | "unavailable";
  publicIpDetails: string;
  city?: string;
  country?: string;
  geoStatus: "available" | "unavailable";
  geoDetails: string;
}

export interface DashboardSnapshot {
  generatedAt: string;
  orchestratorRoot: string;
  configPath: string;
  configExists: boolean;
  components: {
    mcpServer: DashboardComponentStatus;
    tunnel: DashboardComponentStatus;
    codexWorker: DashboardComponentStatus;
  };
  ips: DashboardIpInfo;
  projects: DashboardProjectCard[];
  actions: Array<{
    id: DashboardActionId;
    label: string;
    enabled: boolean;
    state: DashboardActionVisualState;
    statusText: string;
    reason?: string;
    details?: string;
  }>;
}

export type DashboardActionState = DashboardSnapshot["actions"][number];

export interface DashboardRenderOptions {
  flash?: {
    kind: "ok" | "error";
    text: string;
  };
}

export type DashboardActionId =
  | "open-chatgpt"
  | "open-codex"
  | "open-vpn"
  | "start-mcp"
  | "start-tunnel"
  | "open-config"
  | "start-codex-worker";

export interface DashboardCollectOptions {
  orchestratorRoot: string;
  configPath: string;
  configExists: boolean;
  config: DashboardConfig;
  actionRuntime?: DashboardActionRuntimeMap;
}

export interface DashboardDependencies {
  fetchImpl?: typeof fetch;
  projectStatusService?: Pick<ProjectStatusService, "check">;
  codexWorkerService?: Pick<CodexWorkerService, "readStatus" | "inspectEnvironment">;
}

const RU = {
  heroEyebrow: "\u041b\u043e\u043a\u0430\u043b\u044c\u043d\u044b\u0439 dashboard Fmax-Orchestrator",
  heroTitle: "\u0417\u0430\u043f\u0443\u0441\u043a \u0441\u0435\u0440\u0432\u0438\u0441\u043e\u0432, relay-\u0441\u0442\u0430\u0442\u0443\u0441, IP \u0438 \u0437\u0434\u043e\u0440\u043e\u0432\u044c\u0435 \u043f\u0440\u043e\u0435\u043a\u0442\u043e\u0432 \u0432 \u043e\u0434\u043d\u043e\u043c \u043e\u043a\u043d\u0435",
  refreshPrefix: "\u0410\u0432\u0442\u043e\u043e\u0431\u043d\u043e\u0432\u043b\u0435\u043d\u0438\u0435 \u043a\u0430\u0436\u0434\u044b\u0435",
  refreshSuffix: "\u0441\u0435\u043a. \u041e\u0431\u043d\u043e\u0432\u043b\u0435\u043d\u043e:",
  localConfig: "\u041b\u043e\u043a\u0430\u043b\u044c\u043d\u044b\u0439 config",
  configLoaded: "\u041b\u043e\u043a\u0430\u043b\u044c\u043d\u044b\u0439 override \u043f\u043e\u0434\u043a\u043b\u044e\u0447\u0451\u043d.",
  configMissing:
    "\u0421\u0435\u0439\u0447\u0430\u0441 \u0438\u0441\u043f\u043e\u043b\u044c\u0437\u0443\u044e\u0442\u0441\u044f \u0437\u043d\u0430\u0447\u0435\u043d\u0438\u044f \u043f\u043e \u0443\u043c\u043e\u043b\u0447\u0430\u043d\u0438\u044e. \u0421\u043e\u0437\u0434\u0430\u0439\u0442\u0435 local config \u0434\u043b\u044f \u043f\u0443\u0442\u0435\u0439 Codex, VPN \u0438 \u043a\u043e\u043c\u0430\u043d\u0434 \u0437\u0430\u043f\u0443\u0441\u043a\u0430.",
  ipBlock: "IP \u0438 \u0433\u0435\u043e\u043b\u043e\u043a\u0430\u0446\u0438\u044f",
  localIpv4: "\u041b\u043e\u043a\u0430\u043b\u044c\u043d\u044b\u0435 IPv4",
  publicIp: "\u041f\u0443\u0431\u043b\u0438\u0447\u043d\u044b\u0439 IP",
  city: "\u0413\u043e\u0440\u043e\u0434",
  country: "\u0421\u0442\u0440\u0430\u043d\u0430",
  cityMissing: "\u043d\u0435 \u043e\u043f\u0440\u0435\u0434\u0435\u043b\u0451\u043d",
  countryMissing: "\u043d\u0435 \u043e\u043f\u0440\u0435\u0434\u0435\u043b\u0435\u043d\u0430",
  notDetected: "\u043d\u0435 \u043e\u043f\u0440\u0435\u0434\u0435\u043b\u0435\u043d\u044b",
  unavailable: "\u043d\u0435\u0434\u043e\u0441\u0442\u0443\u043f\u0435\u043d",
  managedProjects: "\u0423\u043f\u0440\u0430\u0432\u043b\u044f\u0435\u043c\u044b\u0435 \u043f\u0440\u043e\u0435\u043a\u0442\u044b",
  actionAvailable: "\u0414\u043e\u0441\u0442\u0443\u043f\u043d\u043e\u0435 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0435",
  actionIdle: "\u043d\u0435 \u0437\u0430\u043f\u0443\u0449\u0435\u043d\u043e",
  actionStarting: "\u0437\u0430\u043f\u0443\u0441\u043a...",
  actionRunning: "\u0440\u0430\u0431\u043e\u0442\u0430\u0435\u0442",
  actionFailed: "\u043e\u0448\u0438\u0431\u043a\u0430",
  actionDisabled: "\u043d\u0435 \u043d\u0430\u0441\u0442\u0440\u043e\u0435\u043d\u043e",
  projectReady: "\u0413\u041e\u0422\u041e\u0412 \u041a \u041f\u0420\u041e\u0412\u0415\u0420\u041a\u0415",
  projectFailed: "\u041f\u0420\u041e\u0412\u0415\u0420\u041a\u0410 \u041d\u0415 \u041f\u0420\u041e\u0428\u041b\u0410",
  currentTask: "\u0422\u0435\u043a\u0443\u0449\u0430\u044f \u0437\u0430\u0434\u0430\u0447\u0430",
  doctor: "Doctor",
  git: "Git",
  waitingFor: "\u041e\u0436\u0438\u0434\u0430\u043d\u0438\u0435",
  nextActor: "\u0421\u043b\u0435\u0434\u0443\u044e\u0449\u0438\u0439 \u0438\u0441\u043f\u043e\u043b\u043d\u0438\u0442\u0435\u043b\u044c",
  recommendedAction: "\u0420\u0435\u043a\u043e\u043c\u0435\u043d\u0434\u0443\u0435\u043c\u043e\u0435 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0435",
  nextStep: "\u0421\u043b\u0435\u0434\u0443\u044e\u0449\u0438\u0439 \u0448\u0430\u0433",
  warning: "\u041f\u0440\u0435\u0434\u0443\u043f\u0440\u0435\u0436\u0434\u0435\u043d\u0438\u0435",
  error: "\u041e\u0448\u0438\u0431\u043a\u0430",
  openVpn: "\u041e\u0442\u043a\u0440\u044b\u0442\u044c VPN",
  startTunnel: "\u0417\u0430\u043f\u0443\u0441\u0442\u0438\u0442\u044c Tunnel",
  startMcp: "\u0417\u0430\u043f\u0443\u0441\u0442\u0438\u0442\u044c MCP",
  openChatgpt: "\u041e\u0442\u043a\u0440\u044b\u0442\u044c ChatGPT",
  openCodex: "\u041e\u0442\u043a\u0440\u044b\u0442\u044c Codex",
  openConfig: "\u041e\u0442\u043a\u0440\u044b\u0442\u044c \u043a\u043e\u043d\u0444\u0438\u0433",
  startCodexWorker: "\u0417\u0430\u043f\u0443\u0441\u0442\u0438\u0442\u044c Codex Worker",
  workerTask: "\u041f\u043e\u0441\u043b\u0435\u0434\u043d\u044f\u044f \u043d\u0430\u0439\u0434\u0435\u043d\u043d\u0430\u044f \u0437\u0430\u0434\u0430\u0447\u0430",
  workerReport: "\u0421\u0442\u0430\u0442\u0443\u0441 report",
  workerLimitations: "\u041e\u0433\u0440\u0430\u043d\u0438\u0447\u0435\u043d\u0438\u044f worker",
  workerNotStarted:
    "\u0421\u0442\u0430\u0442\u0443\u0441 worker \u0435\u0449\u0451 \u043d\u0435 \u0437\u0430\u043f\u0438\u0441\u0430\u043d. \u0417\u0430\u043f\u0443\u0441\u0442\u0438\u0442\u0435 worker \u043a\u043d\u043e\u043f\u043a\u043e\u0439 \u0438\u043b\u0438 \u043a\u043e\u043c\u0430\u043d\u0434\u043e\u0439 npm run codex:worker.",
  workerDirectLaunch:
    "\u041f\u0440\u044f\u043c\u043e\u0439 \u0431\u0435\u0437\u043e\u043f\u0430\u0441\u043d\u044b\u0439 \u0437\u0430\u043f\u0443\u0441\u043a Codex Desktop \u0438 \u043e\u0442\u043f\u0440\u0430\u0432\u043a\u0430 prompt \u0438\u0437 CLI \u043d\u0435 \u043f\u043e\u0434\u0434\u0435\u0440\u0436\u0438\u0432\u0430\u044e\u0442\u0441\u044f.",
  workerCliFound: "Codex CLI",
  workerExecAvailable: "codex exec",
  workerDirectExecution: "\u041f\u0440\u044f\u043c\u043e\u0435 \u0432\u044b\u043f\u043e\u043b\u043d\u0435\u043d\u0438\u0435",
  workerLastExitCode: "Last exit code",
  workerLastErrorSummary: "Last error summary",
  workerStatusFile: "Worker status file",
  workerFullDiagnostics: "\u041f\u043e\u043b\u043d\u044b\u0439 stdout/stderr \u043e\u0441\u0442\u0430\u0451\u0442\u0441\u044f \u0442\u043e\u043b\u044c\u043a\u043e \u0432 worker status file/report.",
  workerSandbox: "Sandbox",
  workerManualMode: "Manual Codex Desktop mode",
  workerManualHint: "\u041e\u0442\u043a\u0440\u043e\u0439\u0442\u0435 Codex Desktop \u0438 \u0432\u044b\u043f\u043e\u043b\u043d\u0438\u0442\u0435 \u0437\u0430\u0434\u0430\u0447\u0443 \u0438\u0437 .codex/tasks; worker \u0442\u043e\u043b\u044c\u043a\u043e \u0441\u043b\u0435\u0434\u0438\u0442 \u0437\u0430 report."
} as const;

const WORKER_DIAGNOSTIC_SUMMARY_LIMIT = 240;
const ACTION_START_GRACE_MS = 15_000;

export class DashboardService {
  private readonly fetchImpl: typeof fetch;
  private readonly projectStatusService: Pick<ProjectStatusService, "check">;
  private readonly codexWorkerService: Pick<CodexWorkerService, "readStatus" | "inspectEnvironment">;

  constructor(dependencies: DashboardDependencies = {}) {
    this.fetchImpl = dependencies.fetchImpl ?? fetch;
    this.projectStatusService = dependencies.projectStatusService ?? new ProjectStatusService();
    this.codexWorkerService = dependencies.codexWorkerService ?? new CodexWorkerService();
  }

  async collect(options: DashboardCollectOptions): Promise<DashboardSnapshot> {
    const [mcpServer, tunnel, codexWorker, ips, projects] = await Promise.all([
      this.readMcpStatus(options.config),
      this.readTunnelStatus(options.config),
      this.readCodexWorkerStatus(options.config),
      this.readIpInfo(options.config),
      this.readProjects(options.config)
    ]);

    return {
      generatedAt: new Date().toISOString(),
      orchestratorRoot: path.resolve(options.orchestratorRoot),
      configPath: options.configPath,
      configExists: options.configExists,
      components: {
        mcpServer,
        tunnel,
        codexWorker
      },
      ips,
      projects,
      actions: buildDashboardActions(options.config, {
        mcpServer,
        tunnel,
        codexWorker
      }, options.actionRuntime)
    };
  }

  async readPublicIp(config: DashboardConfig): Promise<DashboardIpInfo["publicIp"] | undefined> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.publicIpTimeoutMs);

    try {
      const response = await this.fetchImpl(config.publicIpLookupUrl, {
        signal: controller.signal,
        headers: { accept: "application/json" }
      });
      if (!response.ok) {
        return undefined;
      }

      const body = await response.json() as { ip?: string };
      return body.ip?.trim() || undefined;
    } catch {
      return undefined;
    } finally {
      clearTimeout(timeout);
    }
  }

  async readPublicIpGeo(
    config: DashboardConfig,
    ip: string | undefined
  ): Promise<{ city?: string; country?: string; geoStatus: DashboardIpInfo["geoStatus"]; geoDetails: string }> {
    if (!ip) {
      return {
        geoStatus: "unavailable",
        geoDetails: "\u0413\u0435\u043e\u043b\u043e\u043a\u0430\u0446\u0438\u044f \u043d\u0435\u0434\u043e\u0441\u0442\u0443\u043f\u043d\u0430, \u043f\u043e\u0442\u043e\u043c\u0443 \u0447\u0442\u043e \u043f\u0443\u0431\u043b\u0438\u0447\u043d\u044b\u0439 IP \u043d\u0435 \u043e\u043f\u0440\u0435\u0434\u0435\u043b\u0451\u043d."
      };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.publicIpTimeoutMs);
    const url = config.publicIpGeoLookupUrlTemplate.replace("{ip}", encodeURIComponent(ip));

    try {
      const response = await this.fetchImpl(url, {
        signal: controller.signal,
        headers: { accept: "application/json" }
      });

      if (!response.ok) {
        return {
          geoStatus: "unavailable",
          geoDetails: "\u0413\u0435\u043e\u043b\u043e\u043a\u0430\u0446\u0438\u044f \u043d\u0435 \u043e\u0442\u0432\u0435\u0442\u0438\u043b\u0430 \u0443\u0441\u043f\u0435\u0448\u043d\u043e."
        };
      }

      const body = await response.json() as { success?: boolean; city?: string; country?: string };
      if (body.success === false) {
        return {
          geoStatus: "unavailable",
          geoDetails: "\u0413\u0435\u043e\u043b\u043e\u043a\u0430\u0446\u0438\u044f \u0432\u0435\u0440\u043d\u0443\u043b\u0430 \u043e\u0442\u043a\u0430\u0437 \u0438\u043b\u0438 \u043d\u0435\u043f\u043e\u043b\u043d\u044b\u0435 \u0434\u0430\u043d\u043d\u044b\u0435."
        };
      }

      const city = body.city?.trim();
      const country = body.country?.trim();
      if (!city && !country) {
        return {
          geoStatus: "unavailable",
          geoDetails: "\u0413\u043e\u0440\u043e\u0434 \u0438 \u0441\u0442\u0440\u0430\u043d\u0430 \u043d\u0435 \u043e\u043f\u0440\u0435\u0434\u0435\u043b\u0435\u043d\u044b."
        };
      }

      return {
        city,
        country,
        geoStatus: "available",
        geoDetails: "\u0413\u0435\u043e\u043b\u043e\u043a\u0430\u0446\u0438\u044f \u043e\u043f\u0440\u0435\u0434\u0435\u043b\u0435\u043d\u0430 \u043f\u043e \u043f\u0443\u0431\u043b\u0438\u0447\u043d\u043e\u043c\u0443 IP."
      };
    } catch {
      return {
        geoStatus: "unavailable",
        geoDetails: "\u0413\u0435\u043e\u043b\u043e\u043a\u0430\u0446\u0438\u044f \u043d\u0435\u0434\u043e\u0441\u0442\u0443\u043f\u043d\u0430 \u043f\u043e \u0442\u0430\u0439\u043c\u0430\u0443\u0442\u0443, \u043e\u0444\u043b\u0430\u0439\u043d \u0438\u043b\u0438 \u0447\u0435\u0440\u0435\u0437 VPN."
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private async readProjects(config: DashboardConfig): Promise<DashboardProjectCard[]> {
    return Promise.all(
      config.managedProjects.map(async (project) => {
        try {
          const status = await this.projectStatusService.check({
            projectPath: project.path,
            includeDoctor: true,
            includeReview: true
          });
          return mapProjectStatus(project.name, status);
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            name: project.name,
            path: project.path,
            ok: false,
            summary: "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043f\u043e\u043b\u0443\u0447\u0438\u0442\u044c \u0441\u0442\u0430\u0442\u0443\u0441 \u043f\u0440\u043e\u0435\u043a\u0442\u0430.",
            errors: [message],
            warnings: []
          };
        }
      })
    );
  }

  private async readIpInfo(config: DashboardConfig): Promise<DashboardIpInfo> {
    const local = getLocalIpv4Addresses();
    const publicIp = await this.readPublicIp(config);
    const geo = await this.readPublicIpGeo(config, publicIp);

    return {
      local,
      publicIp,
      publicIpStatus: publicIp ? "available" : "unavailable",
      publicIpDetails: publicIp
        ? "\u041f\u0443\u0431\u043b\u0438\u0447\u043d\u044b\u0439 IP \u043e\u043f\u0440\u0435\u0434\u0435\u043b\u0451\u043d."
        : "\u041f\u0443\u0431\u043b\u0438\u0447\u043d\u044b\u0439 IP \u043d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043e\u043f\u0440\u0435\u0434\u0435\u043b\u0438\u0442\u044c: \u0442\u0430\u0439\u043c\u0430\u0443\u0442, \u043e\u0444\u043b\u0430\u0439\u043d \u0438\u043b\u0438 \u043e\u0442\u0441\u0443\u0442\u0441\u0442\u0432\u0438\u0435 \u043e\u0442\u0432\u0435\u0442\u0430.",
      city: geo.city,
      country: geo.country,
      geoStatus: geo.geoStatus,
      geoDetails: geo.geoDetails
    };
  }

  private async readMcpStatus(config: DashboardConfig): Promise<DashboardComponentStatus> {
    if (!config.health.mcpHealthUrl) {
      return {
        name: "MCP",
        state: config.commands.mcpServer ? "manual" : "offline",
        details: config.commands.mcpServer
          ? "\u041a\u043e\u043c\u0430\u043d\u0434\u0430 \u0437\u0430\u043f\u0443\u0441\u043a\u0430 \u043d\u0430\u0441\u0442\u0440\u043e\u0435\u043d\u0430. \u0414\u043b\u044f stdio MCP-\u0441\u0435\u0440\u0432\u0435\u0440\u0430 \u043d\u0435 \u0437\u0430\u0434\u0430\u043d \u043e\u0442\u0434\u0435\u043b\u044c\u043d\u044b\u0439 HTTP health-check."
          : "\u041d\u0435 \u043d\u0430\u0441\u0442\u0440\u043e\u0435\u043d\u044b \u043d\u0438 \u043a\u043e\u043c\u0430\u043d\u0434\u0430 \u0437\u0430\u043f\u0443\u0441\u043a\u0430 MCP, \u043d\u0438 health-check.",
        actionLabel: RU.startMcp,
        actionState: config.commands.mcpServer ? "idle" : "disabled"
      };
    }

    const probe = await probeUrl(this.fetchImpl, config.health.mcpHealthUrl, config.publicIpTimeoutMs);
    return {
      name: "MCP",
      state: probe.ok ? "online" : "offline",
      details: probe.ok
        ? `\u0421\u0435\u0440\u0432\u0438\u0441 \u043e\u0442\u0432\u0435\u0447\u0430\u0435\u0442 \u043f\u043e ${config.health.mcpHealthUrl}`
        : `\u041f\u0440\u043e\u0432\u0435\u0440\u043a\u0430 health \u043d\u0435 \u043f\u0440\u043e\u0448\u043b\u0430 \u043f\u043e ${config.health.mcpHealthUrl}`,
      actionLabel: RU.startMcp,
      actionState: probe.ok ? "running" : "failed"
    };
  }

  private async readTunnelStatus(config: DashboardConfig): Promise<DashboardComponentStatus> {
    const [health, ready] = await Promise.all([
      probeUrl(this.fetchImpl, config.health.tunnelHealthUrl, config.publicIpTimeoutMs),
      probeUrl(this.fetchImpl, config.health.tunnelReadyUrl, config.publicIpTimeoutMs)
    ]);

    if (health.ok && ready.ok) {
      return {
        name: "Tunnel",
        state: "online",
        details: `Tunnel \u043e\u0442\u0432\u0435\u0447\u0430\u0435\u0442 \u0438 \u0433\u043e\u0442\u043e\u0432 \u043f\u043e ${config.health.tunnelHealthUrl} / ${config.health.tunnelReadyUrl}`,
        actionLabel: RU.startTunnel,
        actionState: "running"
      };
    }

    if (health.ok && !ready.ok) {
      return {
        name: "Tunnel",
        state: "degraded",
        details: `healthz \u043e\u0442\u0432\u0435\u0447\u0430\u0435\u0442, \u043d\u043e readyz \u0435\u0449\u0451 \u043d\u0435 \u0433\u043e\u0442\u043e\u0432 \u043f\u043e ${config.health.tunnelReadyUrl}`,
        actionLabel: RU.startTunnel,
        actionState: "starting"
      };
    }

    return {
      name: "Tunnel",
      state: config.commands.tunnel ? "offline" : "manual",
      details: config.commands.tunnel
        ? `\u041f\u0440\u043e\u0432\u0435\u0440\u043a\u0430 tunnel \u043d\u0435 \u043f\u0440\u043e\u0448\u043b\u0430 \u043f\u043e ${config.health.tunnelHealthUrl}. \u0418\u0441\u043f\u043e\u043b\u044c\u0437\u0443\u0439\u0442\u0435 \u043a\u043d\u043e\u043f\u043a\u0443 \u0437\u0430\u043f\u0443\u0441\u043a\u0430.`
        : `\u041f\u0440\u043e\u0432\u0435\u0440\u043a\u0430 tunnel \u043d\u0435 \u043f\u0440\u043e\u0448\u043b\u0430 \u043f\u043e ${config.health.tunnelHealthUrl}. \u0414\u043e\u0431\u0430\u0432\u044c\u0442\u0435 \u043a\u043e\u043c\u0430\u043d\u0434\u0443 tunnel \u0432 local config \u0434\u043b\u044f \u0437\u0430\u043f\u0443\u0441\u043a\u0430 \u0432 \u043e\u0434\u0438\u043d \u043a\u043b\u0438\u043a.`,
      actionLabel: RU.startTunnel,
      actionState: config.commands.tunnel ? "idle" : "disabled"
    };
  }

  private async readCodexWorkerStatus(config: DashboardConfig): Promise<DashboardComponentStatus> {
    const status = await this.codexWorkerService.readStatus(config.worker.statusFilePath);
    if (!status) {
      const runtime = await this.codexWorkerService.inspectEnvironment(config.worker.directExecution);
      return {
        name: "Codex Worker",
        state: config.commands.codexWorker ? "manual" : "offline",
        details: config.worker.directExecution.enabled ? RU.workerNotStarted : `${RU.workerManualMode}: ${RU.workerManualHint}`,
        actionLabel: RU.startCodexWorker,
        actionState: config.commands.codexWorker ? "idle" : "disabled",
        meta: [...buildWorkerMeta(runtime, config.worker.statusFilePath), `${RU.workerLimitations}: ${RU.workerDirectLaunch}`]
      };
    }

    return mapWorkerStatus(status, config.worker.statusFilePath);
  }
}

export function renderDashboardHtml(snapshot: DashboardSnapshot, config: DashboardConfig, options: DashboardRenderOptions = {}): string {
  const refreshSeconds = Math.max(10, config.refreshIntervalSeconds);
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="refresh" content="${refreshSeconds}" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Fmax-Orchestrator Dashboard</title>
  <style>
    :root {
      --bg: #f4efe7;
      --card: #fffaf2;
      --ink: #1d1d1b;
      --muted: #645d55;
      --line: #dbcdb8;
      --accent: #22543d;
      --warn: #a85d16;
      --bad: #9b2226;
      --shadow: 0 18px 40px rgba(58, 42, 25, 0.08);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Segoe UI", "Trebuchet MS", sans-serif;
      background:
        radial-gradient(circle at top left, rgba(255,255,255,0.9), transparent 28%),
        linear-gradient(135deg, #efe4d2 0%, var(--bg) 55%, #e9dcc6 100%);
      color: var(--ink);
    }
    main {
      max-width: 1180px;
      margin: 0 auto;
      padding: 28px 20px 48px;
    }
    h1, h2, h3, p { margin-top: 0; }
    .hero, .card {
      background: rgba(255,250,242,0.92);
      border: 1px solid var(--line);
      border-radius: 24px;
      box-shadow: var(--shadow);
    }
    .hero { padding: 26px; margin-bottom: 20px; }
    .hero-grid, .actions, .component-grid, .project-grid {
      display: grid;
      gap: 16px;
    }
    .hero-grid { grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); }
    .actions { grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); margin: 18px 0 6px; }
    .component-grid, .project-grid { grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }
    .card { padding: 18px; }
    .flash {
      margin: 0 0 18px;
      padding: 14px 16px;
      border-radius: 16px;
      border: 1px solid var(--line);
      background: #fff8e8;
    }
    .flash.error {
      border-color: #f0b7b9;
      background: #fff1f1;
      color: var(--bad);
    }
    .flash.ok {
      border-color: #b9dfc7;
      background: #effaf2;
      color: var(--accent);
    }
    .eyebrow, .muted { color: var(--muted); font-size: 14px; }
    .pill {
      display: inline-flex;
      align-items: center;
      padding: 6px 10px;
      border-radius: 999px;
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0.02em;
    }
    .online { background: #d8f3dc; color: var(--accent); }
    .degraded { background: #fff1c9; color: var(--warn); }
    .offline { background: #ffd9d9; color: var(--bad); }
    .manual { background: #ece7df; color: #4f4a44; }
    .action-form { margin: 0; }
    .action-button {
      width: 100%;
      border: 0;
      border-radius: 8px;
      padding: 11px 12px;
      color: white;
      font-size: 15px;
      font-weight: 700;
      cursor: pointer;
      display: grid;
      gap: 4px;
      text-align: left;
      min-height: 62px;
    }
    .action-button.idle {
      background: #1d4ed8;
    }
    .action-button.starting {
      background: #2563eb;
    }
    .action-button.running {
      background: #15803d;
    }
    .action-button.failed {
      background: #b91c1c;
    }
    .action-button.disabled {
      background: #8f8f8f;
      cursor: not-allowed;
    }
    .action-state {
      font-size: 12px;
      font-weight: 700;
      opacity: 0.9;
      text-transform: uppercase;
    }
    code {
      font-family: "Cascadia Code", "Consolas", monospace;
      font-size: 13px;
      background: rgba(34, 84, 61, 0.08);
      padding: 1px 6px;
      border-radius: 7px;
      overflow-wrap: anywhere;
    }
    ul.meta {
      list-style: none;
      padding: 0;
      margin: 12px 0 0;
      display: grid;
      gap: 8px;
    }
    .card h3 { margin-bottom: 10px; }
    .card p, .card li, .muted {
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .card p, ul.meta li {
      display: -webkit-box;
      -webkit-line-clamp: 4;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    ul.meta li {
      max-height: 5.8em;
    }
    .project-grid .card { min-height: 260px; }
  </style>
</head>
<body>
  <main>
    <section class="hero">
      <div class="hero-grid">
        <div>
          <p class="eyebrow">${RU.heroEyebrow}</p>
          <h1>${RU.heroTitle}</h1>
          <p class="muted">${RU.refreshPrefix} ${refreshSeconds} ${RU.refreshSuffix} ${escapeHtml(snapshot.generatedAt)}.</p>
        </div>
        <div>
          <p class="eyebrow">${RU.localConfig}</p>
          <p><code>${escapeHtml(snapshot.configPath)}</code></p>
          <p class="muted">${snapshot.configExists ? RU.configLoaded : RU.configMissing}</p>
        </div>
        <div>
          <p class="eyebrow">${RU.ipBlock}</p>
          <ul class="meta">
            <li>${RU.localIpv4}: ${escapeHtml(snapshot.ips.local.join(", ") || RU.notDetected)}</li>
            <li>${RU.publicIp}: ${escapeHtml(snapshot.ips.publicIp ?? RU.unavailable)}</li>
            <li>${RU.city}: ${escapeHtml(snapshot.ips.city ?? RU.cityMissing)}</li>
            <li>${RU.country}: ${escapeHtml(snapshot.ips.country ?? RU.countryMissing)}</li>
            <li class="muted">${escapeHtml(snapshot.ips.publicIpDetails)}</li>
            <li class="muted">${escapeHtml(snapshot.ips.geoDetails)}</li>
          </ul>
        </div>
      </div>
      <div class="actions">
        ${snapshot.actions.map((action) => renderActionButton(action)).join("")}
      </div>
    </section>
    ${options.flash ? `<div class="flash ${options.flash.kind}">${escapeHtml(options.flash.text)}</div>` : ""}
    <section class="component-grid">
      ${renderComponentCard(snapshot.components.mcpServer)}
      ${renderComponentCard(snapshot.components.tunnel)}
      ${renderComponentCard(snapshot.components.codexWorker)}
    </section>
    <section>
      <h2>${RU.managedProjects}</h2>
      <div class="project-grid">
        ${snapshot.projects.map(renderProjectCard).join("")}
      </div>
    </section>
  </main>
</body>
</html>`;
}

function renderActionButton(action: DashboardSnapshot["actions"][number]): string {
  return `<form class="action-form" method="POST" action="/action/${encodeURIComponent(action.id)}">
    <button class="action-button ${escapeHtml(action.state)}" ${action.enabled ? "" : "disabled"} title="${escapeHtml(action.reason ?? action.details ?? action.statusText)}">
      <span>${escapeHtml(action.label)}</span>
      <span class="action-state">${escapeHtml(action.statusText)}</span>
    </button>
    ${action.details ? `<div class="muted">${escapeHtml(action.details)}</div>` : ""}
    ${!action.enabled && action.reason ? `<div class="muted">${escapeHtml(action.reason)}</div>` : ""}
  </form>`;
}

function renderComponentCard(component: DashboardComponentStatus): string {
  return `<article class="card">
    <p class="pill ${component.state}">${escapeHtml(localizeComponentState(component.state))}</p>
    <h3>${escapeHtml(component.name)}</h3>
    <p>${escapeHtml(component.details)}</p>
    ${component.meta?.length ? `<ul class="meta">${component.meta.map((item) => `<li title="${escapeHtml(item)}">${escapeHtml(item)}</li>`).join("")}</ul>` : ""}
    ${component.actionLabel ? `<p class="muted">${RU.actionAvailable}: ${escapeHtml(component.actionLabel)}</p>` : ""}
  </article>`;
}

function renderProjectCard(project: DashboardProjectCard): string {
  return `<article class="card">
    <p class="pill ${project.ok ? "online" : "offline"}">${escapeHtml(project.ok ? RU.projectReady : RU.projectFailed)}</p>
    <h3>${escapeHtml(project.name)}</h3>
    <p><code>${escapeHtml(project.path)}</code></p>
    <p>${escapeHtml(project.summary)}</p>
    <ul class="meta">
      ${project.currentTask ? `<li>${RU.currentTask}: ${escapeHtml(project.currentTask)}</li>` : ""}
      ${project.doctorResult ? `<li>${RU.doctor}: ${escapeHtml(localizeDoctorResult(project.doctorResult))} (${escapeHtml(project.doctorResult)})</li>` : ""}
      ${project.gitStatus ? `<li>${RU.git}: ${escapeHtml(localizeGitStatus(project.gitStatus))} (${escapeHtml(project.gitStatus)})</li>` : ""}
      ${project.waitingFor ? `<li>${RU.waitingFor}: ${escapeHtml(localizeRelayValue(project.waitingFor))} (${escapeHtml(project.waitingFor)})</li>` : ""}
      ${project.nextActor ? `<li>${RU.nextActor}: ${escapeHtml(localizeRelayValue(project.nextActor))} (${escapeHtml(project.nextActor)})</li>` : ""}
      ${project.recommendedAction ? `<li>${RU.recommendedAction}: ${escapeHtml(localizeRecommendedAction(project.recommendedAction))} (${escapeHtml(project.recommendedAction)})</li>` : ""}
      ${project.nextAction ? `<li>${RU.nextStep}: ${escapeHtml(project.nextAction)}</li>` : ""}
      ${project.warnings.map((warning) => `<li class="muted">${RU.warning}: ${escapeHtml(warning)}</li>`).join("")}
      ${project.errors.map((error) => `<li class="muted">${RU.error}: ${escapeHtml(error)}</li>`).join("")}
    </ul>
  </article>`;
}

export function buildDashboardActions(
  config: DashboardConfig,
  components?: DashboardSnapshot["components"],
  runtime: DashboardActionRuntimeMap = {}
): DashboardActionState[] {
  const openVpnEnabled = Boolean(config.apps.vpnPath);
  const startTunnelEnabled = Boolean(config.commands.tunnel);
  const startMcpEnabled = Boolean(config.commands.mcpServer);
  const openCodexEnabled = Boolean(config.apps.codexPath);
  const startWorkerEnabled = Boolean(config.commands.codexWorker);
  const openChatgptEnabled = Boolean(config.apps.chatgptUrl);

  const openVpnState = buildLaunchActionState(openVpnEnabled, runtime["open-vpn"]);
  const tunnelState = buildServiceActionState(startTunnelEnabled, components?.tunnel.actionState, runtime["start-tunnel"], components?.tunnel.details);
  const mcpState = buildMcpActionState(
    startMcpEnabled,
    Boolean(config.health.mcpHealthUrl),
    components?.mcpServer.actionState,
    runtime["start-mcp"],
    components?.mcpServer.details,
    components?.tunnel.actionState
  );
  const openChatgptState = buildLaunchActionState(openChatgptEnabled, runtime["open-chatgpt"]);
  const openCodexState = buildLaunchActionState(openCodexEnabled, runtime["open-codex"]);
  const openConfigState = buildLaunchActionState(true, runtime["open-config"]);
  const workerState = buildWorkerActionState(startWorkerEnabled, components?.codexWorker.actionState, runtime["start-codex-worker"], components?.codexWorker.details);

  return [
    {
      id: "open-vpn",
      label: RU.openVpn,
      enabled: openVpnEnabled,
      ...openVpnState,
      reason: openVpnEnabled ? undefined : "\u0423\u043a\u0430\u0436\u0438\u0442\u0435 apps.vpnPath \u0432 scripts/fmax-orchestrator.config.local.json"
    },
    {
      id: "start-tunnel",
      label: RU.startTunnel,
      enabled: startTunnelEnabled,
      ...tunnelState,
      reason: startTunnelEnabled ? undefined : "\u0423\u043a\u0430\u0436\u0438\u0442\u0435 commands.tunnel \u0432 local config"
    },
    {
      id: "start-mcp",
      label: RU.startMcp,
      enabled: startMcpEnabled,
      ...mcpState,
      reason: startMcpEnabled ? undefined : "\u0423\u043a\u0430\u0436\u0438\u0442\u0435 commands.mcpServer \u0432 local config"
    },
    {
      id: "open-chatgpt",
      label: RU.openChatgpt,
      enabled: openChatgptEnabled,
      ...openChatgptState,
      reason: openChatgptEnabled ? undefined : "\u0423\u043a\u0430\u0436\u0438\u0442\u0435 apps.chatgptUrl \u0432 local config"
    },
    {
      id: "open-codex",
      label: RU.openCodex,
      enabled: openCodexEnabled,
      ...openCodexState,
      reason: openCodexEnabled ? undefined : "\u0423\u043a\u0430\u0436\u0438\u0442\u0435 apps.codexPath \u0432 scripts/fmax-orchestrator.config.local.json"
    },
    {
      id: "open-config",
      label: RU.openConfig,
      enabled: true,
      ...openConfigState
    },
    {
      id: "start-codex-worker",
      label: RU.startCodexWorker,
      enabled: startWorkerEnabled,
      ...workerState,
      reason: startWorkerEnabled ? undefined : "\u0423\u043a\u0430\u0436\u0438\u0442\u0435 commands.codexWorker \u0432 local config"
    }
  ];
}

function buildActionState(
  enabled: boolean,
  state: Exclude<DashboardActionVisualState, "disabled">,
  details?: string
): Pick<DashboardActionState, "state" | "statusText" | "details"> {
  const resolvedState = enabled ? state : "disabled";
  return {
    state: resolvedState,
    statusText: localizeActionState(resolvedState),
    details
  };
}

function buildLaunchActionState(
  enabled: boolean,
  runtime: DashboardActionRuntimeState | undefined
): Pick<DashboardActionState, "state" | "statusText" | "details"> {
  if (!enabled) {
    return buildActionState(false, "idle");
  }

  if (runtime?.state === "failed") {
    return buildActionState(true, "failed", runtime.message);
  }

  return buildActionState(true, "idle", runtime?.message);
}

function buildServiceActionState(
  enabled: boolean,
  componentState: DashboardActionVisualState | undefined,
  runtime: DashboardActionRuntimeState | undefined,
  componentDetails?: string
): Pick<DashboardActionState, "state" | "statusText" | "details"> {
  if (!enabled) {
    return buildActionState(false, "idle");
  }

  if (componentState === "running") {
    return buildActionState(true, "running", componentDetails);
  }

  if (componentState === "starting") {
    return buildActionState(true, "starting", componentDetails);
  }

  if (runtime?.state === "starting" && isRuntimeFresh(runtime)) {
    return buildActionState(true, "starting", runtime.message);
  }

  if (componentState === "failed" || runtime?.state === "failed" || (runtime?.state === "starting" && !isRuntimeFresh(runtime))) {
    return buildActionState(true, "failed", runtime?.message ?? componentDetails);
  }

  return buildActionState(true, "idle");
}

function buildMcpActionState(
  enabled: boolean,
  hasReliableHealth: boolean,
  componentState: DashboardActionVisualState | undefined,
  runtime: DashboardActionRuntimeState | undefined,
  componentDetails?: string,
  tunnelActionState?: DashboardActionVisualState
): Pick<DashboardActionState, "state" | "statusText" | "details"> {
  if (!hasReliableHealth) {
    if (!enabled) {
      return buildActionState(false, "idle");
    }

    if (runtime?.state === "failed") {
      return buildActionState(true, "failed", runtime.message);
    }

    if (runtime?.state === "starting" && isRuntimeFresh(runtime)) {
      return buildActionState(true, "starting", runtime.message);
    }

    if (tunnelActionState === "running") {
      return {
        state: "running",
        statusText: "\u0447\u0435\u0440\u0435\u0437 tunnel",
        details: componentDetails
          ? `${componentDetails} \u041e\u0441\u043d\u043e\u0432\u043d\u043e\u0439 MCP \u0434\u043e\u0441\u0442\u0443\u043f\u0435\u043d \u0447\u0435\u0440\u0435\u0437 \u0433\u043e\u0442\u043e\u0432\u044b\u0439 tunnel.`
          : "\u041e\u0441\u043d\u043e\u0432\u043d\u043e\u0439 MCP \u0434\u043e\u0441\u0442\u0443\u043f\u0435\u043d \u0447\u0435\u0440\u0435\u0437 \u0433\u043e\u0442\u043e\u0432\u044b\u0439 tunnel."
      };
    }

    return buildActionState(
      true,
      "idle",
      componentDetails ?? "\u0414\u043b\u044f stdio MCP-\u0441\u0435\u0440\u0432\u0435\u0440\u0430 \u043d\u0435\u0442 \u0434\u043e\u0441\u0442\u043e\u0432\u0435\u0440\u043d\u043e\u0433\u043e HTTP health-check; \u0440\u0430\u0431\u043e\u0442\u0443 \u043f\u0440\u043e\u0432\u0435\u0440\u044f\u0435\u043c \u0447\u0435\u0440\u0435\u0437 MCP self-test \u0438 tunnel readyz."
    );
  }

  return buildServiceActionState(enabled, componentState, runtime, componentDetails);
}

function buildWorkerActionState(
  enabled: boolean,
  componentState: DashboardActionVisualState | undefined,
  runtime: DashboardActionRuntimeState | undefined,
  componentDetails?: string
): Pick<DashboardActionState, "state" | "statusText" | "details"> {
  return buildServiceActionState(enabled, componentState, runtime, componentDetails);
}

function isRuntimeFresh(runtime: DashboardActionRuntimeState): boolean {
  if (!runtime.updatedAt) {
    return false;
  }

  const updatedAt = Date.parse(runtime.updatedAt);
  return Number.isFinite(updatedAt) && Date.now() - updatedAt <= ACTION_START_GRACE_MS;
}

function mapProjectStatus(name: string, status: ProjectStatusResult): DashboardProjectCard {
  return {
    name,
    path: status.projectPath,
    ok: status.errors.length === 0,
    summary: status.currentTask
      ? `${status.currentTask.id}: ${localizeTaskStatus(status.currentTask.status)}; ${localizeNextActionText(status.nextAction)}`
      : `\u0421\u043b\u0435\u0434\u0443\u044e\u0449\u0438\u0439 \u0448\u0430\u0433: ${localizeNextActionText(status.nextAction)}`,
    waitingFor: status.waitingFor,
    nextActor: status.nextActor,
    nextAction: localizeNextActionText(status.nextAction),
    recommendedAction: status.recommendedAction,
    doctorResult: status.doctor?.result,
    gitStatus: status.git.status,
    currentTask: status.currentTask ? `${status.currentTask.id} - ${status.currentTask.title}` : undefined,
    errors: status.errors,
    warnings: status.warnings
  };
}

function mapWorkerStatus(status: CodexWorkerStatus, statusFilePath: string): DashboardComponentStatus {
  const state = workerStateToComponentState(status.state, status.codexCli.directExecutionEnabled);
  const meta = [
    status.currentTask
      ? `${RU.workerTask}: ${status.currentTask.projectName} / ${status.currentTask.taskId} / ${status.currentTask.title}`
      : `${RU.workerTask}: \u043d\u0435\u0442`,
    `${RU.workerReport}: ${status.lastReportStatus === "detected" ? "\u043d\u0430\u0439\u0434\u0435\u043d" : "\u0435\u0449\u0451 \u043d\u0435\u0442"}`,
    ...buildWorkerMeta(status.codexCli, statusFilePath),
    `${RU.workerLimitations}: ${RU.workerDirectLaunch}`
  ];

  return {
    name: "Codex Worker",
    state,
    details: `${status.message} (${status.updatedAt})`,
    actionLabel: RU.startCodexWorker,
    actionState: workerStateToActionState(status.state, status.codexCli.directExecutionEnabled),
    meta
  };
}

function workerStateToActionState(state: CodexWorkerStatus["state"], directExecutionEnabled: boolean): DashboardActionVisualState {
  if (!directExecutionEnabled && state !== "error") {
    return "idle";
  }

  switch (state) {
    case "idle":
      return "idle";
    case "task_found":
    case "waiting_for_codex":
    case "report_detected":
      return "running";
    case "error":
      return "failed";
  }
}

function buildWorkerMeta(status: CodexWorkerStatus["codexCli"], statusFilePath: string): string[] {
  const lastErrorSummary = summarizeWorkerDiagnostic(status.lastError);
  if (!status.directExecutionEnabled) {
    return [
      `${RU.workerManualMode}: ${RU.workerManualHint}`,
      `${RU.workerCliFound}: ${status.checked === false ? "\u043d\u0435 \u043f\u0440\u043e\u0432\u0435\u0440\u044f\u043b\u0441\u044f" : status.found ? "\u043d\u0430\u0439\u0434\u0435\u043d" : "\u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d"}`,
      `${RU.workerExecAvailable}: \u043e\u0442\u043a\u043b\u044e\u0447\u0451\u043d`,
      `${RU.workerDirectExecution}: \u0432\u044b\u043a\u043b\u044e\u0447\u0435\u043d\u043e`,
      `${RU.workerSandbox}: ${status.sandbox}`,
      `${RU.workerLastExitCode}: ${status.lastExitCode ?? "\u043d\u0435\u0442"}`,
      `${RU.workerLastErrorSummary}: ${lastErrorSummary ?? "\u043d\u0435\u0442"}`,
      `${RU.workerStatusFile}: ${statusFilePath}`,
      ...(status.lastError && status.checked !== false ? [RU.workerFullDiagnostics] : [])
    ];
  }

  return [
    `${RU.workerCliFound}: ${status.found ? "\u043d\u0430\u0439\u0434\u0435\u043d" : "\u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d"}`,
    `${RU.workerExecAvailable}: ${status.execAvailable ? "\u0434\u043e\u0441\u0442\u0443\u043f\u0435\u043d" : "\u043d\u0435 \u0434\u043e\u0441\u0442\u0443\u043f\u0435\u043d"}`,
    `${RU.workerDirectExecution}: ${status.directExecutionEnabled ? "\u0432\u043a\u043b\u044e\u0447\u0435\u043d\u043e" : "\u0432\u044b\u043a\u043b\u044e\u0447\u0435\u043d\u043e"}`,
    `${RU.workerSandbox}: ${status.sandbox}`,
    `${RU.workerLastExitCode}: ${status.lastExitCode ?? "\u043d\u0435\u0442"}`,
    `${RU.workerLastErrorSummary}: ${lastErrorSummary ?? "\u043d\u0435\u0442"}`,
    `${RU.workerStatusFile}: ${statusFilePath}`,
    ...(status.lastError ? [RU.workerFullDiagnostics] : [])
  ];
}

function summarizeWorkerDiagnostic(value: string | undefined): string | undefined {
  const compact = value?.replace(/\s+/gu, " ").trim();
  if (!compact) {
    return undefined;
  }

  if (looksLikeRawCodexSessionLog(compact)) {
    const nestedMessage = [
      extractPattern(compact, /Access is denied\./iu),
      extractPattern(compact, /Failed to start [^.]+/iu),
      extractPattern(compact, /spawn EINVAL/iu),
      extractPattern(compact, /PSSecurityException/iu),
      extractPattern(compact, /sandbox[^.]+denied[^.]*/iu),
      extractPattern(compact, /report was not detected[^.]*/iu)
    ].find(Boolean);

    if (nestedMessage) {
      return trimDiagnosticSummary(nestedMessage);
    }

    return "Captured Codex session log is available in the worker status file.";
  }

  return trimDiagnosticSummary(compact);
}

function trimDiagnosticSummary(value: string): string {
  return value.length > WORKER_DIAGNOSTIC_SUMMARY_LIMIT
    ? `${value.slice(0, WORKER_DIAGNOSTIC_SUMMARY_LIMIT - 1)}...`
    : value;
}

function looksLikeRawCodexSessionLog(value: string): boolean {
  return value.includes("OpenAI Codex v")
    || value.includes("OpenAI Codex session")
    || value.includes("session id:")
    || value.includes("workdir:")
    || value.includes("approval:")
    || value.includes("sandbox:")
    || value.includes("user 1. Open task file");
}

function extractPattern(value: string, pattern: RegExp): string | undefined {
  return value.match(pattern)?.[0];
}

function workerStateToComponentState(state: CodexWorkerStatus["state"], directExecutionEnabled: boolean): DashboardComponentState {
  if (!directExecutionEnabled && state !== "error") {
    return "manual";
  }

  switch (state) {
    case "idle":
      return "manual";
    case "task_found":
    case "waiting_for_codex":
      return "degraded";
    case "report_detected":
      return "online";
    case "error":
      return "offline";
  }
}

function localizeComponentState(state: DashboardComponentState): string {
  return ({
    online: "\u041e\u041d\u041b\u0410\u0419\u041d",
    degraded: "\u0427\u0410\u0421\u0422\u0418\u0427\u041d\u041e",
    offline: "\u041d\u0415 \u0412 \u0421\u0415\u0422\u0418",
    manual: "\u0420\u0423\u0427\u041d\u041e\u0419"
  } as Record<DashboardComponentState, string>)[state];
}

function localizeActionState(state: DashboardActionVisualState): string {
  return ({
    idle: RU.actionIdle,
    starting: RU.actionStarting,
    running: RU.actionRunning,
    failed: RU.actionFailed,
    disabled: RU.actionDisabled
  } as Record<DashboardActionVisualState, string>)[state];
}

function localizeTaskStatus(status: string): string {
  return ({
    pending: "\u043e\u0436\u0438\u0434\u0430\u0435\u0442 \u0432\u044b\u043f\u043e\u043b\u043d\u0435\u043d\u0438\u044f",
    reported: "\u043e\u0442\u0447\u0451\u0442 \u0433\u043e\u0442\u043e\u0432",
    approved: "\u043e\u0434\u043e\u0431\u0440\u0435\u043d\u0430",
    rejected: "\u043e\u0442\u043a\u043b\u043e\u043d\u0435\u043d\u0430",
    archived: "\u0432 \u0430\u0440\u0445\u0438\u0432\u0435"
  } as Record<string, string>)[status] ?? status;
}

function localizeDoctorResult(value: string): string {
  return ({
    READY: "\u0433\u043e\u0442\u043e\u0432\u043e",
    READY_WITH_WARNINGS: "\u0433\u043e\u0442\u043e\u0432\u043e \u0441 \u043f\u0440\u0435\u0434\u0443\u043f\u0440\u0435\u0436\u0434\u0435\u043d\u0438\u044f\u043c\u0438",
    NOT_READY: "\u043d\u0435 \u0433\u043e\u0442\u043e\u0432\u043e"
  } as Record<string, string>)[value] ?? value;
}

function localizeGitStatus(value: string): string {
  return ({
    clean: "\u0447\u0438\u0441\u0442\u043e",
    dirty: "\u0435\u0441\u0442\u044c \u0438\u0437\u043c\u0435\u043d\u0435\u043d\u0438\u044f",
    unknown: "\u043d\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043d\u043e"
  } as Record<string, string>)[value] ?? value;
}

function localizeRelayValue(value: string): string {
  return ({
    user: "\u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u044c",
    chatgpt: "ChatGPT",
    codex: "Codex",
    review: "review",
    commit: "commit"
  } as Record<string, string>)[value] ?? value;
}

function localizeRecommendedAction(value: string): string {
  return ({
    fix_blockers: "\u0443\u0441\u0442\u0440\u0430\u043d\u0438\u0442\u044c \u0431\u043b\u043e\u043a\u0435\u0440\u044b",
    wait_for_codex_or_request_report: "\u0434\u043e\u0436\u0434\u0430\u0442\u044c\u0441\u044f Codex \u0438\u043b\u0438 \u043e\u0442\u0447\u0451\u0442\u0430",
    run_review_gate: "\u0437\u0430\u043f\u0443\u0441\u0442\u0438\u0442\u044c review_gate",
    rerun_review_gate: "\u043f\u0435\u0440\u0435\u0437\u0430\u043f\u0443\u0441\u0442\u0438\u0442\u044c review_gate",
    approve_task: "\u043e\u0434\u043e\u0431\u0440\u0438\u0442\u044c \u0437\u0430\u0434\u0430\u0447\u0443",
    commit_changes: "\u0441\u0434\u0435\u043b\u0430\u0442\u044c commit \u0438\u0437\u043c\u0435\u043d\u0435\u043d\u0438\u0439",
    create_next_task: "\u0441\u043e\u0437\u0434\u0430\u0442\u044c \u0441\u043b\u0435\u0434\u0443\u044e\u0449\u0443\u044e \u0437\u0430\u0434\u0430\u0447\u0443",
    create_task: "\u0441\u043e\u0437\u0434\u0430\u0442\u044c \u0437\u0430\u0434\u0430\u0447\u0443"
  } as Record<string, string>)[value] ?? value;
}

function localizeNextActionText(value: string): string {
  const mapped = ({
    "Resolve doctor, policy, or Git blockers before continuing the relay workflow.":
      "\u0423\u0441\u0442\u0440\u0430\u043d\u0438\u0442\u0435 \u0431\u043b\u043e\u043a\u0435\u0440\u044b doctor, policy \u0438\u043b\u0438 Git \u043f\u0435\u0440\u0435\u0434 \u043f\u0440\u043e\u0434\u043e\u043b\u0436\u0435\u043d\u0438\u0435\u043c relay workflow.",
    "Create the next task through create_task.": "\u0421\u043e\u0437\u0434\u0430\u0439\u0442\u0435 \u0441\u043b\u0435\u0434\u0443\u044e\u0449\u0443\u044e \u0437\u0430\u0434\u0430\u0447\u0443 \u0447\u0435\u0440\u0435\u0437 create_task.",
    "Open Codex Desktop and execute the next pending task.":
      "\u041e\u0442\u043a\u0440\u043e\u0439\u0442\u0435 Codex Desktop \u0438 \u0432\u044b\u043f\u043e\u043b\u043d\u0438\u0442\u0435 \u0441\u043b\u0435\u0434\u0443\u044e\u0449\u0443\u044e pending task.",
    "Run review_gate for the current task.": "\u0417\u0430\u043f\u0443\u0441\u0442\u0438\u0442\u0435 review_gate \u0434\u043b\u044f \u0442\u0435\u043a\u0443\u0449\u0435\u0439 \u0437\u0430\u0434\u0430\u0447\u0438.",
    "Rerun review_gate for the current task.": "\u041f\u0435\u0440\u0435\u0437\u0430\u043f\u0443\u0441\u0442\u0438\u0442\u0435 review_gate \u0434\u043b\u044f \u0442\u0435\u043a\u0443\u0449\u0435\u0439 \u0437\u0430\u0434\u0430\u0447\u0438.",
    "Approve or reject the current task.": "\u041e\u0434\u043e\u0431\u0440\u0438\u0442\u0435 \u0438\u043b\u0438 \u043e\u0442\u043a\u043b\u043e\u043d\u0438\u0442\u0435 \u0442\u0435\u043a\u0443\u0449\u0443\u044e \u0437\u0430\u0434\u0430\u0447\u0443.",
    "Commit the approved changes.": "\u0421\u0434\u0435\u043b\u0430\u0439\u0442\u0435 commit \u043e\u0434\u043e\u0431\u0440\u0435\u043d\u043d\u044b\u0445 \u0438\u0437\u043c\u0435\u043d\u0435\u043d\u0438\u0439.",
    "Create the next task.": "\u0421\u043e\u0437\u0434\u0430\u0439\u0442\u0435 \u0441\u043b\u0435\u0434\u0443\u044e\u0449\u0443\u044e \u0437\u0430\u0434\u0430\u0447\u0443."
  } as Record<string, string>)[value];

  if (mapped) {
    return mapped;
  }

  return value
    .replace("Open Codex Desktop, execute task", "\u041e\u0442\u043a\u0440\u043e\u0439\u0442\u0435 Codex Desktop \u0438 \u0432\u044b\u043f\u043e\u043b\u043d\u0438\u0442\u0435 \u0437\u0430\u0434\u0430\u0447\u0443")
    .replace("and write report", "\u0438 \u0441\u043e\u0437\u0434\u0430\u0439\u0442\u0435 \u043e\u0442\u0447\u0451\u0442")
    .replace("Run review_gate for task", "\u0417\u0430\u043f\u0443\u0441\u0442\u0438\u0442\u0435 review_gate \u0434\u043b\u044f \u0437\u0430\u0434\u0430\u0447\u0438")
    .replace("Rerun review_gate for task", "\u041f\u0435\u0440\u0435\u0437\u0430\u043f\u0443\u0441\u0442\u0438\u0442\u0435 review_gate \u0434\u043b\u044f \u0437\u0430\u0434\u0430\u0447\u0438")
    .replace("Approve or reject task", "\u041e\u0434\u043e\u0431\u0440\u0438\u0442\u0435 \u0438\u043b\u0438 \u043e\u0442\u043a\u043b\u043e\u043d\u0438\u0442\u0435 \u0437\u0430\u0434\u0430\u0447\u0443")
    .replace("after reviewing the report and diff.", "\u043f\u043e\u0441\u043b\u0435 \u043f\u0440\u043e\u0432\u0435\u0440\u043a\u0438 \u043e\u0442\u0447\u0451\u0442\u0430 \u0438 diff.")
    .replace("Commit the approved changes for task", "\u0421\u0434\u0435\u043b\u0430\u0439\u0442\u0435 commit \u043e\u0434\u043e\u0431\u0440\u0435\u043d\u043d\u044b\u0445 \u0438\u0437\u043c\u0435\u043d\u0435\u043d\u0438\u0439 \u0434\u043b\u044f \u0437\u0430\u0434\u0430\u0447\u0438")
    .replace("Create the next task after", "\u0421\u043e\u0437\u0434\u0430\u0439\u0442\u0435 \u0441\u043b\u0435\u0434\u0443\u044e\u0449\u0443\u044e \u0437\u0430\u0434\u0430\u0447\u0443 \u043f\u043e\u0441\u043b\u0435");
}

async function probeUrl(fetchImpl: typeof fetch, url: string, timeoutMs: number): Promise<{ ok: boolean }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    return { ok: response.ok };
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timeout);
  }
}

function getLocalIpv4Addresses(): string[] {
  const interfaces = os.networkInterfaces();
  return Object.values(interfaces)
    .flat()
    .filter((entry): entry is NonNullable<(typeof interfaces)[string]>[number] => Boolean(entry))
    .filter((entry) => entry.family === "IPv4" && !entry.internal)
    .map((entry) => entry.address)
    .sort();
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function commandToText(command: DashboardCommandConfig | undefined): string {
  if (!command) {
    return "\u043d\u0435 \u043d\u0430\u0441\u0442\u0440\u043e\u0435\u043d\u043e";
  }
  return [command.command, ...(command.args ?? [])].join(" ");
}
