// 独立线程：负责后台定时器调度，不受页面休眠影响
let unifiedTimer = null; // 统一定时器
let batchTimer = null;   // 批量消息定时器

// 接收主线程消息
self.onmessage = (e) => {
    const { type, delayMs, intervalMs } = e.data;
    switch (type) {
        case 'startUnifiedTimer':
            // 启动统一定时器（闲置/计划任务）
            clearTimeout(unifiedTimer);
            unifiedTimer = setTimeout(() => {
                self.postMessage({ type: 'unifiedTimerFired' });
            }, delayMs);
            break;
        case 'startBatchTimer':
            // 启动批量消息定时器
            clearTimeout(batchTimer);
            batchTimer = setTimeout(() => {
                self.postMessage({ type: 'batchTimerFired' });
            }, intervalMs);
            break;
        case 'stopAllTimers':
            // 停止所有定时器
            clearTimeout(unifiedTimer);
            clearTimeout(batchTimer);
            unifiedTimer = null;
            batchTimer = null;
            break;
    }
};

// 线程关闭时清理定时器
self.onclose = () => {
    clearTimeout(unifiedTimer);
    clearTimeout(batchTimer);
};
