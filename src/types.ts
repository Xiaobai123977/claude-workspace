export type TopologyRef={path:string;line:number}
export type TopologyBoundary={direction:'input'|'output';port:string;kind:'entry'|'terminal'|'external'|'parent'|'unresolved';reason:string;refs:TopologyRef[];parentPort?:string}
export type TopologyLifecycle={status?:'planned'|'implemented';acceptance?:string[];verification?:{status:'pending'|'passed'|'failed';summary:string;commands:string[]}}
export type TopologyFlow={complete:boolean;designComplete:boolean;plannedNodes:string[];plannedEdges:string[];issues:{kind:'graph'|'node'|'edge';id:string;code:string;message:string}[];zeroIncoming:string[];zeroOutgoing:string[]}
export type TopologyNode=TopologyLifecycle&{exploration?:{state:'leaf'|'external'|'blocked';reason:string};id:string;label:string;purpose:string;inputs:string[];outputs:string[];refs:TopologyRef[];parent?:string;kind:'module'|'external'|'database'|'terminal';uncertain?:string;boundaries?:TopologyBoundary[]}
export type TopologyEdge=TopologyLifecycle&{id:string;source:string;target:string;label:string;data:string;refs:TopologyRef[];kind?:'call'|'data'|'storage-write'|'storage-read'|'side-effect'|'return';sourceOutputs?:string[];targetInputs?:string[]}
export type TopologyTarget={kind:'node'|'edge';id:string}
export type TopologyAction='comment'|'question'|'change'|'approve'|'refine'|'explore'|'regenerate'|'design'|'implement'|'sync'
export type TopologyRequest={revision:string;targets:TopologyTarget[];action:TopologyAction;text:string;depth?:number|'auto';parallel?:boolean}
export type TopologyDraft=TopologyRequest&{summary:string}
export type TopologyNote=Omit<TopologyRequest,'action'>&{action:Exclude<TopologyAction,'refine'|'explore'|'regenerate'|'design'|'implement'|'sync'>;id:string;createdAt:number}
export type TopologyData={path:string;revision:string;graph:{version:1;flowVersion?:1;title:string;description:string;nodes:TopologyNode[];edges:TopologyEdge[]}|null;notes:TopologyNote[];warnings:string[];flow?:TopologyFlow;exploration?:{complete:boolean;reachedDepth:number;visited:number;frontier:{id:string;label:string;depth:number;blocked:boolean;reason:string}[]}}
export type ProjectSettings={name?:string;pinned?:boolean;collapsed?:boolean;hidden?:boolean}
export type ModelRequest={thinkingMode?:'inherit'|'enabled'|'disabled'|'adaptive';thinkingBudget?:number;effortField?:string;effortMap?:Record<string,string>;outputTokenField?:string;timeout?:number;extraBody?:Record<string,unknown>}
export type ModelVerification={kind:string;checkedAt:number;signature:string;ok:boolean;detail:string;status?:number;elapsedMs:number}
export type ModelPreview={protocol:string;endpoint:string;keyName:string;signature:string;context?:number;params:Record<string,unknown>;headerNames:string[];overriddenFields:string[]}
export type ModelConfigPlan={token:string;restore:boolean;providers:number;pools:number;changes:string[];details:{path:string;before:string;after:string}[];credentials:string}
export type ModelConfigBackup={name:string;createdAt:number;reason:string;providers:number;pools:number}
export type BrowserContext={url:string;title:string;selector:string;tag:string;text:string;html:string;rect:{x:number;y:number;width:number;height:number};styles:Record<string,string>;documentKey?:number;capturedAt?:string}
export type BrowserState={url:string;title:string;loading:boolean;canGoBack:boolean;canGoForward:boolean;error:string}
export type Attachment = { id: string; name: string; path: string; kind: 'file' | 'image' | 'directory'; mime?: string; size: number; preview?: string }
export type Tool = { id: string; name: string; input: string; output: string; status: 'running' | 'waiting' | 'done' | 'error' | 'stopped' }
export type ApprovalQuestion = { question: string; header?: string; multiSelect?: boolean; options: { label: string; description?: string }[] }
export type Approval = { id: string; tool: string; toolUseId?: string; input: Record<string, unknown> & { questions?: ApprovalQuestion[]; plan?: string }; description: string; reason: string; status: 'pending' | 'approved' | 'denied' | 'cancelled'; sessionLabel: string; sessionDetail?: string; answer?: Record<string, string | string[]>; note?: string }
export type ApprovalChoice = { action: 'allow' | 'allow-session' | 'deny' | 'answer'; reason?: string; answers?: Record<string, string | string[]> }
export type TaskInfo = { id: string; status: string; description: string; summary?: string; toolUseId?: string; outputFile?: string }
export type GatewayRetry = { requestId: string; phase: 'waiting' | 'attempting' | 'requesting'; reason: 'http' | 'network' | 'timeout' | 'upstream' | 'pending' | 'turn' | 'routing';errorType?:string;startedAt?:number;timeoutAt?:number; status?: number; attempt: number; maxRetries: number; nextAt?: number;providerName?:string;keyName?:string }
export type TokenUsage = {input_tokens?:number;output_tokens?:number;cache_read_input_tokens?:number;cache_creation_input_tokens?:number;cost?:number;duration?:number}
export type ChangeFile={path:string;kind:'added'|'modified'|'deleted';add:number;del:number;reason?:string;patch?:string}
export type ChangeSummary={files:ChangeFile[];add:number;del:number;limited:boolean;coverage:'git'|'tools'}
export type TurnChangeRecord={scope:'turn';messageId:string;createdAt:number;files:ChangeFile[];limited:boolean;coverage:'git'|'tools'}
export type TokenStats = {known:boolean;input:number|null;uncached:number|null;output:number|null;cacheRead:number|null;cacheWrite:number|null;cacheKnown:boolean;cacheRate:number|null;total:number|null}
export type Message = {
  id:string;role:'user'|'assistant';text:string;time:number;tools:Tool[];status:'running'|'done'|'error'|'stopped'
  agentProgress?:{stage:'exploring'|'merging'|'writing';total:number;completed:number;since:number;topology:boolean}
  topologySelection?:{displayText:string;requests:TopologyDraft[];context:string}
  changes?:ChangeSummary;changeError?:string;lastRequestUsage?:TokenUsage;modelUsage?:Record<string,{contextWindow?:number;maxOutputTokens?:number}>;cacheReporting?:boolean;contextKey?:string
  imageReferences?:number;browserContexts?:BrowserContext[];thinking?:string;approvals?:Approval[];error?:string;notice?:string;gatewayRetries?:GatewayRetry[];gatewayRoute?:GatewayRoute;model?:string;attachments?:Attachment[];checkpointId?:string;nativeUUID?:string;structured?:unknown
  subagents?:{id:string;text:string;thinking?:string;tools:Tool[];status:string}[];tasks?:TaskInfo[];hooks?:{id:string;name:string;type:string;output:string;outcome?:string;time:number}[]
  usage?:{input_tokens?:number;output_tokens?:number;cache_read_input_tokens?:number;cache_creation_input_tokens?:number;cost?:number;duration?:number}
}
export type UsageReport = {connected:boolean;latest:TokenStats;totals:TokenStats;context:{used:number|null;max:number|null;rawMax:number|null;percentage:number|null;source:"cli"|"unavailable";updatedAt?:number;categories:{name:string;tokens:number;kind?:string}[];autoCompactThreshold:number|null;isAutoCompactEnabled:boolean|null;model:string};recordedReplies:number;completedReplies:number;cost:number|null;running:boolean}
export type Preferences = { completionSound?:boolean;completionNotification?:boolean;completionMinSeconds?:number; modelImageInputs?:Record<string,boolean>; cliPath: string; configDir?: string; fontSize?: string; providerId?: string; model: string; effort: string; permission: string; allowedTools: string; disallowedTools: string }
export type ConfigValue = string | number | boolean | string[] | null
export type ConfigScope = 'app' | 'user' | 'local' | 'project'
export type ConfigSource = { path: string; exists: boolean; revision: string; error?: string; values: Record<string, ConfigValue>; writable: boolean }
export type Configuration = { configHome: string; resolved: Record<string, ConfigValue>; origins: Record<string, string[]>; overrides: Record<string, string | null>; selectedModel: string; model: string; secureStorageAvailable: boolean; sources: Record<ConfigScope | 'managed', ConfigSource> }
export type Instruction = { id: string; title: string; path: string; description: string; exists: boolean; content?: string; revision?: string }
export type RunOptions = { agent?: string; maxTurns?: number; budget?: number; schema?: string; fallback?: string; fastMode?: boolean; ultracode?: boolean; safeMode?: boolean; chrome?: boolean; pluginDirs?: string[] }
export type ModelCapability = { reported?:Record<string,unknown>;overrides?:Record<string,unknown>;request?:ModelRequest;verification?:Record<string,ModelVerification>; id: string; name?: string; efforts?: string[]; defaultEffort?: string; context?: number; output?: number; vision?: boolean; tools?: boolean; thinking?: boolean; source?: string; stale?: boolean; favorite?: boolean; enabled?: boolean; fetchedAt?: number;detected?:boolean }
export type ProviderKey = {id:string;name:string;weight?:number;enabled?:boolean;key?:string;keyEnv?:string;hasKey?:boolean;clearKey?:boolean;models:ModelCapability[];checkedAt?:number;checkError?:string;checkAttemptAt?:number}
export type PoolMember = {providerId:string;model:string;keyIds?:string[];enabled?:boolean}
export type ModelPool = {id?:string;revision?:string;name:string;model:string;enabled:boolean;sticky:boolean;ttlMinutes:number;defaultEffort?:string;members:PoolMember[];providerCount?:number;keyCount?:number}
export type ModelCoverage = {model:string;providerCount:number;keyCount:number;detectedProviderCount:number;detectedKeyCount:number;suppliers:{providerId:string;name:string;enabled:boolean;keys:{keyId:string;name:string;enabled:boolean;checkedAt?:number;source?:string;detected?:boolean}[]}[]}
export type RoutingState = {pools:ModelPool[];coverage:ModelCoverage[]}
export type GatewayRoute = {providerId:string;providerName:string;keyId:string;keyName:string;model:string}
export type Provider = { id?: string; revision?: string; name: string; weight?:number;enabled?:boolean;sticky?:boolean;keys?:ProviderKey[];isPool?:boolean;providerCount?:number;keyCount?:number; protocol: 'anthropic' | 'chat' | 'responses'; baseUrl: string; auth: 'none' | 'bearer' | 'api-key' | 'env'; key?: string; keyEnv?: string; hasKey?: boolean; clearKey?: boolean; headers?: Record<string,string>; extraBody?: Record<string,unknown>; outputTokenField?: string; timeoutMode?:'unlimited'|'limited'; timeout?: number; models: ModelCapability[]; defaultModel?: string; defaultEffort?: string; thinking?: string; thinkingBudget?: number; endpoint?: string }
export type NativeInfo = { models?: {value: string; displayName?: string; resolvedModel?: string; supportedEffortLevels?: string[]; supportsAutoMode?: boolean}[]; capabilities?: string[] }
export type NativeCommand={name:string;description:string;argumentHint:string;source:string}
export type DocRef = { scope: string; kind: string; name: string; content?: string; path?: string; revision?: string }
export type HookConfig = { scope: string; path: string; revision: string; hooks: Record<string,unknown>; disabled: boolean; readOnly: boolean }
export type ModInfo = { id: string; name: string; enabled: boolean; path?: string; definition?: string; status: string; local?: boolean }
export type Schedule = { id?: string; sessionId: string; prompt: string; minutes: number; enabled: boolean; nextAt?: number; lastAt?: number; result?: string }
export type Session = {contextReport?:unknown; regeneration?:{origin:{sessionId:string;messageId:string};answerId:string};pinned?:boolean;unread?:boolean; browserEnabled?:boolean; id: string; cwd: string; title: string; createdAt: number; updatedAt: number; archived: boolean; model: string; effort: string; permission: string; nativeId?: string; nativeCommands?: string[]; messages: Message[]; providerId?: string; options?: RunOptions; suggestion?: string; worktree?: {cwd: string; root: string; name: string; branch: string}; runtimeInfo?: {model?: string; permission?: string; version?: string; cwd?: string} }
export type State = { projectSettings?:Record<string,ProjectSettings>; version: number; preferences: Preferences; sessions: Session[]; activeId: string }
export type Probe = { path: string; version: string; loggedIn: boolean; authMethod: string }
export type Skill = { name: string; description: string; source: string }
export type ExtensionMarket = { id: string; title: string; repo: string; branch: string }
export type InstalledPlugin = { id: string; name: string; version: string; scope: 'user' | 'project' | 'local'; path: string; enabled: boolean }
export type InstalledSkill = { id: string; name: string; description: string; path: string; scope: string; plugin?: string; visibility: string; userInvocable: boolean }
export type InstalledMcp = { name: string; scope: 'user' | 'project' | 'local'; transport: string; address: string; envKeys: string[]; disabled: boolean; status: string }
export type ExtensionsState = { markets: ExtensionMarket[]; nativeMarkets: { name: string; repo?: string }[]; plugins: InstalledPlugin[]; skills: InstalledSkill[]; mcp: InstalledMcp[]; errors: string[] }
export type CatalogItem = { id: string; kind: 'plugin' | 'skill' | 'mcp'; name: string; description: string; version: string; source: string; homepage: string; components?: string[]; pluginId?: string; config?: Record<string, unknown> | null; auth?: string }
export type CatalogResult = { items: CatalogItem[]; nextCursor: string; fetchedAt: number; marketplace?: string }
export type ExtensionPreview = { kind: string; text: string; revision: string }
export interface Bridge {
  prepareTopologyWorkflow(id:string,request:TopologyRequest):Promise<string>
  prepareTopologyOperation(id:string,request:TopologyRequest):Promise<{prompt:string;backup?:string}>
  topology(id:string):Promise<TopologyData>;prepareTopology(id:string,scope?:{revision:string;nodeId:string}):Promise<string>;annotateTopology(id:string,request:TopologyRequest):Promise<TopologyData>;topologyPrompt(id:string,request:TopologyRequest):Promise<string>
  modelImageInput(id:string,key?:string,enabled?:boolean):Promise<{key:string;enabled:boolean}>
  turnChanges(id:string,messageId:string):Promise<TurnChangeRecord>
  modelPreview(input:Provider,keyId:string,model:string):Promise<ModelPreview>;modelProbe(input:Provider,keyId:string,model:string,kind:string):Promise<ModelVerification>;modelConfigBackups():Promise<ModelConfigBackup[]>;modelConfigBackup():Promise<string|null>;modelConfigExport():Promise<string|null>;modelConfigPreview(name?:string):Promise<ModelConfigPlan|null>;modelConfigApply(token:string):Promise<{providers:number;pools:number}>;
  browserState(id:string):Promise<BrowserState>;browserLayout(id:string,bounds:{x:number;y:number;width:number;height:number}|null):Promise<void>;browserAction(id:string,name:string,args?:Record<string,unknown>):Promise<{content:{type:string;text?:string;data?:string;mimeType?:string}[]}>;browserEnable(id:string,enabled:boolean):Promise<void>;onBrowser(callback:(id:string,state:BrowserState)=>void):()=>void;
  connections():Promise<Provider[]>;routing():Promise<RoutingState>;savePool(input:ModelPool):Promise<ModelPool>;removePool(id:string):Promise<void>;
  providers(): Promise<Provider[]>; activateProvider(sessionId:string,providerId:string):Promise<void>; saveProvider(input: Provider): Promise<Provider>; removeProvider(id: string): Promise<void>
  discoverModels(input: Provider,keyId?:string): Promise<{models: ModelCapability[]; fetchedAt: number;keys?:ProviderKey[];errors?:{keyId:string;message:string}[]}>; nativeModels(id: string): Promise<NativeInfo>;commands(id:string):Promise<NativeCommand[]>
  testProvider(id: string, input: Provider, model: string,keyId?:string): Promise<{model: string; text: string;keyId?:string;verification?:ModelVerification}>
  diff(id: string): Promise<{branch: string; status: string; diff: string; revision: string}>
  documents(id: string): Promise<DocRef[]>; document(id: string, input: DocRef): Promise<DocRef>; saveDocument(id: string, input: DocRef): Promise<DocRef>
  nativeSessions(id: string): Promise<{id:string;title:string;updatedAt:number}[]>; importSession(id:string,nativeId:string): Promise<Session>
  hooks(id: string): Promise<HookConfig[]>; saveHooks(id: string, input: HookConfig): Promise<HookConfig[]>
  mods(id: string): Promise<ModInfo[]>; validateMod(id: string, pluginId: string): Promise<string>; doctor(id: string): Promise<string>
  tryMod(id:string,dir:string):Promise<string>
  terminal(id: string, mode: string, channel?: string): Promise<string>
  stopTask(id: string, taskId: string): Promise<void>
  context(id: string): Promise<unknown>
  createWorktree(id: string, name: string): Promise<Session>; removeWorktree(id: string): Promise<void>
  checkpoint(id: string, messageId: string, mode: string): Promise<string>; exportSession(id: string): Promise<string | null>
  schedules(): Promise<Schedule[]>; saveSchedule(input: Schedule): Promise<Schedule[]>; removeSchedule(id: string): Promise<void>
  usage(id:string,refresh?:boolean):Promise<UsageReport>;get(): Promise<State>; probe(): Promise<Probe>; create(cwd?: string): Promise<Session>;clear(id:string):Promise<Session>; select(id: string): Promise<void>;readSession(id:string):Promise<Session>;branchMessage(id:string,messageId:string):Promise<Session>;regenerate(id:string,messageId:string):Promise<Session>
  changeProject(id:string,cwd:string):Promise<Session>
  openProject(cwd:string):Promise<string>
  updateProject(cwd:string,patch:ProjectSettings):Promise<void>;archiveProject(cwd:string,archived:boolean):Promise<void>
  organize(id:string,patch:{pinned?:boolean;unread?:boolean}):Promise<void>;deleteSession(id:string):Promise<void>
  fork(id: string): Promise<Session>
  update(id: string, patch: Partial<Session>): Promise<void>; preferences(patch: Partial<Preferences>): Promise<void>
  config(id: string): Promise<Configuration>
  saveConfig(id: string, request: { scope: ConfigScope; revision: string; changes: Record<string, ConfigValue> }): Promise<{ path: string; backup: string | null; changed: string[] }>
  testConnection(id: string): Promise<{text: string; model: string; duration?: number}>
  instructions(id: string): Promise<Instruction[]>; readInstruction(id: string, fileId: string): Promise<Instruction>
  saveInstruction(id: string, request: {id: string; revision: string; content: string}): Promise<{path: string; backup: string | null}>
  createRule(id: string, request: {scope: 'user' | 'project'; name: string}): Promise<string>; openBackups(): Promise<string>
  send(id: string, prompt: string, ids: string[],browserContexts?:BrowserContext[],topologyRequests?:TopologyDraft[]): Promise<{messageId: string}>; stop(id: string): Promise<void>
  answer(id: string, requestId: string, choice: ApprovalChoice): Promise<void>
  folder(): Promise<string | null>; files(): Promise<Attachment[]>; reference(id: string, relative: string): Promise<Attachment>
  importFiles(items: {path?: string; name?: string; data?: string}[]): Promise<Attachment[]>; pathForFile(file: File): string
  projectFiles(id: string): Promise<string[]>; skills(id: string): Promise<Skill[]>; openFolder(id: string): Promise<string>
  extensions(id: string): Promise<ExtensionsState>
  extensionCatalog(id: string, source: string, query: string, cursor: string, refresh: boolean): Promise<CatalogResult>
  extensionPreview(id: string, itemId: string): Promise<ExtensionPreview>
  extensionMutation(id: string, action: string, payload: Record<string, unknown>): Promise<unknown>
  skillContent(id: string, skillId: string): Promise<string>
  openLink(url: string): Promise<void>; window(action: string): Promise<void>; subscribe(fn: (state: State) => void): () => void
}
declare global { interface Window { workspace: Bridge } }
