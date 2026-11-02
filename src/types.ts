export const DIARY_KEYS = {
  date: "дата",
  weightKg: "вес_кг",
  caloriesKcal: "калории_ккал",
  proteinG: "белки_г",
  fatG: "жиры_г",
  carbsG: "углеводы_г",
  dietFlag: "диета",
} as const;

export const NUTRITION_SECTION_HEADING = "## Питание";
export const MANUAL_HABITS_PREFIX = "dh_today_manual_habits_v1:";

export interface FoodItem {
  id: string;
  name: string;
  kcalPer100: number;
  proteinPer100: number;
  fatPer100: number;
  carbsPer100: number;
  defaultGrams: number;
  isFavorite?: boolean;
  useCount: number;
  lastUsedAt: number;
}

export interface FoodCatalogFileData {
  version: number;
  foods: FoodItem[];
}

export interface LoggedMealEntry {
  lineIndex: number;
  timeStr: string;
  name: string;
  grams: number;
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
}

export interface DailyMacrosSummary {
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
}

export interface NutritionPluginSettings {
  diaryFolder: string;
  foodDbPath: string;
  /** null или 0 означает, что цель отключена (считается только факт) */
  dailyCalorieGoal: number | null;
}

export const DEFAULT_SETTINGS: NutritionPluginSettings = {
  diaryFolder: "Ежедневник",
  foodDbPath: "Знания/База продуктов.json",
  dailyCalorieGoal: 2600,
};

export function makeFoodId(): string {
  return (
    "fd_" +
    Date.now().toString(36) +
    "_" +
    Math.random().toString(36).slice(2, 7)
  );
}

export const DEFAULT_FOODS: readonly FoodItem[] = [
  {
    id: "fd_cottage_cheese_5",
    name: "Творог 5%",
    kcalPer100: 121,
    proteinPer100: 17,
    fatPer100: 5,
    carbsPer100: 1.8,
    defaultGrams: 200,
    isFavorite: true,
    useCount: 5,
    lastUsedAt: 0,
  },
  {
    id: "fd_syrniki",
    name: "Сырники творожные",
    kcalPer100: 185,
    proteinPer100: 14.5,
    fatPer100: 7.5,
    carbsPer100: 15,
    defaultGrams: 180,
    isFavorite: true,
    useCount: 4,
    lastUsedAt: 0,
  },
  {
    id: "fd_whey_protein",
    name: "Протеин сывороточный",
    kcalPer100: 390,
    proteinPer100: 78,
    fatPer100: 5.5,
    carbsPer100: 7,
    defaultGrams: 30,
    isFavorite: true,
    useCount: 5,
    lastUsedAt: 0,
  },
  {
    id: "fd_eggs",
    name: "Яйцо куриное C1",
    kcalPer100: 157,
    proteinPer100: 12.7,
    fatPer100: 11.5,
    carbsPer100: 0.7,
    defaultGrams: 150,
    isFavorite: true,
    useCount: 4,
    lastUsedAt: 0,
  },
  {
    id: "fd_rice_boiled",
    name: "Рис отварной",
    kcalPer100: 116,
    proteinPer100: 2.2,
    fatPer100: 0.5,
    carbsPer100: 24.9,
    defaultGrams: 200,
    isFavorite: true,
    useCount: 3,
    lastUsedAt: 0,
  },
  {
    id: "fd_buckwheat_boiled",
    name: "Гречка отварная",
    kcalPer100: 110,
    proteinPer100: 4.2,
    fatPer100: 1.1,
    carbsPer100: 21.3,
    defaultGrams: 200,
    isFavorite: true,
    useCount: 3,
    lastUsedAt: 0,
  },
  {
    id: "fd_chicken_breast",
    name: "Куриное филе (готовое)",
    kcalPer100: 165,
    proteinPer100: 31,
    fatPer100: 3.6,
    carbsPer100: 0,
    defaultGrams: 150,
    isFavorite: true,
    useCount: 4,
    lastUsedAt: 0,
  },
  {
    id: "fd_oats_dry",
    name: "Овсяные хлопья (сухие)",
    kcalPer100: 352,
    proteinPer100: 12.3,
    fatPer100: 6.2,
    carbsPer100: 61.8,
    defaultGrams: 80,
    isFavorite: false,
    useCount: 2,
    lastUsedAt: 0,
  },
  {
    id: "fd_banana",
    name: "Банан",
    kcalPer100: 96,
    proteinPer100: 1.5,
    fatPer100: 0.5,
    carbsPer100: 21,
    defaultGrams: 120,
    isFavorite: false,
    useCount: 2,
    lastUsedAt: 0,
  },
];

export function cloneDefaultFoods(): FoodItem[] {
  return DEFAULT_FOODS.map((f) => ({ ...f }));
}
