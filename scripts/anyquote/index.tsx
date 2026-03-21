import {
    Button,
    HStack,
    Navigation,
    NavigationStack,
    RoundedRectangle,
    Script,
    ScrollView,
    Spacer,
    Text,
    Toolbar,
    ToolbarItem,
    VStack,
    useState,
} from "scripting"

import { QuoteItem, QuoteModel } from "./model"
import { SettingsPage } from "./settings"

function DetailPage() {
    const [quote, setQuote] = useState<QuoteItem>(() => QuoteModel.getCurrentQuote())
    const [showSettings, setShowSettings] = useState(false)

    const isLongText = quote.content.length > 80
    const authorAndSource = [quote.from_who, quote.from ? `《${quote.from}》` : null].filter(Boolean).join(" ")
    const metaInfo = [quote.type ? `#${quote.type}` : null, `${quote.length ?? quote.content.length} 字`].filter(Boolean).join(" • ")

    return (
        <NavigationStack>
            <ScrollView
                navigationTitle="AnyQuote"
                navigationBarTitleDisplayMode="inline"
                background={{ color: "systemGroupedBackground" as any }}
                toolbar={
                    <Toolbar>
                        <ToolbarItem placement="topBarTrailing">
                            <Button
                                title="设置"
                                systemImage="gearshape"
                                action={() => setShowSettings(true)}
                                sheet={{
                                    isPresented: showSettings,
                                    onChanged: setShowSettings,
                                    content: (
                                        <SettingsPage
                                            onDismiss={() => setShowSettings(false)}
                                            onRefreshQuote={setQuote}
                                        />
                                    ),
                                }}
                            />
                        </ToolbarItem>
                    </Toolbar>
                }
            >
                <VStack padding={{ top: isLongText ? 16 : 100, bottom: 32, leading: 16, trailing: 16 }}>
                    <VStack
                        padding={32}
                        spacing={32}
                        background={
                            <RoundedRectangle
                                cornerRadius={36}
                                fill={{
                                    gradient: [
                                        { color: "rgba(255, 255, 255, 0.95)", location: 0 },
                                        { color: "rgba(255, 255, 255, 0.75)", location: 1 },
                                    ],
                                    startPoint: { x: 0, y: 0 },
                                    endPoint: { x: 1, y: 1 },
                                }}
                            />
                        }
                        shadow={{ radius: 24, color: "rgba(0, 0, 0, 0.05)", x: 0, y: 12 }}
                        alignment="leading"
                    >
                        <HStack frame={{ maxWidth: Infinity }} alignment="center">
                            <Text font={14} fontWeight="heavy" foregroundStyle="rgba(0, 0, 0, 0.2)" fontDesign="serif">
                                AnyQuote
                            </Text>
                            <Spacer />
                            <Text font={50} fontWeight="black" foregroundStyle="rgba(0, 0, 0, 0.04)" lineLimit={1}>
                                “
                            </Text>
                        </HStack>

                        <Text
                            font={isLongText ? 18 : 28}
                            fontWeight={isLongText ? "medium" : "bold"}
                            foregroundStyle="rgba(0, 0, 0, 0.85)"
                            fontDesign="serif"
                            lineSpacing={isLongText ? 12 : 14}
                        >
                            {quote.content}
                        </Text>

                        <VStack spacing={8} alignment="trailing" frame={{ maxWidth: Infinity }}>
                            {authorAndSource ? (
                                <Text font={16} fontWeight="medium" foregroundStyle="rgba(0, 0, 0, 0.65)">
                                    — {authorAndSource}
                                </Text>
                            ) : null}

                            {metaInfo ? (
                                <Text font={13} fontWeight="regular" foregroundStyle="rgba(0, 0, 0, 0.35)">
                                    {metaInfo}
                                </Text>
                            ) : null}
                        </VStack>
                    </VStack>
                </VStack>
            </ScrollView>
        </NavigationStack>
    )
}

async function run() {
    void QuoteModel.fetchAndCache()

    await Navigation.present({
        element: <DetailPage />,
    })

    Script.exit()
}

run()
