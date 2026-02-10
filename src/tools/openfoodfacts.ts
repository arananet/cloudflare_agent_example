/**
 * OpenFoodFacts MCP Tools
 *
 * @developer Eduardo Arana
 *
 * MCP-style tool definitions that call the OpenFoodFacts API.
 * These tools are exposed to the Agent as callable functions so the LLM
 * can autonomously decide which nutritional lookup to perform.
 *
 * API docs: https://openfoodfacts.github.io/openfoodfacts-server/api/
 */

const OFF_BASE = "https://world.openfoodfacts.org";
const USER_AGENT = "NutriAgent/1.0 (cloudflare-agent; contact@nutriagent.dev)";

// ── helpers ────────────────────────────────────────────────────────────────

async function offFetch(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`OpenFoodFacts ${res.status}: ${res.statusText}`);
  return res.json();
}

// ── types ──────────────────────────────────────────────────────────────────

export interface NutrientInfo {
  energy_kcal_100g?: number;
  fat_100g?: number;
  saturated_fat_100g?: number;
  carbohydrates_100g?: number;
  sugars_100g?: number;
  fiber_100g?: number;
  proteins_100g?: number;
  salt_100g?: number;
  sodium_100g?: number;
  [key: string]: unknown;
}

export interface ProductSummary {
  code: string;
  product_name: string;
  brands: string;
  categories: string;
  nutriscore_grade: string;
  nova_group: number | string;
  ecoscore_grade: string;
  image_url: string;
  nutriments: NutrientInfo;
  ingredients_text: string;
  allergens: string;
  quantity: string;
}

// ── normalise a raw OFF product into a lean summary ────────────────────────

function summarise(p: Record<string, unknown>): ProductSummary {
  const n = (p.nutriments ?? {}) as NutrientInfo;
  return {
    code: String(p.code ?? ""),
    product_name: String(p.product_name ?? p.product_name_en ?? "Unknown"),
    brands: String(p.brands ?? ""),
    categories: String(p.categories ?? ""),
    nutriscore_grade: String(p.nutriscore_grade ?? "unknown"),
    nova_group: (p.nova_group as number | string) ?? "unknown",
    ecoscore_grade: String(p.ecoscore_grade ?? "unknown"),
    image_url: String(p.image_front_url ?? p.image_url ?? ""),
    nutriments: {
      energy_kcal_100g: n.energy_kcal_100g,
      fat_100g: n.fat_100g,
      saturated_fat_100g: n["saturated-fat_100g" as keyof NutrientInfo] as number | undefined ?? n.saturated_fat_100g,
      carbohydrates_100g: n.carbohydrates_100g,
      sugars_100g: n.sugars_100g,
      fiber_100g: n.fiber_100g,
      proteins_100g: n.proteins_100g,
      salt_100g: n.salt_100g,
      sodium_100g: n.sodium_100g,
    },
    ingredients_text: String(p.ingredients_text ?? p.ingredients_text_en ?? ""),
    allergens: String(p.allergens ?? ""),
    quantity: String(p.quantity ?? ""),
  };
}

// ── MCP TOOL 1: lookup by barcode ──────────────────────────────────────────

export async function getProductByBarcode(barcode: string): Promise<ProductSummary> {
  const data = (await offFetch(
    `${OFF_BASE}/api/v2/product/${encodeURIComponent(barcode)}.json`
  )) as { status: number; product?: Record<string, unknown> };

  if (!data.product) throw new Error(`Product not found for barcode ${barcode}`);
  return summarise(data.product);
}

// ── MCP TOOL 2: search products by name / keyword ─────────────────────────

export async function searchProducts(
  query: string,
  page = 1,
  pageSize = 5
): Promise<{ count: number; products: ProductSummary[] }> {
  const url = new URL(`${OFF_BASE}/cgi/search.pl`);
  url.searchParams.set("search_terms", query);
  url.searchParams.set("search_simple", "1");
  url.searchParams.set("action", "process");
  url.searchParams.set("json", "true");
  url.searchParams.set("page", String(page));
  url.searchParams.set("page_size", String(pageSize));

  const data = (await offFetch(url.toString())) as {
    count: number;
    products: Record<string, unknown>[];
  };

  return {
    count: data.count ?? 0,
    products: (data.products ?? []).map(summarise),
  };
}

// ── MCP TOOL 3: search by category ────────────────────────────────────────

export async function getProductsByCategory(
  category: string,
  page = 1,
  pageSize = 5
): Promise<{ count: number; products: ProductSummary[] }> {
  const tag = category.toLowerCase().replace(/\s+/g, "-");
  const url = `${OFF_BASE}/category/${encodeURIComponent(tag)}.json?page=${page}&page_size=${pageSize}`;
  const data = (await offFetch(url)) as {
    count: number;
    products: Record<string, unknown>[];
  };

  return {
    count: data.count ?? 0,
    products: (data.products ?? []).map(summarise),
  };
}

// ── MCP TOOL 4: compare Nutri-Score of multiple barcodes ──────────────────

export async function compareProducts(
  barcodes: string[]
): Promise<ProductSummary[]> {
  const results = await Promise.allSettled(barcodes.map(getProductByBarcode));
  return results
    .filter((r): r is PromiseFulfilledResult<ProductSummary> => r.status === "fulfilled")
    .map((r) => r.value);
}

// ── MCP TOOL 5: get allergen info for a barcode ───────────────────────────

export async function getAllergenInfo(barcode: string): Promise<{
  product_name: string;
  allergens: string;
  allergens_tags: string[];
  traces: string;
  traces_tags: string[];
}> {
  const data = (await offFetch(
    `${OFF_BASE}/api/v2/product/${encodeURIComponent(barcode)}.json?fields=product_name,allergens,allergens_tags,traces,traces_tags`
  )) as { product?: Record<string, unknown> };

  const p = data.product ?? {};
  return {
    product_name: String(p.product_name ?? "Unknown"),
    allergens: String(p.allergens ?? ""),
    allergens_tags: (p.allergens_tags as string[]) ?? [],
    traces: String(p.traces ?? ""),
    traces_tags: (p.traces_tags as string[]) ?? [],
  };
}

// ── OpenAI-style tool definitions (for function-calling) ──────────────────

export const TOOL_DEFINITIONS = [
  {
    type: "function" as const,
    function: {
      name: "get_product_by_barcode",
      description:
        "Look up a food product by its barcode (EAN/UPC). Returns full nutritional facts, Nutri-Score, ingredients, allergens.",
      parameters: {
        type: "object",
        properties: {
          barcode: {
            type: "string",
            description: "The product barcode (EAN-13 or UPC-A), e.g. '3017620422003' for Nutella",
          },
        },
        required: ["barcode"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "search_products",
      description:
        "Search the OpenFoodFacts database by product name or keyword. Returns a list of matching products with nutritional info.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Product name or keyword to search for" },
          page: { type: "number", description: "Page number (default 1)" },
          page_size: { type: "number", description: "Results per page, max 50 (default 5)" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_products_by_category",
      description:
        "Browse products in a specific food category, e.g. 'breakfast-cereals', 'yogurts', 'sodas'.",
      parameters: {
        type: "object",
        properties: {
          category: { type: "string", description: "Food category name" },
          page: { type: "number", description: "Page number (default 1)" },
          page_size: { type: "number", description: "Results per page (default 5)" },
        },
        required: ["category"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "compare_products",
      description:
        "Compare nutritional facts and Nutri-Score across multiple products by their barcodes.",
      parameters: {
        type: "object",
        properties: {
          barcodes: {
            type: "array",
            items: { type: "string" },
            description: "Array of barcodes to compare",
          },
        },
        required: ["barcodes"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_allergen_info",
      description:
        "Get allergen and trace information for a product by barcode. Useful for dietary restriction checks.",
      parameters: {
        type: "object",
        properties: {
          barcode: { type: "string", description: "Product barcode" },
        },
        required: ["barcode"],
      },
    },
  },
] as const;

// ── dispatcher: route tool calls from the LLM to the right function ───────

export async function dispatchTool(
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  switch (name) {
    case "get_product_by_barcode":
      return getProductByBarcode(args.barcode as string);
    case "search_products":
      return searchProducts(
        args.query as string,
        (args.page as number) ?? 1,
        (args.page_size as number) ?? 5
      );
    case "get_products_by_category":
      return getProductsByCategory(
        args.category as string,
        (args.page as number) ?? 1,
        (args.page_size as number) ?? 5
      );
    case "compare_products":
      return compareProducts(args.barcodes as string[]);
    case "get_allergen_info":
      return getAllergenInfo(args.barcode as string);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
