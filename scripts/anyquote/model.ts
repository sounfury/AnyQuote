// Storage、fetch 均是 Scripting 运行时全局对象，无需 import

export const USE_MOCK = false // 开发测试模式开关，开启时只读取 mock 数据，不去查缓存和发网络请求
export const MOCK_TYPE: "long" | "short" = "short" // mock 数据的类型："long" | "short"

// 句子数据结构
export interface QuoteItem {
    content: string
    from?: string
    from_who?: string
    type?: string
    length?: number
    bgColors?: string[]
    bgImageUrl?: string
}

export type QuoteSourceId = "default" | string

export interface QuoteSourceConfig {
    id: string
    name: string
    url: string
}

interface QuotePayload {
    hitokoto?: unknown
    content?: unknown
    from?: unknown
    from_who?: unknown
    type?: unknown
    length?: unknown
}

interface LegacyAppSettings {
    autoRefresh?: unknown
    refreshInterval?: unknown
    activeSourceId?: unknown
    customSources?: unknown
    customApiUrl?: unknown
}

// 一言 type 编码 -> 中文类型名映射
const HITOKOTO_TYPE_MAP: Record<string, string> = {
    a: "动画",
    b: "漫画",
    c: "游戏",
    d: "文学",
    e: "原创",
    f: "来自网络",
    g: "其他",
    h: "影视",
    i: "诗词",
    j: "网易云",
    k: "哲学",
    l: "抖机灵",
}

const CACHE_KEY = "anyquote_cache_queue"
const SETTINGS_KEY = "anyquote_settings"
const MAX_QUEUE_SIZE = 5
const SHARED_STORAGE_OPTIONS = { shared: true } as const

export const DEFAULT_SOURCE: QuoteSourceConfig = {
    id: "default",
    name: "一言（默认）",
    url: "https://v1.hitokoto.cn/",
}

// 刷新间隔选项（分钟）
export const REFRESH_INTERVALS = [30, 60, 180, 360] as const
export type RefreshInterval = typeof REFRESH_INTERVALS[number]

export interface AppSettings {
    autoRefresh: boolean
    refreshInterval: RefreshInterval
    activeSourceId: QuoteSourceId
    customSources: QuoteSourceConfig[]
}

const DEFAULT_SETTINGS: AppSettings = {
    autoRefresh: true,
    refreshInterval: 60,
    activeSourceId: DEFAULT_SOURCE.id,
    customSources: [],
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null
}

function normalizeText(value: unknown): string | undefined {
    if (typeof value === "string") {
        const trimmed = value.trim()
        return trimmed.length > 0 ? trimmed : undefined
    }

    if (typeof value === "number" && Number.isFinite(value)) {
        return String(value)
    }

    return undefined
}

function normalizeLength(value: unknown, fallbackLength: number): number {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
        return Math.floor(value)
    }

    if (typeof value === "string") {
        const parsed = Number.parseInt(value, 10)
        if (Number.isFinite(parsed) && parsed > 0) {
            return parsed
        }
    }

    return fallbackLength
}

function isValidHttpUrl(value: string): boolean {
    return /^https?:\/\/\S+$/i.test(value.trim())
}

/**
 * 优先从共享存储域读取数据；如果共享域还没有旧版本数据，则从当前脚本私有域迁移一份过去。
 */
function getSharedStorageValue<T>(key: string): T | null {
    const sharedValue = Storage.get<T>(key, SHARED_STORAGE_OPTIONS)
    if (sharedValue !== null) {
        return sharedValue
    }

    const privateValue = Storage.get<T>(key)
    if (privateValue !== null) {
        Storage.set(key, privateValue, SHARED_STORAGE_OPTIONS)
    }

    return privateValue
}

/**
 * 统一写入共享存储域，保证详情页脚本和 Widget 脚本拿到同一份数据。
 */
function setSharedStorageValue<T>(key: string, value: T): void {
    Storage.set(key, value, SHARED_STORAGE_OPTIONS)
}

function normalizeSource(source: unknown): QuoteSourceConfig | null {
    if (!isRecord(source)) return null

    const id = normalizeText(source.id)
    const name = normalizeText(source.name)
    const url = normalizeText(source.url)

    if (!id || id === DEFAULT_SOURCE.id || !name || !url || !isValidHttpUrl(url)) {
        return null
    }

    return { id, name, url }
}

function normalizeSources(sources: unknown): QuoteSourceConfig[] {
    if (!Array.isArray(sources)) return []

    // 存储层允许脏数据存在，这里统一做去重和结构清洗，避免 UI 层再做防御。
    const uniqueSources = new Map<string, QuoteSourceConfig>()

    for (const source of sources) {
        const normalized = normalizeSource(source)
        if (normalized && !uniqueSources.has(normalized.id)) {
            uniqueSources.set(normalized.id, normalized)
        }
    }

    return Array.from(uniqueSources.values())
}

function buildLegacyCustomSource(rawUrl: unknown): QuoteSourceConfig[] {
    const url = normalizeText(rawUrl)
    if (!url || !isValidHttpUrl(url)) return []

    return [{
        id: "legacy-custom-source",
        name: "旧版自定义来源",
        url,
    }]
}

function normalizeSettings(rawSettings?: LegacyAppSettings | null): AppSettings {
    const raw = isRecord(rawSettings) ? rawSettings : {}

    // 兼容旧版仅有 customApiUrl 的设置结构，避免升级后用户配置直接丢失。
    const legacySources = buildLegacyCustomSource(raw.customApiUrl)
    const customSources = normalizeSources(raw.customSources)
    const mergedSources = customSources.length > 0 ? customSources : legacySources

    const refreshInterval = REFRESH_INTERVALS.includes(raw.refreshInterval as RefreshInterval)
        ? raw.refreshInterval as RefreshInterval
        : DEFAULT_SETTINGS.refreshInterval

    const requestedActiveSourceId = normalizeText(raw.activeSourceId)
        ?? (mergedSources.length > 0 ? mergedSources[0].id : DEFAULT_SOURCE.id)

    const activeSourceId = requestedActiveSourceId === DEFAULT_SOURCE.id
        || mergedSources.some((source) => source.id === requestedActiveSourceId)
        ? requestedActiveSourceId
        : DEFAULT_SOURCE.id

    return {
        autoRefresh: typeof raw.autoRefresh === "boolean" ? raw.autoRefresh : DEFAULT_SETTINGS.autoRefresh,
        refreshInterval,
        activeSourceId,
        customSources: mergedSources,
    }
}

function getStoredQueue(): QuoteItem[] {
    const queue = getSharedStorageValue<QuoteItem[]>(CACHE_KEY)
    if (!Array.isArray(queue)) return []

    // 只保留最小可展示结构，坏数据不会再污染当前显示和后续刷新。
    return queue.filter((item) => {
        return isRecord(item) && typeof item.content === "string" && item.content.trim().length > 0
    })
}

export function normalizeQuotePayload(payload: unknown): QuoteItem | null {
    if (!isRecord(payload)) return null

    const data = payload as QuotePayload
    // 一言结构是主协议，其它接口只要提供同名字段就能直接复用这套解析。
    const content = normalizeText(data.hitokoto) ?? normalizeText(data.content)
    if (!content) return null

    const typeValue = normalizeText(data.type)

    return {
        content,
        from: normalizeText(data.from),
        from_who: normalizeText(data.from_who),
        type: typeValue ? (HITOKOTO_TYPE_MAP[typeValue] ?? typeValue) : undefined,
        length: normalizeLength(data.length, content.length),
    }
}

function getErrorMessage(error: unknown, fallback: string): string {
    if (error instanceof Error && error.message.trim().length > 0) {
        return error.message
    }

    return fallback
}

export class QuoteModel {
    static getDefaultSource(): QuoteSourceConfig {
        return { ...DEFAULT_SOURCE }
    }

    static getAllSources(settings = QuoteModel.getSettings()): QuoteSourceConfig[] {
        return [QuoteModel.getDefaultSource(), ...settings.customSources]
    }

    static getActiveSource(settings = QuoteModel.getSettings()): QuoteSourceConfig {
        return QuoteModel.getAllSources(settings).find((source) => source.id === settings.activeSourceId)
            ?? QuoteModel.getDefaultSource()
    }

    static getQueue(): QuoteItem[] {
        if (USE_MOCK) return []
        return getStoredQueue()
    }

    static getCurrentQuote(): QuoteItem {
        if (USE_MOCK) return getMockQuote()

        const queue = QuoteModel.getQueue()
        if (queue.length > 0) {
            return queue[0]
        }

        return getMockQuote()
    }

    static saveQueue(queue: QuoteItem[]) {
        setSharedStorageValue(CACHE_KEY, queue.slice(0, MAX_QUEUE_SIZE))
    }

    static clearQueue() {
        QuoteModel.saveQueue([])
    }

    static getSettings(): AppSettings {
        return normalizeSettings(getSharedStorageValue<LegacyAppSettings>(SETTINGS_KEY))
    }

    static saveSettings(settings: AppSettings) {
        setSharedStorageValue(SETTINGS_KEY, normalizeSettings(settings))
    }

    static saveSources(customSources: QuoteSourceConfig[], activeSourceId?: QuoteSourceId): AppSettings {
        const currentSettings = QuoteModel.getSettings()
        const nextSettings = normalizeSettings({
            ...currentSettings,
            customSources,
            activeSourceId: activeSourceId ?? currentSettings.activeSourceId,
        })

        QuoteModel.saveSettings(nextSettings)
        return nextSettings
    }

    static upsertCustomSource(source: QuoteSourceConfig, options?: { setActive?: boolean }): AppSettings {
        const normalizedSource = normalizeSource(source)
        if (!normalizedSource) {
            throw new Error("来源配置无效")
        }

        const currentSettings = QuoteModel.getSettings()
        const nextSources = currentSettings.customSources.some((item) => item.id === normalizedSource.id)
            ? currentSettings.customSources.map((item) => item.id === normalizedSource.id ? normalizedSource : item)
            : [...currentSettings.customSources, normalizedSource]

        const nextActiveSourceId = options?.setActive === false
            ? currentSettings.activeSourceId
            : normalizedSource.id

        return QuoteModel.saveSources(nextSources, nextActiveSourceId)
    }

    static deleteCustomSource(sourceId: string): AppSettings {
        const currentSettings = QuoteModel.getSettings()
        const nextSources = currentSettings.customSources.filter((source) => source.id !== sourceId)
        const nextActiveSourceId = currentSettings.activeSourceId === sourceId
            ? DEFAULT_SOURCE.id
            : currentSettings.activeSourceId

        return QuoteModel.saveSources(nextSources, nextActiveSourceId)
    }

    static setActiveSource(sourceId: QuoteSourceId): AppSettings {
        const currentSettings = QuoteModel.getSettings()
        const nextSettings = normalizeSettings({
            ...currentSettings,
            activeSourceId: sourceId,
        })

        QuoteModel.saveSettings(nextSettings)
        return nextSettings
    }

    static resetToDefaultSource(): AppSettings {
        return QuoteModel.setActiveSource(DEFAULT_SOURCE.id)
    }

    static async fetchQuoteFromUrl(url: string): Promise<QuoteItem> {
        const res = await (globalThis as any).fetch(url)

        if (!res.ok) {
            throw new Error(`请求失败（HTTP ${res.status}）`)
        }

        let payload: unknown
        try {
            payload = await res.json()
        } catch {
            throw new Error("返回内容不是合法 JSON")
        }

        const quote = normalizeQuotePayload(payload)
        if (!quote) {
            throw new Error("返回结果缺少可用的正文内容")
        }

        return quote
    }

    static async fetchQuoteFromActiveSource(): Promise<QuoteItem> {
        const activeSource = QuoteModel.getActiveSource()
        return QuoteModel.fetchQuoteFromUrl(activeSource.url)
    }

    static async fetchAndCache(): Promise<void> {
        if (USE_MOCK) return

        const queueBeforeFetch = QuoteModel.getQueue()
        if (queueBeforeFetch.length >= MAX_QUEUE_SIZE) return

        try {
            const quote = await QuoteModel.fetchQuoteFromActiveSource()
            const queue = QuoteModel.getQueue()
            // 重新读取一次队列，避免并发请求把尾部缓存挤爆。
            if (queue.length < MAX_QUEUE_SIZE) {
                queue.push(quote)
                QuoteModel.saveQueue(queue)
            }
        } catch (error) {
            console.error("AnyQuote 网络请求失败:", getErrorMessage(error, "未知错误"))
        }
    }

    static consumeAndRefresh(): QuoteItem {
        const queue = QuoteModel.getQueue()
        const current = queue.length > 0 ? queue[0] : getMockQuote()

        if (queue.length > 0) {
            queue.shift()
            QuoteModel.saveQueue(queue)
        }

        void QuoteModel.fetchAndCache()
        return current
    }

    static async forceFetchNew(): Promise<QuoteItem> {
        if (USE_MOCK) return getMockQuote()

        const quote = await QuoteModel.fetchQuoteFromActiveSource()
        const queue = QuoteModel.getQueue()

        // 强刷始终把最新内容放到队首，详情页和 Widget 都直接读 queue[0]。
        queue.unshift(quote)
        QuoteModel.saveQueue(queue.slice(0, MAX_QUEUE_SIZE))

        return quote
    }
}

// 兜底 Mock 数据，无缓存且网络不可用时使用
const MOCK_QUOTE_LONG: QuoteItem = {
    content: "这时他轻声地，像是在对自己说：\n“可是爱情呢？”\n这话她听到了。她嘴唇上露出一丝浅浅的微笑。\n“您今天还保留着您所有的理想，那些您当年带往远方世界去的所有理想吗？所有这些您还保留着，没有损坏，或者说有些已经死亡，已经枯萎？或者到头来人家没有把这些理想强行从您怀里抢走，扔在污泥里，被成千上万驰向生活目标的车轮碾得粉碎？或者说您一点也没有丢失？”",
    from_who: "屠格涅夫",
    from: "罗亭",
    type: "文学",
    length: 168,
}

const MOCK_QUOTE_SHORT: QuoteItem = {
    content: "当一切似乎都在与你作对时，请记住，飞机是逆风而不是顺风起飞的。",
    from_who: "亨利·福特",
    type: "励志",
    length: 27,
    bgColors: ["#a1c4fd", "#c2e9fb"],
}

export function getMockQuote(): QuoteItem {
    return MOCK_TYPE === "long" ? MOCK_QUOTE_LONG : MOCK_QUOTE_SHORT
}
