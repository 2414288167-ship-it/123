import {
    saveSettingsDebounced,
    substituteParams,
} from '../../../../script.js';
import { debounce } from '../../../utils.js';
import { promptQuietForLoudResponse, sendMessageAs, sendNarratorMessage } from '../../../slash-commands.js';
import { extension_settings, getContext, renderExtensionTemplateAsync } from '../../../extensions.js';
import { registerSlashCommand } from '../../../slash-commands.js';


// 扩展配置（遵循官方扩展变量规范）
const extensionSettings = {
  autoAiMessage: {
    enabled: true,
    enableFixedMode: true,
    enableRandomMode: false,
    fixedTimes: [{ hour: 8, minute: 30 }, { hour: 18, minute: 0 }],
    minRandomInterval: 10,
    maxRandomInterval: 60,
    minMessageGap: 5,
    onlyWhenIdle: true,
    prompts: [
      "基于之前的对话，自然地继续交流吧。",
      "有什么想聊的吗？我很乐意继续。",
      "接着刚才的话题，你觉得呢？"
    ]
  }
};

// 定时器与状态变量
let fixedModeTimer = null;
let randomModeTimer = null;
let lastAutoMessageTime = 0;
let lastUserInputTime = Date.now();

// 初始化扩展（官方规范：使用setup函数）
function setup() {
  // 加载保存的配置（存储键改为123123，与id一致）
  loadSettings();
  // 注册事件监听
  registerEventListeners();
  // 启动模式
  startAllModes();
}

// 加载本地配置（存储键从auto-ai-message改为123123）
function loadSettings() {
  const saved = window.extensions.getStorage("123123"); // 关键修改：与id一致
  if (saved) {
    extensionSettings.autoAiMessage = { ...extensionSettings.autoAiMessage, ...saved };
  }
}

// 保存配置（存储键从auto-ai-message改为123123）
function saveSettings() {
  window.extensions.setStorage("123123", extensionSettings.autoAiMessage); // 关键修改：与id一致
}

// 注册事件监听（用户输入/对话变化）
function registerEventListeners() {
  // 监听用户输入（键盘+触摸）
  document.addEventListener('input', updateLastUserInput);
  document.addEventListener('touchend', updateLastUserInput);
  
  // 监听对话切换
  window.conversations.on('conversation_changed', () => {
    stopAllModes();
    startAllModes();
  });
}

// 更新用户输入时间
function updateLastUserInput() {
  lastUserInputTime = Date.now();
}

// 启动所有模式
function startAllModes() {
  const config = extensionSettings.autoAiMessage;
  if (!config.enabled) return;
  
  if (config.enableFixedMode && config.fixedTimes.length > 0) {
    startFixedMode();
  }
  if (config.enableRandomMode) {
    startRandomMode();
  }
}

// 停止所有模式
function stopAllModes() {
  if (fixedModeTimer) clearTimeout(fixedModeTimer);
  if (randomModeTimer) clearTimeout(randomModeTimer);
  fixedModeTimer = randomModeTimer = null;
}

// 定时模式（时间点触发）
function startFixedMode() {
  if (fixedModeTimer) clearTimeout(fixedModeTimer);
  
  const nextTime = getNextFixedTime();
  if (!nextTime) {
    fixedModeTimer = setTimeout(startFixedMode, 10000);
    return;
  }
  
  const delay = nextTime - Date.now();
  fixedModeTimer = setTimeout(async () => {
    await trySendAutoMessage("fixed");
    startFixedMode();
  }, delay);
}

// 计算下一个定时时间点
function getNextFixedTime() {
  const config = extensionSettings.autoAiMessage;
  if (!config.fixedTimes || config.fixedTimes.length === 0) return null;
  
  const now = new Date();
  const currentTotalMinutes = now.getHours() * 60 + now.getMinutes();
  
  const sortedTimes = [...config.fixedTimes]
    .map(t => ({ ...t, total: t.hour * 60 + t.minute }))
    .sort((a, b) => a.total - b.total);
  
  for (const time of sortedTimes) {
    if (time.total > currentTotalMinutes) {
      const next = new Date();
      next.setHours(time.hour, time.minute, 0, 0);
      return next.getTime();
    }
  }
  
  // 次日第一个时间点
  const first = sortedTimes[0];
  const next = new Date();
  next.setDate(next.getDate() + 1);
  next.setHours(first.hour, first.minute, 0, 0);
  return next.getTime();
}

// 随机模式
function startRandomMode() {
  if (randomModeTimer) clearTimeout(randomModeTimer);
  
  const run = async () => {
    const config = extensionSettings.autoAiMessage;
    if (!config.enabled || !config.enableRandomMode) return;
    
    await trySendAutoMessage("random");
    
    const delay = Math.floor(
      Math.random() * (config.maxRandomInterval - config.minRandomInterval + 1)
      + config.minRandomInterval
    ) * 1000;
    
    randomModeTimer = setTimeout(run, delay);
  };
  
  run();
}

// 尝试发送消息（检查条件）
async function trySendAutoMessage(mode) {
  const config = extensionSettings.autoAiMessage;
  const now = Date.now();
  const nowSeconds = now / 1000;
  
  // 最小间隔检查
  if ((nowSeconds - lastAutoMessageTime) < config.minMessageGap) return;
  
  // 闲置检查
  const idleThreshold = mode === "fixed" ? 1800 : config.maxRandomInterval;
  const isIdle = (nowSeconds - (lastUserInputTime / 1000)) >= idleThreshold;
  if (config.onlyWhenIdle && !isIdle) return;
  
  // 发送消息
  const success = await sendAutoMessage();
  if (success) lastAutoMessageTime = nowSeconds;
}

// 发送AI消息（使用官方API）
async function sendAutoMessage() {
  try {
    const conversation = window.conversations.getCurrent();
    if (!conversation) return false;
    
    // 随机选择提示词
    const prompts = extensionSettings.autoAiMessage.prompts;
    const randomPrompt = prompts[Math.floor(Math.random() * prompts.length)];
    
    const response = await window.ai.generate({
      prompt: randomPrompt,
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

// 同步UI配置到扩展（官方规范：设置界面回调）
function updateFromUI() {
  // 从dropdown.html同步配置（具体实现见UI部分）
  saveSettings();
  stopAllModes();
  startAllModes();
}

// 暴露扩展接口（官方规范，接口名可保持不变）
window.autoAiMessage = {
  setup,
  updateFromUI,
  getSettings: () => extensionSettings.autoAiMessage
};

// 初始化
document.addEventListener('DOMContentLoaded', setup);
