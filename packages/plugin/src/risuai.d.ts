interface OpenAIChat {
  role: "system" | "user" | "assistant" | "function";
  content: string;
  name?: string;
  /** PocketRisu preserves the source chat message ID here through translation. */
  memo?: string;
}

interface LocalStorageApi {
  getItem<T = string>(key: string): Promise<T | null>;
  setItem<T>(key: string, value: T): Promise<void>;
  removeItem(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

interface SafeRootElement {
  appendChild(child: SafeRootElement): Promise<void>;
  remove(): Promise<void>;
  setTextContent(value: string): Promise<void>;
  setInnerHTML(value: string): Promise<void>;
  setStyle(name: string, value: string): Promise<void>;
  setAttribute(name: string, value: string): Promise<void>;
  addEventListener(type: string, callback: (event: any) => void): Promise<string>;
  getStyleAttribute(): Promise<string>;
  getBoundingClientRect(): Promise<DOMRect>;
  clientWidth(): Promise<number>;
  clientHeight(): Promise<number>;
  querySelector(selector: string): Promise<SafeRootElement | null>;
}

interface SafeRootDocument extends SafeRootElement {
  createElement(tagName: string): Promise<SafeRootElement>;
}

interface ChatOutputListenerArg {
  char: any;
  chat: any;
  characterIndex: number;
  chatIndex: number;
  messageIndex: number;
}

interface RisuPluginApi {
  getCharacter(): Promise<any>;
  getCurrentCharacterIndex(): Promise<number>;
  getCurrentChatIndex(): Promise<number>;
  getChatFromIndex(characterIndex: number, chatIndex: number): Promise<any | null>;
  getCurrentLorebookEntries(): Promise<any[]>;
  getDatabase(includeOnly?: string[] | "all"): Promise<any | null>;
  getRootDocument(): Promise<SafeRootDocument>;
  getArgument(key: string): Promise<string | number | undefined>;
  setArgument(key: string, value: string | number): Promise<void>;
  getLocalPluginStorage(): Promise<LocalStorageApi>;
  nativeFetch(url: string, init?: RequestInit): Promise<Response>;
  getFetchLogs(): Promise<Array<{
    url: string;
    body: string;
    status?: number;
    response?: string;
    error?: string;
    timestamp: number;
  }> | null>;
  runLLMModel(options: { messages: any[]; staticModel?: string; mode: string; allowPlugins?: boolean }): Promise<any>;
  showContainer(mode: "fullscreen"): Promise<void>;
  hideContainer(): Promise<void>;
  registerSetting(name: string, callback: () => void | Promise<void>, icon?: string, iconType?: "html" | "img" | "none", id?: string): Promise<{ id: string }>;
  registerButton(config: { name: string; icon: string; iconType: "html" | "img" | "none"; location?: "action" | "chat" | "hamburger"; id?: string }, callback: () => void): Promise<{ id: string }>;
  addRisuReplacer(type: "beforeRequest", callback: (messages: OpenAIChat[], type: string) => OpenAIChat[] | Promise<OpenAIChat[]>): Promise<void>;
  addRisuReplacer(type: "afterRequest", callback: (content: string, type: string) => string | Promise<string>): Promise<void>;
  addRisuChatListener?(type: "output", callback: (arg: ChatOutputListenerArg) => void | Promise<void>): Promise<void>;
  registerMCP(meta: { identifier: string; name: string; version: string; description: string }, tools: () => Promise<any[]>, call: (name: string, args: any) => Promise<Array<{ type: "text"; text: string }>>): Promise<void>;
  addPluginChannelListener(channelName: string, callback: (message: any, metadata?: { sender?: string; channel?: string }) => void | Promise<void>): Promise<void>;
  postPluginChannelMessage(pluginName: string, channelName: string, message: any): Promise<void>;
  onUnload(callback: () => void | Promise<void>): Promise<void>;
}

declare const risuai: RisuPluginApi;
declare const Risuai: RisuPluginApi;
