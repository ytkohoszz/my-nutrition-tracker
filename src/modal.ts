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

private isEditingGoal = false;
  private goalDraftStr = "";
  private confirmDeleteFoodId: string | null = null;
  private isDeletingMeal = false;

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
    const titleWrap = topRow.createDiv("my-nt-title-wrap");
    titleWrap.createSpan({
      cls: "my-nt-title",
      text: "Питание",
    });
    titleWrap.createSpan({
      cls: "my-nt-date",
      text: formatDateRu(this.dateISO),
    });

    if (diaryFile) {
      const openBtn = topRow.createEl("button", {
        cls: "my-nt-icon-btn my-nt-diary-btn",
        attr: {
          type: "button",
          title: `Открыть дневник (${diaryFile.path})`,
        },
      });
      setIcon(openBtn, "book-open");
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
    const leftKcal = kcalRow.createDiv("my-nt-kcal-main");
    leftKcal.createSpan({
      cls: "my-nt-kcal-big" + (isGoalReached ? " is-done" : ""),
      text: String(totals.kcal),
    });
    leftKcal.createSpan({
      cls: "my-nt-kcal-unit",
      text: "ккал",
    });

    const goalTrigger = leftKcal.createEl("button", {
      cls: "my-nt-goal-trigger" + (this.isEditingGoal ? " is-active" : ""),
      text: goal !== null ? `/ ${goal}` : "+ цель",
      attr: {
        type: "button",
        title: "Нажмите, чтобы изменить дневную цель",
      },
    });
    goalTrigger.onclick = () => {
      this.isEditingGoal = !this.isEditingGoal;
      this.goalDraftStr = goal !== null ? String(goal) : "2600";
      this.renderSummary(totals, diaryFile, loggedEntries);
    };

    if (goal !== null) {
      const remaining = Math.max(0, goal - totals.kcal);
      kcalRow.createSpan({
        cls: "my-nt-diet-status" + (isGoalReached ? " is-done" : ""),
        text: isGoalReached ? "Цель закрыта" : `ещё ${remaining}`,
      });
    }

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

const doSaveGoal = async () => {
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

      gInp.onkeydown = (e: KeyboardEvent) => {
        if (e.key === "Enter") {
          e.preventDefault();
          void doSaveGoal();
        }
      };

      const saveGoalBtn = goalDrawer.createEl("button", {
        cls: "mod-cta my-nt-btn",
        text: "Сохранить",
        attr: { type: "button" },
      });
      saveGoalBtn.onclick = () => void doSaveGoal();

      if (goal !== null) {
        const removeGoalBtn = goalDrawer.createEl("button", {
          cls: "my-nt-btn is-danger",
          text: "Убрать цель",
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

    const allFoods = this.plugin.foodStore.getSortedFoods();
    if (!this.selectedFoodId && allFoods[0]) {
      this.selectedFoodId = allFoods[0].id;
    }

    const searchRow = this.adderEl.createDiv("my-nt-search-row");
    const searchInput = searchRow.createEl("input", {
      cls: "my-nt-search-input",
      attr: {
        type: "search",
        placeholder: "Поиск продукта…",
        value: this.searchQuery,
      },
    });

    const newFoodBtn = searchRow.createEl("button", {
      cls: "my-nt-icon-btn my-nt-add-food-btn" + (this.isCreateFoodOpen ? " is-active" : ""),
      attr: {
        type: "button",
        title: this.isCreateFoodOpen ? "Закрыть форму" : "Добавить свой продукт",
      },
    });
    setIcon(newFoodBtn, this.isCreateFoodOpen ? "x" : "plus");
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

    const resultsHost = this.adderEl.createDiv("my-nt-search-results");

    const renderSearchResults = () => {
      resultsHost.empty();
      const q = this.searchQuery.trim();
      const matches = this.plugin.foodStore.getSortedFoods(q);

if (q.length === 0) return;

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

    // Единая компактная карточка выбранного продукта с одним полем ввода граммов
    const portionBox = this.adderEl.createDiv("my-nt-portion-box");

const selectedBar = portionBox.createDiv("my-nt-selected-bar");
    const selectedInfo = selectedBar.createDiv("my-nt-selected-info");
    selectedInfo.createSpan({
      cls: "my-nt-selected-name",
      text: activeFood.name,
    });
    selectedInfo.createSpan({
      cls: "my-nt-selected-per100",
      text: `${activeFood.kcalPer100} ккал / 100 г · Б ${activeFood.proteinPer100} · Ж ${activeFood.fatPer100} · У ${activeFood.carbsPer100}`,
    });

    const selectedTools = selectedBar.createDiv("my-nt-selected-tools");

    const favBtn = selectedTools.createEl("button", {
      cls: "my-nt-icon-btn my-nt-fav-btn" + (activeFood.isFavorite ? " is-active" : ""),
      attr: {
        type: "button",
        title: activeFood.isFavorite
          ? "Убрать из избранных"
          : "Добавить в избранные",
      },
    });
    setIcon(favBtn, "star");
    favBtn.onclick = () => {
      this.plugin.foodStore.toggleFavorite(activeFood.id);
      this.renderAdder();
    };

    const editFoodBtn = selectedTools.createEl("button", {
      cls: "my-nt-icon-btn",
      attr: { type: "button", title: "Изменить КБЖУ этого продукта" },
    });
    setIcon(editFoodBtn, "pencil");
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
      text: isConfirmingDel ? "Удалить?" : "",
      attr: {
        type: "button",
        title: "Удалить продукт из базы",
      },
    });
    if (!isConfirmingDel) {
      setIcon(delFoodBtn, "trash-2");
    }
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

const gramLine = portionBox.createDiv("my-nt-gram-line");
    const gramPill = gramLine.createEl("label", { cls: "my-nt-gram-pill" });

    const gInp = gramPill.createEl("input", {
      cls: "my-nt-step-input",
      attr: {
        type: "number",
        inputmode: "decimal",
        min: "1",
        placeholder: "100",
        value: String(this.gramsInputVal),
      },
    });
    gInp.onfocus = () => gInp.select();
    gramPill.createSpan({ cls: "my-nt-gram-unit", text: "г" });

    const previewEl = gramLine.createSpan({ cls: "my-nt-portion-preview" });
    const submitBtn = this.adderEl.createEl("button", {
      cls: "mod-cta my-nt-primary-btn",
      attr: { type: "button" },
    });

    const updatePortionPreview = () => {
      const effGrams = round1(Math.max(0, this.gramsInputVal || 0));
      const calc = this.calculatePortionMacros(activeFood, effGrams);
      previewEl.setText(
        `Б ${calc.protein} · Ж ${calc.fat} · У ${calc.carbs}`
      );
      submitBtn.setText(`Добавить · +${calc.kcal} ккал`);
    };

    gInp.oninput = () => {
      const n = Number(gInp.value.replace(",", "."));
      this.gramsInputVal = Number.isFinite(n) && n >= 0 ? n : 0;
      updatePortionPreview();
    };

    const doSubmitMeal = async () => {
      if (submitBtn.disabled) return;
      const effGrams = round1(Number(gInp.value.replace(",", ".")) || 0);
      if (!Number.isFinite(effGrams) || effGrams <= 0) {
        new Notice("Введи количество граммов больше 0.");
        gInp.focus();
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

    gInp.onkeydown = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void doSubmitMeal();
      }
    };
    submitBtn.onclick = () => void doSubmitMeal();

    updatePortionPreview();
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
        isFavorite: Boolean(this.newFoodDraft.isFavorite),
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
    _diaryFile: ReturnType<typeof findDiaryFileForDate>
  ): void {
    this.logEl.empty();

    const head = this.logEl.createDiv("my-nt-section-head");
    head.createSpan({
      cls: "my-nt-section-title",
      text: entries.length > 0 ? `Съедено · ${entries.length}` : "Съедено",
    });

    if (entries.length === 0) return;

    const listEl = this.logEl.createDiv("my-nt-meals-list");
    entries.forEach((e) => {
      const row = listEl.createDiv("my-nt-meal-row");

      row.createSpan({
        cls: "my-nt-meal-time",
        text: e.timeStr || "—",
      });

      const main = row.createDiv("my-nt-meal-main");
      main.createDiv({ cls: "my-nt-meal-name", text: e.name });
      main.createDiv({
        cls: "my-nt-meal-sub",
        text: `${e.grams} г · Б ${e.protein} · Ж ${e.fat} · У ${e.carbs}`,
      });

      const right = row.createDiv("my-nt-meal-right");
      right.createSpan({
        cls: "my-nt-meal-kcal",
        text: `${e.kcal} ккал`,
      });

      const delBtn = right.createEl("button", {
        cls: "my-nt-meal-del",
        attr: { type: "button", title: "Удалить приём пищи" },
      });
      setIcon(delBtn, "x");
delBtn.onclick = async () => {
        if (this.isDeletingMeal) return;
        this.isDeletingMeal = true;
        delBtn.disabled = true;
        try {
          await deleteMealFromDiary(
            this.app,
            this.plugin.settings,
            this.dateISO,
            e.lineIndex
          );
          await this.refreshAll();
        } finally {
          this.isDeletingMeal = false;
        }
      };
    });
  }
}
