// 首屏快照：把上一次的用户、任务与签到原始记录同步存在本机。
// 冷启动时先用它渲染出完整页面，网络请求只在后台校正数据，避免等接口期间白屏。
// 只存页面真正用到的字段，日历/统计一律用当天的日期重算，跨天跨月不会显示旧状态。
// 后端已不下发自增主键等内部字段，这里再按白名单兜一层，并清掉旧快照里的残留。

const KEY = 'daily_checkin_snapshot_v1';
const VERSION = 1;

const USER_FIELDS = ['openid', 'nickname', 'avatar', 'logged_in', 'created_at', 'points'];
const TASK_FIELDS = ['id', 'title', 'icon', 'color'];
const ROW_FIELDS = ['date', 'time', 'earned_points'];

function pick(source, fields) {
    if (!source || typeof source !== 'object') return null;
    const safe = {};
    fields.forEach(function (key) {
        if (source[key] !== undefined) safe[key] = source[key];
    });
    return safe;
}

function pickList(list, fields) {
    if (!Array.isArray(list)) return [];
    return list.map(function (item) {
        return pick(item, fields) || {};
    });
}

// 统一收敛读写两端：任何多余字段（用户 id、内部状态、记录 id/外键/时间戳）都不会落到本机。
function normalize(raw) {
    return {
        v: VERSION,
        user: pick(raw.user, USER_FIELDS),
        tasks: pickList(raw.tasks, TASK_FIELDS),
        activeTaskId: raw.activeTaskId || null,
        rows: pickList(raw.rows, ROW_FIELDS),
        rowsTaskId: raw.rowsTaskId || null,
    };
}

function read() {
    try {
        const raw = wx.getStorageSync(KEY);
        if (!raw || typeof raw !== 'object' || raw.v !== VERSION) return null;
        if (!raw.user || !Array.isArray(raw.tasks) || !Array.isArray(raw.rows)) return null;
        const clean = normalize(raw);
        if (!clean.user) return null;
        // 回写一次清洗结果，把老版本快照里残留的 id / 内部字段真正抹掉。
        write(clean);
        return clean;
    } catch (error) {
        return null;
    }
}

function write(payload) {
    try {
        if (!payload || !payload.user) return;
        const clean = normalize(payload);
        if (!clean.user) return;
        wx.setStorageSync(KEY, clean);
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
