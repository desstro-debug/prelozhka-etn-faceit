const BOT_API = "https://api.telegram.org/bot";
const WEB_APP_URL = "ВСТАВЬ_СЮДА_URL_ВЕБ-ПРИЛОЖЕНИЯ";
const PROP = PropertiesService.getScriptProperties();
const MAX_NEWS_LENGTH = 3000;
const MAX_MEDIA_CAPTION_LENGTH = 900;

function doPost(event) {
  try {
    const update = JSON.parse(event.postData.contents);
    if (update.message) handleMessage(update.message);
    if (update.callback_query) handleCallback(update.callback_query);
  } catch (error) {
    console.error(error && error.stack ? error.stack : error);
  }
  return ContentService.createTextOutput("OK");
}

function handleMessage(message) {
  const user = message.from;
  const chatId = message.chat.id;
  if (!user || String(chatId) !== String(user.id)) {
    sendText(chatId, "Пожалуйста, напишите боту в личные сообщения.");
    return;
  }

  rememberUser(user);
  if (isBanned(user.id)) {
    sendText(chatId, "Доступ к предложке ограничен.");
    return;
  }
  if (shouldBlockForMaintenance(isMaintenanceEnabled(), isStaff(user.id))) {
    sendText(chatId, maintenanceMessage());
    return;
  }

  const text = String(message.text || "").trim();
  if (text === "/start") return showStart(chatId);
  if (text === "/help") return showHelp(chatId, user.id);
  if (text === "/rules") return sendText(chatId, rulesText());
  if (text === "/id") return showUserId(chatId, user);
  if (text === "/mynews") return showUserSubmissions(chatId, user.id);
  if (text === "/admins") return showAdminPanel(chatId, user.id);
  if (text === "/moder") return showModeratorPanel(chatId, user.id);
  if (text === "/senior") return showSeniorPanel(chatId, user.id);
  if (text === "/stats") return showStats(chatId, user.id);
  if (text === "/moderators") return showModerators(chatId, user.id);
  if (text === "/appeals") return showQueue(chatId, user.id, "pending_appeal");
  if (text === "/audit" || text.indexOf("/audit ") === 0) {
    return showAuditLog(chatId, user.id, text.slice(6).trim());
  }
  if (text.indexOf("/unban ") === 0) return unbanCommand(chatId, user.id, text.slice(7).trim());
  if (text.indexOf("/clearwarn ") === 0) return clearWarnCommand(chatId, user.id, text.slice(11).trim());
  if (text.indexOf("/setchat ") === 0) return setDestinationCommand(chatId, user.id, text.slice(9).trim());
  if (text.indexOf("/find ") === 0) return findUserCommand(chatId, user.id, text.slice(6).trim());
  if (text === "/cancel") {
    clearFlow(user.id);
    return sendText(chatId, "Действие отменено.");
  }

  const flow = getFlow(user.id);
  if (!flow) {
    return sendText(chatId, "Чтобы предложить новость, нажмите «Предложить новость» или отправьте /start.");
  }
  handleFlowMessage(message, flow);
}

function showStart(chatId) {
  const text = "Добро пожаловать в предложку ETNFaceit!\n\n"
    + "Есть новость или важная информация по ETNFaceit? Отправьте ее сюда. "
    + "Модератор проверит, что текст понятный и соответствует правилам, а администратор отдельно оценит достоверность и пользу новости.\n\n"
    + rulesText();
  sendText(chatId, text, [[{ text: "Предложить новость", callback_data: "submit" }],
    [{ text: "Мои новости", callback_data: "my_news" }, { text: "Правила", callback_data: "rules" }]]);
}

function rulesText() {
  return "<b>Правила предложки</b>\n"
    + "1. Пишите только о FACEIT, ETN и связанных с ними событиях. Без оффтопа.\n"
    + "2. Не отправляйте политику, оскорбления, травлю и дискриминацию, включая расизм.\n"
    + "3. Запрещены порнография, нагота и откровенный сексуальный контент.\n"
    + "4. Не присылайте спам, рекламу, фейки и заведомо ложные обвинения.\n"
    + "5. Формулируйте новость понятно и по возможности добавляйте источник.\n\n"
    + "Сначала текст проверит модератор, затем администратор оценит его достоверность и значимость. Отправка не гарантирует публикацию.";
}

function showHelp(chatId, userId) {
  const lines = [
    "<b>Команды предложки</b>",
    "/start — открыть главное меню",
    "/rules — прочитать правила",
    "/id — показать свой Telegram ID",
    "/mynews — посмотреть отправленные новости",
    "/cancel — отменить текущее действие"
  ];
  if (isModerator(userId) || isAdmin(userId)) {
    lines.push("/moder — открыть панель модератора");
  }
  if (isSeniorModerator(userId)) {
    lines.push("/senior — открыть панель старшего модератора");
  }
  if (isAdmin(userId)) {
    lines.push("/admins — открыть панель администратора");
    lines.push("/stats — статистика предложки");
    lines.push("/moderators — список модераторов");
    lines.push("/appeals — очередь апелляций");
    lines.push("/audit [фильтр] — журнал действий");
    lines.push("Фильтры: user:ID, target:ID, action:событие, date:ГГГГ-ММ-ДД или текст");
    lines.push("/find ID или username — найти пользователя");
    lines.push("/unban ID — снять бан");
    lines.push("/clearwarn ID — сбросить варны");
    lines.push("/setchat ID — изменить чат публикации");
    lines.push("Управление админами и техработами — в /admins");
  }
  sendText(chatId, lines.join("\n"));
}

function showUserId(chatId, user) {
  const username = user.username ? "@" + user.username : "не задан";
  sendText(chatId, "Ваш Telegram ID: <code>" + escapeHtml(user.id)
    + "</code>\nUsername: " + escapeHtml(username));
}

function showUserSubmissions(chatId, userId) {
  const items = getUserSubmissions(userId).slice(0, 20);
  if (!items.length) {
    return sendText(chatId, "У вас пока нет отправленных новостей.", [
      [{ text: "Предложить новость", callback_data: "submit" }]
    ]);
  }

  const keyboard = items.map(function (item) {
    const preview = item.text.replace(/\s+/g, " ").slice(0, 34);
    const status = submissionStatusLabel(item.status);
    return [{ text: status + " | " + (preview || "Новость"), callback_data: "user_view:" + item.id }];
  });
  sendText(chatId, "Ваши последние новости. Выберите запись, чтобы посмотреть статус:", keyboard);
}

function showUserSubmission(chatId, userId, submissionId) {
  const item = getSubmission(submissionId);
  if (!item || String(item.userId) !== String(userId)) {
    return sendText(chatId, "Новость не найдена в ваших отправлениях.");
  }

  const keyboard = [];
  if (item.status === "pending_moderation" || item.status === "pending_admin") {
    keyboard.push([
      { text: "Изменить текст", callback_data: "user_edit:" + item.id },
      { text: "Отозвать", callback_data: "user_cancel:" + item.id }
    ]);
  }
  if (item.status === "rejected_moderation" || item.status === "rejected_admin") {
    keyboard.push([{ text: "Подать апелляцию", callback_data: "user_appeal:" + item.id }]);
  }
  const text = "<b>Статус:</b> " + escapeHtml(submissionStatusLabel(item.status)) + "\n"
    + "<b>ID:</b> <code>" + escapeHtml(item.id) + "</code>\n"
    + "<b>Отправлено:</b> " + escapeHtml(formatDate(item.createdAt)) + "\n\n"
    + (item.rejectionReason ? "<b>Причина отказа:</b> " + escapeHtml(item.rejectionReason) + "\n\n" : "")
    + escapeHtml(item.text || (item.media ? "Медиа без подписи" : ""));
  if (item.media) sendMediaFile(chatId, item.media, "Вложение к вашей новости");
  sendText(chatId, text, keyboard.length ? keyboard : undefined);
}

function startEditSubmission(chatId, userId, submissionId) {
  const item = getSubmission(submissionId);
  if (!item || String(item.userId) !== String(userId)) {
    return sendText(chatId, "Новость не найдена в ваших отправлениях.");
  }
  if (item.status !== "pending_moderation" && item.status !== "pending_admin") {
    return sendText(chatId, "Изменить можно только новость, которая еще проверяется.");
  }
  setFlow(userId, { type: "edit_news", submissionId: submissionId });
  sendText(chatId, "Отправьте новый полный текст новости. После изменения он снова пройдет проверку модератора. Максимум 3000 символов.");
}

function editUserSubmission(chatId, userId, submissionId, replacementText) {
  if (replacementText.length > MAX_NEWS_LENGTH) {
    return sendText(chatId, "Текст слишком длинный. Максимум 3000 символов.");
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  let updated = null;
  try {
    const item = getSubmission(submissionId);
    const editable = item && String(item.userId) === String(userId)
      && (item.status === "pending_moderation" || item.status === "pending_admin");
    if (editable) {
      item.text = replacementText;
      item.status = "pending_moderation";
      item.editedAt = new Date().toISOString();
      item.version = Number(item.version || 1) + 1;
      PROP.setProperty("submission_" + submissionId, JSON.stringify(item));
      updated = item;
    }
  } finally {
    lock.releaseLock();
  }
  clearFlow(userId);
  if (!updated) return sendText(chatId, "Новость больше нельзя изменить. Проверьте ее статус в /mynews.");
  auditEvent("submission_edited", userId, submissionId, "Текст изменен; назначена повторная модерация.");
  sendText(chatId, "Текст обновлен и отправлен на повторную проверку модератору.");
  notifyReviewers(updated, "pending_moderation");
}

function cancelUserSubmission(chatId, userId, submissionId) {
  const item = getSubmission(submissionId);
  if (!item || String(item.userId) !== String(userId)) {
    return sendText(chatId, "Новость не найдена в ваших отправлениях.");
  }
  const expected = item.status;
  if (expected !== "pending_moderation" && expected !== "pending_admin") {
    return sendText(chatId, "Эту новость уже нельзя отозвать: проверка завершена.");
  }
  const cancelled = transitionSubmission(submissionId, expected, "cancelled");
  if (!cancelled) return sendText(chatId, "Статус изменился. Обновите список новостей.");
  sendText(chatId, "Новость отозвана.");
  notifySubmissionChange(cancelled, "Автор отозвал новость.");
}

function startAppeal(chatId, userId, submissionId) {
  const item = getSubmission(submissionId);
  if (!item || String(item.userId) !== String(userId)) {
    return sendText(chatId, "Новость не найдена в ваших отправлениях.");
  }
  if (item.status !== "rejected_moderation" && item.status !== "rejected_admin") {
    return sendText(chatId, "Апелляция доступна только для отклоненных новостей.");
  }
  setFlow(userId, { type: "appeal", submissionId: submissionId });
  sendText(chatId, "Коротко напишите, почему решение стоит пересмотреть. Максимум 1000 символов. Для отмены отправьте /cancel.");
}

function submitAppeal(chatId, userId, submissionId, appealText) {
  if (appealText.length > 1000) {
    return sendText(chatId, "Апелляция слишком длинная. Максимум 1000 символов.");
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  let item;
  try {
    item = getSubmission(submissionId);
    if (!item || String(item.userId) !== String(userId)
      || (item.status !== "rejected_moderation" && item.status !== "rejected_admin")) {
      clearFlow(userId);
      return sendText(chatId, "Апелляцию уже нельзя отправить. Проверьте статус новости.");
    }
    item.status = "pending_appeal";
    item.appealText = appealText;
    item.appealAt = new Date().toISOString();
    PROP.setProperty("submission_" + submissionId, JSON.stringify(item));
  } finally {
    lock.releaseLock();
  }
  clearFlow(userId);
  sendText(chatId, "Апелляция отправлена администраторам.");
  notifyAppealReviewers(item);
}

function notifyAppealReviewers(item) {
  const username = item.username && item.username !== "не указан" ? "@" + item.username : "не указан";
  const text = "<b>Апелляция по новости</b>\n"
    + "Отправитель: " + escapeHtml(item.firstName || "") + "\n"
    + "Telegram ID: <code>" + escapeHtml(item.userId) + "</code>\n"
    + "Username: " + escapeHtml(username) + "\n\n"
    + "<b>Новость:</b>\n" + escapeHtml(item.text) + "\n\n"
    + "<b>Пояснение:</b>\n" + escapeHtml(item.appealText || "");
  const keyboard = [[
    { text: "Вернуть в проверку", callback_data: "appeal_ok:" + item.id },
    { text: "Оставить отказ", callback_data: "appeal_no:" + item.id }
  ]];
  getAdminIds().forEach(function (adminId) {
    try { sendText(adminId, text, keyboard); }
    catch (error) { console.error("Appeal notification failed: " + error); }
  });
}

function resolveAppeal(chatId, adminId, submissionId, accepted) {
  if (!isAdmin(adminId)) return sendText(chatId, "Только администратор может рассматривать апелляции.");
  const nextStatus = accepted ? "pending_moderation" : "appeal_dismissed";
  const item = transitionSubmission(submissionId, "pending_appeal", nextStatus);
  if (!item) return sendText(chatId, "Апелляция уже обработана.");
  item.appealResolvedAt = new Date().toISOString();
  item.appealResolvedBy = adminId;
  PROP.setProperty("submission_" + submissionId, JSON.stringify(item));
  if (accepted) {
    sendText(chatId, "Апелляция принята. Новость возвращена на проверку модераторам.");
    sendText(item.userId, "Апелляция принята. Новость вернулась на проверку модераторам.");
    notifyReviewers(item, "pending_moderation");
  } else {
    sendText(chatId, "Апелляция отклонена.");
    sendText(item.userId, "Администратор рассмотрел апелляцию и оставил решение без изменений.");
  }
}

function getUserSubmissions(userId) {
  return getAllSubmissions().filter(function (item) {
    return String(item.userId) === String(userId);
  }).sort(function (a, b) { return b.createdAt.localeCompare(a.createdAt); });
}

function getAllSubmissions() {
  const properties = PROP.getProperties();
  return Object.keys(properties).filter(function (key) {
    return key.indexOf("submission_") === 0;
  }).map(function (key) {
    try { return JSON.parse(properties[key]); } catch (error) { return null; }
  }).filter(function (item) { return item && item.id; });
}

function submissionStatusLabel(status) {
  const labels = {
    pending_moderation: "На проверке у модератора",
    pending_admin: "На проверке у администратора",
    publishing: "Публикуется",
    published: "Опубликована",
    rejected_moderation: "Отклонена модератором",
    rejected_admin: "Отклонена администратором",
    pending_appeal: "Апелляция рассматривается",
    appeal_dismissed: "Апелляция отклонена",
    cancelled: "Отозвана автором"
  };
  return labels[status] || "Статус неизвестен";
}

function formatDate(value) {
  const date = new Date(value);
  if (isNaN(date.getTime())) return "неизвестно";
  return Utilities.formatDate(date, "Etc/UTC", "yyyy-MM-dd HH:mm 'UTC'");
}

function notifySubmissionChange(item, message) {
  const ids = getAdminIds().concat(getModeratorIds());
  const uniqueIds = ids.filter(function (id, index) { return ids.indexOf(id) === index; });
  uniqueIds.forEach(function (id) {
    try {
      sendText(id, escapeHtml(message) + "\nID новости: <code>" + escapeHtml(item.id) + "</code>");
    } catch (error) {
      console.error("Status notification failed for " + id + ": " + error);
    }
  });
}

function showStats(chatId, userId) {
  if (!isAdmin(userId)) return sendText(chatId, "Команда доступна только администраторам.");
  const submissions = getAllSubmissions();
  const properties = PROP.getProperties();
  const counts = {};
  submissions.forEach(function (item) {
    counts[item.status] = (counts[item.status] || 0) + 1;
  });
  const text = "<b>Статистика предложки</b>\n"
    + "Пользователей запускали бота: " + countKeys(properties, "seen_") + "\n"
    + "Модераторов: " + getModeratorIds().length + "\n"
    + "На проверке у модератора: " + (counts.pending_moderation || 0) + "\n"
    + "На проверке у администратора: " + (counts.pending_admin || 0) + "\n"
    + "Апелляций ожидает решения: " + (counts.pending_appeal || 0) + "\n"
    + "Опубликовано: " + (counts.published || 0) + "\n"
    + "Отклонено: " + ((counts.rejected_admin || 0) + (counts.rejected_moderation || 0)) + "\n"
    + "Забанено: " + countKeys(properties, "banned_");
  sendText(chatId, text);
}

function showModerators(chatId, userId) {
  if (!isAdmin(userId)) return sendText(chatId, "Команда доступна только администраторам.");
  const moderators = getModeratorIds();
  if (!moderators.length) return sendText(chatId, "Модераторов пока нет.");
  const rows = moderators.map(function (moderatorId, index) {
    const profile = getUserProfile(moderatorId);
    const name = profile ? profile.firstName || "Без имени" : "Без профиля";
    const username = profile && profile.username ? " @" + profile.username : "";
    return (index + 1) + ". " + escapeHtml(name + username) + " — <code>" + escapeHtml(moderatorId) + "</code>";
  });
  sendText(chatId, "<b>Модераторы (" + moderators.length + ")</b>\n" + rows.join("\n"));
}

function unbanCommand(chatId, adminId, targetId) {
  if (!isAdmin(adminId)) return sendText(chatId, "Команда доступна только администраторам.");
  if (!/^\d+$/.test(targetId)) return sendText(chatId, "Использование: /unban TELEGRAM_ID");
  if (isAdmin(targetId)) return sendText(chatId, "Администратор не может быть забанен.");
  const existed = isBanned(targetId);
  PROP.deleteProperty("banned_" + targetId);
  if (existed) auditEvent("user_unbanned", adminId, targetId, "Бан снят администратором.");
  sendText(chatId, existed ? "Бан снят с пользователя " + targetId + "." : "Пользователь не был забанен.");
  if (existed) sendText(targetId, "Ваш бан в предложке снят.");
}

function clearWarnCommand(chatId, adminId, targetId) {
  if (!isAdmin(adminId)) return sendText(chatId, "Команда доступна только администраторам.");
  if (!/^\d+$/.test(targetId)) return sendText(chatId, "Использование: /clearwarn TELEGRAM_ID");
  if (isAdmin(targetId)) return sendText(chatId, "Нельзя менять предупреждения администратора.");
  const current = Number(PROP.getProperty("warns_" + targetId) || 0);
  PROP.deleteProperty("warns_" + targetId);
  auditEvent("warns_cleared", adminId, targetId, "Сброшено варнов: " + current);
  sendText(chatId, "Варны пользователя " + targetId + " сброшены (было " + current + ").");
  sendText(targetId, "Ваши варны сброшены администратором.");
}

function setDestinationCommand(chatId, adminId, destination) {
  if (!isAdmin(adminId)) return sendText(chatId, "Команда доступна только администраторам.");
  if (!isValidDestination(destination)) {
    return sendText(chatId, "Использование: /setchat -1001234567890 или /setchat @channel_name");
  }
  PROP.setProperty("DESTINATION_CHAT_ID", destination);
  auditEvent("destination_changed", adminId, destination, "Изменен чат публикации.");
  sendText(chatId, "Чат публикации установлен: <code>" + escapeHtml(destination) + "</code>");
}

function findUserCommand(chatId, adminId, query) {
  if (!isAdmin(adminId)) return sendText(chatId, "Команда доступна только администраторам.");
  const normalized = query.replace(/^@/, "").toLowerCase();
  if (!normalized) return sendText(chatId, "Использование: /find TELEGRAM_ID или /find username");
  const properties = PROP.getProperties();
  let matches = Object.keys(properties).filter(function (key) {
    return key.indexOf("user_profile_") === 0;
  }).map(function (key) {
    try { return JSON.parse(properties[key]); } catch (error) { return null; }
  }).filter(function (profile) {
    if (!profile) return false;
    return String(profile.id) === normalized || String(profile.username || "").toLowerCase() === normalized;
  });
  if (/^\d+$/.test(normalized) && !matches.some(function (profile) { return String(profile.id) === normalized; })) {
    matches.push({ id: normalized, username: "", firstName: "Профиль еще не сохранен" });
  }
  if (!matches.length) return sendText(chatId, "Пользователь не найден среди известных боту.");
  const output = matches.slice(0, 10).map(function (profile) {
    const username = profile.username ? " @" + profile.username : "";
    const role = isAdmin(profile.id) ? "администратор" : isModerator(profile.id) ? "модератор" : "пользователь";
    const warns = Number(PROP.getProperty("warns_" + profile.id) || 0);
    const banned = isBanned(profile.id) ? "; бан" : "";
    return "• <code>" + escapeHtml(profile.id) + "</code> " + escapeHtml(profile.firstName || "")
      + escapeHtml(username) + " — " + role + "; варны " + warns + "/3" + banned;
  });
  sendText(chatId, output.join("\n"));
}

function showAuditLog(chatId, userId, filter) {
  if (!isAdmin(userId)) return sendText(chatId, "Команда доступна только администраторам.");
  const properties = PROP.getProperties();
  const allEntries = Object.keys(properties).filter(function (key) {
    return key.indexOf("audit_") === 0;
  }).map(function (key) {
    try { return JSON.parse(properties[key]); } catch (error) { return null; }
  }).filter(function (entry) { return entry && entry.at; })
    .sort(function (a, b) { return b.at.localeCompare(a.at); });
  const matched = filterAuditEntries(allEntries, filter);
  const entries = matched.slice(0, 10);
  if (!entries.length) return sendText(chatId, filter ? "По этому фильтру записей нет." : "Журнал пока пуст.");
  const lines = entries.map(function (entry) {
    return escapeHtml(formatDate(entry.at)) + " | <b>" + escapeHtml(entry.action) + "</b>\n"
      + "Актор: <code>" + escapeHtml(entry.actorId) + "</code>; цель: <code>"
      + escapeHtml(entry.targetId || "—") + "</code>\n" + escapeHtml(String(entry.details || "").slice(0, 250));
  });
  const title = filter ? "<b>Журнал по фильтру:</b> " + escapeHtml(filter)
    : "<b>Последние действия</b>";
  sendText(chatId, title + "\nНайдено: " + matched.length + "; показано: " + entries.length
    + " из 10 последних.\n\n" + lines.join("\n\n"));
}

function filterAuditEntries(entries, filter) {
  const query = String(filter || "").trim().toLowerCase();
  if (!query) return entries;
  const terms = query.split(/\s+/);
  return entries.filter(function (entry) {
    return terms.every(function (term) {
      const separator = term.indexOf(":");
      const field = separator === -1 ? "" : term.slice(0, separator);
      const value = (separator === -1 ? term : term.slice(separator + 1)).trim();
      if (!value) return true;
      if (field === "user") {
        return String(entry.actorId || "").toLowerCase().indexOf(value) !== -1
          || String(entry.targetId || "").toLowerCase().indexOf(value) !== -1;
      }
      if (field === "actor") {
        return String(entry.actorId || "").toLowerCase().indexOf(value) !== -1;
      }
      if (field === "target") {
        return String(entry.targetId || "").toLowerCase().indexOf(value) !== -1;
      }
      if (field === "action") {
        return String(entry.action || "").toLowerCase().indexOf(value) !== -1;
      }
      if (field === "date") return String(entry.at || "").indexOf(value) === 0;
      const haystack = [entry.action, entry.actorId, entry.targetId, entry.details, entry.at]
        .join(" ").toLowerCase();
      return haystack.indexOf(value) !== -1;
    });
  });
}

function auditEvent(action, actorId, targetId, details) {
  const id = Date.now() + "_" + Utilities.getUuid().slice(0, 8);
  const entry = {
    at: new Date().toISOString(),
    action: action,
    actorId: String(actorId),
    targetId: targetId === undefined ? "" : String(targetId),
    details: String(details || "").slice(0, 500)
  };
  PROP.setProperty("audit_" + id, JSON.stringify(entry));
  pruneAuditLog(200);
}

function pruneAuditLog(limit) {
  const properties = PROP.getProperties();
  const keys = Object.keys(properties).filter(function (key) {
    return key.indexOf("audit_") === 0;
  }).sort();
  const removeCount = keys.length - limit;
  if (removeCount <= 0) return;
  keys.slice(0, removeCount).forEach(function (key) { PROP.deleteProperty(key); });
}

function countKeys(properties, prefix) {
  return Object.keys(properties).filter(function (key) { return key.indexOf(prefix) === 0; }).length;
}

function getModeratorIds() {
  const properties = PROP.getProperties();
  return Object.keys(properties).filter(function (key) {
    if (key.indexOf("moderator_") !== 0 || properties[key] !== "1") return false;
    const userId = key.slice(10);
    return !isAdmin(userId) && !isSeniorModerator(userId);
  }).map(function (key) { return key.slice(10); });
}

function getSeniorModeratorIds() {
  return parseAdminIds(PROP.getProperty("SENIOR_MODERATOR_IDS") || "");
}

function saveSeniorModeratorIds(ids) {
  PROP.setProperty("SENIOR_MODERATOR_IDS", parseAdminIds(ids.join(",")).join(","));
}

function getModeratorNotificationIds(moderatorIds, adminIds) {
  const admins = adminIds.map(String);
  return moderatorIds.map(String).filter(function (id, index, ids) {
    return admins.indexOf(id) === -1 && ids.indexOf(id) === index;
  });
}

function getUserProfile(userId) {
  const value = PROP.getProperty("user_profile_" + userId);
  if (!value) return null;
  try { return JSON.parse(value); } catch (error) { return null; }
}

function showAdminPanel(chatId, userId) {
  if (!isAdmin(userId)) return sendText(chatId, "Команда доступна только администраторам.");
  const keyboard = [
    [{ text: "Нанять модератора", callback_data: "hire" }, { text: "Уволить модератора", callback_data: "fire" }],
    [{ text: "Проверить новости", callback_data: "admin_queue" }, { text: "Работа модератора", callback_data: "mod_work" }],
    [{ text: "Объявление всем", callback_data: "broadcast" }],
    [{ text: "Забанить", callback_data: "ban" }, { text: "Выдать варн", callback_data: "warn" }],
    [{ text: "Назначить админа", callback_data: "hire_admin" }, { text: "Снять админку", callback_data: "fire_admin" }],
    [{ text: "Назначить старшего", callback_data: "hire_senior" }, { text: "Снять старшего", callback_data: "fire_senior" }],
    [{ text: isMaintenanceEnabled() ? "Выключить техработы" : "Включить техработы", callback_data: "maintenance_toggle" }],
    [{ text: "Автоматизация · SOON", callback_data: "automation_soon" }],
    [{ text: isSubmissionsPaused() ? "▶️ Возобновить приём" : "⏸️ Пауза приёма", callback_data: "toggle_submissions" }],
    [{ text: isPublishingPaused() ? "▶️ Возобновить публикации" : "🧊 Пауза публикаций", callback_data: "toggle_publishing" }],
    [{ text: "📊 Сводка очередей", callback_data: "queue_summary" }],
    [{ text: "🆘 Сигнал команде", callback_data: "staff_alert" }],
    [{ text: "🩺 Проверка бота", callback_data: "bot_health" }]
  ];
  sendText(chatId, "<b>Панель администратора</b>\nВыберите действие:", keyboard);
}

function showModeratorPanel(chatId, userId) {
  if (isSeniorModerator(userId)) return showSeniorPanel(chatId, userId);
  if (!isModerator(userId) && !isSeniorModerator(userId) && !isAdmin(userId)) {
    return sendText(chatId, "Команда доступна только модераторам.");
  }
  const keyboard = [
    [{ text: "Очередь новостей", callback_data: "mod_queue" }],
    [{ text: "Правила", callback_data: "rules" }]
  ];
  sendText(chatId, "<b>Панель модератора</b>\nПроверьте понятность текста и соответствие правилам. Публикацию подтверждает старший модератор или администратор.", keyboard);
}

function showSeniorPanel(chatId, userId) {
  if (!isSeniorModerator(userId) && !isAdmin(userId)) {
    return sendText(chatId, "Команда доступна только старшим модераторам.");
  }
  const keyboard = [
    [{ text: "Очередь модерации", callback_data: "mod_queue" }],
    [{ text: "Очередь публикации", callback_data: "senior_admin_queue" }],
    [{ text: "Нанять помощника", callback_data: "hire_helper" }, { text: "Уволить помощника", callback_data: "fire_helper" }],
    [{ text: "Правила", callback_data: "rules" }]
  ];
  sendText(chatId, "<b>Панель старшего модератора</b>\nПроверяйте новости, управляйте своей командой и публикуйте после проверки.", keyboard);
}

function handleCallback(query) {
  const userId = query.from.id;
  const chatId = query.message ? query.message.chat.id : userId;
  rememberUser(query.from);
  answerCallback(query.id);

  if (isBanned(userId)) return sendText(chatId, "Доступ к предложке ограничен.");
  if (shouldBlockForMaintenance(isMaintenanceEnabled(), isStaff(userId))) {
    return sendText(chatId, maintenanceMessage());
  }
  const data = String(query.data || "");

  if (data === "rules") return sendText(chatId, rulesText());
  if (data === "my_news") return showUserSubmissions(chatId, userId);
  if (data === "submit") {
    if (!canAcceptSubmissions(isSubmissionsPaused())) return sendText(chatId, "Приём новостей временно приостановлен. Попробуйте позже.");
    setFlow(userId, { type: "submit" });
    return sendText(chatId, "Отправьте текст новости или одно фото, видео либо документ с подписью или без нее. Максимум 3000 символов; подпись к медиа — 900. Для отмены отправьте /cancel.");
  }
  if (data === "maintenance_toggle") {
    if (!isAdmin(userId)) return sendText(chatId, "Действие доступно только администраторам.");
    return toggleMaintenance(chatId, userId);
  }
  if (data === "automation_soon") {
    if (!isAdmin(userId)) return sendText(chatId, "Действие доступно только администраторам.");
    return sendText(chatId, "Автоматизация скоро появится. Пока ничего не запускается.");
  }
  if (["toggle_submissions", "toggle_publishing", "queue_summary", "staff_alert", "bot_health"].indexOf(data) !== -1) {
    if (!isAdmin(userId)) return sendText(chatId, "Действие доступно только администраторам.");
    if (data === "toggle_submissions") return toggleSubmissionPause(chatId, userId);
    if (data === "toggle_publishing") return togglePublishingPause(chatId, userId);
    if (data === "queue_summary") return showQueueSummary(chatId, userId);
    if (data === "staff_alert") {
      setFlow(userId, { type: "staff_alert" });
      return sendText(chatId, "Отправьте текст срочного сообщения только для команды. Для отмены отправьте /cancel.");
    }
    return showBotHealth(chatId, userId);
  }
  if (data === "hire" || data === "fire" || data === "hire_admin" || data === "fire_admin"
    || data === "hire_senior" || data === "fire_senior" || data === "hire_helper" || data === "fire_helper"
    || data === "ban" || data === "warn" || data === "broadcast") {
    const adminAction = ["hire", "fire", "hire_admin", "fire_admin", "hire_senior", "fire_senior", "ban", "warn", "broadcast"].indexOf(data) !== -1;
    const helperAction = data === "hire_helper" || data === "fire_helper";
    if (adminAction && !isAdmin(userId)) return sendText(chatId, "Действие доступно только администраторам.");
    if (helperAction && !isSeniorModerator(userId)) return sendText(chatId, "Только старший модератор может управлять помощниками.");
    const prompts = {
      hire: "Отправьте Telegram ID пользователя, которого нужно назначить модератором.",
      fire: "Отправьте Telegram ID модератора, которого нужно снять.",
      hire_admin: "Отправьте Telegram ID пользователя, которому нужно выдать права администратора.",
      fire_admin: "Отправьте Telegram ID администратора, у которого нужно снять права.",
      hire_senior: "Отправьте Telegram ID пользователя, которого нужно назначить старшим модератором.",
      fire_senior: "Отправьте Telegram ID старшего модератора, которого нужно снять.",
      hire_helper: "Отправьте Telegram ID помощника, которого нужно назначить модератором.",
      fire_helper: "Отправьте Telegram ID своего помощника, которого нужно снять.",
      ban: "Отправьте Telegram ID пользователя для бана.",
      warn: "Отправьте Telegram ID пользователя для выдачи варна.",
      broadcast: "Отправьте текст объявления для всех пользователей бота. Для отмены отправьте /cancel."
    };
    setFlow(userId, { type: data });
    return sendText(chatId, prompts[data]);
  }
  if (data === "admin_queue" || data === "senior_admin_queue") return showQueue(chatId, userId, "pending_admin");
  if (data === "mod_queue" || data === "mod_work") return showQueue(chatId, userId, "pending_moderation");
  if (data === "appeal_queue") return showQueue(chatId, userId, "pending_appeal");
  if (data.indexOf("queue_page:") === 0) {
    const parts = data.split(":");
    return showQueue(chatId, userId, parts[1], Number(parts[2]));
  }
  if (data.indexOf("user_view:") === 0) return showUserSubmission(chatId, userId, data.slice(10));
  if (data.indexOf("user_edit:") === 0) return startEditSubmission(chatId, userId, data.slice(10));
  if (data.indexOf("edit_review:") === 0) return startReviewEdit(chatId, userId, data.slice(12));
  if (data === "edit_confirm_yes") return confirmReviewEdit(chatId, userId, true);
  if (data === "edit_confirm_no") return confirmReviewEdit(chatId, userId, false);
  if (data.indexOf("user_cancel:") === 0) return cancelUserSubmission(chatId, userId, data.slice(12));
  if (data.indexOf("user_appeal:") === 0) return startAppeal(chatId, userId, data.slice(12));
  if (data.indexOf("appeal_ok:") === 0) return resolveAppeal(chatId, userId, data.slice(10), true);
  if (data.indexOf("appeal_no:") === 0) return resolveAppeal(chatId, userId, data.slice(10), false);
  if (data.indexOf("m_ok:") === 0) return reviewAsModerator(chatId, userId, data.slice(5), true);
  if (data.indexOf("m_no:") === 0) return showRejectionReasons(chatId, userId, data.slice(5), "mod");
  if (data.indexOf("s_pub:") === 0) return reviewAsSeniorModerator(chatId, userId, data.slice(6));
  if (data.indexOf("a_pub:") === 0) return reviewAsAdmin(chatId, userId, data.slice(6), true);
  if (data.indexOf("a_no:") === 0) return showRejectionReasons(chatId, userId, data.slice(5), "admin");
  if (data.indexOf("reject:") === 0) {
    const parts = data.split(":");
    return rejectSubmission(chatId, userId, parts[2], parts[1], parts[3]);
  }
  if (data.indexOf("view_mod:") === 0) return showReviewItem(chatId, userId, data.slice(9), "pending_moderation");
  if (data.indexOf("view_admin:") === 0) return showReviewItem(chatId, userId, data.slice(11), "pending_admin");
  if (data.indexOf("view_appeal:") === 0) return showReviewItem(chatId, userId, data.slice(12), "pending_appeal");
}

function handleFlowMessage(message, flow) {
  const userId = message.from.id;
  const chatId = message.chat.id;
  const text = String(message.text || message.caption || "").trim();
  const media = extractSubmissionMedia(message);
  if (!text && !(flow.type === "submit" && media)) return sendText(chatId, "Отправьте текст или одно фото, видео либо документ с подписью.");

  if (flow.type === "submit") {
    if (!canAcceptSubmissions(isSubmissionsPaused())) {
      clearFlow(userId);
      return sendText(chatId, "Приём новостей временно приостановлен. Ваша заявка не отправлена.");
    }
    if (text.length > MAX_NEWS_LENGTH) return sendText(chatId, "Текст слишком длинный. Максимум 3000 символов.");
    if (media && text.length > MAX_MEDIA_CAPTION_LENGTH) {
      return sendText(chatId, "Подпись к фото, видео или документу должна быть не длиннее 900 символов.");
    }
    const id = Utilities.getUuid().replace(/-/g, "").slice(0, 12);
    const submission = {
      id: id,
      userId: userId,
      username: message.from.username || "не указан",
      firstName: message.from.first_name || "",
      text: text,
      media: media,
      status: "pending_moderation",
      createdAt: new Date().toISOString()
    };
    PROP.setProperty("submission_" + id, JSON.stringify(submission));
    auditEvent("submission_created", userId, id, "Пользователь отправил новость.");
    clearFlow(userId);
    sendText(chatId, "Новость отправлена модераторам. Если текст пройдет проверку, администратор отдельно оценит его достоверность и пользу.");
    notifyReviewers(submission, "pending_moderation");
    return;
  }

  if (flow.type === "appeal") {
    return submitAppeal(chatId, userId, flow.submissionId, text);
  }
  if (flow.type === "edit_news") {
    return editUserSubmission(chatId, userId, flow.submissionId, text);
  }
  if (flow.type === "review_edit") {
    return prepareReviewEdit(chatId, userId, flow, text);
  }
  if (flow.type === "staff_alert") {
    if (!isAdmin(userId)) {
      clearFlow(userId);
      return sendText(chatId, "Действие доступно только администраторам.");
    }
    if (text.length > 3000) return sendText(chatId, "Сообщение команде должно быть короче 3000 символов.");
    clearFlow(userId);
    return sendStaffAlert(chatId, userId, text);
  }

  if (flow.type === "hire_helper" || flow.type === "fire_helper") {
    if (!isSeniorModerator(userId)) {
      clearFlow(userId);
      return sendText(chatId, "Только старший модератор может управлять помощниками.");
    }
    if (!/^\d+$/.test(text)) return sendText(chatId, "Нужен числовой Telegram ID.");
    if (flow.type === "hire_helper") return hireHelper(chatId, userId, text);
    return fireHelper(chatId, userId, text);
  }

  if (!isAdmin(userId)) {
    clearFlow(userId);
    return sendText(chatId, "Действие доступно только администраторам.");
  }
  if (flow.type === "broadcast") {
    if (text.length > 3500) return sendText(chatId, "Объявление слишком длинное. Максимум 3500 символов.");
    clearFlow(userId);
    return broadcastMessage(userId, text);
  }
  if (!/^\d+$/.test(text)) return sendText(chatId, "Нужен числовой Telegram ID. Попробуйте еще раз или отправьте /cancel.");

  const targetId = text;
  if (flow.type === "hire") return hireModerator(chatId, userId, targetId);
  if (flow.type === "fire") return fireModerator(chatId, userId, targetId);
  if (flow.type === "hire_admin") return hireAdmin(chatId, userId, targetId);
  if (flow.type === "fire_admin") return fireAdmin(chatId, userId, targetId);
  if (flow.type === "hire_senior") return hireSeniorModerator(chatId, userId, targetId);
  if (flow.type === "fire_senior") return fireSeniorModerator(chatId, userId, targetId);
  if (flow.type === "ban") return banUser(chatId, userId, targetId, "Бан выдан администратором.");
  if (flow.type === "warn") return warnUser(chatId, userId, targetId);
  clearFlow(userId);
}

function extractSubmissionMedia(message) {
  if (message.photo && message.photo.length) {
    return { type: "photo", fileId: message.photo[message.photo.length - 1].file_id };
  }
  if (message.video && message.video.file_id) {
    return { type: "video", fileId: message.video.file_id };
  }
  if (message.document && message.document.file_id) {
    return { type: "document", fileId: message.document.file_id };
  }
  return null;
}

function sendMediaFile(chatId, media, caption) {
  const methods = { photo: "sendPhoto", video: "sendVideo", document: "sendDocument" };
  const method = media && methods[media.type];
  if (!method || !media.fileId) throw new Error("Неизвестный тип вложения.");
  const payload = { chat_id: chatId };
  payload[media.type] = media.fileId;
  if (caption) {
    payload.caption = caption;
    payload.parse_mode = "HTML";
  }
  return telegramRequest_(method, payload);
}

function sendSubmissionReview(chatId, item, status, keyboard) {
  if (item.media) {
    sendMediaFile(chatId, item.media, "Медиа к новости <code>" + escapeHtml(item.id) + "</code>");
  }
  return sendText(chatId, formatSubmission(item, status), keyboard);
}

function sendSubmissionToChannel(chatId, item) {
  const body = item.text ? escapeHtml(item.text) : "";
  const heading = "<b>Новость ETNFaceit</b>";
  if (!item.media) return sendText(chatId, heading + (body ? "\n\n" + body : ""));
  const caption = heading + (body ? "\n\n" + body : "");
  if (caption.length <= 1024) return sendMediaFile(chatId, item.media, caption);
  sendMediaFile(chatId, item.media, heading);
  return sendText(chatId, body);
}

function showQueue(chatId, userId, status, requestedOffset) {
  if (["pending_moderation", "pending_admin", "pending_appeal"].indexOf(status) === -1) {
    return sendText(chatId, "Неизвестный тип очереди.");
  }
  if (!canAccessQueue(isAdmin(userId), isModerator(userId), status, isSeniorModerator(userId))) {
    return sendText(chatId, "Нет доступа к этой очереди.");
  }
  const allItems = getSubmissions(status);
  if (!allItems.length) return sendText(chatId, "Очередь пуста.");
  const pageSize = 8;
  const pageCount = Math.ceil(allItems.length / pageSize);
  const page = Math.max(0, Math.min(Number(requestedOffset) || 0, pageCount - 1));
  const items = allItems.slice(page * pageSize, (page + 1) * pageSize);
  const keyboard = items.map(function (item) {
    const title = item.text.replace(/\s+/g, " ").slice(0, 42);
    const callback = status === "pending_admin" ? "view_admin:"
      : status === "pending_appeal" ? "view_appeal:" : "view_mod:";
    return [{ text: title || "Новость без текста", callback_data: callback + item.id }];
  });
  const navigation = [];
  if (page > 0) navigation.push({ text: "Назад", callback_data: "queue_page:" + status + ":" + (page - 1) });
  if (page + 1 < pageCount) navigation.push({ text: "Дальше", callback_data: "queue_page:" + status + ":" + (page + 1) });
  if (navigation.length) keyboard.push(navigation);
  sendText(chatId, "В очереди: " + allItems.length + ". Страница " + (page + 1) + "/" + pageCount + ". Выберите новость:", keyboard);
}

function showReviewItem(chatId, userId, id, expectedStatus) {
  const adminUser = isAdmin(userId);
  const seniorUser = isSeniorModerator(userId);
  const moderatorUser = isModerator(userId);
  if (!canAccessQueue(adminUser, moderatorUser, expectedStatus, seniorUser)) {
    return sendText(chatId, "Нет доступа к этой новости.");
  }
  const item = getSubmission(id);
  if (!item || item.status !== expectedStatus) return sendText(chatId, "Эта новость уже проверена или недоступна.");
  let keyboard;
  if (expectedStatus === "pending_admin") {
    keyboard = [
      [{ text: "Редактировать", callback_data: "edit_review:" + id }],
      [{ text: "Опубликовать", callback_data: "a_pub:" + id }, { text: "Отклонить", callback_data: "a_no:" + id }]
    ];
  } else if (expectedStatus === "pending_appeal") {
    keyboard = [[{ text: "Вернуть в проверку", callback_data: "appeal_ok:" + id }, { text: "Оставить отказ", callback_data: "appeal_no:" + id }]];
  } else {
    const publishAction = adminUser || seniorUser
      ? { text: "Опубликовать", callback_data: "s_pub:" + id }
      : { text: "Отправить администратору", callback_data: "m_ok:" + id };
    keyboard = [
      [{ text: "Редактировать", callback_data: "edit_review:" + id }],
      [{ text: "Отклонить", callback_data: "m_no:" + id }, publishAction]
    ];
  }
  sendSubmissionReview(chatId, item, expectedStatus, keyboard);
}

function startReviewEdit(chatId, userId, submissionId) {
  const item = getSubmission(submissionId);
  if (!item || !canAccessQueue(isAdmin(userId), isModerator(userId), item.status, isSeniorModerator(userId))) {
    return sendText(chatId, "Нет доступа к редактированию этой новости.");
  }
  if (item.status !== "pending_moderation" && item.status !== "pending_admin") {
    return sendText(chatId, "Эту новость уже нельзя редактировать.");
  }
  setFlow(userId, { type: "review_edit", submissionId: submissionId, sourceStatus: item.status });
  sendText(chatId, "Отправьте новый полный текст новости. После этого покажу предпросмотр и подтверждение публикации.");
}

function prepareReviewEdit(chatId, userId, flow, replacementText) {
  if (replacementText.length > MAX_NEWS_LENGTH) {
    return sendText(chatId, "Текст слишком длинный. Максимум 3000 символов.");
  }
  const item = getSubmission(flow.submissionId);
  if (!item || item.status !== flow.sourceStatus
    || !canAccessQueue(isAdmin(userId), isModerator(userId), item.status, isSeniorModerator(userId))) {
    clearFlow(userId);
    return sendText(chatId, "Статус новости изменился или у вас больше нет доступа. Откройте очередь заново.");
  }
  PROP.setProperty("review_edit_draft_" + userId, JSON.stringify({
    submissionId: flow.submissionId,
    sourceStatus: flow.sourceStatus,
    text: replacementText,
    createdAt: new Date().toISOString()
  }));
  clearFlow(userId);
  const question = reviewerEditConfirmation(isAdmin(userId), isSeniorModerator(userId));
  const keyboard = [[
    { text: "Да", callback_data: "edit_confirm_yes" },
    { text: "Нет", callback_data: "edit_confirm_no" }
  ]];
  sendText(chatId, "<b>Предпросмотр новости</b>\n\n" + escapeHtml(replacementText)
    + "\n\n" + question, keyboard);
}

function confirmReviewEdit(chatId, userId, approved) {
  const draftKey = "review_edit_draft_" + userId;
  const value = PROP.getProperty(draftKey);
  if (!value) return sendText(chatId, "Черновик редактирования не найден. Откройте новость заново.");
  let draft;
  try { draft = JSON.parse(value); } catch (error) {
    PROP.deleteProperty(draftKey);
    return sendText(chatId, "Черновик поврежден. Откройте новость заново.");
  }
  if (!approved) {
    PROP.deleteProperty(draftKey);
    return sendText(chatId, "Редактирование отменено. Новость не отправлена.");
  }
  if (!canAccessQueue(isAdmin(userId), isModerator(userId), draft.sourceStatus, isSeniorModerator(userId))) {
    PROP.deleteProperty(draftKey);
    return sendText(chatId, "Нет доступа к этой новости.");
  }
  const item = getSubmission(draft.submissionId);
  if (!item || item.status !== draft.sourceStatus) {
    PROP.deleteProperty(draftKey);
    return sendText(chatId, "Новость уже обработана. Подтверждение отменено.");
  }

  PROP.deleteProperty(draftKey);
  if (canPublishDirectly(isAdmin(userId), isSeniorModerator(userId))) {
    return publishSubmission(chatId, userId, draft.submissionId, draft.sourceStatus, draft.text);
  }
  const updated = transitionSubmissionWithText(
    draft.submissionId, draft.sourceStatus, "pending_admin", draft.text
  );
  if (!updated) return sendText(chatId, "Новость уже обработана. Откройте очередь заново.");
  auditEvent("moderator_edited_for_admin", userId, draft.submissionId, "Отредактированная новость передана администратору.");
  sendText(chatId, "Отредактированная новость передана администратору на подтверждение.");
  notifyReviewers(updated, "pending_admin");
}

function rejectionReasonLabels() {
  return {
    offtopic: "Новость не относится к ETNFaceit.",
    source: "Не хватает источника или подтверждения информации.",
    rules: "Текст нарушает правила предложки.",
    spam: "Спам или реклама.",
    unclear: "Текст непонятен; уточните формулировку."
  };
}

function canRejectAtStage(adminUser, seniorUser, moderatorUser, stage) {
  if (stage === "mod") return Boolean(adminUser || seniorUser || moderatorUser);
  if (stage === "admin") return Boolean(adminUser || seniorUser);
  return false;
}

function showRejectionReasons(chatId, userId, submissionId, stage) {
  const expectedStatus = stage === "mod" ? "pending_moderation"
    : stage === "admin" ? "pending_admin" : "";
  if (!expectedStatus || !canRejectAtStage(isAdmin(userId), isSeniorModerator(userId), isModerator(userId), stage)) {
    return sendText(chatId, "Нет доступа к отклонению этой новости.");
  }
  const item = getSubmission(submissionId);
  if (!item || item.status !== expectedStatus) return sendText(chatId, "Новость уже обработана.");
  const reasons = rejectionReasonLabels();
  const keyboard = [
    [{ text: "Не по теме", callback_data: "reject:" + stage + ":" + submissionId + ":offtopic" },
      { text: "Нет источника", callback_data: "reject:" + stage + ":" + submissionId + ":source" }],
    [{ text: "Нарушение правил", callback_data: "reject:" + stage + ":" + submissionId + ":rules" },
      { text: "Спам/реклама", callback_data: "reject:" + stage + ":" + submissionId + ":spam" }],
    [{ text: "Текст непонятен", callback_data: "reject:" + stage + ":" + submissionId + ":unclear" }]
  ];
  sendText(chatId, "Выберите причину отказа:\n\n" + Object.keys(reasons).map(function (key) {
    return "• " + reasons[key];
  }).join("\n"), keyboard);
}

function rejectSubmission(chatId, userId, submissionId, stage, reasonKey) {
  const expectedStatus = stage === "mod" ? "pending_moderation"
    : stage === "admin" ? "pending_admin" : "";
  const nextStatus = stage === "mod" ? "rejected_moderation" : "rejected_admin";
  const reasons = rejectionReasonLabels();
  const reason = reasons[reasonKey];
  if (!expectedStatus || !reason
    || !canRejectAtStage(isAdmin(userId), isSeniorModerator(userId), isModerator(userId), stage)) {
    return sendText(chatId, "Нет доступа или неизвестная причина отказа.");
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  let item = null;
  try {
    item = getSubmission(submissionId);
    if (item && item.status === expectedStatus) {
      item.status = nextStatus;
      item.rejectionReason = reason;
      item.rejectedAt = new Date().toISOString();
      item.rejectedBy = String(userId);
      PROP.setProperty("submission_" + submissionId, JSON.stringify(item));
    } else {
      item = null;
    }
  } finally {
    lock.releaseLock();
  }
  if (!item) return sendText(chatId, "Новость уже обработана.");
  auditEvent("submission_rejected", userId, submissionId, reason);
  sendText(chatId, "Новость отклонена. Причина: " + escapeHtml(reason));
  try {
    sendText(item.userId, "<b>Новость отклонена</b>\nПричина: " + escapeHtml(reason) + "\nВы можете подать апелляцию через /mynews.");
  } catch (error) {
    console.error("Rejection notification failed: " + error);
  }
}

function reviewAsModerator(chatId, userId, id, accepted) {
  if (!isStaff(userId)) return sendText(chatId, "Нет доступа к проверке.");
  if (!accepted) return showRejectionReasons(chatId, userId, id, "mod");
  const item = transitionSubmission(id, "pending_moderation", "pending_admin");
  if (!item) return sendText(chatId, "Эта новость уже проверена другим модератором.");
  sendText(chatId, "Проверка текста пройдена. Новость отправлена администратору на оценку.");
  notifyReviewers(item, "pending_admin");
}

function reviewAsAdmin(chatId, userId, id, accepted) {
  if (!isAdmin(userId) && !isSeniorModerator(userId)) {
    return sendText(chatId, "Только старший модератор или администратор может принять это решение.");
  }
  if (!accepted) return showRejectionReasons(chatId, userId, id, "admin");
  const item = getSubmission(id);
  if (!item || item.status !== "pending_admin") return sendText(chatId, "Эта новость уже проверена или недоступна.");
  return publishSubmission(chatId, userId, id, "pending_admin", null);
}

function reviewAsSeniorModerator(chatId, userId, id) {
  if (!isAdmin(userId) && !isSeniorModerator(userId)) {
    return sendText(chatId, "Только старший модератор или администратор может публиковать напрямую.");
  }
  return publishSubmission(chatId, userId, id, "pending_moderation", null);
}

function publishSubmission(chatId, userId, id, expectedStatus, replacementText) {
  if (!canPublishDirectly(isAdmin(userId), isSeniorModerator(userId))) {
    return sendText(chatId, "Нет прав для прямой публикации.");
  }
  if (!canPublish(isPublishingPaused())) {
    return sendText(chatId, "Публикации в канал временно заморожены. Новость осталась в очереди.");
  }
  const destination = PROP.getProperty("DESTINATION_CHAT_ID");
  if (!isValidDestination(destination)) return sendText(chatId, "Не настроен корректный DESTINATION_CHAT_ID.");
  const claimed = transitionSubmissionWithText(id, expectedStatus, "publishing", replacementText);
  if (!claimed) return sendText(chatId, "Эта новость уже обрабатывается.");
  try {
    sendSubmissionToChannel(destination, claimed);
  } catch (error) {
    transitionSubmission(id, "publishing", expectedStatus);
    console.error(error);
    sendText(chatId, "Не удалось отправить новость в чат. Проверьте ID чата и права бота.");
    return;
  }
  transitionSubmission(id, "publishing", "published");
  auditEvent("news_published", userId, id, "Новость опубликована напрямую в " + destination);
  sendText(chatId, "Новость опубликована в канал.");
  try { sendText(claimed.userId, "Ваша новость опубликована. Спасибо!"); }
  catch (error) { console.error("Author notification failed: " + error); }
}

function hireModerator(chatId, adminId, targetId) {
  if (String(adminId) === targetId || isAdmin(targetId) || isSeniorModerator(targetId)) {
    clearFlow(adminId);
    return sendText(chatId, "Администраторов и старших модераторов нельзя назначить обычными модераторами.");
  }
  PROP.setProperty("moderator_" + targetId, "1");
  PROP.deleteProperty("moderator_owner_" + targetId);
  clearFlow(adminId);
  sendText(chatId, "Пользователь " + targetId + " назначен модератором.");
  sendText(targetId, "Вам выданы права модератора предложки ETNFaceit. Панель: /moder");
}

function fireModerator(chatId, adminId, targetId) {
  if (isAdmin(targetId)) {
    clearFlow(adminId);
    return sendText(chatId, "Нельзя снять права администратора этим действием.");
  }
  const existed = PROP.getProperty("moderator_" + targetId);
  PROP.deleteProperty("moderator_" + targetId);
  PROP.deleteProperty("moderator_owner_" + targetId);
  clearFlow(adminId);
  sendText(chatId, existed ? "Права модератора сняты у " + targetId + "." : "Этот пользователь не был модератором.");
}

function hireSeniorModerator(chatId, adminId, targetId) {
  if (!isValidTelegramId(targetId) || isAdmin(targetId)) {
    clearFlow(adminId);
    return sendText(chatId, "Укажите корректный Telegram ID не-администратора.");
  }
  const seniorIds = getSeniorModeratorIds();
  if (seniorIds.indexOf(String(targetId)) !== -1) {
    clearFlow(adminId);
    return sendText(chatId, "Этот пользователь уже старший модератор.");
  }
  seniorIds.push(String(targetId));
  saveSeniorModeratorIds(seniorIds);
  PROP.deleteProperty("moderator_" + targetId);
  PROP.deleteProperty("moderator_owner_" + targetId);
  clearFlow(adminId);
  auditEvent("senior_moderator_hired", adminId, targetId, "Назначен старший модератор.");
  sendText(chatId, "Пользователь " + targetId + " назначен старшим модератором.");
  try { sendText(targetId, "Вам выданы права старшего модератора ETNFaceit. Панель: /moder"); }
  catch (error) { console.error("Senior moderator notification failed: " + error); }
}

function fireSeniorModerator(chatId, adminId, targetId) {
  const seniorIds = getSeniorModeratorIds();
  if (seniorIds.indexOf(String(targetId)) === -1) {
    clearFlow(adminId);
    return sendText(chatId, "Этот пользователь не является старшим модератором.");
  }
  saveSeniorModeratorIds(seniorIds.filter(function (id) { return id !== String(targetId); }));
  const helpers = getModeratorIds().filter(function (id) {
    return PROP.getProperty("moderator_owner_" + id) === String(targetId);
  });
  helpers.forEach(function (id) {
    PROP.deleteProperty("moderator_" + id);
    PROP.deleteProperty("moderator_owner_" + id);
  });
  clearFlow(adminId);
  auditEvent("senior_moderator_fired", adminId, targetId, "Снята роль старшего; сняты помощники: " + helpers.length + ".");
  sendText(chatId, "Права старшего модератора сняты. Помощников снято: " + helpers.length + ".");
  try { sendText(targetId, "Ваши права старшего модератора ETNFaceit сняты."); }
  catch (error) { console.error("Senior moderator removal notification failed: " + error); }
}

function hireHelper(chatId, seniorId, targetId) {
  if (!isValidTelegramId(targetId) || String(seniorId) === String(targetId)
    || isAdmin(targetId) || isSeniorModerator(targetId)) {
    clearFlow(seniorId);
    return sendText(chatId, "Укажите корректный ID пользователя, который не имеет старшей роли.");
  }
  if (isModerator(targetId)) {
    clearFlow(seniorId);
    return sendText(chatId, "Этот пользователь уже модератор.");
  }
  PROP.setProperty("moderator_" + targetId, "1");
  PROP.setProperty("moderator_owner_" + targetId, String(seniorId));
  clearFlow(seniorId);
  auditEvent("helper_hired", seniorId, targetId, "Назначен помощник старшего модератора.");
  sendText(chatId, "Пользователь " + targetId + " назначен вашим модератором-помощником.");
  try { sendText(targetId, "Вам выданы права модератора-помощника ETNFaceit. Панель: /moder"); }
  catch (error) { console.error("Helper notification failed: " + error); }
}

function fireHelper(chatId, seniorId, targetId) {
  if (PROP.getProperty("moderator_owner_" + targetId) !== String(seniorId)) {
    clearFlow(seniorId);
    return sendText(chatId, "Этот пользователь не является вашим помощником.");
  }
  PROP.deleteProperty("moderator_" + targetId);
  PROP.deleteProperty("moderator_owner_" + targetId);
  clearFlow(seniorId);
  auditEvent("helper_fired", seniorId, targetId, "Снят модератор-помощник.");
  sendText(chatId, "Права модератора-помощника сняты у " + targetId + ".");
  try { sendText(targetId, "Ваши права модератора-помощника ETNFaceit сняты."); }
  catch (error) { console.error("Helper removal notification failed: " + error); }
}

function hireAdmin(chatId, actingAdminId, targetId) {
  if (!isValidTelegramId(targetId)) {
    clearFlow(actingAdminId);
    return sendText(chatId, "Нужен числовой Telegram ID.");
  }
  const admins = getAdminIds();
  if (admins.indexOf(String(targetId)) !== -1) {
    clearFlow(actingAdminId);
    return sendText(chatId, "Этот пользователь уже администратор.");
  }
  admins.push(String(targetId));
  saveAdminIds(admins);
  PROP.deleteProperty("banned_" + targetId);
  clearFlow(actingAdminId);
  auditEvent("admin_hired", actingAdminId, targetId, "Выданы права администратора из панели.");
  sendText(chatId, "Пользователю " + targetId + " выданы права администратора.");
  try { sendText(targetId, "Вам выданы права администратора ETNFaceit. Панель: /admins"); }
  catch (error) { console.error("Admin notification failed: " + error); }
}

function fireAdmin(chatId, actingAdminId, targetId) {
  const admins = getAdminIds();
  const removalError = getAdminRemovalError(admins, actingAdminId, targetId);
  if (removalError) {
    clearFlow(actingAdminId);
    const messages = {
      self: "Нельзя снять админку у самого себя.",
      missing: "Этот пользователь не является администратором.",
      last: "Нельзя снять права у последнего администратора."
    };
    return sendText(chatId, messages[removalError]);
  }
  saveAdminIds(admins.filter(function (id) { return id !== String(targetId); }));
  clearFlow(actingAdminId);
  auditEvent("admin_fired", actingAdminId, targetId, "Сняты права администратора из панели.");
  sendText(chatId, "Права администратора сняты у " + targetId + ".");
  try { sendText(targetId, "Ваши права администратора ETNFaceit сняты."); }
  catch (error) { console.error("Admin removal notification failed: " + error); }
}

function toggleMaintenance(chatId, adminId) {
  const enabled = !isMaintenanceEnabled();
  PROP.setProperty("MAINTENANCE_MODE", enabled ? "1" : "0");
  const notice = maintenanceMessage(enabled);
  const recipients = getKnownUserIds();
  let delivered = 0;
  let failed = 0;
  recipients.forEach(function (userId) {
    try {
      sendText(userId, notice);
      delivered++;
    } catch (error) {
      failed++;
      console.error("Maintenance notice failed for " + userId + ": " + error);
    }
  });
  auditEvent("maintenance_toggled", adminId, "", "Режим " + (enabled ? "включен" : "выключен") + ".");
  sendText(chatId, "Техработы " + (enabled ? "включены" : "выключены")
    + ". Уведомлено: " + delivered + "; ошибок доставки: " + failed + ".");
}

function getKnownUserIds() {
  const properties = PROP.getProperties();
  return Object.keys(properties).filter(function (key) {
    return key.indexOf("seen_") === 0;
  }).map(function (key) { return key.slice(5); });
}

function isMaintenanceEnabled() {
  return PROP.getProperty("MAINTENANCE_MODE") === "1";
}

function isStaff(userId) {
  return isAdmin(userId) || isSeniorModerator(userId) || isModerator(userId);
}

function canPublishDirectly(adminUser, seniorUser) {
  return Boolean(adminUser || seniorUser);
}

function reviewerEditConfirmation(adminUser, seniorUser) {
  return canPublishDirectly(adminUser, seniorUser)
    ? "Уверены, что хотите отправить эту версию в канал?"
    : "Передать эту отредактированную новость администратору?";
}

function shouldBlockForMaintenance(enabled, staff) {
  return Boolean(enabled && !staff);
}

function getAdminRemovalError(adminIds, actingAdminId, targetId) {
  const admins = adminIds.map(String);
  if (String(actingAdminId) === String(targetId)) return "self";
  if (admins.indexOf(String(targetId)) === -1) return "missing";
  if (admins.length <= 1) return "last";
  return "";
}

function maintenanceMessage(enabled) {
  if (enabled === false) return "Технические работы завершены. Бот снова работает, можете отправлять новости.";
  return "Технический перерыв: заливается обновление. Попробуйте воспользоваться ботом немного позже.";
}

function isSubmissionsPaused() {
  return PROP.getProperty("SUBMISSIONS_PAUSED") === "1";
}

function isPublishingPaused() {
  return PROP.getProperty("PUBLISHING_PAUSED") === "1";
}

function canAcceptSubmissions(paused) {
  return !paused;
}

function canPublish(paused) {
  return !paused;
}

function toggleSubmissionPause(chatId, adminId) {
  const paused = !isSubmissionsPaused();
  PROP.setProperty("SUBMISSIONS_PAUSED", paused ? "1" : "0");
  auditEvent("submission_intake_toggled", adminId, "", paused ? "Приём приостановлен." : "Приём возобновлен.");
  sendText(chatId, paused
    ? "Приём новых заявок остановлен. Уже созданные новости остаются в очереди."
    : "Приём новых заявок возобновлён.");
}

function togglePublishingPause(chatId, adminId) {
  const paused = !isPublishingPaused();
  PROP.setProperty("PUBLISHING_PAUSED", paused ? "1" : "0");
  auditEvent("publishing_toggled", adminId, "", paused ? "Публикации заморожены." : "Публикации возобновлены.");
  sendText(chatId, paused
    ? "Публикации в канал заморожены. Очереди и проверки продолжают работать."
    : "Публикации в канал возобновлены.");
}

function showQueueSummary(chatId, adminId) {
  if (!isAdmin(adminId)) return sendText(chatId, "Действие доступно только администраторам.");
  const statuses = ["pending_moderation", "pending_admin", "pending_appeal"];
  const counts = {};
  statuses.forEach(function (status) { counts[status] = getSubmissions(status); });
  const oldest = counts.pending_moderation.concat(counts.pending_admin)
    .sort(function (a, b) { return a.createdAt < b.createdAt ? -1 : 1; })[0];
  const text = "<b>Сводка очередей</b>\n"
    + "Модерация: " + counts.pending_moderation.length + "\n"
    + "Публикация: " + counts.pending_admin.length + "\n"
    + "Апелляции: " + counts.pending_appeal.length + "\n"
    + "Приём: " + (isSubmissionsPaused() ? "приостановлен" : "работает") + "\n"
    + "Публикации: " + (isPublishingPaused() ? "заморожены" : "работают") + "\n"
    + "Старейшая открытая заявка: " + (oldest ? formatDate(oldest.createdAt) : "нет");
  sendText(chatId, text);
}

function sendStaffAlert(chatId, adminId, message) {
  const staffIds = getAdminIds().concat(getSeniorModeratorIds(), getModeratorIds())
    .map(String).filter(function (id, index, ids) { return ids.indexOf(id) === index; });
  let delivered = 0;
  let failed = 0;
  const text = "<b>Срочный сигнал от администратора</b>\n\n" + escapeHtml(message);
  staffIds.forEach(function (staffId) {
    try { sendText(staffId, text); delivered++; }
    catch (error) { failed++; console.error("Staff alert failed for " + staffId + ": " + error); }
  });
  auditEvent("staff_alert_sent", adminId, "", "Доставлено: " + delivered + "; ошибок: " + failed + ".");
  sendText(chatId, "Сигнал отправлен команде. Доставлено: " + delivered + "; ошибок: " + failed + ".");
}

function showBotHealth(chatId, adminId) {
  if (!isAdmin(adminId)) return sendText(chatId, "Действие доступно только администраторам.");
  let webhookLine = "Webhook: ошибка запроса";
  try {
    const result = telegramRequest_("getWebhookInfo", {}).result || {};
    webhookLine = "Webhook: " + (result.url ? "установлен" : "не установлен")
      + "; ожидает: " + Number(result.pending_update_count || 0);
    if (result.last_error_message) webhookLine += "\nПоследняя ошибка: " + escapeHtml(result.last_error_message).slice(0, 300);
  } catch (error) {
    webhookLine += " (" + escapeHtml(String(error).slice(0, 200)) + ")";
  }
  const text = "<b>Проверка бота</b>\n"
    + webhookLine + "\n"
    + "Токен: " + (PROP.getProperty("BOT_TOKEN") ? "задан" : "не задан") + "\n"
    + "Канал: " + (isValidDestination(PROP.getProperty("DESTINATION_CHAT_ID")) ? "настроен" : "не настроен") + "\n"
    + "Старших модераторов: " + getSeniorModeratorIds().length + "\n"
    + "Помощников-модераторов: " + getModeratorIds().length;
  sendText(chatId, text);
}

function banUser(chatId, adminId, targetId, reason) {
  if (isAdmin(targetId)) {
    clearFlow(adminId);
    return sendText(chatId, "Нельзя забанить администратора.");
  }
  PROP.setProperty("banned_" + targetId, "1");
  PROP.deleteProperty("moderator_" + targetId);
  auditEvent("user_banned", adminId, targetId, reason);
  clearFlow(adminId);
  sendText(chatId, "Пользователь " + targetId + " забанен.");
  sendText(targetId, "Вы забанены в предложке. Причина: " + escapeHtml(reason));
}

function warnUser(chatId, adminId, targetId) {
  if (isAdmin(targetId)) {
    clearFlow(adminId);
    return sendText(chatId, "Нельзя выдать варн администратору.");
  }
  const key = "warns_" + targetId;
  const warns = Number(PROP.getProperty(key) || 0) + 1;
  PROP.setProperty(key, String(warns));
  auditEvent("user_warned", adminId, targetId, "Варн " + warns + "/3.");
  clearFlow(adminId);
  if (warns >= 3) return banUser(chatId, adminId, targetId, "Автоматический бан после 3 варнов.");
  sendText(chatId, "Варн выдан. Сейчас у пользователя " + warns + "/3.");
  sendText(targetId, "Вам выдан варн за нарушение правил. Варнов: " + warns + "/3. После третьего варна выдается бан.");
}

function broadcastMessage(adminId, text) {
  const properties = PROP.getProperties();
  const recipients = Object.keys(properties)
    .filter(function (key) { return key.indexOf("seen_") === 0; })
    .map(function (key) { return key.slice(5); });
  const body = "<b>Объявление ETNFaceit</b>\n\n" + escapeHtml(text);
  let delivered = 0;
  let failed = 0;
  recipients.forEach(function (userId) {
    try {
      sendText(userId, body);
      delivered++;
    } catch (error) {
      failed++;
      console.error("Broadcast failed for " + userId + ": " + error);
    }
  });
  auditEvent("broadcast_sent", adminId, "", "Доставлено: " + delivered + "; ошибок: " + failed + ".");
  sendText(adminId, "Рассылка завершена. Доставлено: " + delivered + ", не доставлено: " + failed + ".");
}

function notifyReviewers(item, status) {
  const ids = status === "pending_admin" ? getAdminIds()
    : getModeratorNotificationIds(getModeratorIds().concat(getSeniorModeratorIds()), getAdminIds());
  const callbackPrefix = status === "pending_admin" ? "view_admin:" : "view_mod:";
  const label = status === "pending_admin" ? "Проверить новость" : "Открыть очередь модерации";
  ids.forEach(function (id) {
    try {
      sendSubmissionReview(id, item, status, [[{ text: label, callback_data: callbackPrefix + item.id }]]);
    } catch (error) {
      console.error("Reviewer notification failed for " + id + ": " + error);
    }
  });
}

function formatSubmission(item, status) {
  const needsProfile = !item.firstName || !item.username || item.username === "не указан";
  const profile = needsProfile ? getUserProfile(item.userId) || {} : {};
  const firstName = item.firstName || profile.firstName || "не указан";
  const usernameValue = item.username && item.username !== "не указан" ? item.username : profile.username;
  const username = usernameValue ? "@" + usernameValue : "не указан (username не задан)";
  const body = item.text ? escapeHtml(item.text)
    : item.media ? "<i>Медиа без подписи</i>" : "<i>Текст не указан</i>";
  const stage = status === "pending_admin" ? "Оценка достоверности и пользы"
    : status === "pending_appeal" ? "Рассмотрение апелляции" : "Проверка текста и правил";
  return "<b>Новость на проверке: " + escapeHtml(stage) + "</b>\n"
    + "Отправитель: " + escapeHtml(firstName) + "\n"
    + "Telegram ID: <code>" + escapeHtml(item.userId === undefined ? "не указан" : item.userId) + "</code>\n"
    + "Username: " + escapeHtml(username) + "\n\n"
    + body
    + (status === "pending_appeal" ? "\n\n<b>Пояснение автора:</b>\n" + escapeHtml(item.appealText || "") : "");
}

function getSubmissions(status) {
  const properties = PROP.getProperties();
  return Object.keys(properties).filter(function (key) {
    return key.indexOf("submission_") === 0;
  }).map(function (key) {
    try { return JSON.parse(properties[key]); } catch (error) { return null; }
  }).filter(function (item) {
    return item && item.status === status;
  }).sort(function (a, b) { return a.createdAt < b.createdAt ? -1 : 1; });
}

function getSubmission(id) {
  const value = PROP.getProperty("submission_" + id);
  if (!value) return null;
  try { return JSON.parse(value); } catch (error) { return null; }
}

function transitionSubmission(id, expectedStatus, nextStatus) {
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    const item = getSubmission(id);
    if (!item || item.status !== expectedStatus) return null;
    item.status = nextStatus;
    PROP.setProperty("submission_" + id, JSON.stringify(item));
    return item;
  } finally {
    lock.releaseLock();
  }
}

function transitionSubmissionWithText(id, expectedStatus, nextStatus, replacementText) {
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    const item = getSubmission(id);
    if (!item || item.status !== expectedStatus) return null;
    if (typeof replacementText === "string") {
      item.text = replacementText;
      item.editedAt = new Date().toISOString();
      item.version = Number(item.version || 1) + 1;
    }
    item.status = nextStatus;
    PROP.setProperty("submission_" + id, JSON.stringify(item));
    return item;
  } finally {
    lock.releaseLock();
  }
}

function rememberUser(userOrId) {
  const isObject = userOrId && typeof userOrId === "object";
  const userId = isObject ? userOrId.id : userOrId;
  PROP.setProperty("seen_" + userId, "1");
  if (!isObject) return;
  const previous = getUserProfile(userId) || {};
  const profile = {
    id: String(userId),
    firstName: userOrId.first_name || previous.firstName || "",
    lastName: userOrId.last_name || previous.lastName || "",
    username: userOrId.username || previous.username || "",
    firstSeen: previous.firstSeen || new Date().toISOString(),
    lastSeen: new Date().toISOString()
  };
  PROP.setProperty("user_profile_" + userId, JSON.stringify(profile));
}

function getAdminIds() {
  return parseAdminIds(PROP.getProperty("ADMIN_IDS") || "");
}

function saveAdminIds(adminIds) {
  PROP.setProperty("ADMIN_IDS", parseAdminIds(adminIds.join(",")).join(","));
}

function parseAdminIds(value) {
  const ids = String(value).split(/[\s,]+/).filter(isValidTelegramId);
  return ids.filter(function (id, index) { return ids.indexOf(id) === index; });
}

function isValidTelegramId(value) {
  return /^\d{1,20}$/.test(String(value));
}

function isValidDestination(value) {
  return /^(?:-?\d{1,20}|@[A-Za-z0-9_]{5,})$/.test(String(value));
}

function isValidWebhookUrl(value) {
  return /^https:\/\/[^\s/?#]+(?:\/[^\s?#]*)?(?:\?[^\s#]*)?$/.test(String(value).trim());
}

function canAccessQueue(isAdminUser, isModeratorUser, status, isSeniorUser) {
  if (status === "pending_appeal") return Boolean(isAdminUser);
  if (status === "pending_admin") return Boolean(isAdminUser || isSeniorUser);
  if (status === "pending_moderation") return Boolean(isAdminUser || isSeniorUser || isModeratorUser);
  return false;
}

function isAdmin(userId) {
  return getAdminIds().indexOf(String(userId)) !== -1;
}

function isModerator(userId) {
  return PROP.getProperty("moderator_" + userId) === "1" && !isAdmin(userId) && !isSeniorModerator(userId);
}

function isSeniorModerator(userId) {
  return getSeniorModeratorIds().indexOf(String(userId)) !== -1;
}

function isBanned(userId) {
  return PROP.getProperty("banned_" + userId) === "1";
}

function setFlow(userId, flow) {
  PROP.setProperty("flow_" + userId, JSON.stringify(flow));
}

function getFlow(userId) {
  const value = PROP.getProperty("flow_" + userId);
  if (!value) return null;
  try { return JSON.parse(value); } catch (error) { return null; }
}

function clearFlow(userId) {
  PROP.deleteProperty("flow_" + userId);
}

function decoratePublicMessage(text, isPublicUser) {
  const message = String(text);
  if (!isPublicUser) return message;
  const heading = message.split(/\r?\n/, 1)[0].replace(/<[^>]*>/g, "").toLowerCase().trim();
  let emoji = "🎮";
  if (/техничес|обновлен|перерыв/.test(heading)) emoji = "🚧";
  else if (/добро пожаловать/.test(heading)) emoji = "🏁";
  else if (/правил/.test(heading)) emoji = "📚";
  else if (/провер|модерац|администратор/.test(heading)) emoji = "🔎";
  else if (/публикац|опублик|одобрен/.test(heading)) emoji = "📣";
  else if (/отклон|не найден|нельзя|ошиб|ограничен|забан|варн/.test(heading)) emoji = "🚫";
  else if (/отправьте|напишите|пришлите/.test(heading)) emoji = "📝";
  else if (/новост/.test(heading)) emoji = "🗞️";
  return emoji + " " + message;
}

function answerCallback(callbackId) {
  telegramRequest_("answerCallbackQuery", { callback_query_id: callbackId });
}

function sendText(chatId, text, keyboard) {
  const publicUserChat = /^\d+$/.test(String(chatId)) && !isAdmin(chatId) && !isModerator(chatId);
  const payload = {
    chat_id: chatId,
    text: decoratePublicMessage(text, publicUserChat),
    parse_mode: "HTML",
    disable_web_page_preview: true
  };
  if (keyboard) payload.reply_markup = { inline_keyboard: keyboard };
  return telegramRequest_("sendMessage", payload);
}

function telegramRequest_(method, payload) {
  if (typeof method !== "string" || !method) {
    throw new Error("Не указан метод Telegram API. Запускайте configureWebhook, а не внутреннюю функцию запроса.");
  }
  const token = PROP.getProperty("BOT_TOKEN");
  if (!token) throw new Error("Укажите BOT_TOKEN в свойствах скрипта.");
  const response = UrlFetchApp.fetch(BOT_API + token + "/" + method, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  const result = JSON.parse(response.getContentText());
  if (!result.ok) throw new Error("Telegram API " + method + ": " + result.description);
  return result;
}

function configureWebhook() {
  const webAppUrl = WEB_APP_URL.trim();
  if (!isValidWebhookUrl(webAppUrl)) {
    throw new Error("Вставьте публичный HTTPS URL Cloudflare в WEB_APP_URL в начале файла.");
  }
  const result = telegramRequest_("setWebhook", { url: webAppUrl });
  Logger.log("Webhook установлен: " + webAppUrl);
  return result;
}

function showWebhookInfo() {
  const result = telegramRequest_("getWebhookInfo", {});
  Logger.log(JSON.stringify(result.result, null, 2));
  return result.result;
}

function escapeHtml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function runSelfTests() {
  const cases = [
    {
      name: "HTML special characters are escaped",
      run: function () {
        assertSelfTestEqual(
          escapeHtml("<tag attr=\"x\">&"),
          "&lt;tag attr=&quot;x&quot;&gt;&amp;"
        );
      }
    },
    {
      name: "HTML escaping preserves ordinary text",
      run: function () {
        assertSelfTestEqual(escapeHtml("FACEIT ETN 123"), "FACEIT ETN 123");
      }
    },
    {
      name: "Telegram numeric ID is accepted",
      run: function () {
        assertSelfTestTrue(isValidTelegramId("123456789"));
      }
    },
    {
      name: "Telegram ID rejects signs and spaces",
      run: function () {
        assertSelfTestFalse(isValidTelegramId("-123"));
        assertSelfTestFalse(isValidTelegramId("12 34"));
      }
    },
    {
      name: "Telegram ID rejects empty and non-numeric values",
      run: function () {
        assertSelfTestFalse(isValidTelegramId(""));
        assertSelfTestFalse(isValidTelegramId("user123"));
      }
    },
    {
      name: "Numeric destination chat is accepted",
      run: function () {
        assertSelfTestTrue(isValidDestination("-1001234567890"));
        assertSelfTestTrue(isValidDestination("123456789"));
      }
    },
    {
      name: "Public Telegram channel name is accepted",
      run: function () {
        assertSelfTestTrue(isValidDestination("@ETNFaceitNews"));
      }
    },
    {
      name: "Invalid destination chat values are rejected",
      run: function () {
        assertSelfTestFalse(isValidDestination("https://t.me/channel"));
        assertSelfTestFalse(isValidDestination("@ab"));
        assertSelfTestFalse(isValidDestination("-100 chat"));
      }
    },
    {
      name: "Public HTTPS webhook URLs are accepted",
      run: function () {
        assertSelfTestTrue(isValidWebhookUrl("https://script.google.com/macros/s/AbCdEf_123-xyz/exec"));
        assertSelfTestTrue(isValidWebhookUrl("https://etnfaceit.example.workers.dev/telegram/hook?key=abc123"));
      }
    },
    {
      name: "Non-HTTPS and malformed webhook URLs are rejected",
      run: function () {
        assertSelfTestFalse(isValidWebhookUrl("http://worker.example/hook"));
        assertSelfTestFalse(isValidWebhookUrl("ftp://worker.example/hook"));
        assertSelfTestFalse(isValidWebhookUrl("not-a-url"));
      }
    },
    {
      name: "Photo, video and document attachments are extracted",
      run: function () {
        assertSelfTestArrayEqual(
          extractSubmissionMedia({ photo: [{ file_id: "small" }, { file_id: "large" }] }),
          { type: "photo", fileId: "large" }
        );
        assertSelfTestArrayEqual(extractSubmissionMedia({ video: { file_id: "video-id" } }),
          { type: "video", fileId: "video-id" });
        assertSelfTestArrayEqual(extractSubmissionMedia({ document: { file_id: "doc-id" } }),
          { type: "document", fileId: "doc-id" });
        assertSelfTestEqual(extractSubmissionMedia({ sticker: { file_id: "sticker-id" } }), null);
      }
    },
    {
      name: "Admin IDs are parsed and deduplicated",
      run: function () {
        assertSelfTestArrayEqual(parseAdminIds("123, 456\n123 invalid"), ["123", "456"]);
      }
    },
    {
      name: "Admin ID parser handles an empty value",
      run: function () {
        assertSelfTestArrayEqual(parseAdminIds(""), []);
      }
    },
    {
      name: "Admin can access every review queue",
      run: function () {
        assertSelfTestTrue(canAccessQueue(true, false, "pending_moderation"));
        assertSelfTestTrue(canAccessQueue(true, false, "pending_admin"));
        assertSelfTestTrue(canAccessQueue(true, false, "pending_appeal"));
      }
    },
    {
      name: "Moderator can only access the moderation queue",
      run: function () {
        assertSelfTestTrue(canAccessQueue(false, true, "pending_moderation"));
        assertSelfTestFalse(canAccessQueue(false, true, "pending_admin"));
        assertSelfTestFalse(canAccessQueue(false, true, "pending_appeal"));
      }
    },
    {
      name: "Rejection permissions follow the review stage",
      run: function () {
        assertSelfTestTrue(canRejectAtStage(false, false, true, "mod"));
        assertSelfTestFalse(canRejectAtStage(false, false, true, "admin"));
        assertSelfTestTrue(canRejectAtStage(false, true, false, "admin"));
        assertSelfTestEqual(rejectionReasonLabels().offtopic, "Новость не относится к ETNFaceit.");
      }
    },
    {
      name: "Senior moderator can publish but cannot resolve appeals",
      run: function () {
        assertSelfTestTrue(canAccessQueue(false, false, "pending_moderation", true));
        assertSelfTestTrue(canAccessQueue(false, false, "pending_admin", true));
        assertSelfTestFalse(canAccessQueue(false, false, "pending_appeal", true));
        assertSelfTestFalse(canAccessQueue(false, true, "pending_admin", false));
      }
    },
    {
      name: "Only admins and senior moderators publish directly",
      run: function () {
        assertSelfTestTrue(canPublishDirectly(true, false));
        assertSelfTestTrue(canPublishDirectly(false, true));
        assertSelfTestFalse(canPublishDirectly(false, false));
      }
    },
    {
      name: "Edit confirmation text follows the reviewer's role",
      run: function () {
        assertSelfTestTrue(reviewerEditConfirmation(false, false).indexOf("администратору") !== -1);
        assertSelfTestTrue(reviewerEditConfirmation(false, true).indexOf("в канал") !== -1);
        assertSelfTestTrue(reviewerEditConfirmation(true, false).indexOf("в канал") !== -1);
      }
    },
    {
      name: "Ordinary user cannot access review queues",
      run: function () {
        assertSelfTestFalse(canAccessQueue(false, false, "pending_moderation"));
        assertSelfTestFalse(canAccessQueue(false, false, "pending_admin"));
      }
    },
    {
      name: "Unknown queue status is denied",
      run: function () {
        assertSelfTestFalse(canAccessQueue(true, true, "published"));
        assertSelfTestFalse(canAccessQueue(true, true, "anything"));
      }
    },
    {
      name: "Maintenance blocks users but not staff",
      run: function () {
        assertSelfTestTrue(shouldBlockForMaintenance(true, false));
        assertSelfTestFalse(shouldBlockForMaintenance(true, true));
        assertSelfTestFalse(shouldBlockForMaintenance(false, false));
      }
    },
    {
      name: "Submission and publishing pauses are independent",
      run: function () {
        assertSelfTestFalse(canAcceptSubmissions(true));
        assertSelfTestTrue(canAcceptSubmissions(false));
        assertSelfTestFalse(canPublish(true));
        assertSelfTestTrue(canPublish(false));
      }
    },
    {
      name: "Admin removal protects self and last admin",
      run: function () {
        assertSelfTestEqual(getAdminRemovalError(["1"], "1", "1"), "self");
        assertSelfTestEqual(getAdminRemovalError(["1"], "2", "1"), "last");
        assertSelfTestEqual(getAdminRemovalError(["1"], "1", "2"), "missing");
        assertSelfTestEqual(getAdminRemovalError(["1", "2"], "1", "2"), "");
      }
    },
    {
      name: "Public messages receive visual emoji decoration",
      run: function () {
        assertSelfTestTrue(decoratePublicMessage("Добро пожаловать в предложку", true).indexOf("🏁 ") === 0);
        assertSelfTestTrue(decoratePublicMessage("Технический перерыв", true).indexOf("🚧 ") === 0);
        assertSelfTestTrue(decoratePublicMessage("Отклонено", true).indexOf("🚫 ") === 0);
        assertSelfTestTrue(decoratePublicMessage("<b>Правила предложки</b>\nНовости ETN", true).indexOf("📚 ") === 0);
        assertSelfTestTrue(decoratePublicMessage("Новость опубликована", true).indexOf("📣 ") === 0);
        assertSelfTestEqual(decoratePublicMessage("Панель администратора", false), "Панель администратора");
      }
    },
    {
      name: "Known submission statuses have readable labels",
      run: function () {
        assertSelfTestEqual(submissionStatusLabel("pending_moderation"), "На проверке у модератора");
        assertSelfTestEqual(submissionStatusLabel("published"), "Опубликована");
      }
    },
    {
      name: "Admins are excluded from first-stage moderator notifications",
      run: function () {
        assertSelfTestArrayEqual(
          getModeratorNotificationIds(["101", "202", "303"], ["202", "404"]),
          ["101", "303"]
        );
      }
    },
    {
      name: "Submission card includes sender ID and username",
      run: function () {
        const card = formatSubmission({
          userId: 12345,
          firstName: "Игрок",
          username: "faceit_player",
          text: "Тестовая новость"
        }, "pending_moderation");
        assertSelfTestTrue(card.indexOf("<code>12345</code>") !== -1);
        assertSelfTestTrue(card.indexOf("@faceit_player") !== -1);
        assertSelfTestTrue(card.indexOf("Игрок") !== -1);
      }
    },
    {
      name: "Audit filter searches actions, users, targets and dates",
      run: function () {
        const entries = [
          { id: "a", action: "news_published", actorId: "10", targetId: "story-1", details: "Channel post", at: "2026-11-02T12:00:00Z" },
          { id: "b", action: "user_warned", actorId: "20", targetId: "10", details: "Warn 1/3", at: "2026-11-01T12:00:00Z" }
        ];
        assertSelfTestEqual(filterAuditEntries(entries, "action:published")[0].id, "a");
        assertSelfTestEqual(filterAuditEntries(entries, "user:10").length, 2);
        assertSelfTestEqual(filterAuditEntries(entries, "target:story-1")[0].id, "a");
        assertSelfTestEqual(filterAuditEntries(entries, "date:2026-11-02")[0].id, "a");
        assertSelfTestEqual(filterAuditEntries(entries, "channel")[0].id, "a");
      }
    },
    {
      name: "Submission card explains media without a caption",
      run: function () {
        const card = formatSubmission({
          id: "media-1",
          userId: 12345,
          firstName: "Игрок",
          username: "faceit_player",
          text: "",
          media: { type: "photo", fileId: "photo-id" }
        }, "pending_moderation");
        assertSelfTestTrue(card.indexOf("Медиа без подписи") !== -1);
      }
    },
    {
      name: "Unknown submission status has a safe fallback",
      run: function () {
        assertSelfTestEqual(submissionStatusLabel("unexpected"), "Статус неизвестен");
      }
    }
  ];

  const results = [];
  cases.forEach(function (testCase) {
    try {
      testCase.run();
      results.push({ name: testCase.name, passed: true });
    } catch (error) {
      results.push({ name: testCase.name, passed: false, error: String(error) });
    }
  });

  const failures = results.filter(function (result) { return !result.passed; });
  results.forEach(function (result) {
    const message = (result.passed ? "PASS " : "FAIL ") + result.name;
    if (result.error) Logger.log(message + ": " + result.error);
    else Logger.log(message);
  });
  Logger.log("Self-tests: " + (results.length - failures.length) + "/" + results.length + " passed.");
  if (failures.length) throw new Error(failures.length + " self-test(s) failed.");
  return { passed: results.length, failed: failures.length };
}

function assertSelfTestTrue(value) {
  if (value !== true) throw new Error("Expected true, got " + String(value));
}

function assertSelfTestFalse(value) {
  if (value !== false) throw new Error("Expected false, got " + String(value));
}

function assertSelfTestEqual(actual, expected) {
  if (actual !== expected) {
    throw new Error("Expected " + JSON.stringify(expected) + ", got " + JSON.stringify(actual));
  }
}

function assertSelfTestArrayEqual(actual, expected) {
  assertSelfTestEqual(JSON.stringify(actual), JSON.stringify(expected));
}