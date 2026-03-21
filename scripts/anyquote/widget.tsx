import {
    Script,
    VStack,
    HStack,
    Text,
    Spacer,
    Widget,
    WidgetFamily,
    Rectangle,
} from "scripting"
import { QuoteModel } from "./model"

// 根据 Widget 尺寸决定字号
function getFontSize(family: WidgetFamily): number {
    switch (family) {
        case "systemSmall": return 15
        case "systemMedium": return 19
        case "systemLarge": return 26
        default: return 16
    }
}

/**
 * Widget 始终从共享缓存中读取当前句子，保证和详情页展示同一份最新数据。
 */
function WidgetView() {
    const quote = QuoteModel.getCurrentQuote()
    const family = Widget.family
    const fontSize = getFontSize(family)

    const isLongText = quote.content.length > 60

    // 来源文本：优先显示作者，没有则显示来源
    const source = quote.from_who ?? quote.from

    return (
        <VStack
            padding={0}
            background="rgba(255, 255, 255, 0.9)" // 稍微透明一点的玻璃白
            frame={{ maxWidth: Infinity, maxHeight: Infinity }}
        >
            <VStack
                padding={20} // 内层的真实内容间距
                frame={{ maxWidth: Infinity, maxHeight: Infinity }}
                alignment="leading"
                spacing={8}
            >
                {/* 顶部分类标签 & 装饰 */}
                <HStack frame={{ maxWidth: Infinity }}>
                    <Text
                        font={12}
                        fontWeight="bold"
                        foregroundStyle="rgba(0, 0, 0, 0.4)" // 深色半透明分类标签
                    >
                        {quote.type ? `#${quote.type}` : "AnyQuote"}
                    </Text>
                    <Spacer />
                    <Text
                        font={18}
                        fontWeight="black"
                        foregroundStyle="rgba(0, 0, 0, 0.08)" // 非常浅的半透明引号装饰
                    >
                        "
                    </Text>
                </HStack>

                <Spacer minLength={2} />

                {/* 核心句子：长文自适应字重和行距，采用衬线体沉浸阅读 */}
                <Text
                    font={fontSize}
                    fontWeight={isLongText ? "medium" : "bold"}
                    fontDesign="serif" // 与详情页统一，增强长文阅读的排版厚重感
                    foregroundStyle="#1C1C1E" // 苹果系标准深邃灰
                    lineLimit={family === "systemSmall" ? 3 : (family === "systemMedium" ? 4 : 8)}
                    minScaleFactor={0.7}
                    lineSpacing={isLongText ? 4 : 6}
                >
                    {quote.content}
                </Text>

                <Spacer />

                {/* 底部来源信息 */}
                {source != null ? (
                    <HStack frame={{ maxWidth: Infinity }} alignment="bottom">
                        <Spacer />
                        <Text
                            font={Math.max(fontSize - 5, 11)}
                            fontWeight="medium"
                            foregroundStyle="rgba(0, 0, 0, 0.55)" // 较深的半透明来源文本
                            lineLimit={1}
                        >
                            — {source}
                        </Text>
                    </HStack>
                ) : null}
            </VStack>
        </VStack>
    )
}

Widget.present(<WidgetView />)
Script.exit()
