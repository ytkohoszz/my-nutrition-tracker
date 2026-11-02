import { App, Modal, Notice, setIcon } from "obsidian";
import type MyNutritionTrackerPlugin from "./main";
import {
  DIARY_KEYS,
  DailyMacrosSummary,
  FoodItem,
  LoggedMealEntry,
  PortionMode,
} from "./types";
import {
  appendMealToDiary,
  deleteMealFromDiary,
  findDiaryFileForDate,
  formatDateRu,
  parseMealsFromDiaryContent,
  sumDailyMacros,
  todayLocalISO,
} from "./diary";

export interface OpenNutritionOptions {
  dateISO?: string;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export class NutritionTrackerModal extends Modal {
  private plugin: MyNutritionTrackerPlugin;
  private dateISO: string;
  private closed = false;

  private searchQuery = "";
  private selectedFoodId = "";
  private portionMode: PortionMode = "grams";
  private gramsInputVal = 100;
  private piecesInputVal = 2;

  private isCreateFoodOpen = false;
  private editingFoodId: string | null = null;
  private newFoodDraft = {
    name: "",
    kcalPer100: "",
    proteinPer100: "",
    fatPer100: "",
    carbsPer100: "",
    pieceGrams: "",
    pieceLabel: "шт.",
    isFavorite: true,
  };

  private headerEl!: HTMLElement;
  private summaryEl!: HTMLElement;
  private adderEl!: HTMLElement;
  private logEl!: HTMLElement;

  constructor(
    app: App,
    plugin: MyNutritionTrackerPlugin,
    options: OpenNutritionOptions = {}
  ) {
    super(app);
    this.plugin = plugin;
    this.dateISO =
      options.dateISO && /^\d{4}-\d{2}-\d{2}$/.test(options.dateISO)
        ? options.dateISO
        : todayLocalISO();
    (this as unknown as { shouldRestoreSelection?: boolean }).shouldRestoreSelection =
      false;
  }

  private focusSafeContainer(): void {
    if (this.closed) return;
    const active = document.activeElement;
    if (
      active instanceof HTMLSelectElement ||
      active instanceof HTMLInputElement ||
      active instanceof HTMLButtonElement
    ) {
      active.blur();
    }
    this.contentEl.focus({ preventScroll: true });
  }

  onOpen(): void {
    this.closed = false;
    this.modalEl.addClass("my-nt-modal-container");
    this.contentEl.addClass("my-nt-modal");
    this.contentEl.setAttribute("tabindex", "-1");

    this.headerEl = this.contentEl.createDiv("my-nt-header");
    this.summaryEl = this.contentEl.createDiv("my-nt-summary-card");
    this.adderEl = this.contentEl.createDiv("my-nt-adder-card");
    this.logEl = this.contentEl.createDiv("my-nt-log-card");

    const firstFood = this.plugin.foodStore.getSortedFoods()[0];
    if (firstFood) {
      this.selectFood(firstFood, false);
    }

    void this.refreshAll().then(() => {
      this.focusSafeContainer();
      window.setTimeout(() => this.focusSafeContainer(), 30);
    });
  }

  onClose(): void {
    this.closed = true;
    this.contentEl.empty();
  }

  private selectFood(food: FoodItem, rerender = true): void {
    this.selectedFoodId = food.id;
    if (food.pieceGrams && food.pieceGrams > 0) {
      this.portionMode = "pieces";
      const approxPieces = Math.max(
        1,
        Math.round((food.defaultGrams || food.pieceGrams) / food.pieceGrams)
      );
      this.piecesInputVal = approxPieces;
      this.gramsInputVal = round1(approxPieces * food.pieceGrams);
    } else {
      this.portionMode = "grams";
      this.gramsInputVal = food.defaultGrams || 100;
    }
    if (rerender) {
      void this.refreshAll();
    }
  }

  private getEffectiveGrams(food: FoodItem | undefined): number {
    if (!food) return Math.max(1, this.gramsInputVal || 100);
    if (
      this.portionMode === "pieces" &&
      food.pieceGrams &&
      food.pieceGrams > 0
    ) {
      return round1(Math.max(0.5, this.piecesInputVal) * food.pieceGrams);
    }
    return round1(Math.max(1, this.gramsInputVal));
  }

  private calculatePortionMacros(
    food: FoodItem | undefined,
    grams: number
  ): DailyMacrosSummary {
    if (!food || grams <= 0) {
      return { kcal: 0, protein: 0, fat: 0, carbs: 0 };
    }
    const ratio = grams / 100;
    return {
      kcal: Math.round(food.kcalPer100 * ratio),
      protein: round1(food.proteinPer100 * ratio),
      fat: round1(food.fatPer100 * ratio),
      carbs: round1(food.carbsPer100 * ratio),
    };
  }

  private async refreshAll(): Promise<void> {
    if (this.closed) return;

    const diaryFile = findDiaryFileForDate(
      this.app,
      this.plugin.settings,
      this.dateISO
    );
    let loggedEntries: LoggedMealEntry[] = [];
    let yamlFallbackKcal: number | null = null;

    if (diaryFile) {
      try {
        const content = await this.app.vault.read(diaryFile);
        loggedEntries = parseMealsFromDiaryContent(content);
      } catch {
        loggedEntries = [];
      }
      const fm = this.app.metadataCache.getFileCache(diaryFile)?.frontmatter;
      if (fm && typeof fm[DIARY_KEYS.caloriesKcal] === "number") {
        yamlFallbackKcal = fm[DIARY_KEYS.caloriesKcal] as number;
      }
    }

    const totals = sumDailyMacros(loggedEntries);
    if (loggedEntries.length === 0 && yamlFallbackKcal !== null) {
      totals.kcal = Math.round(yamlFallbackKcal);
    }

    this.renderHeader(diaryFile);
    this.renderSummary(totals);
    this.renderAdder();
    this.renderLoggedMeals(loggedEntries, diaryFile);
  }

  private renderHeader(diaryFile: ReturnType<typeof findDiaryFileForDate>): void {
    this.headerEl.empty();

    const topRow = this.headerEl.createDiv("my-nt-top-row");
    const titleWrap = topRow.createDiv();
    titleWrap.createDiv({
      cls: "my-nt-title",
      text: `🥗 Питание и БЖУ · ${formatDateRu(this.dateISO)}`,
    });
    titleWrap.createDiv({
      cls: "my-nt-subtitle",
      text: diaryFile
        ? `Запись в ${diaryFile.path} (YAML + раздел «## Питание»)`
        : `При первом добавлении будет создана заметка Ежедневник/${this.dateISO}.md`,
    });

    if (diaryFile) {
      const openBtn = topRow.createEl("button", {
        cls: "my-nt-btn",
        text: "📄 Дневник",
        attr: { type: "button", title: "Открыть заметку ежедневника" },
      });
      openBtn.onclick = () => {
        this.close();
        void this.app.workspace.openLinkText(diaryFile.path, "", false);
      };
    }
  }

  private renderSummary(totals: DailyMacrosSummary): void {
    this.summaryEl.empty();

    const goal = Math.max(500, this.plugin.settings.dailyCalorieGoal || 2600);
    const pct = Math.min(100, Math.round((totals.kcal / goal) * 100));
    const isGoalReached = totals.kcal >= goal;

    const kcalRow = this.summaryEl.createDiv("my-nt-kcal-row");
    const leftKcal = kcalRow.createDiv();
    leftKcal.createSpan({
      cls: "my-nt-kcal-big" + (isGoalReached ? " is-done" : ""),
      text: `${totals.kcal} ккал`,
    });
    leftKcal.createSpan({
      cls: "my-nt-kcal-goal",
      text: ` из ${goal} ккал (${pct}%)`,
    });

    kcalRow.createSpan({
      cls: "my-nt-diet-badge" + (isGoalReached ? " is-done" : ""),
      text: isGoalReached
        ? `✓ Привычка «Диета» закрыта (≥${goal})`
        : `До цели: ${Math.max(0, goal - totals.kcal)} ккал`,
    });

    const track = this.summaryEl.createDiv("my-nt-progress-track");
    const fill = track.createDiv(
      "my-nt-progress-fill" + (isGoalReached ? " is-done" : "")
    );
    fill.style.width = `${pct}%`;

    const macrosGrid = this.summaryEl.createDiv("my-nt-macros-grid");
    const addMacroPill = (label: string, val: number, colorCls: string) => {
      const box = macrosGrid.createDiv(`my-nt-macro-box ${colorCls}`);
      box.createSpan({ cls: "my-nt-macro-label", text: label });
      box.createSpan({ cls: "my-nt-macro-val", text: `${val} г` });
    };
    addMacroPill("Белки", totals.protein, "is-protein");
    addMacroPill("Жиры", totals.fat, "is-fat");
    addMacroPill("Углеводы", totals.carbs, "is-carbs");
  }

  private renderAdder(): void {
    this.adderEl.empty();

    const head = this.adderEl.createDiv("my-nt-section-head");
    head.createSpan({
      cls: "my-nt-section-title",
      text: "Добавить продукт или блюдо",
    });

    const newFoodBtn = head.createEl("button", {
      cls: "my-nt-btn" + (this.isCreateFoodOpen ? " is-active" : ""),
      text: this.isCreateFoodOpen ? "✕ Закрыть форму" : "＋ Свой продукт в базу",
      attr: { type: "button" },
    });
    newFoodBtn.onclick = () => {
      this.isCreateFoodOpen = !this.isCreateFoodOpen;
      this.editingFoodId = null;
      this.renderAdder();
    };

    if (this.isCreateFoodOpen) {
      this.renderCreateFoodDrawer();
    }

    const sortedFoods = this.plugin.foodStore.getSortedFoods(this.searchQuery);
    if (!this.selectedFoodId && sortedFoods[0]) {
      this.selectedFoodId = sortedFoods[0].id;
    }
    const activeFood =
      this.plugin.foodStore.findById(this.selectedFoodId) ?? sortedFoods[0];

    const quickChipsWrap = this.adderEl.createDiv("my-nt-food-chips");
    for (const f of sortedFoods.slice(0, 12)) {
      const isSelected = activeFood?.id === f.id;
      const chip = quickChipsWrap.createEl("button", {
        cls: "my-nt-food-chip" + (isSelected ? " is-active" : ""),
        text: `${f.isFavorite ? "★ " : ""}${f.name}`,
        attr: {
          type: "button",
          title: `${f.kcalPer100} ккал на 100 г (Б:${f.proteinPer100} Ж:${f.fatPer100} У:${f.carbsPer100})`,
        },
      });
      chip.onclick = () => this.selectFood(f, true);
    }

    const selectRow = this.adderEl.createDiv("my-nt-select-row");
    const foodSelect = selectRow.createEl("select", {
      cls: "dropdown my-nt-food-select",
    });
    for (const f of this.plugin.foodStore.getSortedFoods()) {
      const pieceHint = f.pieceGrams
        ? ` · 1 ${f.pieceLabel || "шт."} = ${f.pieceGrams} г`
        : "";
      const o = foodSelect.createEl("option", {
        value: f.id,
        text: `${f.isFavorite ? "★ " : ""}${f.name} (${f.kcalPer100} ккал/100г${pieceHint})`,
      });
      if (activeFood && f.id === activeFood.id) o.selected = true;
    }
    foodSelect.onchange = () => {
      const picked = this.plugin.foodStore.findById(foodSelect.value);
      if (picked) this.selectFood(picked, true);
      this.focusSafeContainer();
    };

    if (activeFood) {
      const favBtn = selectRow.createEl("button", {
        cls: "my-nt-btn" + (activeFood.isFavorite ? " is-active" : ""),
        text: activeFood.isFavorite ? "★" : "☆",
        attr: { type: "button", title: "В избранное / убрать из избранного" },
      });
      favBtn.onclick = () => {
        this.plugin.foodStore.toggleFavorite(activeFood.id);
        this.renderAdder();
      };

      const editFoodBtn = selectRow.createEl("button", {
        cls: "my-nt-btn",
        text: "✎",
        attr: { type: "button", title: "Изменить КБЖУ этого продукта в базе" },
      });
      editFoodBtn.onclick = () => {
        this.editingFoodId = activeFood.id;
        this.isCreateFoodOpen = true;
        this.newFoodDraft = {
          name: activeFood.name,
          kcalPer100: String(activeFood.kcalPer100),
          proteinPer100: String(activeFood.proteinPer100),
          fatPer100: String(activeFood.fatPer100),
          carbsPer100: String(activeFood.carbsPer100),
          pieceGrams: activeFood.pieceGrams ? String(activeFood.pieceGrams) : "",
          pieceLabel: activeFood.pieceLabel || "шт.",
          isFavorite: Boolean(activeFood.isFavorite),
        };
        this.renderAdder();
      };
    }

    if (!activeFood) return;

    const portionBox = this.adderEl.createDiv("my-nt-portion-box");
    const hasPieceWeight = Boolean(
      activeFood.pieceGrams && activeFood.pieceGrams > 0
    );

    const portionTop = portionBox.createDiv("my-nt-portion-top");
    if (hasPieceWeight) {
      const modeSwitch = portionTop.createDiv("my-nt-mode-seg");
      const piecesBtn = modeSwitch.createEl("button", {
        cls:
          "my-nt-mode-btn" + (this.portionMode === "pieces" ? " is-active" : ""),
        text: `В штуках (1 ${activeFood.pieceLabel || "шт."} = ${activeFood.pieceGrams} г)`,
        attr: { type: "button" },
      });
      const gramsBtn = modeSwitch.createEl("button", {
        cls:
          "my-nt-mode-btn" + (this.portionMode === "grams" ? " is-active" : ""),
        text: "В граммах (г)",
        attr: { type: "button" },
      });
      piecesBtn.onclick = () => {
        this.portionMode = "pieces";
        this.gramsInputVal = round1(
          this.piecesInputVal * (activeFood.pieceGrams || 100)
        );
        this.renderAdder();
      };
      gramsBtn.onclick = () => {
        this.portionMode = "grams";
        this.renderAdder();
      };
    } else {
      portionTop.createSpan({
        cls: "my-nt-field-caption",
        text: "Вес порции в граммах (г):",
      });
    }

    const previewEl = portionTop.createSpan({ cls: "my-nt-portion-preview" });
    const submitBtn = this.adderEl.createEl("button", {
      cls: "mod-cta my-nt-primary-btn",
      attr: { type: "button" },
    });

    const updatePortionPreview = () => {
      const effGrams = this.getEffectiveGrams(activeFood);
      const calc = this.calculatePortionMacros(activeFood, effGrams);
      previewEl.setText(
        `${effGrams} г → ${calc.kcal} ккал (Б: ${calc.protein} · Ж: ${calc.fat} · У: ${calc.carbs})`
      );
      submitBtn.setText(
        `＋ Записать в дневник: ${activeFood.name} (+${calc.kcal} ккал)`
      );
    };

    if (this.portionMode === "pieces" && hasPieceWeight) {
      const stepRow = portionBox.createDiv("my-nt-stepper-row");
      const minusBtn = stepRow.createEl("button", {
        cls: "my-nt-step-btn",
        text: "−1",
        attr: { type: "button" },
      });
      const pInp = stepRow.createEl("input", {
        cls: "my-nt-step-input",
        attr: {
          type: "number",
          inputmode: "decimal",
          min: "0.5",
          step: "0.5",
          value: String(this.piecesInputVal),
        },
      });
      const plusBtn = stepRow.createEl("button", {
        cls: "my-nt-step-btn",
        text: "+1",
        attr: { type: "button" },
      });

      const quickPieces = stepRow.createDiv("my-nt-quick-Portions");
      for (const cnt of [1, 2, 3, 4, 5]) {
        const qb = quickPieces.createEl("button", {
          cls: "my-nt-btn",
          text: `${cnt} ${activeFood.pieceLabel || "шт."}`,
          attr: { type: "button" },
        });
        qb.onclick = () => {
          this.piecesInputVal = cnt;
          pInp.value = String(cnt);
          updatePortionPreview();
        };
      }

      const applyPieces = (nextP: number) => {
        const clean = Math.max(0.5, round1(nextP));
        this.piecesInputVal = clean;
        pInp.value = String(clean);
        updatePortionPreview();
      };
      minusBtn.onclick = () => applyPieces((Number(pInp.value) || 1) - 1);
      plusBtn.onclick = () => applyPieces((Number(pInp.value) || 1) + 1);
      pInp.oninput = () => {
        const n = Number(pInp.value.replace(",", "."));
        if (Number.isFinite(n) && n > 0) {
          this.piecesInputVal = n;
          updatePortionPreview();
        }
      };
    } else {
      const stepRow = portionBox.createDiv("my-nt-stepper-row");
      const minus25 = stepRow.createEl("button", {
        cls: "my-nt-step-btn",
        text: "−25 г",
        attr: { type: "button" },
      });
      const gInp = stepRow.createEl("input", {
        cls: "my-nt-step-input",
        attr: {
          type: "number",
          inputmode: "decimal",
          min: "1",
          step: "10",
          value: String(this.gramsInputVal),
        },
      });
      const plus25 = stepRow.createEl("button", {
        cls: "my-nt-step-btn",
        text: "+25 г",
        attr: { type: "button" },
      });

      const quickGrams = stepRow.createDiv("my-nt-quick-Portions");
      for (const gVal of [50, 100, 150, 200, 250, 300]) {
        const qb = quickGrams.createEl("button", {
          cls: "my-nt-btn",
          text: `${gVal} г`,
          attr: { type: "button" },
        });
        qb.onclick = () => {
          this.gramsInputVal = gVal;
          gInp.value = String(gVal);
          updatePortionPreview();
        };
      }

      const applyGrams = (nextG: number) => {
        const clean = Math.max(5, Math.round(nextG));
        this.gramsInputVal = clean;
        gInp.value = String(clean);
        updatePortionPreview();
      };
      minus25.onclick = () => applyGrams((Number(gInp.value) || 100) - 25);
      plus25.onclick = () => applyGrams((Number(gInp.value) || 100) + 25);
      gInp.oninput = () => {
        const n = Number(gInp.value.replace(",", "."));
        if (Number.isFinite(n) && n > 0) {
          this.gramsInputVal = n;
          updatePortionPreview();
        }
      };
    }

    updatePortionPreview();

    submitBtn.onclick = async () => {
      if (submitBtn.disabled) return;
      const effGrams = this.getEffectiveGrams(activeFood);
      if (effGrams <= 0) {
        new Notice("Укажи вес порции больше 0 г.");
        return;
      }
      const calc = this.calculatePortionMacros(activeFood, effGrams);
      const pieceNote =
        this.portionMode === "pieces" &&
        activeFood.pieceGrams &&
        activeFood.pieceGrams > 0
          ? `${this.piecesInputVal} ${activeFood.pieceLabel || "шт."}`
          : undefined;

      submitBtn.disabled = true;
      try {
        await appendMealToDiary(this.app, this.plugin.settings, this.dateISO, {
          name: activeFood.name,
          grams: effGrams,
          pieceNote,
          ...calc,
        });
        this.plugin.foodStore.recordFoodUsage(activeFood.id, effGrams);
        new Notice(`Добавлено: ${activeFood.name} (${calc.kcal} ккал)`);
        await this.refreshAll();
      } catch (err: unknown) {
        new Notice(
          "Ошибка записи питания: " +
            (err instanceof Error ? err.message : String(err))
        );
        submitBtn.disabled = false;
      }
    };
  }

  private renderCreateFoodDrawer(): void {
    const drawer = this.adderEl.createDiv("my-nt-create-drawer");
    drawer.createDiv({
      cls: "my-nt-drawer-title",
      text: this.editingFoodId
        ? "Редактирование продукта в базе (КБЖУ на 100 г)"
        : "Новый продукт или блюдо в личную базу (КБЖУ на 100 г)",
    });

    const fieldsGrid = drawer.createDiv("my-nt-create-grid");

    const mkField = (
      caption: string,
      placeholder: string,
      val: string,
      isNumeric: boolean,
      onChange: (v: string) => void
    ) => {
      const lbl = fieldsGrid.createEl("label", { cls: "my-nt-labeled-field" });
      lbl.createSpan({ cls: "my-nt-field-caption", text: caption });
      const inp = lbl.createEl("input", {
        cls: "my-nt-field-input",
        attr: {
          type: isNumeric ? "number" : "text",
          inputmode: isNumeric ? "decimal" : "text",
          step: isNumeric ? "0.1" : null,
          placeholder,
          value: val,
        },
      });
      inp.oninput = () => onChange(inp.value);
      return inp;
    };

    mkField(
      "Название продукта *",
      "Напр. Творожная запеканка",
      this.newFoodDraft.name,
      false,
      (v) => {
        this.newFoodDraft.name = v;
      }
    );
    mkField(
      "Ккал на 100 г *",
      "185",
      this.newFoodDraft.kcalPer100,
      true,
      (v) => {
        this.newFoodDraft.kcalPer100 = v;
      }
    );
    mkField(
      "Белки на 100 г",
      "14.5",
      this.newFoodDraft.proteinPer100,
      true,
      (v) => {
        this.newFoodDraft.proteinPer100 = v;
      }
    );
    mkField("Жиры на 100 г", "7.5", this.newFoodDraft.fatPer100, true, (v) => {
      this.newFoodDraft.fatPer100 = v;
    });
    mkField(
      "Углеводы на 100 г",
      "15",
      this.newFoodDraft.carbsPer100,
      true,
      (v) => {
        this.newFoodDraft.carbsPer100 = v;
      }
    );
    mkField(
      "Вес 1 шт./порц. (г, необяз.)",
      "Напр. 60",
      this.newFoodDraft.pieceGrams,
      true,
      (v) => {
        this.newFoodDraft.pieceGrams = v;
      }
    );

    const actions = drawer.createDiv("my-nt-drawer-actions");
    const saveFoodBtn = actions.createEl("button", {
      cls: "mod-cta my-nt-btn",
      text: "✓ Сохранить в базу продуктов",
      attr: { type: "button" },
    });
    saveFoodBtn.onclick = () => {
      const name = this.newFoodDraft.name.trim();
      const kcal = Number(this.newFoodDraft.kcalPer100.replace(",", "."));
      if (!name || !Number.isFinite(kcal) || kcal < 0) {
        new Notice("Укажи название продукта и калорийность на 100 г.");
        return;
      }
      const p = Number(this.newFoodDraft.proteinPer100.replace(",", ".")) || 0;
      const f = Number(this.newFoodDraft.fatPer100.replace(",", ".")) || 0;
      const c = Number(this.newFoodDraft.carbsPer100.replace(",", ".")) || 0;
      const pg = Number(this.newFoodDraft.pieceGrams.replace(",", ".")) || 0;

      const saved = this.plugin.foodStore.upsertFood({
        id: this.editingFoodId ?? undefined,
        name,
        kcalPer100: kcal,
        proteinPer100: p,
        fatPer100: f,
        carbsPer100: c,
        pieceGrams: pg > 0 ? pg : undefined,
        pieceLabel: pg > 0 ? this.newFoodDraft.pieceLabel || "шт." : undefined,
        defaultGrams: pg > 0 ? pg * 2 : 100,
        isFavorite: true,
      });

      this.isCreateFoodOpen = false;
      this.editingFoodId = null;
      this.newFoodDraft = {
        name: "",
        kcalPer100: "",
        proteinPer100: "",
        fatPer100: "",
        carbsPer100: "",
        pieceGrams: "",
        pieceLabel: "шт.",
        isFavorite: true,
      };
      this.selectFood(saved, true);
      new Notice(`Продукт «${saved.name}» сохранён в базу.`);
    };
  }

  private renderLoggedMeals(
    entries: LoggedMealEntry[],
    diaryFile: ReturnType<typeof findDiaryFileForDate>
  ): void {
    this.logEl.empty();

    const head = this.logEl.createDiv("my-nt-section-head");
    head.createSpan({
      cls: "my-nt-section-title",
      text: `Съедено за день · ${entries.length}`,
    });

    if (entries.length === 0) {
      this.logEl.createDiv({
        cls: "my-nt-empty",
        text: diaryFile
          ? "В разделе «## Питание» за сегодня пока нет записей."
          : "Записей за сегодня пока нет.",
      });
      return;
    }

    const listEl = this.logEl.createDiv("my-nt-meals-list");
    entries.forEach((e) => {
      const row = listEl.createDiv("my-nt-meal-row");

      const left = row.createDiv("my-nt-meal-left");
      if (e.timeStr) {
        left.createSpan({ cls: "my-nt-meal-time", text: e.timeStr });
      }
      left.createSpan({ cls: "my-nt-meal-name", text: e.name });
      left.createSpan({ cls: "my-nt-meal-amount", text: e.amountText });

      const right = row.createDiv("my-nt-meal-right");
      right.createSpan({
        cls: "my-nt-meal-kcal",
        text: `${e.kcal} ккал`,
      });
      right.createSpan({
        cls: "my-nt-meal-macros",
        text: `Б:${e.protein} Ж:${e.fat} У:${e.carbs}`,
      });

      const delBtn = right.createEl("button", {
        cls: "my-nt-meal-del",
        attr: { type: "button", title: "Удалить приём пищи" },
      });
      setIcon(delBtn, "x");
      delBtn.onclick = async () => {
        delBtn.disabled = true;
        await deleteMealFromDiary(
          this.app,
          this.plugin.settings,
          this.dateISO,
          e.lineIndex
        );
        await this.refreshAll();
      };
    });
  }
}
