// 全局配置（定时模式改为时间点数组）
let config = {
  enabled: true,
  enableFixedMode: true,       // 定时模式（特定时间点）
  enableRandomMode: false,     // 随机模式
  fixedTimes: [{ hour: 8, minute: 30 }, { hour: 18,  minute: 0 }], // 定时模式的时间点
  minRandomInterval: 10,       // 随机模式最小间隔（秒）
  maxRandomInterval: 60,       // 随机模式最大间隔（秒）
  minMessageGap: 5,            // 两次消息最小间隔（秒）
  onlyWhenIdle: true           // 仅当用户空闲时发送
};

// 定时器与状态变量
let fixedModeTimer = null;     // 定时模式定时器
let randomModeTimer = null;    // 随机模式定时器
let lastAutoMessageTime = 0;   // 最后一次发送时间（秒）
let lastUserInputTime = Date.now(); // 最后一次用户输入时间

// 环境判断
const isBrowser = typeof window !== 'undefined';

// 非浏览器环境模拟
if (!isBrowser) {
  global.window = {
    extensions: { getStorage: () => null, setStorage: () => {}, register: () => {} },
    conversations: { getCurrent: () => null, addMessage: () => {} },
    ai: { generate: async () => ({ text: '' }) },
    ui: { refreshMessages: () => {} }
  };
}

// 更新用户输入时间（支持手机触摸）
function updateLastUserInput() {
  lastUserInputTime = Date.now();
}

// 初始化插件
function init() {
  if (!isBrowser) return;

  loadConfig();
  
  window.extensions.register({
    id: "auto-ai-message",
    name: "Auto AI Message Sender",
    onLoad: startAllModes,
    onUnload: stopAllModes,
    onSettingsSave: saveConfig
  });

  // 监听用户输入（支持手机触摸）
  document.addEventListener('input', updateLastUserInput);
  document.addEventListener('touchend', updateLastUserInput);
}

// 加载配置
function loadConfig() {
  const saved = window.extensions.getStorage("auto-ai-message-config");
  if (saved) config = { ...config, ...saved };
}

// 保存配置
function saveConfig(newConfig) {
  config = { ...config, ...newConfig };
  window.extensions.setStorage("auto-ai-message-config", config);
  stopAllModes();
  startAllModes();
}

// 启动所有模式
function startAllModes() {
  if (!config.enabled) return;
  if (config.enableFixedMode && config.fixedTimes.length > 0) {
    startFixedMode(); // 定时模式（时间点）
  }
  if (config.enableRandomMode) {
    startRandomMode(); // 随机模式
  }
}

// 停止所有模式
function stopAllModes() {
  if (fixedModeTimer) clearTimeout(fixedModeTimer);
  if (randomModeTimer) clearTimeout(randomModeTimer);
  fixedModeTimer = randomModeTimer = null;
}

// 定时模式（核心：计算下一个时间点并触发）
function startFixedMode() {
  // 清除现有定时器
  if (fixedModeTimer) clearTimeout(fixedModeTimer);

  // 计算下一个目标时间点（毫秒）
  const nextTime = getNextFixedTime();
  if (!nextTime) {
    // 没有有效时间点，10秒后重试
    fixedModeTimer = setTimeout(startFixedMode, 10000);
    return;
  }

  // 计算当前到下一个时间点的差值（毫秒）
  const now = Date.now();
  const delay = nextTime - now;

  // 设置定时器，到达时间点后发送消息并重新计算下一次
  fixedModeTimer = setTimeout(async () => {
    await trySendAutoMessage("fixed");
    startFixedMode(); // 循环触发
  }, delay);
}

// 计算下一个定时模式的时间点（毫秒）
function getNextFixedTime() {
  if (!config.fixedTimes || config.fixedTimes.length === 0) return null;

  const now = new Date();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();
  const currentTotalMinutes = currentHour * 60 + currentMinute;

  // 对时间点排序（按一天中的分钟数）
  const sortedTimes = [...config.fixedTimes]
    .map(time => ({ ...time, totalMinutes: time.hour * 60 + time.minute }))
    .sort((a, b) => a.totalMinutes - b.totalMinutes);

  // 寻找今天的下一个时间点
  for (const time of sortedTimes) {
    if (time.totalMinutes > currentTotalMinutes) {
      // 今天的时间点
      const next = new Date();
      next.setHours(time.hour, time.minute, 0, 0);
      return next.getTime();
    }
  }

  // 今天的时间点已过，取明天的第一个时间点
  const firstTime = sortedTimes[0];
  const next = new Date();
  next.setDate(next.getDate() + 1); // 加一天
  next.setHours(firstTime.hour, firstTime.minute, 0, 0);
  return next.getTime();
}

// 随机模式（保持不变）
function startRandomMode() {
  if (randomModeTimer) clearTimeout(randomModeTimer);
  
  const runRandom = async () => {
    if (!config.enabled || !config.enableRandomMode) return;
    
    await trySendAutoMessage("random");
    
    const randomDelay = Math.floor(
      Math.random() * (config.maxRandomInterval - config.minRandomInterval + 1)
      + config.minRandomInterval
    ) * 1000;
    
    randomModeTimer = setTimeout(runRandom, randomDelay);
  };
  
  runRandom();
}

// 尝试发送消息（核心判断）
async function trySendAutoMessage(mode) {
  const now = Date.now();
  const nowSeconds = now / 1000;

  // 检查最小消息间隔
  if ((nowSeconds - lastAutoMessageTime) < config.minMessageGap) return;

  // 检查用户是否空闲（定时模式用30分钟作为默认空闲阈值，可调整）
  const idleThreshold = mode === "fixed" ? 1800 : config.maxRandomInterval; // 30分钟=1800秒
  const isIdle = (nowSeconds - (lastUserInputTime / 1000)) >= idleThreshold;
  if (config.onlyWhenIdle && !isIdle) return;

  // 发送消息
  const success = await sendAutoMessage();
  if (success) lastAutoMessageTime = nowSeconds;
}

// 发送AI消息（保持不变）
async function sendAutoMessage() {
  try {
    const conversation = window.conversations.getCurrent();
    if (!conversation) return false;

    const response = await window.ai.generate({
      prompt: buildAutoPrompt(conversation),
      context: conversation.messages,
      model: conversation.model,
      parameters: conversation.parameters
    });

    if (response?.text) {
      window.conversations.addMessage({
        sender: "ai",
        text: response.text,
        timestamp: new Date().toISOString()
      });
      window.ui.refreshMessages();
      return true;
    }
    return false;
  } catch (error) {
    console.error("Auto AI Message Error:", error);
    return false;
  }
}

// 构建提示词（保持不变）
function buildAutoPrompt(conversation) {
  return `基于之前的对话历史，主动发送一条符合当前语境的消息，保持自然交流节奏。回复要简洁自然，不要过于冗长。`;
}

// 初始化（仅浏览器环境）
if (isBrowser) init();
