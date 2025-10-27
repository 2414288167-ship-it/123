// 调整导入路径（根据实际目录层级确认，确保能正确找到核心文件）
import {
    saveSettingsDebounced,  // 官方防抖保存函数
    substituteParams,
} from '../../../../script.js';
import { debounce } from '../../../utils.js';
import { promptQuietForLoudResponse, sendNarratorMessage } from '../../../slash-commands.js';
import { 
    extension_settings,  // 官方配置存储对象
    getContext, 
    renderExtensionTemplateAsync  // 官方UI模板加载函数
} from '../../../extensions.js';
import { registerSlashCommand } from '../../../slash-commands.js';

// 扩展唯一标识（与manifest.json的id一致）
const EXTENSION_ID = "123123";

// 初始化官方配置（若不存在则创建默认配置）
if (!extension_settings[EXTENSION_ID]) {
    extension_settings[EXTENSION_ID] = {
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
    };
}

// 定时器与状态变量
let fixedModeTimer = null;
let randomModeTimer = null;
let lastAutoMessageTime = 0;
let lastUserInputTime = Date.now();

// 初始化扩展（官方规范：整合UI加载、配置加载、事件注册）
async function setup() {
    // 1. 加载配置界面（关键：使用官方模板加载函数）
    await loadSettingsUI();
    // 2. 加载保存的配置
    loadSettings();
    // 3. 注册事件监听
    registerEventListeners();
    // 4. 启动模式（仅当启用时）
    if (extension_settings[EXTENSION_ID].enabled) {
        startAllModes();
    }
}

// 加载配置界面（官方规范：使用renderExtensionTemplateAsync注入UI）
async function loadSettingsUI() {
    try {
        // 加载dropdown.html模板，注入到官方扩展设置区域
        const uiHtml = await renderExtensionTemplateAsync(EXTENSION_ID, "dropdown");
        const settingsContainer = document.getElementById("extensions_settings2") 
            || document.createElement("div");
        settingsContainer.innerHTML += uiHtml;  // 追加UI到容器
        document.body.appendChild(settingsContainer);
    } catch (error) {
        console.error(`[${EXTENSION_ID}] 加载UI失败:`, error);
    }
}

// 加载本地配置（从官方存储中读取，与extension_settings同步）
function loadSettings() {
    const saved = window.extensions.getStorage(EXTENSION_ID);
    if (saved) {
        // 合并保存的配置到官方配置对象
        extension_settings[EXTENSION_ID] = { 
            ...extension_settings[EXTENSION_ID], 
            ...saved 
        };
    }
}

// 保存配置（使用官方防抖函数，避免频繁IO）
function saveSettings() {
    saveSettingsDebounced(EXTENSION_ID);  // 官方规范：传入扩展ID
}

// 注册事件监听（兼容官方生命周期）
function registerEventListeners() {
    // 监听用户输入（键盘+触摸）
    document.addEventListener('input', updateLastUserInput);
    document.addEventListener('touchend', updateLastUserInput);
    
    // 监听对话切换（官方事件）
    window.conversations.on('conversation_changed', () => {
        stopAllModes();
        if (extension_settings[EXTENSION_ID].enabled) {
            startAllModes();
        }
    });

    // 监听扩展启用状态变化（官方规范：通过扩展ID监听）
    window.extensions.on(`enabled:${EXTENSION_ID}`, (enabled) => {
        if (enabled) {
            startAllModes();
        } else {
            stopAllModes();
        }
    });
}

// 更新用户输入时间
function updateLastUserInput() {
    lastUserInputTime = Date.now();
}

// 启动所有模式（使用官方配置对象）
function startAllModes() {
    const config = extension_settings[EXTENSION_ID];
    if (!config.enabled) return;
    
    if (config.enableFixedMode && config.fixedTimes?.length > 0) {
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
        fixedModeTimer = setTimeout(startFixedMode, 10000);  // 10秒后重试
        return;
    }
    
    const delay = nextTime - Date.now();
    fixedModeTimer = setTimeout(async () => {
        await trySendAutoMessage("fixed");
        startFixedMode();  // 循环触发
    }, delay);
}

// 计算下一个定时时间点
function getNextFixedTime() {
    const config = extension_settings[EXTENSION_ID];
    if (!config.fixedTimes || config.fixedTimes.length === 0) return null;
    
    const now = new Date();
    const currentTotalMinutes = now.getHours() * 60 + now.getMinutes();
    
    // 排序时间点
    const sortedTimes = [...config.fixedTimes]
        .map(t => ({ ...t, total: t.hour * 60 + t.minute }))
        .sort((a, b) => a.total - b.total);
    
    // 查找当天的下一个时间点
    for (const time of sortedTimes) {
        if (time.total > currentTotalMinutes) {
            const next = new Date();
            next.setHours(time.hour, time.minute, 0, 0);
            return next.getTime();
        }
    }
    
    // 当天无剩余时间点，取次日第一个
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
        const config = extension_settings[EXTENSION_ID];
        if (!config.enabled || !config.enableRandomMode) return;
        
        await trySendAutoMessage("random");
        
        // 计算下一次间隔（秒转毫秒）
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
    const config = extension_settings[EXTENSION_ID];
    const now = Date.now();
    const nowSeconds = now / 1000;
    
    // 最小间隔检查
    if ((nowSeconds - lastAutoMessageTime) < config.minMessageGap) return;
    
    // 闲置检查（定时模式默认30分钟=1800秒，随机模式用最大间隔）
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
        const prompts = extension_settings[EXTENSION_ID].prompts;
        if (!prompts || prompts.length === 0) return false;
        const randomPrompt = prompts[Math.floor(Math.random() * prompts.length)];
        
        // 调用官方AI生成接口
        const response = await window.ai.generate({
            prompt: randomPrompt,
            context: conversation.messages,
            model: conversation.model,
            parameters: conversation.parameters
        });
        
        if (response?.text) {
            // 添加消息到对话（官方方法）
            window.conversations.addMessage({
                sender: "ai",
                text: response.text,
                timestamp: new Date().toISOString()
            });
            window.ui.refreshMessages();  // 刷新UI显示
            return true;
        }
        return false;
    } catch (error) {
        console.error(`[${EXTENSION_ID}] 发送消息失败:`, error);
        return false;
    }
}

// 同步UI配置到扩展（官方规范：UI修改后回调）
function updateFromUI() {
    saveSettings();  // 保存配置
    stopAllModes();  // 重启模式使配置生效
    if (extension_settings[EXTENSION_ID].enabled) {
        startAllModes();
    }
}

// 注册扩展到官方系统（核心：让SillyTavern识别插件）
window.extensions.register({
    id: "123123", // 改为字符串形式
    name: "Auto AI Message",  
    setup: setup,  
    updateFromUI: updateFromUI,  
    getSettings: () => extension_settings[EXTENSION_ID],  
    version: "1.3.0",  
    author: "2414288167-ship-it",
    description: "AI自动发送消息（支持定时时间点和随机模式）"
});

// 兼容旧版本初始化（冗余保障）
document.addEventListener('DOMContentLoaded', () => {
    if (!window.extensions.isRegistered("123123")) { // 同步改为字符串
        setup();
    }
});
