/**
 * AI 主动发消息扩展（适配SillyTavern手机端）
 * 功能：1. 定时主动发送消息 2. 用户长时间未发言时主动发送消息
 * 导入方式：SillyTavern → Extensions → Add Extension → 输入GitHub Raw文件URL
 */

// 扩展元数据（SillyTavern 识别用）
const extensionMetadata = {
    name: "AI Auto Message",
    version: "1.0.0",
    author: "Your Name",
    description: "让AI在定时或用户沉默时主动发消息（适配手机端）",
    requiredCoreVersion: "1.10.0", // 兼容的SillyTavern版本
};

// 配置项（可在SillyTavern的扩展设置中修改）
let config = {
    // 定时模式：每隔X分钟发送一次（0表示关闭）
    intervalMinutes: 5,
    // 沉默超时模式：用户X分钟未发消息则触发（0表示关闭）
    inactivityTimeoutMinutes: 10,
    // AI主动消息的提示词（引导AI生成合适的内容）
    promptTemplate: "作为聊天助手，主动发起一个轻松的话题或关心对方，保持自然简短：",
    // 调试模式（在控制台打印日志）
    debugMode: false,
};

// 内部变量
let intervalTimer = null; // 定时任务计时器
let inactivityTimer = null; // 沉默超时计时器
let lastUserMessageTime = Date.now(); // 最后一条用户消息的时间

// 日志工具
const log = (message) => {
    if (config.debugMode) console.log(`[AI Auto Message] ${message}`);
};

// 重置沉默超时计时器（用户发送消息时调用）
const resetInactivityTimer = () => {
    if (config.inactivityTimeoutMinutes <= 0) return;
    clearTimeout(inactivityTimer);
    lastUserMessageTime = Date.now();
    const timeoutMs = config.inactivityTimeoutMinutes * 60 * 1000;
    inactivityTimer = setTimeout(() => {
        log(`用户已沉默${config.inactivityTimeoutMinutes}分钟，触发主动消息`);
        sendAutoMessage();
    }, timeoutMs);
    log(`重置沉默计时器（${config.inactivityTimeoutMinutes}分钟后触发）`);
};

// 启动定时发送任务
const startIntervalTimer = () => {
    if (config.intervalMinutes <= 0) return;
    clearInterval(intervalTimer);
    const intervalMs = config.intervalMinutes * 60 * 1000;
    intervalTimer = setInterval(() => {
        log(`定时触发（每${config.intervalMinutes}分钟），发送主动消息`);
        sendAutoMessage();
    }, intervalMs);
    log(`启动定时任务（每${config.intervalMinutes}分钟一次）`);
};

// 让AI生成并发送主动消息
const sendAutoMessage = async () => {
    try {
        // 检查是否在聊天中（避免无对话时触发）
        if (!app.chat || app.chat.messages.length === 0) {
            log("无活跃对话，跳过主动消息");
            return;
        }

        // 构建AI提示词（结合历史上下文）
        const prompt = `${config.promptTemplate}\n\n历史对话摘要：${getChatSummary()}`;

        // 调用SillyTavern的AI生成接口（核心API）
        const response = await app.generateText({
            prompt: prompt,
            // 传递当前对话ID，确保消息进入正确会话
            chatId: app.chat.id,
            // 限制AI消息长度（手机端体验优化）
            maxTokens: 150,
        });

        // 发送生成的消息到聊天界面
        if (response && response.text) {
            app.addMessage({
                sender: "ai", // 标记为AI发送
                text: response.text.trim(),
                timestamp: new Date().toISOString(),
            });
            log("AI主动消息发送成功");
        }
    } catch (error) {
        log(`发送失败：${error.message}`);
    }
};

// 获取聊天摘要（用于辅助AI生成上下文相关消息）
const getChatSummary = () => {
    // 取最近3条消息作为上下文（避免过长）
    const recentMessages = app.chat.messages.slice(-3);
    return recentMessages.map(msg => 
        `${msg.sender === 'user' ? '用户' : 'AI'}: ${msg.text.substring(0, 50)}...`
    ).join(' ');
};

// 初始化扩展
const initExtension = () => {
    log("扩展初始化成功");

    // 启动定时器
    startIntervalTimer();
    resetInactivityTimer();

    // 监听用户发送消息事件（用于重置沉默计时器）
    app.events.on("message_sent", (message) => {
        if (message.sender === "user") {
            resetInactivityTimer();
        }
    });

    // 监听扩展配置修改事件（用户在设置中修改参数后生效）
    app.events.on("extension_config_updated", (newConfig) => {
        config = { ...config, ...newConfig };
        log("配置已更新，重启定时器");
        startIntervalTimer();
        resetInactivityTimer();
    });
};

// 注册扩展到SillyTavern
module.exports = {
    metadata: extensionMetadata,
    defaultConfig: config, // 默认配置（会显示在扩展设置中）
    init: initExtension,
    // 清理函数（卸载扩展时停止定时器）
    cleanup: () => {
        clearInterval(intervalTimer);
        clearTimeout(inactivityTimer);
        log("扩展已卸载，清理完成");
    },
};
