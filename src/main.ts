import { App, Plugin, PluginSettingTab, Setting } from "obsidian";
import { DEFAULT_SETTINGS, NutritionPluginSettings } from "./types";
import { FoodCatalogStore } from "./food-store";
import { NutritionTrackerModal, OpenNutritionOptions } from "./modal";

function migrateSettings(raw: unknown): NutritionPluginSettings {
  const s =
    raw && typeof raw === "object"
      ? (raw as Partial<NutritionPluginSettings>)
      : {};
  return {
    diaryFolder:
      typeof s.diaryFolder === "string" && s.diaryFolder.trim()
        ? s.diaryFolder.trim()
        : DEFAULT_SETTINGS.diaryFolder,
    foodDbPath:
      typeof s.foodDbPath === "string" && s.foodDbPath.trim()
        ? s.foodDbPath.trim()
        : DEFAULT_SETTINGS.foodDbPath,
    dailyCalorieGoal:
      typeof s.dailyCalorieGoal === "number" &&
      Number.isFinite(s.dailyCalorieGoal) &&
      s.dailyCalorieGoal >= 500
        ? Math.round(s.dailyCalorieGoal)
        : DEFAULT_SETTINGS.dailyCalorieGoal,
  };
}

class NutritionTrackerSettingTab extends PluginSettingTab {
  plugin: MyNutritionTrackerPlugin;

  constructor(app: App, plugin: MyNutritionTrackerPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h3", { text: "Питание и БЖУ" });

    new Setting(containerEl)
      .setName("Дневная цель калорий")
      .setDesc(
        "По умолчанию: 2600. При достижении этой суммы в ежедневнике автоматически ставится «диета: true»"
      )
      .addText((text) =>
        text
          .setPlaceholder("2600")
          .setValue(String(this.plugin.settings.dailyCalorieGoal))
          .onChange((val) => {
            const n = Math.round(Number(val.trim()));
            if (Number.isFinite(n) && n >= 500 && n <= 10000) {
              this.plugin.settings.dailyCalorieGoal = n;
              this.plugin.requestSaveSettings();
            }
          })
      );

    new Setting(containerEl)
      .setName("Папка ежедневника")
      .setDesc("По умолчанию: Ежедневник (заметки «ГГГГ-ММ-ДД.md»)")
      .addText((text) =>
        text.setValue(this.plugin.settings.diaryFolder).onChange((val) => {
          this.plugin.settings.diaryFolder =
            val.trim() || DEFAULT_SETTINGS.diaryFolder;
          this.plugin.requestSaveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Файл базы продуктов в хранилище")
      .setDesc(
        "Читаемый JSON-файл в хранилище (по умолчанию: Знания/База продуктов.json)"
      )
      .addText((text) =>
        text.setValue(this.plugin.settings.foodDbPath).onChange((val) => {
          const next = val.trim() || DEFAULT_SETTINGS.foodDbPath;
          this.plugin.settings.foodDbPath = next;
          this.plugin.foodStore.setDbPath(next);
          this.plugin.requestSaveSettings();
        })
      );
  }
}

export default class MyNutritionTrackerPlugin extends Plugin {
  settings!: NutritionPluginSettings;
  foodStore!: FoodCatalogStore;
  private saveTimer: number | null = null;

  async onload() {
    this.settings = migrateSettings(await this.loadData());
    this.foodStore = new FoodCatalogStore(this.app, this.settings.foodDbPath);

    this.app.workspace.onLayoutReady(() => {
      void this.foodStore.load();
    });

    this.addSettingTab(new NutritionTrackerSettingTab(this.app, this));

    this.addRibbonIcon("utensils", "Открыть дневник питания и БЖУ", () => {
      this.openNutrition();
    });

    this.registerObsidianProtocolHandler("my-nutrition", (params) => {
      this.openNutrition({
        dateISO: params.date || undefined,
      });
    });

    this.addCommand({
      id: "open-nutrition-tracker",
      name: "Открыть дневник питания и БЖУ",
      callback: () => this.openNutrition(),
    });
  }

  openNutrition(options: OpenNutritionOptions = {}) {
    void this.foodStore.load().then(() => {
      new NutritionTrackerModal(this.app, this, options).open();
    });
  }

  requestSaveSettings() {
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      void this.saveData(this.settings);
    }, 250);
  }

  onunload() {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.foodStore?.flush();
  }
}
