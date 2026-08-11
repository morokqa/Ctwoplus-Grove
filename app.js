(function () {
  "use strict";

  const STORAGE_KEY = "cppGrove.v1";
  const defaultState = {
    version: 2,
    settings: {
      appName: "C++ Grove",
      focusMinutes: 25,
      breakMinutes: 5,
      longBreakMinutes: 15,
      rounds: 4
    },
    roadmap: [],
    sessions: [],
    checkins: [],
    diary: [],
    mentorQuestions: []
  };

  let state = loadState();
  let toastTimer = null;
  let openSessionEditor = null;

  const timerState = {
    mode: "focus",
    running: false,
    totalSeconds: state.settings.focusMinutes * 60,
    remainingSeconds: state.settings.focusMinutes * 60,
    round: 1,
    intervalId: null
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function normalizeState(source = {}) {
    return {
      version: defaultState.version,
      settings: { ...defaultState.settings, ...(source.settings || {}) },
      roadmap: Array.isArray(source.roadmap) ? source.roadmap : [],
      sessions: Array.isArray(source.sessions) ? source.sessions : [],
      checkins: Array.isArray(source.checkins) ? source.checkins : [],
      diary: Array.isArray(source.diary) ? source.diary : [],
      mentorQuestions: Array.isArray(source.mentorQuestions) ? source.mentorQuestions : []
    };
  }

  function loadState() {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!stored || typeof stored !== "object") return clone(defaultState);
      return normalizeState(stored);
    } catch (error) {
      console.warn("Не удалось прочитать сохранённые данные", error);
      return clone(defaultState);
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function id(prefix) {
    if (window.crypto && typeof window.crypto.randomUUID === "function") return `${prefix}-${window.crypto.randomUUID()}`;
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function localDateKey(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function parseDateKey(key) {
    const [year, month, day] = key.split("-").map(Number);
    return new Date(year, month - 1, day);
  }

  function formatDate(key, options = { day: "numeric", month: "long" }) {
    if (!key) return "";
    return new Intl.DateTimeFormat("ru-RU", options).format(parseDateKey(key));
  }

  function formatMinutes(minutes) {
    const safeMinutes = Math.max(0, Number(minutes) || 0);
    if (safeMinutes < 60) return `${safeMinutes} мин`;
    const hours = Math.floor(safeMinutes / 60);
    const rest = safeMinutes % 60;
    return rest ? `${hours} ч ${rest} мин` : `${hours} ч`;
  }

  function showToast(message) {
    const toast = $("#toast");
    toast.textContent = message;
    toast.classList.add("is-visible");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 2400);
  }

  function setStatus(selector, message) {
    const target = $(selector);
    if (!target) return;
    target.textContent = message;
    window.setTimeout(() => {
      if (target.textContent === message) target.textContent = "";
    }, 2200);
  }

  function openPage(name) {
    $$("[data-page]").forEach(page => page.classList.toggle("is-active", page.dataset.page === name));
    $$("[data-page-button]").forEach(button => button.classList.toggle("is-active", button.dataset.pageButton === name));
    if (name === "stats") renderStats();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function initNavigation() {
    $$("[data-page-button]").forEach(button => button.addEventListener("click", () => openPage(button.dataset.pageButton)));
    $$("[data-go-page]").forEach(button => button.addEventListener("click", () => openPage(button.dataset.goPage)));
  }

  function renderBrand() {
    $("#brand-name").textContent = state.settings.appName;
    document.title = state.settings.appName;
  }

  function renderTodayHeader() {
    $("#today-date").textContent = new Intl.DateTimeFormat("ru-RU", {
      weekday: "long",
      day: "numeric",
      month: "long"
    }).format(new Date());
  }

  function sessionsSince(days) {
    const threshold = new Date();
    threshold.setHours(0, 0, 0, 0);
    threshold.setDate(threshold.getDate() - (days - 1));
    return state.sessions.filter(session => parseDateKey(session.date) >= threshold);
  }

  function renderDashboardStats() {
    const today = localDateKey();
    const todayMinutes = state.sessions.filter(item => item.date === today).reduce((sum, item) => sum + Number(item.minutes || 0), 0);
    const weekMinutes = sessionsSince(7).reduce((sum, item) => sum + Number(item.minutes || 0), 0);
    const weekDays = lastDays(7);
    const weekCheckins = new Set(state.checkins.filter(item => weekDays.includes(item.date)).map(item => item.date)).size;
    $("#today-minutes").textContent = formatMinutes(todayMinutes);
    $("#week-hours").textContent = formatMinutes(weekMinutes);
    $("#week-checkins").textContent = `${weekCheckins} из 7`;
  }

  function timerDuration(mode) {
    if (mode === "focus") return state.settings.focusMinutes * 60;
    const isLongBreak = timerState.round > state.settings.rounds;
    return (isLongBreak ? state.settings.longBreakMinutes : state.settings.breakMinutes) * 60;
  }

  function updateTimerDisplay() {
    const minutes = Math.floor(timerState.remainingSeconds / 60);
    const seconds = timerState.remainingSeconds % 60;
    $("#timer-display").textContent = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    const elapsed = timerState.totalSeconds - timerState.remainingSeconds;
    $("#timer-progress").style.width = `${timerState.totalSeconds ? Math.max(0, Math.min(100, elapsed / timerState.totalSeconds * 100)) : 0}%`;
    $("#timer-start").textContent = timerState.running ? "Пауза" : "Начать";
    $("#timer-round-label").textContent = timerState.mode === "focus"
      ? `Фокус ${Math.min(timerState.round, state.settings.rounds)} из ${state.settings.rounds}`
      : timerState.round > state.settings.rounds ? "Длинный перерыв" : `Перерыв после фокуса ${timerState.round}`;
  }

  function stopTimer() {
    timerState.running = false;
    window.clearInterval(timerState.intervalId);
    timerState.intervalId = null;
  }

  function resetTimer() {
    stopTimer();
    timerState.totalSeconds = timerDuration(timerState.mode);
    timerState.remainingSeconds = timerState.totalSeconds;
    updateTimerDisplay();
  }

  function setTimerMode(mode) {
    timerState.mode = mode;
    $$('[data-timer-mode]').forEach(button => button.classList.toggle("is-active", button.dataset.timerMode === mode));
    resetTimer();
  }

  function addSession({ id: sessionId = "", date = localDateKey(), minutes, topic = "", kind = "focus" }) {
    const session = { id: sessionId || id("session"), date, minutes: Math.max(1, Math.round(Number(minutes))), topic: topic.trim(), kind };
    const existingIndex = state.sessions.findIndex(item => item.id === sessionId);
    if (existingIndex >= 0) state.sessions[existingIndex] = session;
    else state.sessions.unshift(session);
    saveState();
    renderDashboardStats();
    renderRecentSessions();
    renderStats();
  }

  function finishFocusSession(minutes) {
    const topic = $("#timer-topic").value.trim();
    addSession({ minutes, topic, kind: "focus" });
    showToast(`Занятие записано: ${formatMinutes(minutes)}`);
  }

  function handleTimerFinished() {
    stopTimer();
    timerState.remainingSeconds = 0;
    updateTimerDisplay();
    if (timerState.mode === "focus") {
      finishFocusSession(state.settings.focusMinutes);
      timerState.round += 1;
      window.setTimeout(() => {
        setTimerMode("break");
        showToast(timerState.round > state.settings.rounds ? "Время длинного перерыва" : "Фокус завершён. Время передохнуть");
      }, 450);
    } else {
      if (timerState.round > state.settings.rounds) timerState.round = 1;
      window.setTimeout(() => {
        setTimerMode("focus");
        showToast("Перерыв завершён");
      }, 450);
    }
  }

  function initTimer() {
    $("#timer-start").addEventListener("click", () => {
      if (timerState.running) {
        stopTimer();
        updateTimerDisplay();
        return;
      }
      timerState.running = true;
      timerState.intervalId = window.setInterval(() => {
        timerState.remainingSeconds -= 1;
        if (timerState.remainingSeconds <= 0) handleTimerFinished();
        else updateTimerDisplay();
      }, 1000);
      updateTimerDisplay();
    });

    $("#timer-reset").addEventListener("click", resetTimer);
    $("#timer-complete").addEventListener("click", () => {
      if (timerState.mode !== "focus") {
        showToast("Перерывы не записываются в учебное время");
        return;
      }
      const elapsedSeconds = timerState.totalSeconds - timerState.remainingSeconds;
      if (elapsedSeconds < 60) {
        showToast("Прошла ещё не целая минута — записывать пока нечего");
        return;
      }
      stopTimer();
      finishFocusSession(Math.max(1, Math.round(elapsedSeconds / 60)));
      resetTimer();
    });

    $$("[data-timer-mode]").forEach(button => button.addEventListener("click", () => setTimerMode(button.dataset.timerMode)));
    updateTimerDisplay();
  }

  function renderRecentSessions() {
    const root = $("#recent-sessions");
    const items = state.sessions.slice().sort((a, b) => `${b.date}-${b.id}`.localeCompare(`${a.date}-${a.id}`)).slice(0, 5);
    if (!items.length) {
      root.innerHTML = '<div class="empty-state compact"><p>Занятий пока нет. Можно включить помодоро или добавить время вручную.</p></div>';
      return;
    }
    root.className = "session-list";
    root.innerHTML = items.map(session => `
      <div class="session-row" data-session-id="${session.id}">
        <span class="session-duration">${escapeHtml(formatMinutes(session.minutes))}</span>
        <div class="session-copy"><strong>${escapeHtml(session.topic || "Без темы")}</strong><small>${escapeHtml(kindLabel(session.kind))}</small></div>
        <span class="session-date">${escapeHtml(formatDate(session.date, { day: "numeric", month: "short" }))}</span>
        <div class="session-actions"><button class="icon-button" type="button" data-edit-session aria-label="Изменить занятие">✎</button><button class="icon-button" type="button" data-delete-session aria-label="Удалить занятие">×</button></div>
      </div>
    `).join("");
  }

  function kindLabel(kind) {
    return { focus: "Фокус", theory: "Теория", practice: "Практика", other: "Другое" }[kind] || "Занятие";
  }

  function initSessionDialog() {
    const dialog = $("#session-dialog");
    const form = $("#session-form");

    function openSessionDialog(session = null) {
      form.reset();
      form.elements.id.value = session ? session.id : "";
      form.elements.date.value = session ? session.date : localDateKey();
      form.elements.minutes.value = session ? session.minutes : 60;
      form.elements.topic.value = session ? session.topic || "" : "";
      form.elements.kind.value = session ? session.kind : "focus";
      $("#session-dialog-title").textContent = session ? "Изменить занятие" : "Добавить занятие";
      dialog.showModal();
    }

    openSessionEditor = openSessionDialog;

    $$("[data-open-session-dialog]").forEach(button => button.addEventListener("click", () => openSessionDialog()));
    form.addEventListener("submit", event => {
      if (event.submitter && event.submitter.value === "cancel") return;
      event.preventDefault();
      const data = new FormData(form);
      const sessionId = String(data.get("id") || "");
      addSession({ id: sessionId, date: data.get("date"), minutes: data.get("minutes"), topic: String(data.get("topic") || ""), kind: data.get("kind") });
      dialog.close();
      showToast(sessionId ? "Занятие обновлено" : "Занятие добавлено");
    });

    $("#recent-sessions").addEventListener("click", event => {
      const row = event.target.closest("[data-session-id]");
      if (!row) return;
      const session = state.sessions.find(item => item.id === row.dataset.sessionId);
      if (event.target.closest("[data-edit-session]")) openSessionDialog(session);
      if (event.target.closest("[data-delete-session]") && window.confirm("Удалить это занятие?")) {
        state.sessions = state.sessions.filter(item => item.id !== session.id);
        saveState();
        renderRecentSessions();
        renderDashboardStats();
        renderStats();
      }
    });
  }

  function getRoadmapCounts() {
    const topics = state.roadmap.flatMap(section => section.topics || []);
    const completed = topics.filter(topic => topic.theory && topic.practice).length;
    return { topics, completed, percent: topics.length ? Math.round(completed / topics.length * 100) : 0 };
  }

  function addSection() {
    const section = { id: id("section"), title: "Новый раздел", topics: [] };
    state.roadmap.push(section);
    saveState();
    renderRoadmap();
    renderNextStep();
    window.setTimeout(() => {
      const input = $(`[data-section-id="${section.id}"] .roadmap-title-input`);
      if (input) { input.focus(); input.select(); }
    });
  }

  function addTopic(sectionId) {
    const section = state.roadmap.find(item => item.id === sectionId);
    if (!section) return;
    const topic = { id: id("topic"), name: "Новая тема", theory: false, practice: false, repeat: false, confidence: "new" };
    section.topics.push(topic);
    saveState();
    renderRoadmap();
    renderNextStep();
    window.setTimeout(() => {
      const input = $(`[data-topic-id="${topic.id}"] .topic-name`);
      if (input) { input.focus(); input.select(); }
    });
  }

  function moveItem(array, index, direction) {
    const target = index + direction;
    if (target < 0 || target >= array.length) return;
    [array[index], array[target]] = [array[target], array[index]];
  }

  function confidenceOptions(value) {
    const options = [
      ["new", "Не изучала"],
      ["lost", "Не понимаю"],
      ["shaky", "Плаваю"],
      ["understand", "Понимаю"],
      ["explain", "Могу объяснить"]
    ];
    return options.map(([optionValue, label]) => `<option value="${optionValue}"${optionValue === value ? " selected" : ""}>${label}</option>`).join("");
  }

  function renderRoadmap() {
    const root = $("#roadmap-list");
    const progress = $("#roadmap-progress");
    const counts = getRoadmapCounts();

    progress.innerHTML = state.roadmap.length ? `
      <div class="panel-header"><div><h2>Общий прогресс</h2><p>${counts.completed} из ${counts.topics.length} тем закрыто по теории и практике</p></div></div>
      <div class="progress-line"><div class="progress-bar"><div style="width:${counts.percent}%"></div></div><strong>${counts.percent}%</strong></div>
    ` : '<div class="empty-state compact"><p>Прогресс появится, когда ты добавишь темы.</p></div>';

    if (!state.roadmap.length) {
      root.innerHTML = `
        <article class="panel empty-state">
          <div class="empty-icon" aria-hidden="true">◇</div>
          <h2>Роадмапа пока нет</h2>
          <p>Создай раздел, когда ментор даст структуру курса или она начнёт складываться по ходу обучения.</p>
          <button class="button button-primary" type="button" data-create-section>Создать раздел</button>
        </article>`;
      return;
    }

    root.innerHTML = state.roadmap.map((section, sectionIndex) => `
      <article class="roadmap-section" data-section-id="${section.id}">
        <div class="roadmap-section-header">
          <div class="roadmap-title-wrap">
            <input class="roadmap-title-input" type="text" value="${escapeHtml(section.title)}" aria-label="Название раздела" data-section-title>
          </div>
          <div class="section-actions">
            <button class="button button-small" type="button" data-section-up ${sectionIndex === 0 ? "disabled" : ""}>↑</button>
            <button class="button button-small" type="button" data-section-down ${sectionIndex === state.roadmap.length - 1 ? "disabled" : ""}>↓</button>
            <button class="button button-small button-danger" type="button" data-delete-section>Удалить</button>
          </div>
        </div>
        <div class="topic-list">
          ${(section.topics || []).map((topic, topicIndex) => `
            <div class="topic-row" data-topic-id="${topic.id}">
              <input class="topic-name" type="text" value="${escapeHtml(topic.name)}" aria-label="Название темы" data-topic-name>
              <label class="topic-check"><input type="checkbox" data-topic-theory ${topic.theory ? "checked" : ""}> Теория</label>
              <label class="topic-check"><input type="checkbox" data-topic-practice ${topic.practice ? "checked" : ""}> Практика</label>
              <select class="confidence-select" data-topic-confidence aria-label="Уверенность в теме">${confidenceOptions(topic.confidence)}</select>
              <div class="topic-actions">
                <label class="topic-check"><input type="checkbox" data-topic-repeat ${topic.repeat ? "checked" : ""}> Повторить</label>
                <button class="icon-button" type="button" data-topic-up aria-label="Поднять тему" ${topicIndex === 0 ? "disabled" : ""}>↑</button>
                <button class="icon-button" type="button" data-topic-down aria-label="Опустить тему" ${topicIndex === section.topics.length - 1 ? "disabled" : ""}>↓</button>
                <button class="icon-button" type="button" data-delete-topic aria-label="Удалить тему">×</button>
              </div>
            </div>
          `).join("")}
        </div>
        <div class="add-topic-row"><button class="text-button" type="button" data-add-topic>+ Добавить тему</button></div>
      </article>
    `).join("");
  }

  function findSectionAndTopic(element) {
    const sectionElement = element.closest("[data-section-id]");
    if (!sectionElement) return {};
    const section = state.roadmap.find(item => item.id === sectionElement.dataset.sectionId);
    const topicElement = element.closest("[data-topic-id]");
    const topic = section && topicElement ? section.topics.find(item => item.id === topicElement.dataset.topicId) : null;
    return { section, topic, sectionElement, topicElement };
  }

  function initRoadmap() {
    $("#add-section").addEventListener("click", addSection);
    $("#roadmap-list").addEventListener("click", event => {
      const target = event.target;
      if (target.closest("[data-create-section]")) return addSection();
      const { section, topic } = findSectionAndTopic(target);
      if (!section) return;
      const sectionIndex = state.roadmap.findIndex(item => item.id === section.id);
      const topicIndex = topic ? section.topics.findIndex(item => item.id === topic.id) : -1;

      if (target.closest("[data-add-topic]")) addTopic(section.id);
      else if (target.closest("[data-section-up]")) { moveItem(state.roadmap, sectionIndex, -1); saveState(); renderRoadmap(); }
      else if (target.closest("[data-section-down]")) { moveItem(state.roadmap, sectionIndex, 1); saveState(); renderRoadmap(); }
      else if (target.closest("[data-delete-section]")) {
        if (window.confirm(`Удалить раздел «${section.title}» вместе со всеми темами?`)) {
          state.roadmap.splice(sectionIndex, 1); saveState(); renderRoadmap(); renderNextStep();
        }
      } else if (target.closest("[data-topic-up]") && topic) { moveItem(section.topics, topicIndex, -1); saveState(); renderRoadmap(); }
      else if (target.closest("[data-topic-down]") && topic) { moveItem(section.topics, topicIndex, 1); saveState(); renderRoadmap(); }
      else if (target.closest("[data-delete-topic]") && topic) {
        if (window.confirm(`Удалить тему «${topic.name}»?`)) {
          section.topics.splice(topicIndex, 1); saveState(); renderRoadmap(); renderNextStep();
        }
      }
    });

    $("#roadmap-list").addEventListener("input", event => {
      const { section, topic } = findSectionAndTopic(event.target);
      if (!section) return;
      if (event.target.matches("[data-section-title]")) section.title = event.target.value;
      if (topic && event.target.matches("[data-topic-name]")) topic.name = event.target.value;
      saveState();
      renderNextStep();
    });

    $("#roadmap-list").addEventListener("change", event => {
      const { topic } = findSectionAndTopic(event.target);
      if (!topic) return;
      if (event.target.matches("[data-topic-theory]")) topic.theory = event.target.checked;
      if (event.target.matches("[data-topic-practice]")) topic.practice = event.target.checked;
      if (event.target.matches("[data-topic-repeat]")) topic.repeat = event.target.checked;
      if (event.target.matches("[data-topic-confidence]")) topic.confidence = event.target.value;
      saveState();
      renderRoadmap();
      renderNextStep();
    });
  }

  function renderNextStep() {
    const root = $("#next-step-content");
    if (!state.roadmap.length) {
      root.innerHTML = '<div class="empty-state compact"><p>Пока нет разделов и тем — это нормально.</p><button class="button" type="button" data-dashboard-create-section>Создать раздел</button></div>';
      const button = $("[data-dashboard-create-section]", root);
      button.addEventListener("click", () => { openPage("roadmap"); addSection(); });
      return;
    }
    const repeatTopic = state.roadmap.flatMap(section => section.topics.map(topic => ({ section, topic }))).find(item => item.topic.repeat);
    const nextTopic = repeatTopic || state.roadmap.flatMap(section => section.topics.map(topic => ({ section, topic }))).find(item => !(item.topic.theory && item.topic.practice));
    if (!nextTopic) {
      root.innerHTML = '<div class="empty-state compact"><p>Все добавленные темы закрыты. Можно создать следующую или спокойно порадоваться.</p></div>';
      return;
    }
    root.innerHTML = `<div class="next-step-item"><div><h3>${escapeHtml(nextTopic.topic.name)}</h3><p>${escapeHtml(nextTopic.section.title)}${nextTopic.topic.repeat ? " · отмечено для повторения" : ""}</p></div><button class="button button-small" type="button" data-use-topic>В помодоро</button></div>`;
    $("[data-use-topic]", root).addEventListener("click", () => {
      $("#timer-topic").value = nextTopic.topic.name;
      openPage("today");
      $("#timer-start").focus();
    });
  }

  function initCheckin() {
    const form = $("#checkin-form");
    $$('input[type="range"]', form).forEach(input => input.addEventListener("input", () => {
      $(`[data-range-output="${input.name}"]`, form).textContent = `${input.value}/10`;
    }));
    form.addEventListener("submit", event => {
      event.preventDefault();
      const data = new FormData(form);
      const entry = {
        id: id("checkin"),
        date: localDateKey(),
        energy: Number(data.get("energy")),
        interest: Number(data.get("interest")),
        tension: Number(data.get("tension")),
        concentration: Number(data.get("concentration")),
        note: String(data.get("note") || "").trim()
      };
      const existingIndex = state.checkins.findIndex(item => item.date === entry.date);
      if (existingIndex >= 0) entry.id = state.checkins[existingIndex].id;
      if (existingIndex >= 0) state.checkins[existingIndex] = entry;
      else state.checkins.unshift(entry);
      saveState();
      renderDashboardStats();
      renderStats();
      setStatus("#checkin-status", "Состояние сохранено");
    });
  }

  function loadTodayCheckin() {
    const entry = state.checkins.find(item => item.date === localDateKey());
    if (!entry) return;
    const form = $("#checkin-form");
    ["energy", "interest", "tension", "concentration"].forEach(key => {
      form.elements[key].value = entry[key];
      $(`[data-range-output="${key}"]`, form).textContent = `${entry[key]}/10`;
    });
    form.elements.note.value = entry.note || "";
  }

  function renderMentorQuestions() {
    const root = $("#mentor-list");
    if (!state.mentorQuestions.length) {
      root.innerHTML = '<p class="form-status">Вопросов пока нет.</p>';
      return;
    }
    root.innerHTML = state.mentorQuestions.map(item => `
      <div class="mentor-row${item.done ? " is-done" : ""}" data-question-id="${item.id}">
        <input type="checkbox" data-question-done aria-label="Вопрос обсуждён" ${item.done ? "checked" : ""}>
        <input class="mentor-input" type="text" value="${escapeHtml(item.text)}" aria-label="Текст вопроса" data-question-text>
        <button class="icon-button" type="button" data-delete-question aria-label="Удалить вопрос">×</button>
      </div>
    `).join("");
  }

  function initMentorQuestions() {
    $("#mentor-form").addEventListener("submit", event => {
      event.preventDefault();
      const input = event.currentTarget.elements.question;
      const text = input.value.trim();
      if (!text) return;
      state.mentorQuestions.push({ id: id("question"), text, done: false });
      input.value = "";
      saveState();
      renderMentorQuestions();
    });
    $("#mentor-list").addEventListener("input", event => {
      const row = event.target.closest("[data-question-id]");
      const item = row && state.mentorQuestions.find(question => question.id === row.dataset.questionId);
      if (!item) return;
      if (event.target.matches("[data-question-text]")) item.text = event.target.value;
      saveState();
    });
    $("#mentor-list").addEventListener("change", event => {
      const row = event.target.closest("[data-question-id]");
      const item = row && state.mentorQuestions.find(question => question.id === row.dataset.questionId);
      if (!item || !event.target.matches("[data-question-done]")) return;
      item.done = event.target.checked;
      saveState();
      renderMentorQuestions();
    });
    $("#mentor-list").addEventListener("click", event => {
      const button = event.target.closest("[data-delete-question]");
      const row = button && button.closest("[data-question-id]");
      if (!row) return;
      state.mentorQuestions = state.mentorQuestions.filter(item => item.id !== row.dataset.questionId);
      saveState();
      renderMentorQuestions();
    });
  }

  function openDiaryDialog(entry = null) {
    const form = $("#diary-form");
    form.reset();
    form.elements.id.value = entry ? entry.id : "";
    form.elements.date.value = entry ? entry.date : localDateKey();
    ["learned", "worked", "stuck", "next"].forEach(key => form.elements[key].value = entry ? entry[key] || "" : "");
    $("#diary-dialog-title").textContent = entry ? "Редактировать запись" : "Новая запись";
    $("#diary-dialog").showModal();
  }

  function diaryField(label, value) {
    if (!value) return "";
    return `<div class="diary-field"><h3>${label}</h3><p>${escapeHtml(value)}</p></div>`;
  }

  function renderDiary() {
    const root = $("#diary-list");
    const entries = state.diary.slice().sort((a, b) => b.date.localeCompare(a.date));
    if (!entries.length) {
      root.innerHTML = '<article class="panel empty-state"><div class="empty-icon" aria-hidden="true">✎</div><h2>Первая запись ещё впереди</h2><p>Достаточно пары предложений: что изучила, что получилось и куда двигаться дальше.</p><button class="button button-primary" type="button" data-empty-add-diary>Создать запись</button></article>';
      return;
    }
    root.innerHTML = entries.map(entry => `
      <article class="diary-entry" data-diary-id="${entry.id}">
        <div class="diary-entry-header"><h2>${escapeHtml(formatDate(entry.date, { day: "numeric", month: "long", year: "numeric" }))}</h2><div class="diary-actions"><button class="button button-small" type="button" data-edit-diary>Изменить</button><button class="button button-small button-danger" type="button" data-delete-diary>Удалить</button></div></div>
        <div class="diary-fields">${diaryField("Что изучила", entry.learned)}${diaryField("Что получилось", entry.worked)}${diaryField("Где застряла", entry.stuck)}${diaryField("Следующий шаг", entry.next)}</div>
      </article>
    `).join("");
  }

  function initDiary() {
    $("#add-diary-entry").addEventListener("click", () => openDiaryDialog());
    $("#diary-form").addEventListener("submit", event => {
      if (event.submitter && event.submitter.value === "cancel") return;
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      const entryId = String(data.get("id") || "");
      const entry = {
        id: entryId || id("diary"), date: data.get("date"), learned: String(data.get("learned") || "").trim(),
        worked: String(data.get("worked") || "").trim(), stuck: String(data.get("stuck") || "").trim(), next: String(data.get("next") || "").trim()
      };
      const index = state.diary.findIndex(item => item.id === entryId);
      if (index >= 0) state.diary[index] = entry; else state.diary.unshift(entry);
      saveState(); $("#diary-dialog").close(); renderDiary(); showToast(index >= 0 ? "Запись обновлена" : "Запись создана");
    });
    $("#diary-list").addEventListener("click", event => {
      if (event.target.closest("[data-empty-add-diary]")) return openDiaryDialog();
      const item = event.target.closest("[data-diary-id]");
      if (!item) return;
      const entry = state.diary.find(value => value.id === item.dataset.diaryId);
      if (event.target.closest("[data-edit-diary]")) openDiaryDialog(entry);
      if (event.target.closest("[data-delete-diary]") && window.confirm("Удалить эту запись?")) {
        state.diary = state.diary.filter(value => value.id !== entry.id); saveState(); renderDiary();
      }
    });
  }

  function lastDays(count) {
    const result = [];
    for (let offset = count - 1; offset >= 0; offset -= 1) {
      const date = new Date();
      date.setHours(0, 0, 0, 0);
      date.setDate(date.getDate() - offset);
      result.push(localDateKey(date));
    }
    return result;
  }

  function average(items, key) {
    if (!items.length) return null;
    return items.reduce((sum, item) => sum + Number(item[key] || 0), 0) / items.length;
  }

  function mentalInsight(checkins) {
    if (checkins.length < 3) return { title: "Пока собираем данные", text: "После трёх чек-инов появится аккуратная оценка тенденции — без диагнозов и драматизации." };
    const energy = average(checkins, "energy");
    const interest = average(checkins, "interest");
    const tension = average(checkins, "tension");
    if (energy <= 4 && tension >= 7) return { title: "Похоже на перегрузку", text: "Энергия держится низко, а напряжение высоко. Возможно, следующий учебный день стоит сделать легче: повторение вместо новой сложной темы." };
    if (interest <= 4) return { title: "Интерес просел", text: "Это не обязательно выгорание. Проверь, не стало ли слишком много теории без практики или слишком мало отдыха." };
    if (tension >= 7) return { title: "Напряжение повышено", text: "Можно уменьшить фокус-блок или выбрать знакомую задачу, чтобы не наращивать нагрузку через силу." };
    return { title: "Ритм выглядит устойчивым", text: "По последним отметкам нет явного сочетания низкой энергии, низкого интереса и высокого напряжения." };
  }

  function renderStats() {
    const days = lastDays(7);
    const sessions = state.sessions.filter(item => days.includes(item.date));
    const checkins = state.checkins.filter(item => days.includes(item.date));
    const totalMinutes = sessions.reduce((sum, item) => sum + Number(item.minutes || 0), 0);
    const activeDays = new Set(sessions.map(item => item.date)).size;
    const counts = getRoadmapCounts();

    $("#stats-summary").innerHTML = `
      <article class="stat-card"><span>За 7 дней</span><strong>${escapeHtml(formatMinutes(totalMinutes))}</strong><small>учебного времени</small></article>
      <article class="stat-card"><span>Учебный ритм</span><strong>${activeDays} из 7</strong><small>дней с занятиями</small></article>
      <article class="stat-card"><span>Прогресс тем</span><strong>${counts.percent}%</strong><small>${counts.completed} из ${counts.topics.length} закрыто</small></article>`;

    const byDay = days.map(day => ({ day, minutes: sessions.filter(item => item.date === day).reduce((sum, item) => sum + Number(item.minutes || 0), 0) }));
    const max = Math.max(1, ...byDay.map(item => item.minutes));
    $("#study-chart").innerHTML = byDay.map(item => `
      <div class="bar-day">
        <div class="bar-space"><div class="bar" style="height:${Math.max(item.minutes ? 5 : 2, item.minutes / max * 100)}%" aria-label="${escapeHtml(formatMinutes(item.minutes))}"></div></div>
        <span class="bar-value">${item.minutes ? escapeHtml(formatMinutes(item.minutes)) : "—"}</span>
        <span class="bar-label">${escapeHtml(new Intl.DateTimeFormat("ru-RU", { weekday: "short" }).format(parseDateKey(item.day)))}</span>
      </div>`).join("");

    const metrics = [
      ["Энергия", "energy"], ["Интерес", "interest"], ["Напряжение", "tension"], ["Концентрация", "concentration"]
    ];
    if (!checkins.length) {
      $("#mental-summary").innerHTML = '<div class="empty-state compact"><p>За последние 7 дней пока нет чек-инов.</p></div>';
    } else {
      const insight = mentalInsight(checkins);
      $("#mental-summary").innerHTML = `<div class="mental-grid">${metrics.map(([label, key]) => {
        const value = average(checkins, key);
        return `<div class="mental-row"><span>${label}</span><div class="mental-meter"><div style="width:${value * 10}%"></div></div><strong>${value.toFixed(1)}</strong></div>`;
      }).join("")}</div><div class="mental-insight"><strong>${escapeHtml(insight.title)}</strong><p>${escapeHtml(insight.text)}</p></div>`;
    }

    renderHistories();
  }

  function renderHistories() {
    const sessionsRoot = $("#session-history");
    const sessions = state.sessions.slice().sort((a, b) => `${b.date}-${b.id}`.localeCompare(`${a.date}-${a.id}`));
    sessionsRoot.innerHTML = sessions.length ? sessions.map(session => `
      <div class="session-row" data-history-session-id="${session.id}">
        <span class="session-duration">${escapeHtml(formatMinutes(session.minutes))}</span>
        <div class="session-copy"><strong>${escapeHtml(session.topic || "Без темы")}</strong><small>${escapeHtml(kindLabel(session.kind))}</small></div>
        <span class="session-date">${escapeHtml(formatDate(session.date, { day: "numeric", month: "short", year: "numeric" }))}</span>
        <div class="session-actions"><button class="icon-button" type="button" data-history-edit-session aria-label="Изменить занятие">✎</button><button class="icon-button" type="button" data-history-delete-session aria-label="Удалить занятие">×</button></div>
      </div>`).join("") : '<div class="empty-state compact"><p>Занятий пока нет.</p></div>';

    const checkinsRoot = $("#checkin-history");
    const checkinItems = state.checkins.slice().sort((a, b) => b.date.localeCompare(a.date));
    checkinsRoot.innerHTML = checkinItems.length ? checkinItems.map(item => `
      <div class="checkin-history-row" data-checkin-id="${item.id}">
        <div class="checkin-history-head"><strong>${escapeHtml(formatDate(item.date, { day: "numeric", month: "long", year: "numeric" }))}</strong><button class="icon-button" type="button" data-delete-checkin aria-label="Удалить чек-ин">×</button></div>
        <div class="checkin-history-fields">
          <label class="checkin-mini-field">Энергия<input type="number" min="1" max="10" value="${item.energy}" data-checkin-field="energy"></label>
          <label class="checkin-mini-field">Интерес<input type="number" min="1" max="10" value="${item.interest}" data-checkin-field="interest"></label>
          <label class="checkin-mini-field">Напряжение<input type="number" min="1" max="10" value="${item.tension}" data-checkin-field="tension"></label>
          <label class="checkin-mini-field">Концентрация<input type="number" min="1" max="10" value="${item.concentration}" data-checkin-field="concentration"></label>
          <label class="checkin-mini-field checkin-note">Заметка<input type="text" value="${escapeHtml(item.note || "")}" data-checkin-field="note"></label>
        </div>
      </div>`).join("") : '<div class="empty-state compact"><p>Чек-инов пока нет.</p></div>';
  }

  function initHistoryEditing() {
    $("#session-history").addEventListener("click", event => {
      const row = event.target.closest("[data-history-session-id]");
      if (!row) return;
      const session = state.sessions.find(item => item.id === row.dataset.historySessionId);
      if (event.target.closest("[data-history-edit-session]") && openSessionEditor) openSessionEditor(session);
      if (event.target.closest("[data-history-delete-session]") && window.confirm("Удалить это занятие?")) {
        state.sessions = state.sessions.filter(item => item.id !== session.id);
        saveState(); renderRecentSessions(); renderDashboardStats(); renderStats();
      }
    });

    $("#checkin-history").addEventListener("change", event => {
      const row = event.target.closest("[data-checkin-id]");
      const field = event.target.dataset.checkinField;
      if (!row || !field) return;
      const entry = state.checkins.find(item => item.id === row.dataset.checkinId);
      if (!entry) return;
      entry[field] = field === "note" ? event.target.value : Math.max(1, Math.min(10, Number(event.target.value) || 1));
      saveState();
      renderStats();
      loadTodayCheckin();
    });

    $("#checkin-history").addEventListener("click", event => {
      const button = event.target.closest("[data-delete-checkin]");
      const row = button && button.closest("[data-checkin-id]");
      if (!row || !window.confirm("Удалить этот чек-ин?")) return;
      state.checkins = state.checkins.filter(item => item.id !== row.dataset.checkinId);
      saveState(); renderStats(); loadTodayCheckin();
    });
  }

  function populateSettingsForms() {
    const general = $("#general-settings-form");
    general.elements.appName.value = state.settings.appName;
    const pomodoro = $("#pomodoro-settings-form");
    ["focusMinutes", "breakMinutes", "longBreakMinutes", "rounds"].forEach(key => pomodoro.elements[key].value = state.settings[key]);
  }

  function initSettings() {
    $("#general-settings-form").addEventListener("submit", event => {
      event.preventDefault();
      state.settings.appName = event.currentTarget.elements.appName.value.trim() || "C++ Grove";
      saveState(); renderBrand(); setStatus("#general-settings-status", "Название сохранено");
    });
    $("#pomodoro-settings-form").addEventListener("submit", event => {
      event.preventDefault();
      const form = event.currentTarget;
      ["focusMinutes", "breakMinutes", "longBreakMinutes", "rounds"].forEach(key => state.settings[key] = Math.max(1, Number(form.elements[key].value)));
      saveState(); resetTimer(); setStatus("#pomodoro-settings-status", "Настройки сохранены");
    });
    $("#export-data").addEventListener("click", () => {
      const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `cpp-grove-backup-${localDateKey()}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setStatus("#backup-status", "Резервная копия скачана");
    });
    $("#import-data").addEventListener("change", async event => {
      const file = event.target.files[0];
      if (!file) return;
      try {
        const imported = JSON.parse(await file.text());
        if (!imported || !Array.isArray(imported.roadmap) || !Array.isArray(imported.sessions)) throw new Error("Неверный формат");
        if (!window.confirm("Заменить текущие данные содержимым резервной копии?")) return;
        state = normalizeState(imported);
        saveState();
        renderAll();
        resetTimer();
        setStatus("#backup-status", "Данные восстановлены");
      } catch (error) {
        console.error(error);
        setStatus("#backup-status", "Не удалось прочитать этот файл");
      } finally {
        event.target.value = "";
      }
    });
  }

  function closeDialogButtons() {
    $$('dialog button[value="cancel"]').forEach(button => button.addEventListener("click", event => {
      event.preventDefault();
      button.closest("dialog").close();
    }));
  }

  function renderAll() {
    renderBrand();
    renderTodayHeader();
    renderDashboardStats();
    renderRecentSessions();
    renderRoadmap();
    renderNextStep();
    renderMentorQuestions();
    renderDiary();
    renderStats();
    populateSettingsForms();
    loadTodayCheckin();
  }

  function init() {
    initNavigation();
    initTimer();
    initSessionDialog();
    initRoadmap();
    initCheckin();
    initMentorQuestions();
    initDiary();
    initSettings();
    initHistoryEditing();
    closeDialogButtons();
    renderAll();
  }

  init();
}());
