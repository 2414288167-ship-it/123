// 扩展唯一标识
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

// 初始化扩展
async function setup() {
    try {
        // 1. 加载配置界面
        await loadSettingsUI();
        // 2. 加载保存的配置
        loadSettings();
        // 3. 注册事件监听
        registerEventListeners();
        // 4. 启动模式（仅当启用时）
        if (extension_settings[EXTENSION_ID].enabled) {
            startAllModes();
        }
    } catch (error) {
        console.error(`[${EXTENSION_ID}] 初始化失败:`, error);
    }
}

// 加载配置界面
async function loadSettingsUI() {
    try {
        const uiHtml = await renderExtensionTemplate(EXTENSION_ID, "dropdown");
        const settingsContainer = document.getElementById("extensions_settings2") 
            || document.createElement("div");
        settingsContainer.innerHTML += uiHtml;
        document.body.appendChild(settingsContainer);
    } catch (error) {
        console.error(`[${EXTENSION_ID}] 加载UI失败:`, error);
    }
}

// 加载本地配置
function loadSettings() {
    const saved = localStorage.getItem(`${EXTENSION_ID}_settings`);
    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            extension_settings[EXTENSION_ID] = { 
                ...extension_settings[EXTENSION_ID], 
                ...parsed 
            };
        } catch (error) {
            console.error(`[${EXTENSION_ID}] 加载配置失败:`, error);
        }
    }
}

// 保存配置
function saveSettings() {
    try {
        localStorage.setItem(
            `${EXTENSION_ID}_settings`,
            JSON.stringify(extension_settings[EXTENSION_ID])
        );
    } catch (error) {
        console.error(`[${EXTENSION_ID}] 保存配置失败:`, error);
    }
}

// 注册事件监听
function registerEventListeners() {
    // 监听用户输入
    document.addEventListener('input', updateLastUserInput);
    document.addEventListener('touchend', updateLastUserInput);
    
    // 监听对话切换
    eventSource.on('conversation_changed', () => {
        stopAllModes();
        if (extension_settings[EXTENSION_ID].enabled) {
            startAllModes();
        }
    });
}

// 更新用户输入时间
function updateLastUserInput() {
    lastUserInputTime = Date.now();
}

// 启动所有模式
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

// 定时模式
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
    const config = extension_settings[EXTENSION_ID];
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
        
        const delay = Math.floor(
            Math.random() * (config.maxRandomInterval - config.minRandomInterval + 1)
            + config.minRandomInterval
        ) * 1000;
        
        randomModeTimer = setTimeout(run, delay);
    };
    
    run();
}

// 尝试发送消息
async function trySendAutoMessage(mode) {
    const config = extension_settings[EXTENSION_ID];
    const now = Date.now();
    const nowSeconds = now / 1000;
    
    if ((nowSeconds - lastAutoMessageTime) < config.minMessageGap) return;
    
    const idleThreshold = mode === "fixed" ? 1800 : config.maxRandomInterval;
    const isIdle = (nowSeconds - (lastUserInputTime / 1000)) >= idleThreshold;
    if (config.onlyWhenIdle && !isIdle) return;
    
    const success = await sendAutoMessage();
    if (success) lastAutoMessageTime = nowSeconds;
}

// 发送AI消息
async function sendAutoMessage() {
    try {
        const config = extension_settings[EXTENSION_ID];
        if (!config.prompts || config.prompts.length === 0) return false;
        
        const randomPrompt = config.prompts[
            Math.floor(Math.random() * config.prompts.length)
        ];
        
        const result = await sendNarratorMessage(randomPrompt);
        return !!result;
    } catch (error) {
        console.error(`[${EXTENSION_ID}] 发送消息失败:`, error);
        return false;
    }
}

// 注册扩展
window.extensions.register({
    id: EXTENSION_ID,
    name: "Auto AI Message",
    setup,
    async updateFromUI() {
        saveSettings();
        stopAllModes();
        if (extension_settings[EXTENSION_ID].enabled) {
            startAllModes();
        }
    },
    getSettings: () => extension_settings[EXTENSION_ID],
    version: "1.3.0",
    author: "2414288167-ship-it",
    description: "AI自动发送消息（支持定时时间点和随机模式）"
});

// DOM加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
    if (!window.extensions?.isRegistered(EXTENSION_ID)) {
        setup();
    }
});
