import { App, TFile, normalizePath } from "obsidian";
import {
  FoodCatalogFileData,
  FoodItem,
  cloneDefaultFoods,
  makeFoodId,
} from "./types";

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function sanitizeFoodItem(raw: unknown): FoodItem | null {
  if (!raw || typeof raw !== "object") return null;
  const f = raw as Record<string, unknown>;
  const name = typeof f.name === "string" ? f.name.trim() : "";
  if (!name) return null;

  const num = (v: unknown, def = 0): number => {
    const n = typeof v === "number" ? v : Number(String(v ?? "").replace(",", "."));
    return Number.isFinite(n) && n >= 0 ? round1(n) : def;
  };

  const id =
    typeof f.id === "string" && f.id.trim() ? f.id.trim() : makeFoodId();
  const pieceGrams = num(f.pieceGrams, 0);

  return {
    id,
    name,
    kcalPer100: num(f.kcalPer100, 0),
    proteinPer100: num(f.proteinPer100, 0),
    fatPer100: num(f.fatPer100, 0),
    carbsPer100: num(f.carbsPer100, 0),
    pieceGrams: pieceGrams > 0 ? pieceGrams : undefined,
    pieceLabel:
      typeof f.pieceLabel === "string" && f.pieceLabel.trim()
        ? f.pieceLabel.trim()
        : pieceGrams > 0
          ? "порц."
          : undefined,
    defaultGrams: num(f.defaultGrams, pieceGrams > 0 ? pieceGrams : 100) || 100,
    isFavorite: Boolean(f.isFavorite),
    useCount: Math.max(0, Math.round(num(f.useCount, 0))),
    lastUsedAt: Math.max(0, Math.round(num(f.lastUsedAt, 0))),
  };
}

async function ensureParentFolder(app: App, filePath: string): Promise<void> {
  const parts = normalizePath(filePath).split("/").filter(Boolean);
  parts.pop();
  let cur = "";
  for (const part of parts) {
    cur = cur ? `${cur}/${part}` : part;
    if (!app.vault.getAbstractFileByPath(cur)) {
      try {
        await app.vault.createFolder(cur);
      } catch {
        // уже создана
      }
    }
  }
}

export class FoodCatalogStore {
  private app: App;
  private dbPath: string;
  private foods: FoodItem[] = cloneDefaultFoods();
  private saveTimer: number | null = null;

  constructor(app: App, dbPath: string) {
    this.app = app;
    this.dbPath = normalizePath(dbPath || "Знания/База продуктов.json");
  }

  setDbPath(nextPath: string): void {
    const clean = normalizePath(nextPath.trim() || "Знания/База продуктов.json");
    if (clean !== this.dbPath) {
      this.dbPath = clean;
      void this.load();
    }
  }

  getDbPath(): string {
    return this.dbPath;
  }

  async load(): Promise<void> {
    const existing = this.app.vault.getAbstractFileByPath(this.dbPath);
    if (existing instanceof TFile) {
      try {
        const raw = await this.app.vault.read(existing);
        const parsed = JSON.parse(raw) as Partial<FoodCatalogFileData>;
        if (parsed && Array.isArray(parsed.foods)) {
          const valid = parsed.foods
            .map(sanitizeFoodItem)
            .filter((x): x is FoodItem => x !== null);
          if (valid.length > 0) {
            this.foods = valid;
            return;
          }
        }
      } catch {
        // если файл повреждён, не перезаписываем молча, но держим дефолты в памяти
        return;
      }
    }

    this.foods = cloneDefaultFoods();
    await this.saveNow();
  }

  getAllFoods(): readonly FoodItem[] {
    return this.foods;
  }

  /**
   * Сортирует продукты для быстрого выбора: сначала избранные, затем недавние и частые, затем по алфавиту.
   */
  getSortedFoods(query = ""): FoodItem[] {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? this.foods.filter((f) => f.name.toLowerCase().includes(q))
      : [...this.foods];

    return filtered.sort((a, b) => {
      if (Boolean(a.isFavorite) !== Boolean(b.isFavorite)) {
        return a.isFavorite ? -1 : 1;
      }
      if (b.lastUsedAt !== a.lastUsedAt) {
        return b.lastUsedAt - a.lastUsedAt;
      }
      if (b.useCount !== a.useCount) {
        return b.useCount - a.useCount;
      }
      return a.name.localeCompare(b.name, "ru");
    });
  }

  findById(id: string): FoodItem | undefined {
    return this.foods.find((f) => f.id === id);
  }

  upsertFood(draft: Omit<FoodItem, "id" | "useCount" | "lastUsedAt"> & { id?: string }): FoodItem {
    const cleanName = draft.name.replace(/\s+/g, " ").trim();
    const existing = draft.id
      ? this.foods.find((f) => f.id === draft.id)
      : this.foods.find((f) => f.name.toLowerCase() === cleanName.toLowerCase());

    if (existing) {
      existing.name = cleanName;
      existing.kcalPer100 = round1(draft.kcalPer100);
      existing.proteinPer100 = round1(draft.proteinPer100);
      existing.fatPer100 = round1(draft.fatPer100);
      existing.carbsPer100 = round1(draft.carbsPer100);
      existing.pieceGrams =
        draft.pieceGrams && draft.pieceGrams > 0
          ? round1(draft.pieceGrams)
          : undefined;
      existing.pieceLabel =
        draft.pieceGrams && draft.pieceGrams > 0
          ? draft.pieceLabel?.trim() || "шт."
          : undefined;
      existing.defaultGrams = round1(draft.defaultGrams || 100);
      existing.isFavorite = Boolean(draft.isFavorite);
      this.requestSave();
      return existing;
    }

    const created: FoodItem = {
      id: makeFoodId(),
      name: cleanName,
      kcalPer100: round1(draft.kcalPer100),
      proteinPer100: round1(draft.proteinPer100),
      fatPer100: round1(draft.fatPer100),
      carbsPer100: round1(draft.carbsPer100),
      pieceGrams:
        draft.pieceGrams && draft.pieceGrams > 0
          ? round1(draft.pieceGrams)
          : undefined,
      pieceLabel:
        draft.pieceGrams && draft.pieceGrams > 0
          ? draft.pieceLabel?.trim() || "шт."
          : undefined,
      defaultGrams: round1(
        draft.defaultGrams ||
          (draft.pieceGrams && draft.pieceGrams > 0 ? draft.pieceGrams : 100)
      ),
      isFavorite: Boolean(draft.isFavorite),
      useCount: 1,
      lastUsedAt: Date.now(),
    };
    this.foods.push(created);
    this.requestSave();
    return created;
  }

  recordFoodUsage(foodId: string, usedGrams: number): void {
    const item = this.findById(foodId);
    if (!item) return;
    item.useCount = (item.useCount || 0) + 1;
    item.lastUsedAt = Date.now();
    if (usedGrams > 0) {
      item.defaultGrams = round1(usedGrams);
    }
    this.requestSave();
  }

  toggleFavorite(foodId: string): void {
    const item = this.findById(foodId);
    if (!item) return;
    item.isFavorite = !item.isFavorite;
    this.requestSave();
  }

  deleteFood(foodId: string): void {
    const idx = this.foods.findIndex((f) => f.id === foodId);
    if (idx !== -1) {
      this.foods.splice(idx, 1);
      this.requestSave();
    }
  }

  requestSave(): void {
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      void this.saveNow();
    }, 200);
  }

  async saveNow(): Promise<void> {
    try {
      await ensureParentFolder(this.app, this.dbPath);
      const payload: FoodCatalogFileData = {
        version: 1,
        foods: this.foods,
      };
      const jsonText = JSON.stringify(payload, null, 2);
      const existing = this.app.vault.getAbstractFileByPath(this.dbPath);
      if (existing instanceof TFile) {
        await this.app.vault.modify(existing, jsonText);
      } else {
        await this.app.vault.create(this.dbPath, jsonText);
      }
    } catch {
      // игнорируем ошибки записи
    }
  }

  flush(): void {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
      void this.saveNow();
    }
  }
}
