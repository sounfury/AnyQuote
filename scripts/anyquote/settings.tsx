import {
    Button,
    ForEach,
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
    Widget,
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

/**
 * 为新增来源生成稳定且足够唯一的本地 id。
 */
function buildSourceId(): string {
    return `custom-source-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * 统一提取错误信息，避免对话框里出现空白提示。
 */
function getErrorMessage(error: unknown, fallback: string): string {
    if (error instanceof Error && error.message.trim().length > 0) {
        return error.message
    }

    return fallback
}

/**
 * 在保存前校验来源表单，保证名称和 URL 都可用。
 */
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

/**
 * 来源行采用“点按编辑 + 左滑删除 + 右侧切换”的常见交互，减少误触删除。
 */
function SourceRow({
    source,
    isActive,
    isDefault,
    disabled,
    onUse,
    onEdit,
}: {
    source: QuoteSourceConfig
    isActive: boolean
    isDefault: boolean
    disabled: boolean
    onUse: () => void
    onEdit?: () => void
}) {
    const canEdit = !isDefault && !disabled && typeof onEdit === "function"
    const helperText = isDefault ? "内置默认来源" : "点按进入编辑，左滑可删除"

    return (
        <HStack alignment="top" spacing={12} padding={{ top: 6, bottom: 6 }}>
            <VStack
                alignment="leading"
                spacing={4}
                frame={{ maxWidth: Infinity }}
                contentShape={canEdit ? "rect" : undefined}
                onTapGesture={canEdit ? onEdit : undefined}
            >
                <HStack spacing={8}>
                    <Text font={16} fontWeight="semibold">
                        {source.name}
                    </Text>
                    {isDefault ? (
                        <Text font={11} foregroundStyle="secondaryLabel">
                            默认
                        </Text>
                    ) : null}
                </HStack>
                <Text font={12} foregroundStyle="secondaryLabel">
                    {source.url}
                </Text>
                <Text font={11} foregroundStyle="tertiaryLabel">
                    {helperText}
                </Text>
            </VStack>

            <Spacer />

            {isActive ? (
                <Text font={12} fontWeight="semibold" foregroundStyle="rgba(37, 99, 235, 1)">
                    使用中
                </Text>
            ) : (
                <Button title="使用" action={onUse} disabled={disabled} />
            )}
        </HStack>
    )
}

/**
 * 来源编辑弹窗同时承载新增与编辑，并把接口兼容说明收口到表单内。
 */
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
                <Section header={<Text>基本信息</Text>} footer={<Text>保存后会立即按这里填写的地址拉取内容。</Text>}>
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

                <Section header={<Text>兼容字段</Text>} footer={<Text>正文字段至少返回一个，其余字段会用于补充来源、作者和分类展示。</Text>}>
                    <VStack alignment="leading" spacing={6}>
                        <Text font={13}>
                            正文：`hitokoto` 或 `content`
                        </Text>
                        <Text font={13}>
                            可选：`from` / `from_who` / `type` / `length`
                        </Text>
                    </VStack>
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

/**
 * 设置页负责刷新策略、来源管理以及与主页面数据的同步。
 */
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

    /**
     * 配置落盘后立即通知系统重载 Widget，避免主屏幕继续显示旧时间线。
     */
    function reloadWidget() {
        Widget.reloadAll()
    }

    /**
     * 统一同步设置状态，减少散落的 setState。
     */
    function syncSettings(nextSettings: AppSettings) {
        setSettings(nextSettings)
    }

    /**
     * 保存自动刷新配置，并立刻刷新本地状态。
     */
    function saveRefreshSettings(nextAutoRefresh: boolean, nextInterval: number) {
        const nextSettings: AppSettings = {
            ...settings,
            autoRefresh: nextAutoRefresh,
            refreshInterval: nextInterval as AppSettings["refreshInterval"],
        }

        QuoteModel.saveSettings(nextSettings)
        syncSettings(QuoteModel.getSettings())
    }

    /**
     * 统一复用新增和编辑弹窗状态，避免两个表单状态分叉。
     */
    function resetEditorState() {
        setEditingSource(null)
        setSourceName("")
        setSourceUrl("")
        setSourceError("")
    }

    /**
     * 打开新增来源弹窗，并重置为干净表单。
     */
    function openCreateSourceEditor() {
        resetEditorState()
        setShowSourceEditor(true)
    }

    /**
     * 打开编辑弹窗，并预填当前来源配置。
     */
    function openEditSourceEditor(source: QuoteSourceConfig) {
        setEditingSource(source)
        setSourceName(source.name)
        setSourceUrl(source.url)
        setSourceError("")
        setShowSourceEditor(true)
    }

    /**
     * 关闭来源编辑弹窗，并清理暂存表单内容。
     */
    function closeSourceEditor() {
        setShowSourceEditor(false)
        resetEditorState()
    }

    /**
     * 切换来源后统一做缓存清理、强刷和失败兜底，避免详情页与 Widget 展示不一致。
     */
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

    /**
     * 手动强刷当前来源，并在失败时回退到之前的展示内容。
     */
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

    /**
     * 保存来源配置；新增来源默认设为当前来源，编辑当前来源时会立即重拉内容。
     */
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

    /**
     * 将指定来源切为当前来源，并同步刷新展示内容。
     */
    async function handleUseSource(sourceId: string) {
        if (settings.activeSourceId === sourceId) return
        await applySourceChange(() => QuoteModel.setActiveSource(sourceId))
    }

    /**
     * 一键切回默认来源，并重建当前展示内容。
     */
    async function handleResetToDefault() {
        if (settings.activeSourceId === DEFAULT_SOURCE.id) return
        await applySourceChange(() => QuoteModel.resetToDefaultSource())
    }

    /**
     * 处理列表左滑删除；若删的是当前来源，则自动回退到默认来源并刷新内容。
     */
    async function handleDeleteSources(indices: number[]) {
        const sourcesToDelete = [...indices]
            .sort((left, right) => right - left)
            .map((index) => customSources[index])
            .filter((source): source is QuoteSourceConfig => source != null)

        for (const source of sourcesToDelete) {
            // 删除当前来源时要顺带回退到默认源，否则 activeSourceId 会指向一个不存在的配置。
            if (QuoteModel.getSettings().activeSourceId === source.id) {
                await applySourceChange(() => QuoteModel.deleteCustomSource(source.id))
                continue
            }

            const nextSettings = QuoteModel.deleteCustomSource(source.id)
            syncSettings(nextSettings)
        }
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

                <Section header={<Text>数据来源</Text>}>
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
                            : <Text>点按来源进入编辑；左滑可删除；切换为当前来源后会立即刷新内容。</Text>
                    }
                >
                    {customSources.length > 0 ? (
                        <ForEach
                            count={customSources.length}
                            itemBuilder={(index) => {
                                const source = customSources[index]

                                return (
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
                                    />
                                )
                            }}
                            onDelete={(indices) => {
                                if (isBusy) return
                                void handleDeleteSources(indices)
                            }}
                        />
                    ) : (
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
