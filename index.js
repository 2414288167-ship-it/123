// 扩展配置（完全遵循官方命名规范）
const defaultSettings = {
  enabled: true,
  // 官方原有闲置配置
  timer: 300, // 基础闲置时间（秒）
  random: false, // 官方随机闲置（±30%）
  maxUses: 5, // 最大触发次数
  // 新增：定时模式配置
  fixedMode: {
    enabled: false,
    times: [{ hour: 8, minute: 30 }, { hour: 18, minute: 0 }] // 每日时间点
  },
  // 新增：随机间隔模式配置
  intervalMode: {
    enabled: false,
    min: 60, // 最小间隔（秒）
    max: 300 // 最大间隔（秒）
  },
  // 官方提示词配置
  prompts: [
    "我们继续聊刚才的话题吧？",
    "有什么新想法吗？",
    "你觉得接下来会发生什么？"
  ],
  // 官方动作配置（复用）
  action: "continue",
  sender: "ai",
  cooldown: 60
};

let extensionSettings = { ...defaultSettings };
let idleTimer = null;
let fixedTimer = null;
let intervalTimer = null;
let useCount = 0;
let lastActivity = Date.now();

// 初始化（官方标准入口）
function setup() {
  loadSettings();
  registerListeners();
  resetAllTimers();
}

// 加载配置（复用官方存储方式）
function loadSettings() {
  const saved = window.app.storage.get("my-auto-ai-message");
  if (saved) extensionSettings = { ...defaultSettings, ...saved };
}

// 保存配置（官方规范）
function saveSettings() {
  window.app.storage.set("idleAutoMessage", extensionSettings);
}

// 注册事件（官方标准监听）
function registerListeners() {
  // 监听用户活动（官方方式）
  document.addEventListener("keydown", resetActivity);
  document.addEventListener("click", resetActivity);
  document.addEventListener("touchstart", resetActivity);
  // 监听对话切换
  window.app.conversations.on("change", resetAllTimers);
}

// 重置用户活动时间（官方逻辑）
function resetActivity() {
  lastActivity = Date.now();
  useCount = 0;
  resetAllTimers();
}

// 重置所有定时器（整合官方+新增逻辑）
function resetAllTimers() {
  if (idleTimer) clearTimeout(idleTimer);
  if (fixedTimer) clearTimeout(fixedTimer);
  if (intervalTimer) clearTimeout(intervalTimer);

  if (!extensionSettings.enabled) return;

  // 启动官方闲置模式
  startIdleMode();
  // 启动新增定时模式
  if (extensionSettings.fixedMode.enabled) startFixedMode();
  // 启动新增随机间隔模式
  if (extensionSettings.intervalMode.enabled) startIntervalMode();
}

// 官方闲置模式（原逻辑保留）
function startIdleMode() {
  const baseTime = extensionSettings.timer * 1000;
  const randomOffset = extensionSettings.random ? (Math.random() * baseTime * 0.6 - baseTime * 0.3) : 0;
  const delay = baseTime + randomOffset;

  idleTimer = setTimeout(async () => {
    if (canSendMessage() && (Date.now() - lastActivity) >= baseTime) {
      await sendIdleMessage();
    }
    startIdleMode(); // 循环
  }, delay);
}

// 新增：定时模式（每日固定时间点）
function startFixedMode() {
  const nextTime = getNextFixedTime();
  if (!nextTime) {
    fixedTimer = setTimeout(startFixedMode, 60000); // 1分钟后重试
    return;
  }

  const delay = nextTime - Date.now();
  fixedTimer = setTimeout(async () => {
    if (canSendMessage()) await sendIdleMessage();
    startFixedMode(); // 循环
  }, delay);
}

// 计算下一个定时时间点
function getNextFixedTime() {
  const now = new Date();
  const currentMinute = now.getHours() * 60 + now.getMinutes();

  // 筛选有效时间点
  const validTimes = extensionSettings.fixedMode.times
    .map(t => ({ ...t, total: t.hour * 60 + t.minute }))
    .filter(t => t.total >= 0 && t.total < 1440); // 0-23:59

  if (validTimes.length === 0) return null;

  // 查找当天或次日的时间点
  for (const time of validTimes) {
    if (time.total > currentMinute) {
      const next = new Date();
      next.setHours(time.hour, time.minute, 0, 0);
      return next.getTime();
    }
  }

  // 次日第一个时间点
  const firstTime = validTimes.sort((a, b) => a.total - b.total)[0];
  const next = new Date();
  next.setDate(next.getDate() + 1);
  next.setHours(firstTime.hour, firstTime.minute, 0, 0);
  return next.getTime();
}

// 新增：随机间隔模式
function startIntervalMode() {
  const { min, max } = extensionSettings.intervalMode;
  const delay = (Math.random() * (max - min) + min) * 1000;

  intervalTimer = setTimeout(async () => {
    if (canSendMessage()) await sendIdleMessage();
    startIntervalMode(); // 循环
  }, delay);
}

// 检查是否可以发送消息（整合官方条件）
function canSendMessage() {
  if (!extensionSettings.enabled) return false;
  if (useCount >= extensionSettings.maxUses && extensionSettings.maxUses > 0) return false;
  if (window.app.conversations.getCurrent()?.messages.length === 0) return false; // 空对话不发送
  return true;
}

// 发送消息（复用官方发送逻辑）
async function sendIdleMessage() {
  useCount++;
  const conversation = window.app.conversations.getCurrent();
  if (!conversation) return;

  // 随机选择提示词
  const prompt = extensionSettings.prompts[Math.floor(Math.random() * extensionSettings.prompts.length)];

  // 调用官方AI生成
  const response = await window.app.ai.generate({
    prompt: prompt,
    context: conversation.messages,
    model: conversation.model,
    parameters: conversation.parameters
  });

  if (response.text) {
    // 官方方式添加消息
    window.app.conversations.addMessage({
      sender: extensionSettings.sender,
      text: response.text,
      timestamp: new Date().toISOString()
    });
    window.app.ui.refreshMessages();
  }
}

// 同步UI配置（官方规范）
function updateSettingsFromUI() {
  saveSettings();
  resetAllTimers();
}

// 暴露扩展接口（官方标准）
window.idleAutoMessage = {
  setup,
  updateSettingsFromUI,
  getSettings: () => ({ ...extensionSettings }),
  defaultSettings
};

// 初始化
document.addEventListener("DOMContentLoaded", setup);
