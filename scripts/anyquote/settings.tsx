import {
    Button,
    HStack,
    List,
    NavigationStack,
    Picker,
    Section,
    Spacer,
    Text,
    TextField,
    Toggle,
    Toolbar,
    ToolbarItem,
    VStack,
    useState,
} from "scripting"

import {
    AppSettings,
    DEFAULT_SOURCE,
    QuoteItem,
    QuoteModel,
    QuoteSourceConfig,
    REFRESH_INTERVALS,
} from "./model"

declare const Dialog: {
    alert(options: { message: string, title?: string, buttonLabel?: string }): Promise<void>
    confirm(options: { message: string, title?: string, cancelLabel?: string, confirmLabel?: string }): Promise<boolean>
}

type SettingsPageProps = {
    onDismiss: () => void
    onRefreshQuote: (quote: QuoteItem) => void
}

const intervalLabels: Record<number, string> = {
    30: "30 分钟",
    60: "1 小时",
    180: "3 小时",
    360: "6 小时",
}

function buildSourceId(): string {
    return `custom-source-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function getErrorMessage(error: unknown, fallback: string): string {
    if (error instanceof Error && error.message.trim().length > 0) {
        return error.message
    }

    return fallback
}

function validateSourceInput(name: string, url: string): { name: string, url: string } | { error: string } {
    const trimmedName = name.trim()
    const trimmedUrl = url.trim()

    if (!trimmedName) {
        return { error: "请输入来源名称" }
    }

    if (!trimmedUrl) {
        return { error: "请输入来源地址" }
    }

    if (!/^https?:\/\/\S+$/i.test(trimmedUrl)) {
        return { error: "来源地址格式不正确" }
    }

    return {
        name: trimmedName,
        url: trimmedUrl,
    }
}

// 来源行既承担状态展示，也承担切换 / 编辑 / 删除入口，所以单独抽成组件。
function SourceRow({
    source,
    isActive,
    isDefault,
    disabled,
    onUse,
    onEdit,
    onDelete,
}: {
    source: QuoteSourceConfig
    isActive: boolean
    isDefault: boolean
    disabled: boolean
    onUse: () => void
    onEdit?: () => void
    onDelete?: () => void
}) {
    return (
        <VStack alignment="leading" spacing={12} padding={{ top: 6, bottom: 6 }}>
            <HStack frame={{ maxWidth: Infinity }} alignment="top">
                <VStack alignment="leading" spacing={4} frame={{ maxWidth: Infinity }}>
                    <Text font={16} fontWeight="semibold">
                        {source.name}
                    </Text>
                    <Text font={12} foregroundStyle="secondaryLabel">
                        {source.url}
                    </Text>
                </VStack>
                {isActive ? (
                    <Text font={12} fontWeight="semibold" foregroundStyle="rgba(37, 99, 235, 1)">
                        使用中
                    </Text>
                ) : (
                    <Button title="使用" action={onUse} disabled={disabled} />
                )}
            </HStack>

            <HStack spacing={12}>
                {!isDefault ? (
                    <HStack spacing={12}>
                        <Button title="编辑" action={onEdit ?? (() => {})} disabled={disabled} />
                        <Button title="删除" action={onDelete ?? (() => {})} disabled={disabled} />
                    </HStack>
                ) : (
                    <Text font={12} foregroundStyle="secondaryLabel">
                        内置默认来源
                    </Text>
                )}
            </HStack>
        </VStack>
    )
}

function SourceEditorSheet({
    editingSource,
    sourceName,
    sourceUrl,
    sourceError,
    isSavingSource,
    onSourceNameChanged,
    onSourceUrlChanged,
    onDismiss,
    onSave,
}: {
    editingSource: QuoteSourceConfig | null
    sourceName: string
    sourceUrl: string
    sourceError: string
    isSavingSource: boolean
    onSourceNameChanged: (value: string) => void
    onSourceUrlChanged: (value: string) => void
    onDismiss: () => void
    onSave: () => void
}) {
    const title = editingSource ? "编辑来源" : "新增来源"

    return (
        <NavigationStack
            presentationDetents={["medium", "large"]}
            presentationDragIndicator="visible"
        >
            <List
                navigationTitle={title}
                navigationBarTitleDisplayMode="inline"
                toolbar={
                    <Toolbar>
                        <ToolbarItem placement="topBarLeading">
                            <Button title="取消" action={onDismiss} disabled={isSavingSource} />
                        </ToolbarItem>
                        <ToolbarItem placement="topBarTrailing">
                            <Button title={isSavingSource ? "保存中…" : "保存"} action={onSave} disabled={isSavingSource} />
                        </ToolbarItem>
                    </Toolbar>
                }
            >
                <Section header={<Text>基本信息</Text>} footer={<Text>外部 API 需要返回兼容一言的字段结构。</Text>}>
                    <TextField
                        title="名称"
                        value={sourceName}
                        onChanged={onSourceNameChanged}
                        prompt="例如：我的语录接口"
                        autofocus
                    />
                    <TextField
                        title="URL"
                        value={sourceUrl}
                        onChanged={onSourceUrlChanged}
                        prompt="https://example.com/api/quote"
                        axis="vertical"
                    />
                </Section>

                {sourceError ? (
                    <Section header={<Text>校验提示</Text>}>
                        <Text foregroundStyle="rgba(185, 28, 28, 1)">
                            {sourceError}
                        </Text>
                    </Section>
                ) : null}
            </List>
        </NavigationStack>
    )
}

export function SettingsPage({ onDismiss, onRefreshQuote }: SettingsPageProps) {
    const [settings, setSettings] = useState<AppSettings>(() => QuoteModel.getSettings())
    const [isRefreshing, setIsRefreshing] = useState(false)
    const [refreshDone, setRefreshDone] = useState(false)
    const [showSourceEditor, setShowSourceEditor] = useState(false)
    const [editingSource, setEditingSource] = useState<QuoteSourceConfig | null>(null)
    const [sourceName, setSourceName] = useState("")
    const [sourceUrl, setSourceUrl] = useState("")
    const [sourceError, setSourceError] = useState("")
    const [isSavingSource, setIsSavingSource] = useState(false)
    const [isApplyingSource, setIsApplyingSource] = useState(false)

    const activeSource = QuoteModel.getActiveSource(settings)
    const customSources = settings.customSources
    const isBusy = isRefreshing || isSavingSource || isApplyingSource

    function reloadWidget() {
        ; (globalThis as any).Widget?.reloadAll()
    }

    function syncSettings(nextSettings: AppSettings) {
        setSettings(nextSettings)
    }

    function saveRefreshSettings(nextAutoRefresh: boolean, nextInterval: number) {
        const nextSettings: AppSettings = {
            ...settings,
            autoRefresh: nextAutoRefresh,
            refreshInterval: nextInterval as AppSettings["refreshInterval"],
        }

        QuoteModel.saveSettings(nextSettings)
        syncSettings(QuoteModel.getSettings())
    }

    // 统一复用新增和编辑，避免两个表单状态分叉。
    function resetEditorState() {
        setEditingSource(null)
        setSourceName("")
        setSourceUrl("")
        setSourceError("")
    }

    function openCreateSourceEditor() {
        resetEditorState()
        setShowSourceEditor(true)
    }

    function openEditSourceEditor(source: QuoteSourceConfig) {
        setEditingSource(source)
        setSourceName(source.name)
        setSourceUrl(source.url)
        setSourceError("")
        setShowSourceEditor(true)
    }

    function closeSourceEditor() {
        setShowSourceEditor(false)
        resetEditorState()
    }

    async function applySourceChange(saveAction: () => AppSettings | Promise<AppSettings>): Promise<boolean> {
        const previousQueue = QuoteModel.getQueue()
        const previousQuote = QuoteModel.getCurrentQuote()

        setIsApplyingSource(true)

        try {
            const nextSettings = await saveAction()
            syncSettings(nextSettings)

            // 来源切换先清空旧队列，再强制拉一条新内容，避免新旧来源混在同一个缓存里。
            QuoteModel.clearQueue()
            const nextQuote = await QuoteModel.forceFetchNew()
            onRefreshQuote(nextQuote)
            reloadWidget()

            return true
        } catch (error) {
            // 设置已经落盘，但内容刷新失败时要把展示层恢复到切换前的状态。
            QuoteModel.saveQueue(previousQueue)
            onRefreshQuote(previousQuote)

            await Dialog.alert({
                title: "刷新失败",
                message: getErrorMessage(error, "来源已保存，但当前无法拉取新内容"),
                buttonLabel: "知道了",
            })

            return false
        } finally {
            setIsApplyingSource(false)
        }
    }

    async function handleImmediateRefresh() {
        const previousQueue = QuoteModel.getQueue()
        const previousQuote = QuoteModel.getCurrentQuote()

        setIsRefreshing(true)
        setRefreshDone(false)

        try {
            const nextQuote = await QuoteModel.forceFetchNew()
            onRefreshQuote(nextQuote)
            reloadWidget()

            setRefreshDone(true)
            setTimeout(() => setRefreshDone(false), 2000)
        } catch (error) {
            QuoteModel.saveQueue(previousQueue)
            onRefreshQuote(previousQuote)

            await Dialog.alert({
                title: "刷新失败",
                message: getErrorMessage(error, "当前来源暂时不可用"),
                buttonLabel: "知道了",
            })
        } finally {
            setIsRefreshing(false)
        }
    }

    async function handleSaveSource() {
        const validated = validateSourceInput(sourceName, sourceUrl)
        if ("error" in validated) {
            setSourceError(validated.error)
            return
        }

        const nextSource: QuoteSourceConfig = {
            id: editingSource?.id ?? buildSourceId(),
            name: validated.name,
            url: validated.url,
        }

        setSourceError("")
        setIsSavingSource(true)

        try {
            if (editingSource) {
                // 编辑当前来源时需要立刻重拉；编辑非当前来源只更新配置，不打断当前阅读。
                if (settings.activeSourceId === editingSource.id) {
                    const success = await applySourceChange(() => {
                        return QuoteModel.upsertCustomSource(nextSource, { setActive: true })
                    })

                    if (success) {
                        closeSourceEditor()
                    }
                } else {
                    const nextSettings = QuoteModel.upsertCustomSource(nextSource, { setActive: false })
                    syncSettings(nextSettings)
                    closeSourceEditor()
                }
            } else {
                const success = await applySourceChange(() => QuoteModel.upsertCustomSource(nextSource))
                if (success) {
                    closeSourceEditor()
                }
            }
        } finally {
            setIsSavingSource(false)
        }
    }

    async function handleUseSource(sourceId: string) {
        if (settings.activeSourceId === sourceId) return
        await applySourceChange(() => QuoteModel.setActiveSource(sourceId))
    }

    async function handleResetToDefault() {
        if (settings.activeSourceId === DEFAULT_SOURCE.id) return
        await applySourceChange(() => QuoteModel.resetToDefaultSource())
    }

    async function handleDeleteSource(source: QuoteSourceConfig) {
        const confirmed = await Dialog.confirm({
            title: "删除来源",
            message: `确定删除“${source.name}”吗？`,
            cancelLabel: "取消",
            confirmLabel: "删除",
        })

        if (!confirmed) return

        // 删除当前来源时要顺带回退到默认源，否则 activeSourceId 会指向一个不存在的配置。
        if (settings.activeSourceId === source.id) {
            await applySourceChange(() => QuoteModel.deleteCustomSource(source.id))
            return
        }

        const nextSettings = QuoteModel.deleteCustomSource(source.id)
        syncSettings(nextSettings)
    }

    return (
        <NavigationStack
            presentationDragIndicator="visible"
            presentationDetents={["medium", "large"]}
        >
            <List
                navigationTitle="设置"
                navigationBarTitleDisplayMode="inline"
                sheet={{
                    isPresented: showSourceEditor,
                    onChanged: setShowSourceEditor,
                    content: (
                        <SourceEditorSheet
                            editingSource={editingSource}
                            sourceName={sourceName}
                            sourceUrl={sourceUrl}
                            sourceError={sourceError}
                            isSavingSource={isSavingSource}
                            onSourceNameChanged={(value) => {
                                setSourceName(value)
                                if (sourceError) setSourceError("")
                            }}
                            onSourceUrlChanged={(value) => {
                                setSourceUrl(value)
                                if (sourceError) setSourceError("")
                            }}
                            onDismiss={closeSourceEditor}
                            onSave={handleSaveSource}
                        />
                    ),
                }}
                toolbar={
                    <Toolbar>
                        <ToolbarItem placement="topBarTrailing">
                            <Button title="完成" action={onDismiss} disabled={isBusy} />
                        </ToolbarItem>
                    </Toolbar>
                }
            >
                <Section header={<Text>刷新设置</Text>}>
                    <Toggle
                        title="自动刷新"
                        value={settings.autoRefresh}
                        onChanged={(value: boolean) => {
                            saveRefreshSettings(value, settings.refreshInterval)
                        }}
                    />
                    {settings.autoRefresh ? (
                        <Picker
                            title="刷新间隔"
                            value={settings.refreshInterval.toString()}
                            onChanged={(value: string) => {
                                const nextInterval = Number.parseInt(value, 10)
                                saveRefreshSettings(settings.autoRefresh, nextInterval)
                            }}
                            pickerStyle="menu"
                        >
                            {REFRESH_INTERVALS.map((minutes) => (
                                <Text key={minutes.toString()} tag={minutes.toString()}>
                                    {intervalLabels[minutes]}
                                </Text>
                            ))}
                        </Picker>
                    ) : null}
                </Section>

                <Section header={<Text>数据</Text>} footer={<Text>立即刷新始终使用当前激活的数据来源。</Text>}>
                    <Button
                        title={
                            isRefreshing
                                ? "正在刷新…"
                                : refreshDone
                                    ? "✓ 刷新成功"
                                    : "立即刷新内容"
                        }
                        action={handleImmediateRefresh}
                        disabled={isBusy}
                    />
                </Section>

                <Section
                    header={<Text>数据来源</Text>}
                    footer={<Text>兼容字段：`hitokoto` 或 `content` 为正文，`from` / `from_who` / `type` / `length` 为可选字段。</Text>}
                >
                    <VStack alignment="leading" spacing={4}>
                        <Text font={13} foregroundStyle="secondaryLabel">
                            当前来源
                        </Text>
                        <Text font={16} fontWeight="semibold">
                            {activeSource.name}
                        </Text>
                    </VStack>
                </Section>

                <Section header={<Text>默认来源</Text>}>
                    <SourceRow
                        source={DEFAULT_SOURCE}
                        isActive={settings.activeSourceId === DEFAULT_SOURCE.id}
                        isDefault
                        disabled={isBusy}
                        onUse={() => {
                            void handleUseSource(DEFAULT_SOURCE.id)
                        }}
                    />
                </Section>

                <Section
                    header={<Text>自定义来源</Text>}
                    footer={
                        customSources.length === 0
                            ? <Text>还没有添加自定义来源。</Text>
                            : <Text>新增来源后会立即设为当前来源；编辑当前来源时也会立即刷新内容。</Text>
                    }
                >
                    {customSources.length > 0 ? customSources.map((source) => (
                        <SourceRow
                            key={source.id}
                            source={source}
                            isActive={settings.activeSourceId === source.id}
                            isDefault={false}
                            disabled={isBusy}
                            onUse={() => {
                                void handleUseSource(source.id)
                            }}
                            onEdit={() => openEditSourceEditor(source)}
                            onDelete={() => {
                                void handleDeleteSource(source)
                            }}
                        />
                    )) : (
                        <Text foregroundStyle="secondaryLabel">
                            添加后就可以在多个来源之间切换。
                        </Text>
                    )}
                </Section>

                <Section header={<Text>管理操作</Text>}>
                    <Button title="新增来源" action={openCreateSourceEditor} disabled={isBusy} />
                    <Button title="恢复默认来源" action={handleResetToDefault} disabled={isBusy || settings.activeSourceId === DEFAULT_SOURCE.id} />
                </Section>
            </List>
        </NavigationStack>
    )
}
