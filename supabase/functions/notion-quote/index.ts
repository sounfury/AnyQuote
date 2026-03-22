const NOTION_VERSION = "2025-09-03";
const QUERY_PAGE_SIZE = 100;
const BLOCK_PAGE_SIZE = 100;
const BOOK_WEIGHT_EXPONENT = 0.5;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};

type NotionBlockCandidate = {
  id: string;
  type: string;
  text: string;
  depth: number;
};

type QuotePayload = {
  hitokoto: string;
  from: string;
  from_who: string;
  type: string;
  length: number;
  chapter?: string;
};

type RankedCandidate = NotionBlockCandidate & {
  score: number;
};

type QuoteEntry = {
  pageId: string;
  title: string;
  pageUrl: string;
  metadata: {
    author: string;
    chapter: string;
  };
  candidate: RankedCandidate;
};

type PageQuotePool = {
  pageId: string;
  title: string;
  pageUrl: string;
  metadata: {
    author: string;
    chapter: string;
  };
  ranked: RankedCandidate[];
  entries: QuoteEntry[];
  weight: number;
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: corsHeaders,
  });
}

function richTextToPlainText(items: unknown): string {
  if (!Array.isArray(items)) return "";

  return items
    .map((item) => typeof item === "object" && item !== null && "plain_text" in item ? String(item.plain_text ?? "") : "")
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

async function notionRequest(path: string, options: RequestInit = {}) {
  const notionToken = Deno.env.get("NOTION_TOKEN");

  if (!notionToken) {
    throw new Error("缺少环境变量 NOTION_TOKEN");
  }

  const response = await fetch(`https://api.notion.com${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${notionToken}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(`Notion 请求失败：${response.status} ${response.statusText} ${JSON.stringify(data)}`);
  }

  return data;
}

function getTitleFromPage(page: Record<string, unknown>): string {
  const properties = page.properties;
  if (!properties || typeof properties !== "object") {
    return "";
  }

  for (const property of Object.values(properties)) {
    if (property && typeof property === "object" && "type" in property && property.type === "title") {
      return richTextToPlainText((property as Record<string, unknown>).title);
    }
  }

  return "";
}

async function getDatabaseInfo(databaseId: string) {
  return notionRequest(`/v1/databases/${databaseId}`);
}

async function queryAllPages(dataSourceId: string) {
  const pages: Record<string, unknown>[] = [];
  let startCursor: string | undefined = undefined;

  do {
    const response = await notionRequest(`/v1/data_sources/${dataSourceId}/query`, {
      method: "POST",
      body: JSON.stringify({
        page_size: QUERY_PAGE_SIZE,
        start_cursor: startCursor,
      }),
    });

    if (Array.isArray(response.results)) {
      pages.push(...response.results);
    }

    startCursor = response.has_more ? response.next_cursor : undefined;
  } while (startCursor);

  return pages;
}

async function getBlockChildren(blockId: string) {
  const blocks: Record<string, unknown>[] = [];
  let startCursor: string | undefined = undefined;

  do {
    const params = [`page_size=${BLOCK_PAGE_SIZE}`];
    if (startCursor) {
      params.push(`start_cursor=${encodeURIComponent(startCursor)}`);
    }

    const response = await notionRequest(`/v1/blocks/${blockId}/children?${params.join("&")}`);

    if (Array.isArray(response.results)) {
      blocks.push(...response.results);
    }

    startCursor = response.has_more ? response.next_cursor : undefined;
  } while (startCursor);

  return blocks;
}

function extractTextFromBlock(block: Record<string, unknown>): string {
  const blockType = typeof block.type === "string" ? block.type : "";
  if (!blockType) return "";

  const blockValue = block[blockType];
  if (!blockValue || typeof blockValue !== "object") {
    return "";
  }

  const value = blockValue as Record<string, unknown>;
  if (Array.isArray(value.rich_text)) {
    return richTextToPlainText(value.rich_text);
  }

  if (Array.isArray(value.caption)) {
    return richTextToPlainText(value.caption);
  }

  return "";
}

async function collectReadableBlocks(
  blockId: string,
  depth = 0,
  results: NotionBlockCandidate[] = [],
): Promise<NotionBlockCandidate[]> {
  const blocks = await getBlockChildren(blockId);

  for (const block of blocks) {
    const text = extractTextFromBlock(block);
    const type = typeof block.type === "string" ? block.type : "";
    const id = typeof block.id === "string" ? block.id : "";

    if (text && type && id) {
      results.push({
        id,
        type,
        text,
        depth,
      });
    }

    if (block.has_children) {
      await collectReadableBlocks(id, depth + 1, results);
    }
  }

  return results;
}

function looksLikeMetadata(text: string): boolean {
  const normalized = text.trim();

  if (!normalized) return true;

  return [
    /^作者[:：]/i,
    /^author[:：]/i,
    /^来源[:：]/i,
    /^出版社[:：]/i,
    /^出版/i,
    /^标签[:：]/i,
    /^评分[:：]/i,
    /^ISBN[:：]/i,
    /^页数[:：]/i,
    /notes?/i,
    /from\s+reeden/i,
    /阅读/i,
  ].some((pattern) => pattern.test(normalized));
}

function extractAuthorFromMetadata(text: string): string {
  const match = text.trim().match(/作者[:：]\s*([^•]+)/i);
  return match ? match[1].trim() : "";
}

function extractPageMetadata(candidates: NotionBlockCandidate[]) {
  let author = "";
  let chapter = "";

  for (const candidate of candidates) {
    if (!author && /作者[:：]/i.test(candidate.text)) {
      author = extractAuthorFromMetadata(candidate.text);
    }

    if (!chapter && /^heading_[123]$/.test(candidate.type)) {
      chapter = candidate.text.trim();
    }

    if (author && chapter) break;
  }

  return { author, chapter };
}

function scoreTextCandidate(candidate: NotionBlockCandidate) {
  let score = 0;

  if (candidate.type === "quote") score += 40;
  if (candidate.type === "paragraph") score += 30;
  if (candidate.type === "callout") score += 20;
  if (candidate.type === "bulleted_list_item" || candidate.type === "numbered_list_item") score += 10;

  if (candidate.text.length >= 20) score += 30;
  if (candidate.text.length >= 40) score += 20;
  if (candidate.text.length >= 80) score += 10;

  if (candidate.depth > 0) score += 5;
  if (looksLikeMetadata(candidate.text)) score -= 100;

  return score;
}

function rankTextCandidates(candidates: NotionBlockCandidate[]): RankedCandidate[] {
  return candidates
    .map((candidate) => ({
      ...candidate,
      score: scoreTextCandidate(candidate),
    }))
    .sort((a, b) => b.score - a.score);
}

function randomPick<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function weightedRandomPick<T>(items: T[], getWeight: (item: T) => number): T {
  const weightedItems = items
    .map((item) => ({
      item,
      weight: Math.max(0, getWeight(item)),
    }))
    .filter((item) => item.weight > 0);

  if (weightedItems.length === 0) {
    return randomPick(items);
  }

  const totalWeight = weightedItems.reduce((sum, item) => sum + item.weight, 0);
  let random = Math.random() * totalWeight;

  for (const weightedItem of weightedItems) {
    random -= weightedItem.weight;
    if (random <= 0) {
      return weightedItem.item;
    }
  }

  return weightedItems[weightedItems.length - 1].item;
}

async function buildQuoteEntriesFromPage(page: Record<string, unknown>): Promise<PageQuotePool> {
  const pageId = String(page.id ?? "");
  const title = getTitleFromPage(page) || "未命名书摘";
  const pageUrl = String(page.url ?? "");
  const candidates = await collectReadableBlocks(pageId);
  const metadata = extractPageMetadata(candidates);
  const ranked = rankTextCandidates(candidates);
  const eligibleCandidates = ranked.filter((candidate) => candidate.score > 0);
  const weight = Math.pow(Math.max(eligibleCandidates.length, 1), BOOK_WEIGHT_EXPONENT);

  return {
    pageId,
    title,
    pageUrl,
    metadata,
    ranked,
    weight,
    entries: eligibleCandidates.map((candidate) => ({
      pageId,
      title,
      pageUrl,
      metadata,
      candidate,
    })),
  };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "GET") {
    return json({ error: "仅支持 GET 请求" }, 405);
  }

  try {
    const databaseId = Deno.env.get("NOTION_DATABASE_ID");
    if (!databaseId) {
      throw new Error("缺少环境变量 NOTION_DATABASE_ID");
    }

    const url = new URL(request.url);
    const debug = url.searchParams.get("debug") === "1";

    // 先固定取第一组 data source，后续如果要多库或多源，再把 data_source_id 放成配置项。
    const database = await getDatabaseInfo(databaseId);
    const dataSources = Array.isArray(database.data_sources) ? database.data_sources : [];

    if (dataSources.length === 0) {
      throw new Error("数据库下没有可用的 data source");
    }

    const dataSource = dataSources[0] as Record<string, unknown>;
    const dataSourceId = String(dataSource.id ?? "");
    if (!dataSourceId) {
      throw new Error("data source id 不存在");
    }

    const pages = await queryAllPages(dataSourceId);
    if (pages.length === 0) {
      throw new Error("这个 data source 下面没有页面");
    }

    const pagePools = await Promise.all(pages.map((page) => buildQuoteEntriesFromPage(page)));
    const availablePagePools = pagePools.filter((item) => item.entries.length > 0);

    if (availablePagePools.length === 0) {
      throw new Error("没有构建出可用的书摘池");
    }

    // 先按“书”做温和加权，再在书内随机一条，避免线性按条数碾压，也避免按书绝对平权。
    const selectedPagePool = weightedRandomPick(availablePagePools, (item) => item.weight);
    const selected = randomPick(selectedPagePool.entries);
    const metadata = selected.metadata;
    const result: QuotePayload = {
      hitokoto: selected.candidate.text,
      from: selected.title,
      from_who: metadata.author,
      type: "书摘",
      length: selected.candidate.text.length,
      chapter: metadata.chapter || undefined,
    };

    if (!debug) {
      return json(result);
    }

    return json({
      ...result,
      _debug: {
        database_id: database.id,
        data_source_id: dataSourceId,
        page_id: selected.pageId,
        page_url: selected.pageUrl,
        algorithm: {
          mode: "weighted-book-then-random-quote",
          book_weight_exponent: BOOK_WEIGHT_EXPONENT,
        },
        page_pool_count: availablePagePools.length,
        quote_pool_size: availablePagePools.reduce((sum, item) => sum + item.entries.length, 0),
        selected_book_weight: selectedPagePool.weight,
        picked_candidate: selected.candidate,
        books: availablePagePools.map((item) => ({
          page_id: item.pageId,
          title: item.title,
          quote_count: item.entries.length,
          weight: item.weight,
        })),
        top_candidates: selectedPagePool.ranked.slice(0, 8),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    return json({ error: message }, 500);
  }
});
