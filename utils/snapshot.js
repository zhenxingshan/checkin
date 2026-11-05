// 首屏快照：把上一次的用户、任务与签到原始记录同步存在本机。
// 冷启动时先用它渲染出完整页面，网络请求只在后台校正数据，避免等接口期间白屏。
// 只存原始数据，日历/统计一律用当天的日期重算，跨天跨月不会显示旧状态。

const KEY = 'daily_checkin_snapshot_v1';
const VERSION = 1;

function read() {
    try {
        const raw = wx.getStorageSync(KEY);
        if (!raw || typeof raw !== 'object' || raw.v !== VERSION) return null;
        if (!raw.user || !Array.isArray(raw.tasks) || !Array.isArray(raw.rows)) return null;
        return raw;
    } catch (error) {
        return null;
    }
}

function write(payload) {
    try {
        if (!payload || !payload.user) return;
        wx.setStorageSync(KEY, {
            v: VERSION,
            user: payload.user,
            tasks: payload.tasks || [],
            activeTaskId: payload.activeTaskId || null,
            rows: payload.rows || [],
            rowsTaskId: payload.rowsTaskId || null,
        });
    } catch (error) {
        // 存储不可用/超限时忽略，下次冷启动退回骨架屏，不影响主流程。
    }
}

function clear() {
    try {
        wx.removeStorageSync(KEY);
    } catch (error) {
        // ignore
    }
}

module.exports = {
    read: read,
    write: write,
    clear: clear,
};
