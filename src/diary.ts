import { App, TFile, normalizePath } from "obsidian";
import {
  DIARY_KEYS,
  DailyMacrosSummary,
  LoggedMealEntry,
  MANUAL_HABITS_PREFIX,
  NUTRITION_SECTION_HEADING,
  NutritionPluginSettings,
} from "./types";

/**
 * Формат строки приёма пищи в разделе `## Питание` (только граммы, но старые строки со скобками тоже парсятся):
 * - 09:30 · Сырники творожные · 180 г · 333 ккал · Б: 26.1 · Ж: 13.5 · У: 27
 */
const MEAL_LINE_REGEX =
  /^-\s*(?:(\d{2}:\d{2})\s*·\s*)?(.+?)\s*·\s*([0-9]+(?:[.,][0-9]+)?)\s*г(?:\s*\([^)]*\))?\s*·\s*([0-9]+(?:[.,][0-9]+)?)\s*ккал\s*·\s*Б:\s*([0-9]+(?:[.,][0-9]+)?)\s*·\s*Ж:\s*([0-9]+(?:[.,][0-9]+)?)\s*·\s*У:\s*([0-9]+(?:[.,][0-9]+)?)\s*$/i;

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function todayLocalISO(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function currentTimeHHMM(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function formatDateRu(iso: string): string {
  const parts = iso.split("-");
  if (parts.length !== 3) return iso;
  return `${parts[2]}.${parts[1]}.${parts[0]}`;
}

function extractISODate(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v).trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
}

export function clearManualHabitOverrideForDate(
  dateISO: string,
  habitKey: string
): void {
  try {
    const storageKey = MANUAL_HABITS_PREFIX + dateISO;
    const raw = window.localStorage?.getItem(storageKey);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed && typeof parsed === "object" && habitKey in parsed) {
      delete parsed[habitKey];
      window.localStorage?.setItem(storageKey, JSON.stringify(parsed));
    }
  } catch {
    // игнорируем
  }
}

async function ensureFolder(app: App, folderPath: string): Promise<void> {
  let current = "";
  for (const part of normalizePath(folderPath).split("/").filter(Boolean)) {
    current = current ? `${current}/${part}` : part;
    if (!app.vault.getAbstractFileByPath(current)) {
      try {
        await app.vault.createFolder(current);
      } catch {
        // уже существует
      }
    }
  }
}

export function findDiaryFileForDate(
  app: App,
  settings: NutritionPluginSettings,
  dateISO: string
): TFile | null {
  const folder = normalizePath(settings.diaryFolder || "Ежедневник").replace(
    /\/+$/,
    ""
  );
  const directPath = normalizePath(`${folder}/${dateISO}.md`);
  const direct = app.vault.getAbstractFileByPath(directPath);
  if (direct instanceof TFile) return direct;

  const prefix = `${folder}/`;
  let bestMatch: TFile | null = null;
  for (const f of app.vault.getMarkdownFiles()) {
    if (!f.path.startsWith(prefix)) continue;
    const fm = app.metadataCache.getFileCache(f)?.frontmatter;
    if (fm && extractISODate(fm[DIARY_KEYS.date]) === dateISO) {
      if (!bestMatch || f.stat.mtime > bestMatch.stat.mtime) {
        bestMatch = f;
      }
    }
  }
  return bestMatch;
}

export async function getOrCreateDiaryFile(
  app: App,
  settings: NutritionPluginSettings,
  dateISO: string
): Promise<TFile> {
  const found = findDiaryFileForDate(app, settings, dateISO);
  if (found) return found;

  const folder = normalizePath(settings.diaryFolder || "Ежедневник").replace(
    /\/+$/,
    ""
  );
  await ensureFolder(app, folder);
  const targetPath = normalizePath(`${folder}/${dateISO}.md`);
  const content = [
    "---",
    `${DIARY_KEYS.date}: "${dateISO}"`,
    "---",
    "",
    NUTRITION_SECTION_HEADING,
    "",
  ].join("\n");
  return await app.vault.create(targetPath, content);
}

function findNutritionSectionBounds(lines: string[]): {
  headingIdx: number;
  endIdx: number;
} | null {
  let headingIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = (lines[i] ?? "").trim();
    if (/^##\s+Питание\s*$/i.test(trimmed)) {
      headingIdx = i;
      break;
    }
  }
  if (headingIdx === -1) return null;

  let endIdx = lines.length;
  for (let i = headingIdx + 1; i < lines.length; i++) {
    const trimmed = (lines[i] ?? "").trim();
    if (/^#{1,2}\s+\S/.test(trimmed)) {
      endIdx = i;
      break;
    }
  }
  return { headingIdx, endIdx };
}

export function parseMealsFromDiaryContent(content: string): LoggedMealEntry[] {
  const lines = content.split(/\r?\n/);
  const bounds = findNutritionSectionBounds(lines);
  if (!bounds) return [];

  const entries: LoggedMealEntry[] = [];
  for (let i = bounds.headingIdx + 1; i < bounds.endIdx; i++) {
    const line = (lines[i] ?? "").trim();
    if (!line.startsWith("-")) continue;
    const m = line.match(MEAL_LINE_REGEX);
    if (!m) continue;

    const timeStr = (m[1] ?? "").trim();
    const name = (m[2] ?? "").trim();
    const grams = Number((m[3] ?? "0").replace(",", "."));
    const kcal = Number((m[4] ?? "0").replace(",", "."));
    const protein = Number((m[5] ?? "0").replace(",", "."));
    const fat = Number((m[6] ?? "0").replace(",", "."));
    const carbs = Number((m[7] ?? "0").replace(",", "."));

    if (!name || !Number.isFinite(grams)) continue;

    entries.push({
      lineIndex: i,
      timeStr,
      name,
      grams: round1(grams),
      kcal: Math.round(kcal),
      protein: round1(protein),
      fat: round1(fat),
      carbs: round1(carbs),
    });
  }
  return entries;
}

export function sumDailyMacros(entries: LoggedMealEntry[]): DailyMacrosSummary {
  let kcal = 0;
  let protein = 0;
  let fat = 0;
  let carbs = 0;
  for (const e of entries) {
    kcal += e.kcal;
    protein += e.protein;
    fat += e.fat;
    carbs += e.carbs;
  }
  return {
    kcal: Math.round(kcal),
    protein: round1(protein),
    fat: round1(fat),
    carbs: round1(carbs),
  };
}

export function formatMealMarkdownLine(entry: {
  timeStr: string;
  name: string;
  grams: number;
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
}): string {
  return `- ${entry.timeStr} · ${entry.name} · ${round1(entry.grams)} г · ${Math.round(entry.kcal)} ккал · Б: ${round1(entry.protein)} · Ж: ${round1(entry.fat)} · У: ${round1(entry.carbs)}`;
}

/**
 * Пересчитывает сумму приёмов пищи из раздела `## Питание` и записывает числа в YAML через processFrontMatter.
 * Если дневная цель калорий задана (> 0), обновляет флаг `диета: true/false`.
 * Если цель удалена (null), поле `диета` не принуждается.
 */
export async function syncMacrosToDiaryFrontmatter(
  app: App,
  settings: NutritionPluginSettings,
  diaryFile: TFile,
  dateISO: string,
  entries: LoggedMealEntry[],
  allowClearWhenEmpty = false
): Promise<DailyMacrosSummary> {
  const totals = sumDailyMacros(entries);
  if (entries.length === 0 && !allowClearWhenEmpty) {
    return totals;
  }

  const goal =
    typeof settings.dailyCalorieGoal === "number" &&
    settings.dailyCalorieGoal > 0
      ? settings.dailyCalorieGoal
      : null;

  if (goal !== null) {
    clearManualHabitOverrideForDate(dateISO, DIARY_KEYS.dietFlag);
  }

  await app.fileManager.processFrontMatter(
    diaryFile,
    (fm: Record<string, unknown>) => {
      if (entries.length === 0) {
        delete fm[DIARY_KEYS.caloriesKcal];
        delete fm[DIARY_KEYS.proteinG];
        delete fm[DIARY_KEYS.fatG];
        delete fm[DIARY_KEYS.carbsG];
        if (goal !== null) {
          fm[DIARY_KEYS.dietFlag] = false;
        }
      } else {
        fm[DIARY_KEYS.caloriesKcal] = totals.kcal;
        fm[DIARY_KEYS.proteinG] = totals.protein;
        fm[DIARY_KEYS.fatG] = totals.fat;
        fm[DIARY_KEYS.carbsG] = totals.carbs;
        if (goal !== null) {
          fm[DIARY_KEYS.dietFlag] = totals.kcal >= goal;
        }
      }
    }
  );

  return totals;
}

export async function appendMealToDiary(
  app: App,
  settings: NutritionPluginSettings,
  dateISO: string,
  meal: {
    name: string;
    grams: number;
    kcal: number;
    protein: number;
    fat: number;
    carbs: number;
  }
): Promise<void> {
  const file = await getOrCreateDiaryFile(app, settings, dateISO);
  const raw = await app.vault.read(file);
  const lines = raw.split(/\r?\n/);
  const newLine = formatMealMarkdownLine({
    timeStr: currentTimeHHMM(),
    ...meal,
  });

  const bounds = findNutritionSectionBounds(lines);
  if (!bounds) {
    if (lines.length > 0 && (lines[lines.length - 1] ?? "").trim() !== "") {
      lines.push("");
    }
    lines.push(NUTRITION_SECTION_HEADING, newLine, "");
  } else {
    let insertIdx = bounds.endIdx;
    while (
      insertIdx > bounds.headingIdx + 1 &&
      (lines[insertIdx - 1] ?? "").trim() === ""
    ) {
      insertIdx--;
    }
    lines.splice(insertIdx, 0, newLine);
  }

  const nextContent = lines.join("\n");
  await app.vault.modify(file, nextContent);

  const updatedEntries = parseMealsFromDiaryContent(nextContent);
  await syncMacrosToDiaryFrontmatter(
    app,
    settings,
    file,
    dateISO,
    updatedEntries,
    true
  );
}

export async function deleteMealFromDiary(
  app: App,
  settings: NutritionPluginSettings,
  dateISO: string,
  lineIndex: number
): Promise<void> {
  const file = findDiaryFileForDate(app, settings, dateISO);
  if (!file) return;

  const raw = await app.vault.read(file);
  const lines = raw.split(/\r?\n/);
  if (lineIndex < 0 || lineIndex >= lines.length) return;
  if (!MEAL_LINE_REGEX.test((lines[lineIndex] ?? "").trim())) return;

  lines.splice(lineIndex, 1);
  const nextContent = lines.join("\n");
  await app.vault.modify(file, nextContent);

  const updatedEntries = parseMealsFromDiaryContent(nextContent);
  await syncMacrosToDiaryFrontmatter(
    app,
    settings,
    file,
    dateISO,
    updatedEntries,
    true
  );
}
