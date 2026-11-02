import { App, Modal, Notice, setIcon } from "obsidian";
import type MyNutritionTrackerPlugin from "./main";
import {
  DIARY_KEYS,
  DailyMacrosSummary,
  FoodItem,
  LoggedMealEntry,
} from "./types";
import {
  appendMealToDiary,
  deleteMealFromDiary,
  findDiaryFileForDate,
  formatDateRu,
  parseMealsFromDiaryContent,
  sumDailyMacros,
  syncMacrosToDiaryFrontmatter,
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
  private gramsInputVal = 100;

  // Редактирование или удаление дневной цели калорий прямо из окна
  private isEditingGoal = false;
  private goalDraftStr = "";

  // Подтверждение удаления продукта из базы
  private confirmDeleteFoodId: string | null = null;

  private isCreateFoodOpen = false;
  private editingFoodId: string | null = null;
  private newFoodDraft = {
    name: "",
    kcalPer100: "",
    proteinPer100: "",
    fatPer100: "",
    carbsPer100: "",
    defaultGrams: "100",
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
    this.confirmDeleteFoodId = null;
    this.gramsInputVal = food.defaultGrams || 100;
    if (rerender) {
      this.renderAdder();
    }
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
    this.renderSummary(totals, diaryFile, loggedEntries);
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
        ? `Запись в ${diaryFile.path}`
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

  private renderSummary(
    totals: DailyMacrosSummary,
    diaryFile: ReturnType<typeof findDiaryFileForDate>,
    loggedEntries: LoggedMealEntry[]
  ): void {
    this.summaryEl.empty();

    const rawGoal = this.plugin.settings.dailyCalorieGoal;
    const goal =
      typeof rawGoal === "number" && rawGoal > 0 ? Math.round(rawGoal) : null;
    const isGoalReached = goal !== null && totals.kcal >= goal;

    const kcalRow = this.summaryEl.createDiv("my-nt-kcal-row");
    const leftKcal = kcalRow.createDiv();
    leftKcal.createSpan({
      cls: "my-nt-kcal-big" + (isGoalReached ? " is-done" : ""),
      text: `${totals.kcal} ккал`,
    });

    if (goal !== null) {
      const pct = Math.min(100, Math.round((totals.kcal / goal) * 100));
      leftKcal.createSpan({
        cls: "my-nt-kcal-goal",
        text: ` из ${goal} ккал (${pct}%)`,
      });
    } else {
      leftKcal.createSpan({
        cls: "my-nt-kcal-goal",
        text: " · без дневной цели",
      });
    }

    const rightControls = kcalRow.createDiv("my-nt-goal-controls");
    if (goal !== null) {
      rightControls.createSpan({
        cls: "my-nt-diet-badge" + (isGoalReached ? " is-done" : ""),
        text: isGoalReached
          ? `✓ Диета закрыта (≥${goal})`
          : `Осталось: ${Math.max(0, goal - totals.kcal)} ккал`,
      });
    }

    const editGoalBtn = rightControls.createEl("button", {
      cls: "my-nt-btn" + (this.isEditingGoal ? " is-active" : ""),
      text: goal !== null ? "✎ Цель" : "＋ Задать цель",
      attr: {
        type: "button",
        title: "Изменить или удалить дневную цель калорий",
      },
    });
    editGoalBtn.onclick = () => {
      this.isEditingGoal = !this.isEditingGoal;
      this.goalDraftStr = goal !== null ? String(goal) : "2600";
      this.renderSummary(totals, diaryFile, loggedEntries);
    };

    if (this.isEditingGoal) {
      const goalDrawer = this.summaryEl.createDiv("my-nt-goal-drawer");
      goalDrawer.createSpan({
        cls: "my-nt-field-caption",
        text: "Дневная цель (ккал):",
      });
      const gInp = goalDrawer.createEl("input", {
        cls: "my-nt-goal-input",
        attr: {
          type: "number",
          inputmode: "numeric",
          min: "100",
          max: "15000",
          step: "50",
          placeholder: "Напр. 2600",
          value: this.goalDraftStr,
        },
      });
      gInp.oninput = () => {
        this.goalDraftStr = gInp.value;
      };

      const saveGoalBtn = goalDrawer.createEl("button", {
        cls: "mod-cta my-nt-btn",
        text: "✓ Сохранить цель",
        attr: { type: "button" },
      });
      saveGoalBtn.onclick = async () => {
        const parsed = Math.round(Number(this.goalDraftStr.trim()));
        if (!Number.isFinite(parsed) || parsed <= 0) {
          new Notice("Введи число больше 0 или нажми «Убрать цель».");
          return;
        }
        this.plugin.settings.dailyCalorieGoal = parsed;
        this.plugin.requestSaveSettings();
        this.isEditingGoal = false;
        if (diaryFile && loggedEntries.length > 0) {
          await syncMacrosToDiaryFrontmatter(
            this.app,
            this.plugin.settings,
            diaryFile,
            this.dateISO,
            loggedEntries
          );
        }
        new Notice(`Дневная цель: ${parsed} ккал`);
        await this.refreshAll();
      };

      if (goal !== null) {
        const removeGoalBtn = goalDrawer.createEl("button", {
          cls: "my-nt-btn is-danger",
          text: "✕ Убрать цель совсем",
          attr: { type: "button" },
        });
        removeGoalBtn.onclick = async () => {
          this.plugin.settings.dailyCalorieGoal = null;
          this.plugin.requestSaveSettings();
          this.isEditingGoal = false;
          new Notice("Дневная цель калорий отключена.");
          await this.refreshAll();
        };
      }
    }

    if (goal !== null) {
      const pct = Math.min(100, Math.round((totals.kcal / goal) * 100));
      const track = this.summaryEl.createDiv("my-nt-progress-track");
      const fill = track.createDiv(
        "my-nt-progress-fill" + (isGoalReached ? " is-done" : "")
      );
      fill.style.width = `${pct}%`;
    }

    const macrosGrid = this.summaryEl.createDiv("my-nt-macros-grid");
    const addMacroPill = (label: string, val: number) => {
      const box = macrosGrid.createDiv("my-nt-macro-box");
      box.createSpan({ cls: "my-nt-macro-label", text: label });
      box.createSpan({ cls: "my-nt-macro-val", text: `${val} г` });
    };
    addMacroPill("Белки", totals.protein);
    addMacroPill("Жиры", totals.fat);
    addMacroPill("Углеводы", totals.carbs);
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
      text: this.isCreateFoodOpen ? "✕ Закрыть форму" : "＋ Свой продукт",
      attr: { type: "button" },
    });
    newFoodBtn.onclick = () => {
      this.isCreateFoodOpen = !this.isCreateFoodOpen;
      this.editingFoodId = null;
      this.newFoodDraft = {
        name: this.searchQuery.trim(),
        kcalPer100: "",
        proteinPer100: "",
        fatPer100: "",
        carbsPer100: "",
        defaultGrams: "100",
        isFavorite: true,
      };
      this.renderAdder();
    };

    if (this.isCreateFoodOpen) {
      this.renderCreateFoodDrawer();
    }

    const allFoods = this.plugin.foodStore.getSortedFoods();
    if (!this.selectedFoodId && allFoods[0]) {
      this.selectedFoodId = allFoods[0].id;
    }

    // 1. Компактная строка поиска + область результатов (без дублирующего <select>)
    const searchRow = this.adderEl.createDiv("my-nt-search-row");
    const searchInput = searchRow.createEl("input", {
      cls: "my-nt-search-input",
      attr: {
        type: "search",
        placeholder: "🔍 Начни вводить название продукта или выбери из ★ ниже…",
        value: this.searchQuery,
      },
    });

    const resultsHost = this.adderEl.createDiv("my-nt-search-results");

    const renderSearchResults = () => {
      resultsHost.empty();
      const q = this.searchQuery.trim();
      const matches = this.plugin.foodStore.getSortedFoods(q);

      if (q.length === 0) {
        // Без текста в поиске показываем только компактную полоску избранных (★), до 6 штук
        const favs = matches.filter((f) => f.isFavorite).slice(0, 6);
        const listToShow = favs.length > 0 ? favs : matches.slice(0, 5);
        if (listToShow.length === 0) return;

        const chipsBar = resultsHost.createDiv("my-nt-food-chips");
        for (const f of listToShow) {
          const isSelected = f.id === this.selectedFoodId;
          const chip = chipsBar.createEl("button", {
            cls: "my-nt-food-chip" + (isSelected ? " is-active" : ""),
            text: `${f.isFavorite ? "★ " : ""}${f.name}`,
            attr: {
              type: "button",
              title: `${f.kcalPer100} ккал / 100 г (Б:${f.proteinPer100} Ж:${f.fatPer100} У:${f.carbsPer100})`,
            },
          });
          chip.onclick = () => this.selectFood(f, true);
        }
        return;
      }

      // Если пользователь ввёл запрос — показываем компактный список совпадений (до 6 строк)
      if (matches.length === 0) {
        const emptyRow = resultsHost.createDiv("my-nt-search-empty");
        emptyRow.createSpan({
          text: `По запросу «${q}» ничего не найдено.`,
        });
        const createFromQueryBtn = emptyRow.createEl("button", {
          cls: "my-nt-btn",
          text: `＋ Создать «${q}»`,
          attr: { type: "button" },
        });
        createFromQueryBtn.onclick = () => {
          this.isCreateFoodOpen = true;
          this.editingFoodId = null;
          this.newFoodDraft = {
            name: q,
            kcalPer100: "",
            proteinPer100: "",
            fatPer100: "",
            carbsPer100: "",
            defaultGrams: "100",
            isFavorite: true,
          };
          this.renderAdder();
        };
        return;
      }

      const listEl = resultsHost.createDiv("my-nt-Suggest-list");
      for (const f of matches.slice(0, 6)) {
        const isSelected = f.id === this.selectedFoodId;
        const itemBtn = listEl.createEl("button", {
          cls: "my-nt-suggest-item" + (isSelected ? " is-active" : ""),
          attr: { type: "button" },
        });
        itemBtn.createSpan({
          cls: "my-nt-suggest-name",
          text: `${f.isFavorite ? "★ " : ""}${f.name}`,
        });
        itemBtn.createSpan({
          cls: "my-nt-suggest-meta",
          text: `${f.kcalPer100} ккал · Б:${f.proteinPer100} Ж:${f.fatPer100} У:${f.carbsPer100}`,
        });
        itemBtn.onclick = () => {
          this.searchQuery = "";
          this.selectFood(f, true);
        };
      }
    };

    searchInput.oninput = () => {
      this.searchQuery = searchInput.value;
      renderSearchResults();
    };
    searchInput.onkeydown = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        const matches = this.plugin.foodStore.getSortedFoods(this.searchQuery);
        if (matches[0]) {
          e.preventDefault();
          this.searchQuery = "";
          this.selectFood(matches[0], true);
        }
      }
    };

    renderSearchResults();

    const activeFood =
      this.plugin.foodStore.findById(this.selectedFoodId) ?? allFoods[0];

    if (!activeFood) {
      this.adderEl.createDiv({
        cls: "my-nt-empty",
        text: "В базе пока нет продуктов. Нажми «＋ Свой продукт» выше.",
      });
      return;
    }

    // 2. Единая карточка выбранного продукта: заголовок + кнопки (★ / ✎ / ✕) + ввод граммов
    const portionBox = this.adderEl.createDiv("my-nt-portion-box");

    const selectedBar = portionBox.createDiv("my-nt-selected-bar");
    const selectedInfo = selectedBar.createDiv("my-nt-selected-info");
    selectedInfo.createSpan({
      cls: "my-nt-selected-name",
      text: activeFood.name,
    });
    selectedInfo.createSpan({
      cls: "my-nt-selected-per100",
      text: `на 100 г: ${activeFood.kcalPer100} ккал (Б:${activeFood.proteinPer100} · Ж:${activeFood.fatPer100} · У:${activeFood.carbsPer100})`,
    });

    const selectedTools = selectedBar.createDiv("my-nt-selected-tools");

    const favBtn = selectedTools.createEl("button", {
      cls: "my-nt-icon-btn" + (activeFood.isFavorite ? " is-active" : ""),
      text: activeFood.isFavorite ? "★" : "☆",
      attr: {
        type: "button",
        title: activeFood.isFavorite
          ? "Убрать из избранных"
          : "Добавить в избранные (показывать под строкой поиска)",
      },
    });
    favBtn.onclick = () => {
      this.plugin.foodStore.toggleFavorite(activeFood.id);
      this.renderAdder();
    };

    const editFoodBtn = selectedTools.createEl("button", {
      cls: "my-nt-icon-btn",
      text: "✎",
      attr: { type: "button", title: "Изменить КБЖУ этого продукта" },
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
        defaultGrams: String(activeFood.defaultGrams || 100),
        isFavorite: Boolean(activeFood.isFavorite),
      };
      this.renderAdder();
    };

    const isConfirmingDel = this.confirmDeleteFoodId === activeFood.id;
    const delFoodBtn = selectedTools.createEl("button", {
      cls: "my-nt-icon-btn" + (isConfirmingDel ? " is-danger" : ""),
      text: isConfirmingDel ? "Удалить?" : "✕",
      attr: {
        type: "button",
        title: "Удалить продукт из базы",
      },
    });
    delFoodBtn.onclick = () => {
      if (!isConfirmingDel) {
        this.confirmDeleteFoodId = activeFood.id;
        this.renderAdder();
        return;
      }
      const deletedName = activeFood.name;
      this.plugin.foodStore.deleteFood(activeFood.id);
      this.confirmDeleteFoodId = null;
      const nextFirst = this.plugin.foodStore.getSortedFoods()[0];
      this.selectedFoodId = nextFirst?.id ?? "";
      if (nextFirst) {
        this.gramsInputVal = nextFirst.defaultGrams || 100;
      }
      new Notice(`Продукт «${deletedName}» удалён из базы.`);
      this.renderAdder();
    };

    // Строка расчёта порции в граммах
    const portionTop = portionBox.createDiv("my-nt-portion-top");
    portionTop.createSpan({
      cls: "my-nt-field-caption",
      text: "Порция (г):",
    });

    const previewEl = portionTop.createSpan({ cls: "my-nt-portion-preview" });
    const submitBtn = this.adderEl.createEl("button", {
      cls: "mod-cta my-nt-primary-btn",
      attr: { type: "button" },
    });

    const updatePortionPreview = () => {
      const effGrams = round1(Math.max(1, this.gramsInputVal || 100));
      const calc = this.calculatePortionMacros(activeFood, effGrams);
      previewEl.setText(
        `${effGrams} г → ${calc.kcal} ккал (Б: ${calc.protein} · Ж: ${calc.fat} · У: ${calc.carbs})`
      );
      submitBtn.setText(
        `＋ Записать: ${activeFood.name} (${effGrams} г · +${calc.kcal} ккал)`
      );
    };

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
    for (const gVal of [30, 50, 100, 150, 200, 250, 300]) {
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
      const clean = Math.max(1, Math.round(nextG));
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

    updatePortionPreview();

    submitBtn.onclick = async () => {
      if (submitBtn.disabled) return;
      const effGrams = round1(Math.max(1, this.gramsInputVal || 100));
      if (effGrams <= 0) {
        new Notice("Укажи вес порции больше 0 г.");
        return;
      }
      const calc = this.calculatePortionMacros(activeFood, effGrams);

      submitBtn.disabled = true;
      try {
        await appendMealToDiary(this.app, this.plugin.settings, this.dateISO, {
          name: activeFood.name,
          grams: effGrams,
          ...calc,
        });
        this.plugin.foodStore.recordFoodUsage(activeFood.id, effGrams);
        new Notice(
          `Добавлено: ${activeFood.name} (${effGrams} г · ${calc.kcal} ккал)`
        );
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
      "Стандартная порция (г)",
      "Напр. 150",
      this.newFoodDraft.defaultGrams,
      true,
      (v) => {
        this.newFoodDraft.defaultGrams = v;
      }
    );

    const actions = drawer.createDiv("my-nt-drawer-actions");
    if (this.editingFoodId) {
      const delFromDrawerBtn = actions.createEl("button", {
        cls: "my-nt-btn is-danger",
        text: "✕ Удалить продукт из базы",
        attr: { type: "button" },
      });
      delFromDrawerBtn.onclick = () => {
        if (!this.editingFoodId) return;
        const target = this.plugin.foodStore.findById(this.editingFoodId);
        this.plugin.foodStore.deleteFood(this.editingFoodId);
        this.isCreateFoodOpen = false;
        this.editingFoodId = null;
        const nextFirst = this.plugin.foodStore.getSortedFoods()[0];
        this.selectedFoodId = nextFirst?.id ?? "";
        new Notice(`Продукт «${target?.name ?? ""}» удалён из базы.`);
        this.renderAdder();
      };
    }

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
      const defG =
        Number(this.newFoodDraft.defaultGrams.replace(",", ".")) || 100;

      const saved = this.plugin.foodStore.upsertFood({
        id: this.editingFoodId ?? undefined,
        name,
        kcalPer100: kcal,
        proteinPer100: p,
        fatPer100: f,
        carbsPer100: c,
        defaultGrams: defG > 0 ? defG : 100,
        isFavorite: true,
      });

      this.isCreateFoodOpen = false;
      this.editingFoodId = null;
      this.searchQuery = "";
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
      left.createSpan({ cls: "my-nt-meal-amount", text: `${e.grams} г` });

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
